"""HTTP API for agents and operators (FastAPI).

Agents submit actions and poll their status. The API only *records* actions;
workers execute them. That split means an accepted action survives an API
crash, a worker crash, or both — it is durable the moment the API answers 201.

Interactive docs: run ``oneshot serve`` and open http://127.0.0.1:8700/docs
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import FastAPI, Header, HTTPException, Query, Response
from pydantic import BaseModel, Field

from oneshot.action_types import REGISTRY, InvalidPayload, get_action_type
from oneshot.config import Settings
from oneshot.domain import ActionStatus
from oneshot.provider_client import ProviderClient
from oneshot.reconciler import Reconciler, ReconciliationError
from oneshot.store import ActionStore, IdempotencyConflict


class SubmitRequest(BaseModel):
    type: str = Field(examples=["payment.charge"])
    payload: dict[str, Any] = Field(examples=[{"amount_cents": 1500, "currency": "USD", "customer": "cus_123"}])


class ResolveRequest(BaseModel):
    status: Literal["SUCCEEDED", "FAILED"]
    note: str = Field(min_length=3)
    actor: str = "operator"


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    store = ActionStore(settings.db_path)
    app = FastAPI(
        title="OneShot",
        version="0.1.0",
        description="Reliable action execution for AI agents (educational reference implementation).",
    )

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

    @app.post("/reconcile")
    def reconcile(apply: bool = True) -> dict[str, Any]:
        client = ProviderClient(settings)
        try:
            return Reconciler(store, client, settings).run(apply=apply).to_json()
        except ReconciliationError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        finally:
            client.close()

    return app
