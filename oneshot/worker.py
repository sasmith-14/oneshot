"""The worker: claims due actions, performs attempts, records decisions, recovers.

One loop iteration (:meth:`Worker.step`):

1. **Recover** — any IN_FLIGHT action whose lease expired belonged to a worker
   that crashed or stalled. Its open attempt is closed as CRASHED (ambiguous)
   and the ambiguity policy decides what to do next.
2. **Claim** — atomically take the next due action and record the attempt
   *before* doing it (write-ahead intent; see oneshot/store.py).
3. **Act** — send it, or verify it against the provider's record.
4. **Decide & record** — the pure policy (oneshot/policy.py) decides; the store
   applies the decision only if this worker still owns the lease.

Workers are stateless: everything they need is in the database, which is why a
killed worker can simply be restarted.
"""

from __future__ import annotations

import os
import random
import socket
import sys
import time
from typing import Callable

from oneshot import policy
from oneshot.action_types import get_action_type
from oneshot.config import Settings
from oneshot.domain import Action, ActionStatus, Attempt, Decision, Outcome
from oneshot.failpoints import failpoint
from oneshot.provider_client import ProviderClient
from oneshot.store import ActionStore, LeaseLost

UNFINISHED = (ActionStatus.PENDING, ActionStatus.IN_FLIGHT, ActionStatus.VERIFYING)


def default_worker_id() -> str:
    return f"w-{socket.gethostname().split('.')[0]}-{os.getpid()}"


def _stderr_log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


class Worker:
    def __init__(
        self,
        store: ActionStore,
        client: ProviderClient,
        settings: Settings,
        *,
        worker_id: str | None = None,
        clock: Callable[[], float] = time.time,
        rng: random.Random | None = None,
        log: Callable[[str], None] = _stderr_log,
    ) -> None:
        self.store = store
        self.client = client
        self.settings = settings
        self.worker_id = worker_id or default_worker_id()
        self.clock = clock
        self.rng = rng
        self._log = log
        self._stopping = False

    def log(self, message: str) -> None:
        self._log(f"[worker {self.worker_id}] {message}")

    def stop(self) -> None:
        """Finish the current step, then exit the loop (used for SIGTERM)."""
        self._stopping = True

    # --------------------------------------------------------------- recovery

    def recover(self) -> int:
        """Resolve IN_FLIGHT actions abandoned by dead or stalled workers."""
        recovered = 0
        for stale in self.store.expired_in_flight():
            taken = self.store.take_over(stale.id, self.worker_id, self.settings.lease_seconds)
            if taken is None:
                continue
            action, attempt = taken
            why = (
                f"recovered: worker {attempt.worker_id} was lost during attempt {attempt.number} "
                "(crash/kill/stall); the request may or may not have reached the provider"
            )
            decision = policy.after_ambiguous(
                action, get_action_type(action.type), self.settings, self.clock(), why, self.rng
            )
            self._record(action, attempt, Outcome.CRASHED, why, decision)
            recovered += 1
        return recovered

    # ------------------------------------------------------------------- step

    def step(self) -> bool:
        """Do one unit of work. Returns False if nothing was due."""
        self.recover()
        claimed = self.store.claim_next(self.worker_id, self.settings.lease_seconds)
        if claimed is None:
            return False
        action, attempt = claimed
        action_type = get_action_type(action.type)

        if attempt.kind == "send":
            veto = policy.before_send(action, action_type, self.settings, self.clock())
            if veto is not None:
                self._record(action, attempt, Outcome.NOT_SENT, "pre-send safety check", veto)
                return True
            failpoint("before_send")
            result = self.client.send(action, action_type)
            failpoint("after_response")
            decision = policy.after_send(action, action_type, result, self.settings, self.clock(), self.rng)
            self._record(action, attempt, result.outcome, result.detail, decision)
        else:
            lookup = self.client.lookup(action.id)
            outcome, decision = policy.after_verify(action, action_type, lookup, self.settings, self.clock(), self.rng)
            detail = lookup.detail or (f"found {', '.join(lookup.effect_ids)}" if lookup.effect_ids else "no record")
            self._record(action, attempt, outcome, detail, decision)
        return True

    def _record(self, action: Action, attempt: Attempt, outcome: Outcome, detail: str, decision: Decision) -> None:
        label = f"{attempt.kind} #{attempt.number}"
        try:
            self.store.apply_decision(action.id, attempt.id, self.worker_id, outcome, detail, decision)
        except LeaseLost as exc:
            # Our lease expired while we were working and another worker took
            # over. Its decision wins; ours is discarded rather than overwriting.
            self.log(f"{action.id} {label}: result {outcome.value} DISCARDED ({exc})")
            return
        self.log(f"{action.id} {label}: {outcome.value} -> {decision.status.value}: {decision.reason}")

    # ------------------------------------------------------------------- loop

    def has_unfinished_work(self) -> bool:
        counts = self.store.counts()
        return any(counts.get(s.value, 0) for s in UNFINISHED)

    def run(self, *, drain: bool = False, max_seconds: float | None = None) -> None:
        """Process actions until stopped. With ``drain=True``, exit once every
        action is SUCCEEDED, FAILED or UNKNOWN (waiting out leases and backoffs)."""
        started = time.monotonic()
        recovered = self.recover()
        self.log(f"started (recovered {recovered} abandoned in-flight action(s))")
        while not self._stopping:
            if max_seconds is not None and time.monotonic() - started > max_seconds:
                self.log("max run time reached; stopping")
                break
            if self.step():
                continue
            if drain and not self.has_unfinished_work():
                self.log("drained: no unfinished actions left")
                break
            time.sleep(self.settings.poll_interval_seconds)
        self.log("stopped")
