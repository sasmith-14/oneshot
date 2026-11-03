"""Lab mode: fault injection, process control and one-click failure presets.

This is **test/demo scaffolding for the web console**, not part of the product.
A real backend never controls its provider's failures. The routes exist only
when ``ONESHOT_LAB=1`` (``make dev`` sets it); otherwise they are not mounted at
all, so they return 404.

With ``ONESHOT_LAB_MANAGE=1`` the API process also *supervises* the fake
provider and one worker as child processes, so the console can kill and
restart them. A killed worker really is SIGKILLed, and a provider crash is a
real ``os._exit`` in the provider process. Nothing here mocks a failure.
"""

from __future__ import annotations

import os
import signal
import subprocess
import threading
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from fakeprovider.process import ProviderProcess
from oneshot.action_types import get_action_type
from oneshot.config import Settings
from oneshot.domain import ActionStatus
from oneshot.store import ActionStore
from oneshot.worker_process import spawn_worker


def lab_manage_from_env() -> bool:
    return os.environ.get("ONESHOT_LAB_MANAGE", "0") not in ("0", "", "false", "no")


# --------------------------------------------------------------------------- supervisor


class NotManaged(Exception):
    pass


@dataclass
class LabEvent:
    at: float
    kind: str  # "worker" | "provider" | "preset" | "fault"
    message: str

    def to_json(self) -> dict[str, Any]:
        return {"at": self.at, "kind": self.kind, "message": self.message}


class Supervisor:
    """Owns the provider and worker child processes in lab mode.

    A watchdog thread notices exits. A worker that exits after a *failpoint* is
    restarted automatically (that is the scenario being shown: crash, then
    recovery). A worker you killed stays dead until you start it, so you can
    watch actions wait safely on disk. A crashed provider also stays down until
    restarted, because "provider unreachable" is the point of that scenario.
    """

    def __init__(self, settings: Settings, *, manage: bool, var_dir: Path) -> None:
        self.settings = settings
        self.manage = manage
        self.var_dir = var_dir
        self.events: deque[LabEvent] = deque(maxlen=200)
        self._lock = threading.RLock()
        self._worker: subprocess.Popen[bytes] | None = None
        self._worker_failpoints: tuple[str, ...] = ()
        self._worker_auto_restart = True
        self._worker_restarts = 0
        self._provider: ProviderProcess | None = None
        self._provider_seen_running = False
        self._stop = threading.Event()
        self._watchdog: threading.Thread | None = None

    # ---- lifecycle -------------------------------------------------------

    def start(self) -> None:
        if not self.manage:
            return
        self.var_dir.mkdir(parents=True, exist_ok=True)
        port = int(httpx.URL(self.settings.provider_url).port or 8701)
        self._provider = ProviderProcess(
            self.var_dir / "provider.db",
            port=port,
            timeout_hang=max(5.0, self.settings.provider_timeout_seconds * 2.5),
            slow_delay=3.0,
            log_path=self.var_dir / "provider.log",
        )
        self._provider.start()
        self._provider_seen_running = True
        self.log("provider", f"provider started (pid {self._provider._proc.pid if self._provider._proc else '?'})")
        self.start_worker()
        self._watchdog = threading.Thread(target=self._watch, name="lab-watchdog", daemon=True)
        self._watchdog.start()

    def shutdown(self) -> None:
        self._stop.set()
        with self._lock:
            if self._worker and self._worker.poll() is None:
                self._worker.send_signal(signal.SIGTERM)
                try:
                    self._worker.wait(5)
                except subprocess.TimeoutExpired:
                    self._worker.kill()
            if self._provider:
                self._provider.stop()

    def log(self, kind: str, message: str) -> None:
        self.events.append(LabEvent(time.time(), kind, message))

    def _require(self) -> None:
        if not self.manage:
            raise NotManaged(
                "processes are not managed by this API (start it with ONESHOT_LAB_MANAGE=1, as `make dev` does)"
            )

    # ---- worker ----------------------------------------------------------

    def start_worker(self, failpoints: tuple[str, ...] = ()) -> int:
        self._require()
        with self._lock:
            if self._worker and self._worker.poll() is None:
                raise ValueError(f"a worker is already running (pid {self._worker.pid})")
            log = open(self.var_dir / "worker.log", "ab")
            self._worker = spawn_worker(self.settings, failpoints=failpoints, drain=False, max_seconds=None, output=log)
            log.close()  # the child keeps its own descriptor
            self._worker_failpoints = failpoints
            self._worker_auto_restart = True
            fp = f" with failpoint {', '.join(failpoints)}" if failpoints else ""
            self.log("worker", f"worker started (pid {self._worker.pid}){fp}")
            return self._worker.pid

    def kill_worker(self) -> int:
        """SIGKILL: no cleanup code runs, exactly like a power cut for that process."""
        self._require()
        with self._lock:
            if not self._worker or self._worker.poll() is not None:
                raise ValueError("no worker is running")
            self._worker_auto_restart = False
            pid = self._worker.pid
            self._worker.kill()
            self._worker.wait(5)
            self.log("worker", f"worker pid {pid} killed with SIGKILL; it stays down until you start one")
            return pid

    def crash_worker_at(self, point: str) -> int:
        """Restart the worker so that it dies at a failpoint on its next attempt."""
        self._require()
        with self._lock:
            if self._worker and self._worker.poll() is None:
                self._worker.send_signal(signal.SIGTERM)
                self._worker.wait(10)
                self.log("worker", "worker stopped cleanly to re-arm it with a failpoint")
            return self.start_worker((point,))

    # ---- provider --------------------------------------------------------

    def restart_provider(self) -> None:
        self._require()
        with self._lock:
            assert self._provider is not None
            self._provider.restart()
            self._provider_seen_running = True
            self.log("provider", "provider restarted; its ledger survived on disk")

    # ---- state -----------------------------------------------------------

    def state(self) -> dict[str, Any]:
        with self._lock:
            w = self._worker
            worker_running = bool(w and w.poll() is None)
            p = self._provider
            return {
                "managed": self.manage,
                "worker": {
                    "running": worker_running,
                    "pid": w.pid if w else None,
                    "failpoints": list(self._worker_failpoints) if worker_running else [],
                    "auto_restart": self._worker_auto_restart,
                    "restarts": self._worker_restarts,
                },
                "provider": {"running": bool(p and p.is_running()), "url": self.settings.provider_url},
                "events": [e.to_json() for e in reversed(self.events)][:50],
            }

    def _watch(self) -> None:
        while not self._stop.wait(0.3):
            with self._lock:
                w = self._worker
                if w and w.poll() is not None and self._worker_auto_restart:
                    code = w.returncode
                    why = "failpoint" if code == 70 else f"exit code {code}"
                    self.log("worker", f"worker pid {w.pid} died ({why}); starting a fresh worker to show recovery")
                    self._worker = None
                    self._worker_restarts += 1
                    try:
                        self.start_worker()
                    except Exception as exc:  # noqa: BLE001
                        self.log("worker", f"could not restart worker: {exc}")
                p = self._provider
                if p and self._provider_seen_running and not p.is_running():
                    self._provider_seen_running = False
                    self.log("provider", "provider process exited (crash fault?); restart it from the Chaos page")


# --------------------------------------------------------------------------- presets


@dataclass
class LabContext:
    store: ActionStore
    settings: Settings
    supervisor: Supervisor
    arm: Callable[..., None]
    run_id: str = field(default_factory=lambda: uuid.uuid4().hex[:6])

    def submit(self, type_name: str, payload: dict[str, Any], key: str | None = None) -> tuple[str, bool]:
        action_type = get_action_type(type_name)
        action, created = self.store.submit(action_type.name, action_type.validate(payload), key or f"lab-{self.run_id}-{uuid.uuid4().hex[:6]}")
        return action.id, created


def _charge(ctx: LabContext, customer: str | None = None, amount: int | None = None) -> dict[str, Any]:
    # Each run gets its own customer and amount, so two different presets never
    # look like the same request (which reconciliation would rightly flag).
    return {
        "amount_cents": amount or 1000 + int(ctx.run_id, 16) % 9000,
        "currency": "USD",
        "customer": customer or f"cus_lab_{ctx.run_id}",
    }


def _message(ctx: LabContext, body: str = "Your order shipped") -> dict[str, Any]:
    return {"to": "+15550100", "body": f"{body} [{ctx.run_id}]"}


@dataclass(frozen=True)
class Preset:
    name: str
    group: str
    title: str
    what: str  # what the preset does
    expect: str  # what you should see
    run: Callable[[LabContext], dict[str, Any]]
    needs_managed: bool = False

    def to_json(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "group": self.group,
            "title": self.title,
            "what": self.what,
            "expect": self.expect,
            "needs_managed": self.needs_managed,
        }


def _one(ctx: LabContext, type_name: str, payload: dict[str, Any], note: str = "") -> dict[str, Any]:
    action_id, _ = ctx.submit(type_name, payload)
    return {"action_ids": [action_id], "note": note}


def _p_happy(ctx):
    return _one(ctx, "payment.charge", _charge(ctx))


def _p_transient(ctx):
    ctx.arm({"mode": "unavailable", "endpoint": "/v1/charges", "times": 2})
    return _one(ctx, "payment.charge", _charge(ctx))


def _p_decline(ctx):
    return _one(ctx, "payment.charge", _charge(ctx, customer="cus_declined"))


def _p_timeout_charge(ctx):
    ctx.arm({"mode": "timeout", "endpoint": "/v1/charges"})
    return _one(ctx, "payment.charge", _charge(ctx))


def _p_lost_charge(ctx):
    ctx.arm({"mode": "lost_response", "endpoint": "/v1/charges"})
    return _one(ctx, "payment.charge", _charge(ctx))


def _p_lost_message(ctx):
    ctx.arm({"mode": "lost_response", "endpoint": "/v1/messages"})
    return _one(ctx, "message.send", _message(ctx))


def _p_timeout_message(ctx):
    ctx.arm({"mode": "timeout", "endpoint": "/v1/messages"})
    return _one(ctx, "message.send", _message(ctx, "Table booked"))


def _p_error_after_apply(ctx):
    ctx.arm({"mode": "error_after_apply", "endpoint": "/v1/charges"})
    return _one(ctx, "payment.charge", _charge(ctx))


def _p_provider_crash(ctx):
    ctx.arm({"mode": "crash_after_apply", "endpoint": "/v1/messages"})
    return _one(ctx, "message.send", _message(ctx, "Refund issued"), "The provider will crash right after applying. Restart it, then run reconciliation.")


def _p_same_key(ctx):
    key = f"lab-{ctx.run_id}-same"
    payload = _charge(ctx, amount=2500)
    first, created1 = ctx.submit("payment.charge", payload, key)
    second, created2 = ctx.submit("payment.charge", payload, key)
    assert created1 and not created2 and first == second
    return {"action_ids": [first], "note": "Submitted twice with the same Idempotency-Key: the second call returned the original action."}


def _p_new_key(ctx):
    payload = _charge(ctx, amount=2600)
    a, _ = ctx.submit("payment.charge", payload)
    b, _ = ctx.submit("payment.charge", payload)
    return {"action_ids": [a, b], "note": "Same request, two different keys: two actions and two charges. Reconciliation flags it as a suspected duplicate."}


def _p_slow_duplicate(ctx):
    delay = ctx.settings.provider_settle_seconds + 3
    ctx.arm({"mode": "slow_success", "endpoint": "/v1/messages", "delay_seconds": delay})
    return _one(ctx, "message.send", _message(ctx, "Slow provider"), f"The provider takes {delay:g}s, longer than the {ctx.settings.provider_settle_seconds:g}s settle window, so the resend duplicates the message.")


def _p_worker_crash_after(ctx):
    ctx.supervisor.crash_worker_at("after_response")
    return _one(ctx, "payment.charge", _charge(ctx), f"The worker dies right after the provider applied the charge. Recovery starts when its {ctx.settings.lease_seconds:g}s lease expires.")


def _p_worker_crash_before_message(ctx):
    ctx.supervisor.crash_worker_at("before_send")
    return _one(ctx, "message.send", _message(ctx, "Crash before send"), f"The worker dies just before sending. After the {ctx.settings.lease_seconds:g}s lease, recovery checks the ledger, finds nothing, and sends once.")


def _p_worker_kill(ctx):
    ctx.arm({"mode": "timeout", "endpoint": "/v1/charges"})
    action_id, _ = ctx.submit("payment.charge", _charge(ctx))

    def kill_when_in_flight() -> None:
        deadline = time.time() + 10
        while time.time() < deadline:
            a = ctx.store.get(action_id, detail=False)
            if a and a.status is ActionStatus.IN_FLIGHT:
                time.sleep(0.3)  # the request is now hanging at the provider
                try:
                    ctx.supervisor.kill_worker()
                    time.sleep(2)
                    ctx.supervisor.start_worker()
                except Exception as exc:  # noqa: BLE001
                    ctx.supervisor.log("preset", f"worker-kill preset: {exc}")
                return
            time.sleep(0.1)
        ctx.supervisor.log("preset", "worker-kill preset: action never went in flight (is a worker running?)")

    threading.Thread(target=kill_when_in_flight, daemon=True).start()
    return {"action_ids": [action_id], "note": f"The worker is SIGKILLed mid-request and restarted 2s later. The new worker recovers the action once the {ctx.settings.lease_seconds:g}s lease expires."}


PRESETS: dict[str, Preset] = {
    p.name: p
    for p in [
        Preset("happy-path", "core", "Happy path", "Submit one charge with no faults.", "PENDING → IN_FLIGHT → SUCCEEDED, one effect.", _p_happy),
        Preset("transient-retry", "core", "Provider briefly unavailable", "The provider answers 503 (applied:false) twice, then works.", "Two safe retries with backoff, then SUCCEEDED, one effect.", _p_transient),
        Preset("permanent-decline", "core", "Card declined", "Charge a customer the provider always declines (402).", "FAILED after one attempt, with no retry and no effect.", _p_decline),
        Preset("timeout-charge", "core", "Charge times out", "The provider holds the request until the client gives up, without applying it.", "AMBIGUOUS, then a same-key retry that is safe because the provider deduplicates, then SUCCEEDED.", _p_timeout_charge),
        Preset("lost-response-charge", "ambiguity", "Lost response on a charge", "The provider applies the charge, then drops the connection.", "AMBIGUOUS, then the same-key retry gets the stored result replayed: one effect, never two.", _p_lost_charge),
        Preset("lost-response-message", "ambiguity", "Lost response on a message", "The provider sends the message, then drops the connection. Messages have no idempotency key.", "VERIFYING: the ledger is checked first, the message is found, SUCCEEDED, and no resend.", _p_lost_message),
        Preset("timeout-message", "ambiguity", "Message times out", "The provider hangs without sending.", "VERIFYING, no record after the settle window, sent once more, SUCCEEDED.", _p_timeout_message),
        Preset("server-error-after-apply", "ambiguity", "500 after applying", "The provider applies the charge, then answers 500.", "A 500 is treated as ambiguous, not as failed. The same-key retry replays, so there is one effect.", _p_error_after_apply),
        Preset("provider-crash-unknown", "ambiguity", "Provider crashes after applying", "The provider process exits right after applying a message.", "Lookups fail, then UNKNOWN. Restart the provider, then reconcile: it resolves to SUCCEEDED.", _p_provider_crash, needs_managed=True),
        Preset("agent-retry-same-key", "duplicates", "Agent retries with the same key", "The agent submits the same request twice with one Idempotency-Key.", "One action and one charge. The second submit is a replay.", _p_same_key),
        Preset("agent-retry-new-key", "duplicates", "Agent retries with a new key", "The agent submits the same request twice with two different keys.", "Two actions and two charges, a real duplicate. Reconciliation warns SUSPECTED_DUPLICATE_REQUEST.", _p_new_key),
        Preset("slow-provider-duplicate", "duplicates", "Provider slower than the settle window", "A message takes longer at the provider than OneShot's settle assumption.", "Verify finds nothing in time, OneShot resends, and both apply: DUPLICATE_EFFECT. This is a documented gap.", _p_slow_duplicate),
        Preset("worker-crash-after-response", "process", "Worker dies after the provider applied", "The worker is armed to exit right after the provider answered.", "IN_FLIGHT until the lease expires, then recovery (CRASHED), a same-key retry and replay: one effect.", _p_worker_crash_after, needs_managed=True),
        Preset("worker-crash-before-send", "process", "Worker dies before sending a message", "The worker is armed to exit just before the request leaves.", "After the lease: VERIFYING, ledger empty, sent exactly once.", _p_worker_crash_before_message, needs_managed=True),
        Preset("worker-kill-mid-request", "process", "kill -9 mid-request", "The worker is SIGKILLed while its request hangs at the provider.", "The action sits IN_FLIGHT with no live worker, then a new worker recovers it after the lease.", _p_worker_kill, needs_managed=True),
    ]
}

GROUPS = [
    {"id": "core", "title": "Core failures", "about": "Failures with a definite answer: retry when it is provably safe, stop when it is final."},
    {"id": "ambiguity", "title": "Ambiguous outcomes", "about": "The request may or may not have been applied. Watch how OneShot avoids guessing."},
    {"id": "duplicates", "title": "Duplicates", "about": "Where duplicates are stopped, and the documented cases where they are not."},
    {"id": "process", "title": "Process crashes", "about": "Kill the worker at the worst moments and watch leases and recovery."},
]


# --------------------------------------------------------------------------- routes


class FaultRequest(BaseModel):
    mode: str
    endpoint: str | None = None
    times: int = Field(default=1, ge=1, le=20)
    delay_seconds: float | None = Field(default=None, ge=0, le=60)


class CrashRequest(BaseModel):
    point: str = Field(pattern="^(before_send|after_response)$")


def create_lab_router(store: ActionStore, settings: Settings, supervisor: Supervisor) -> APIRouter:
    router = APIRouter(prefix="/lab", tags=["lab (test scaffolding)"])
    admin = httpx.Client(base_url=settings.provider_url, timeout=2.0)

    def provider_admin(method: str, path: str, **kw: Any) -> Any:
        try:
            resp = admin.request(method, path, **kw)
        except httpx.HTTPError as exc:
            raise HTTPException(503, f"cannot reach the provider ({type(exc).__name__}); restart it from the Chaos page") from exc
        if resp.status_code >= 400:
            raise HTTPException(resp.status_code, resp.json().get("error", resp.text))
        return resp.json()

    def arm(*rules: dict[str, Any]) -> None:
        provider_admin("POST", "/_admin/faults", json=list(rules))
        for r in rules:
            supervisor.log("fault", f"armed {r['mode']}" + (f" on {r['endpoint']}" if r.get("endpoint") else "") + (f" ×{r['times']}" if r.get("times", 1) > 1 else ""))

    def managed(fn: Callable[[], Any]) -> Any:
        try:
            return fn()
        except NotManaged as exc:
            raise HTTPException(409, str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc

    @router.get("/state")
    def state() -> dict[str, Any]:
        out = supervisor.state()
        try:
            out["faults"] = admin.get("/_admin/faults").json()["faults"]
        except Exception:  # noqa: BLE001 - provider down is a valid state here
            out["faults"] = None
        return out

    @router.get("/presets")
    def presets() -> dict[str, Any]:
        return {"groups": GROUPS, "presets": [p.to_json() for p in PRESETS.values()]}

    @router.post("/presets/{name}")
    def run_preset(name: str) -> dict[str, Any]:
        preset = PRESETS.get(name)
        if preset is None:
            raise HTTPException(404, f"no preset named {name!r}")
        if preset.needs_managed and not supervisor.manage:
            raise HTTPException(409, "this preset controls processes; start the API with ONESHOT_LAB_MANAGE=1 (as `make dev` does)")
        ctx = LabContext(store=store, settings=settings, supervisor=supervisor, arm=arm)
        result = managed(lambda: preset.run(ctx))
        supervisor.log("preset", f"ran “{preset.title}” → {', '.join(result['action_ids'])}")
        return {"preset": preset.to_json(), **result}

    @router.post("/faults")
    def add_fault(body: FaultRequest) -> dict[str, Any]:
        rule = body.model_dump(exclude_none=True)
        arm(rule)
        return provider_admin("GET", "/_admin/faults")

    @router.delete("/faults")
    def clear_faults() -> dict[str, Any]:
        out = provider_admin("DELETE", "/_admin/faults")
        supervisor.log("fault", "cleared all armed faults")
        return out

    @router.post("/worker/start")
    def worker_start() -> dict[str, Any]:
        return {"pid": managed(lambda: supervisor.start_worker())}

    @router.post("/worker/kill")
    def worker_kill() -> dict[str, Any]:
        return {"pid": managed(supervisor.kill_worker)}

    @router.post("/worker/crash")
    def worker_crash(body: CrashRequest) -> dict[str, Any]:
        return {"pid": managed(lambda: supervisor.crash_worker_at(body.point))}

    @router.post("/provider/restart")
    def provider_restart() -> dict[str, Any]:
        managed(supervisor.restart_provider)
        return {"ok": True}

    return router
