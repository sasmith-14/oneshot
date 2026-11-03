"""Everything a demo scenario needs, wired up and isolated.

Each scenario gets a fresh directory with its own provider ledger and OneShot
database, a real provider *process*, the real FastAPI app (called in-process
through FastAPI's TestClient — ``oneshot serve`` exposes the same app over a
socket), and real worker *processes* that can genuinely crash.
"""

from __future__ import annotations

import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import warnings

# Upstream Starlette deprecation notice about its own test client; not actionable here.
warnings.filterwarnings("ignore", message="Using `httpx` with `starlette.testclient`")

from fastapi.testclient import TestClient  # noqa: E402
from rich.console import Console
from rich.text import Text

from fakeprovider.process import ProviderProcess
from oneshot.api import create_app
from oneshot.config import Settings
from oneshot.domain import Action, ActionStatus
from oneshot.provider_client import ProviderClient
from oneshot.reconciler import Reconciler, Report
from oneshot.render import print_timeline, reconcile_table, summary
from oneshot.store import ActionStore
from oneshot.worker_process import spawn_worker

#: Short timings so the whole demo runs in about a minute. Jitter is off so the
#: printed delays are predictable; production should keep jitter on.
DEMO_TIMINGS = dict(
    provider_timeout_seconds=1.0,
    lease_seconds=3.0,
    max_attempts=4,
    max_verifications=3,
    backoff_base_seconds=0.3,
    backoff_max_seconds=2.0,
    backoff_jitter=False,
    provider_settle_seconds=1.5,
    poll_interval_seconds=0.05,
)


@dataclass
class Check:
    description: str
    passed: bool


@dataclass
class DemoContext:
    workdir: Path
    console: Console
    provider_ttl: float = 24 * 3600
    checks: list[Check] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.workdir.mkdir(parents=True, exist_ok=True)
        self.provider = ProviderProcess(
            self.workdir / "provider.db",
            idempotency_ttl=self.provider_ttl,
            timeout_hang=2.0,
            slow_delay=1.5,
            log_path=self.workdir / "provider.log",
        )
        self.provider.start()
        self.settings = Settings(
            db_path=str(self.workdir / "oneshot.db"), provider_url=self.provider.url, **DEMO_TIMINGS
        )
        self.store = ActionStore(self.settings.db_path)
        self.api = TestClient(create_app(self.settings))
        self._log_offset = 0
        self._worker_runs = 0

    def close(self) -> None:
        self.provider.stop()

    # ------------------------------------------------------------- narration

    def say(self, text: str, style: str = "") -> None:
        self.console.print(Text(text, style=style))

    def step(self, text: str) -> None:
        self.console.print(Text.assemble(("  > ", "bold cyan"), text))

    # ------------------------------------------------------------------ verbs

    def arm(self, *rules: dict[str, Any]) -> None:
        self.provider.add_faults(*rules)
        desc = ", ".join(f"{r['mode']}" + (f" on {r['endpoint']}" if r.get("endpoint") else "") for r in rules)
        self.step(f"fault armed at the provider: {desc}")

    def submit(self, type_: str, payload: dict[str, Any], key: str) -> Action:
        resp = self.api.post("/actions", json={"type": type_, "payload": payload}, headers={"Idempotency-Key": key})
        resp.raise_for_status()
        action = self.store.get(resp.json()["id"])
        assert action is not None
        replay = " (replayed: same key, no new action)" if resp.status_code == 200 else ""
        self.step(f"agent POST /actions Idempotency-Key={key} -> HTTP {resp.status_code} {action.id}: {summary(action)}{replay}")
        return action

    def run_worker(self, *, failpoints: tuple[str, ...] = (), label: str = "worker process") -> int:
        self._worker_runs += 1
        log_path = self.workdir / f"worker-{self._worker_runs}.log"
        fp = f" with failpoint {','.join(failpoints)}" if failpoints else ""
        self.step(f"start {label}{fp}")
        with open(log_path, "wb") as log:
            proc = spawn_worker(self.settings, failpoints=failpoints, output=log, max_seconds=60)
            code = proc.wait(timeout=90)
        if code == 0:
            self.step(f"{label} finished: every action is SUCCEEDED, FAILED or UNKNOWN (exit 0)")
        else:
            self.step(f"{label} DIED with exit code {code}" + (" (failpoint crash)" if code == 70 else ""))
        return code

    def kill_provider_now(self) -> None:
        self.provider.stop()

    def provider_crashed(self) -> bool:
        return not self.provider.is_running()

    def restart_provider(self) -> None:
        self.provider.start()
        self.step("provider restarted (its ledger file survived the crash)")

    def reconcile(self, *, show_ok: bool = False) -> Report:
        client = ProviderClient(self.settings)
        try:
            report = Reconciler(self.store, client, self.settings).run()
        finally:
            client.close()
        self.step("run reconciliation against the provider's ledger")
        self.console.print(reconcile_table(report, show_ok=show_ok))
        return report

    # ------------------------------------------------------------- inspection

    def refresh(self, action: Action) -> Action:
        fresh = self.store.get(action.id)
        assert fresh is not None
        return fresh

    def effects(self, action: Action) -> list[dict[str, Any]]:
        return self.provider.effects(action.id)

    def show(self, *actions: Action) -> None:
        self.say("  OneShot's record (event timeline):", "bold")
        for a in actions:
            print_timeline(self.console, self.refresh(a))
        self.show_provider_view()
        self.say("  Provider's independent ledger:", "bold")
        for a in actions:
            ids = [e["id"] for e in self.effects(a)]
            self.say(f"    {a.id}: {len(ids)} effect(s) {ids}", "green" if len(ids) == 1 else "yellow")

    def show_provider_view(self) -> None:
        log = (self.workdir / "provider.log").read_text(errors="replace")
        new = log[self._log_offset :]
        self._log_offset = len(log)
        lines = [ln for ln in new.splitlines() if "POST /v1/" in ln or "CRASH" in ln]
        if lines:
            self.say("  Provider's side of the story (its log):", "bold")
            for ln in lines:
                self.say("    " + ln.replace("[provider] ", ""), "dim")

    def expect(self, description: str, passed: bool) -> None:
        self.checks.append(Check(description, passed))
        mark, style = ("PASS", "bold green") if passed else ("FAIL", "bold red")
        self.console.print(Text.assemble(("  [", ""), (mark, style), ("] ", ""), description))

    def expect_status(self, action: Action, status: ActionStatus, effects: int) -> None:
        a = self.refresh(action)
        n = len(self.effects(a))
        self.expect(f"{a.id} is {status.value} and provider ledger has {effects} effect(s) (observed: {a.status.value}, {n})",
                    a.status is status and n == effects)  # fmt: skip


def wait_for(proc: subprocess.Popen, timeout: float) -> int:
    return proc.wait(timeout=timeout)
