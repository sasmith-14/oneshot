"""HTTP API for agents and operators (FastAPI).

Agents submit actions and poll their status. The API only *records* actions;
workers execute them. That split means an accepted action survives an API
crash, a worker crash, or both — it is durable the moment the API answers 201.

Interactive docs: run ``oneshot serve`` and open http://127.0.0.1:8700/docs
Web console (after ``make web-build``): http://127.0.0.1:8700/ui/
"""

from __future__ import annotations

import os
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, Header, HTTPException, Query, Response
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from pydantic import BaseModel, Field

from oneshot.action_types import REGISTRY, InvalidPayload, get_action_type
from oneshot import guarantees, learn
from oneshot.config import Settings
from oneshot.domain import ActionStatus
from oneshot.lab import Supervisor, create_lab_router, lab_manage_from_env
from oneshot.provider_client import ProviderClient
from oneshot.reconciler import Reconciler, ReconciliationError
from oneshot.store import ActionStore, IdempotencyConflict
from oneshot.worker import HEARTBEAT_INTERVAL_SECONDS

#: Where ``make web-build`` puts the compiled web console.
DEFAULT_WEB_DIST = Path(__file__).resolve().parent.parent / "web" / "dist"


def lab_enabled_from_env() -> bool:
    return os.environ.get("ONESHOT_LAB", "0") not in ("0", "", "false", "no")


class SubmitRequest(BaseModel):
    type: str = Field(examples=["payment.charge"])
    payload: dict[str, Any] = Field(examples=[{"amount_cents": 1500, "currency": "USD", "customer": "cus_123"}])


class ResolveRequest(BaseModel):
    status: Literal["SUCCEEDED", "FAILED"]
    note: str = Field(min_length=3)
    actor: str = "operator"


def create_app(
    settings: Settings | None = None,
    *,
    lab: bool | None = None,
    lab_manage: bool | None = None,
    web_dist: Path | None = None,
    docs_root: Path | None = None,
) -> FastAPI:
    settings = settings or Settings.from_env()
    lab = lab_enabled_from_env() if lab is None else lab
    lab_manage = lab and (lab_manage_from_env() if lab_manage is None else lab_manage)
    web_dist = web_dist or Path(os.environ.get("ONESHOT_WEB_DIST", DEFAULT_WEB_DIST))
    docs_root = docs_root or learn.ROOT
    store = ActionStore(settings.db_path)
    provider = ProviderClient(settings)  # shared; httpx.Client is thread-safe
    supervisor = Supervisor(settings, manage=lab_manage, var_dir=Path(settings.db_path).resolve().parent)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        supervisor.start()  # no-op unless lab mode manages the processes
        try:
            yield
        finally:
            supervisor.shutdown()
            provider.close()

    app = FastAPI(
        title="OneShot",
        version="0.1.0",
        description="Reliable action execution for AI agents (educational reference implementation).",
        lifespan=lifespan,
    )
    if lab:
        app.include_router(create_lab_router(store, settings, supervisor))

    @app.get("/healthz")
    def healthz() -> dict[str, Any]:
        return {"ok": True, "counts": store.counts()}

    @app.get("/action-types")
    def action_types() -> list[dict[str, Any]]:
        return [
            {"name": t.name, "idempotent_at_provider": t.idempotent, "provider_lookup": t.supports_lookup}
            for t in REGISTRY.values()
        ]

    @app.post("/actions", status_code=201)
    def submit(
        body: SubmitRequest,
        response: Response,
        idempotency_key: str | None = Header(
            None, alias="Idempotency-Key", max_length=200,
            description="Required. Unique per *intent*. Reuse it when retrying the same request.",
        ),
    ) -> dict[str, Any]:  # fmt: skip
        if not idempotency_key:
            # IETF idempotency-key draft: a required key that is missing -> 400.
            raise HTTPException(status_code=400, detail="Idempotency-Key header is required")
        try:
            action_type = get_action_type(body.type)
            payload = action_type.validate(body.payload)
        except InvalidPayload as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        try:
            action, created = store.submit(action_type.name, payload, idempotency_key)
        except IdempotencyConflict as exc:
            # IETF draft "The Idempotency-Key HTTP Header Field": reuse with a different payload -> 422.
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        if not created:
            response.status_code = 200
            response.headers["Idempotent-Replayed"] = "true"
        return action.to_json()

    @app.get("/actions")
    def list_actions(status: ActionStatus | None = Query(default=None)) -> list[dict[str, Any]]:
        return [a.to_json() for a in store.list(status)]

    @app.get("/actions/{action_id}")
    def get_action(action_id: str) -> dict[str, Any]:
        action = store.get(action_id)
        if action is None:
            raise HTTPException(status_code=404, detail="no such action")
        return action.to_json(detail=True)

    @app.post("/actions/{action_id}/resolve")
    def resolve(action_id: str, body: ResolveRequest) -> dict[str, Any]:
        """Manually resolve an UNKNOWN action after investigating it."""
        try:
            action = store.resolve(action_id, ActionStatus(body.status), body.note, actor=body.actor)
        except KeyError:
            raise HTTPException(status_code=404, detail="no such action") from None
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        return action.to_json(detail=True)

    @app.get("/actions/{action_id}/provider-record")
    def provider_record(action_id: str) -> dict[str, Any]:
        """What the provider's own ledger holds for this action (the authoritative
        answer to "did the effect happen?"). Same lookup as ``oneshot show``."""
        if store.get(action_id, detail=False) is None:
            raise HTTPException(status_code=404, detail="no such action")
        try:
            effects = provider.ledger(reference=action_id)
        except Exception as exc:  # noqa: BLE001 - any failure means "could not ask"
            raise HTTPException(status_code=503, detail=f"cannot reach the provider: {type(exc).__name__}") from exc
        return {"action_id": action_id, "checked_at": time.time(), "effects": effects}

    @app.get("/system/status")
    def system_status() -> dict[str, Any]:
        """Liveness for operators and the web console. Nothing here affects correctness."""
        now = time.time()
        reachable, error = provider.healthy()
        # A worker only beats between steps, and one step can take up to about
        # two provider timeouts (send + verify), so allow for that before calling it silent.
        silent_after = 3 * HEARTBEAT_INTERVAL_SECONDS + 2 * settings.provider_timeout_seconds
        workers = []
        for w in store.workers():
            age = now - w["last_seen_at"]
            state = "stopped" if w["stopped_at"] is not None else ("alive" if age <= silent_after else "silent")
            workers.append({**w, "state": state, "seconds_since_seen": round(age, 1)})
        return {
            "now": now,
            "lab": lab,
            "counts": store.counts(),
            "provider": {"url": settings.provider_url, "reachable": reachable, "error": error},
            "workers": workers,
            "worker_silent_after_seconds": silent_after,
            "settings": {
                "provider_timeout_seconds": settings.provider_timeout_seconds,
                "lease_seconds": settings.lease_seconds,
                "max_attempts": settings.max_attempts,
                "max_verifications": settings.max_verifications,
                "provider_settle_seconds": settings.provider_settle_seconds,
                "provider_key_retention_seconds": settings.provider_key_retention_seconds,
            },
        }

    @app.post("/reconcile")
    def reconcile(apply: bool = True) -> dict[str, Any]:
        """Compare every action with the provider's ledger. Each run is saved,
        and the response includes its ``run_id``."""
        try:
            report = Reconciler(store, provider, settings).run(apply=apply).to_json()
        except ReconciliationError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        report["run_id"] = store.save_reconcile_run(report)
        return report

    @app.get("/reconcile/runs")
    def reconcile_runs(limit: int = Query(default=50, ge=1, le=500)) -> list[dict[str, Any]]:
        return store.reconcile_runs(limit)

    @app.get("/reconcile/runs/{run_id}")
    def reconcile_run(run_id: int) -> dict[str, Any]:
        run = store.reconcile_run(run_id)
        if run is None:
            raise HTTPException(status_code=404, detail="no such reconciliation run")
        return run

    @app.get("/provider/ledger")
    def provider_ledger() -> dict[str, Any]:
        """Every effect in the provider's own ledger (what reconciliation reads)."""
        try:
            return {"checked_at": time.time(), "effects": provider.ledger()}
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=503, detail=f"cannot reach the provider: {type(exc).__name__}") from exc

    @app.get("/guarantees")
    def guarantee_checks() -> dict[str, Any]:
        """G1–G5 checked against current data (a dry run: changes nothing)."""
        alive = any(w["stopped_at"] is None and time.time() - w["last_seen_at"] < 15 for w in store.workers())
        return guarantees.check(store, provider, settings, worker_alive=alive)

    @app.get("/learn/docs")
    def learn_docs() -> list[dict[str, Any]]:
        return learn.list_docs(docs_root)

    @app.get("/learn/docs/{slug}")
    def learn_doc(slug: str) -> dict[str, Any]:
        doc = learn.render_doc(slug, docs_root)
        if doc is None:
            raise HTTPException(status_code=404, detail="no such document")
        return doc

    _mount_web_console(app, web_dist)
    return app


def _mount_web_console(app: FastAPI, dist: Path) -> None:
    """Serve the compiled React app at /ui/ (single-page app: unknown paths get index.html).

    It lives under /ui because the JSON API already owns root paths like /actions.
    """

    @app.get("/", include_in_schema=False)
    def root() -> RedirectResponse:
        return RedirectResponse("/ui/")

    @app.get("/ui", include_in_schema=False)
    @app.get("/ui/{path:path}", include_in_schema=False)
    def web_console(path: str = "") -> Response:
        index = dist / "index.html"
        if not index.is_file():
            return HTMLResponse(
                "<h1>OneShot web console is not built</h1><p>Run <code>make web-build</code> "
                "(needs Node), or use <code>make dev</code> for the live dev server. "
                "The JSON API is unaffected: see <a href='/docs'>/docs</a>.</p>",
                status_code=404,
            )
        candidate = (dist / path).resolve()
        if path and candidate.is_file() and candidate.is_relative_to(dist.resolve()):
            return FileResponse(candidate)
        return FileResponse(index)
