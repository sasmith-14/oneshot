"""Core vocabulary: action statuses, attempt outcomes and the legal state machine.

Everything else in OneShot speaks in these terms. Keeping them in one small
module with no I/O makes the lifecycle easy to read, test and extend.

Lifecycle (see docs/src/01-durable-action-tracking.md for the diagram)::

    PENDING ──claim──▶ IN_FLIGHT ──▶ SUCCEEDED | FAILED          (definite answer)
       ▲                  │
       │ retry            ├──▶ PENDING     (definitely not applied, retry later;
       │                  │                 or ambiguous but provider dedups by key)
       │                  ├──▶ VERIFYING   (ambiguous: look at the provider's record first)
       │                  └──▶ UNKNOWN     (ambiguous and no safe way to find out)
       │
    VERIFYING ──▶ SUCCEEDED (record found) | PENDING (confirmed absent, retry)
               └▶ FAILED (confirmed absent, no attempts left) | UNKNOWN (cannot verify)

    UNKNOWN ──(reconciliation or a human)──▶ SUCCEEDED | FAILED
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class ActionStatus(str, Enum):
    PENDING = "PENDING"
    """Durably accepted; waiting for its first attempt or a scheduled retry."""

    IN_FLIGHT = "IN_FLIGHT"
    """A worker holds the lease and an attempt has been recorded as started.
    The request may or may not have reached the provider yet."""

    VERIFYING = "VERIFYING"
    """The last attempt's outcome is ambiguous; OneShot will consult the
    provider's own record before deciding whether retrying is safe."""

    SUCCEEDED = "SUCCEEDED"
    """The provider confirmed the effect was applied. Terminal."""

    FAILED = "FAILED"
    """The effect was definitely not applied and OneShot stopped trying. Terminal."""

    UNKNOWN = "UNKNOWN"
    """OneShot cannot determine whether the effect happened. Needs investigation:
    reconciliation or a human must resolve it to SUCCEEDED or FAILED."""

    @property
    def is_terminal(self) -> bool:
        return self in (ActionStatus.SUCCEEDED, ActionStatus.FAILED)


S = ActionStatus

#: Every legal status change. The store refuses anything not listed here, so a
#: bug elsewhere cannot silently move, say, SUCCEEDED back to PENDING.
ALLOWED_TRANSITIONS: dict[ActionStatus, frozenset[ActionStatus]] = {
    S.PENDING: frozenset({S.IN_FLIGHT}),
    S.IN_FLIGHT: frozenset({S.SUCCEEDED, S.FAILED, S.PENDING, S.VERIFYING, S.UNKNOWN}),
    S.VERIFYING: frozenset({S.SUCCEEDED, S.FAILED, S.PENDING, S.VERIFYING, S.UNKNOWN}),
    S.UNKNOWN: frozenset({S.SUCCEEDED, S.FAILED}),
    S.SUCCEEDED: frozenset(),
    S.FAILED: frozenset(),
}


class IllegalTransition(Exception):
    pass


def check_transition(current: ActionStatus, new: ActionStatus) -> None:
    if new not in ALLOWED_TRANSITIONS[current]:
        raise IllegalTransition(f"{current.value} -> {new.value} is not allowed")


class Outcome(str, Enum):
    """What one attempt (a send or a lookup) told us.

    The crucial distinction is between outcomes that prove the effect was
    *not* applied (safe to retry anything) and AMBIGUOUS ones (it may have been).
    """

    APPLIED = "APPLIED"  # provider said yes (2xx)
    REJECTED = "REJECTED"  # provider said a permanent no (4xx); not applied
    RETRYABLE = "RETRYABLE"  # provably not applied, transient (503/429, connection refused)
    IN_PROGRESS = "IN_PROGRESS"  # provider: original request with this key still running (409)
    AMBIGUOUS = "AMBIGUOUS"  # timeout, dropped connection, 5xx: may or may not be applied
    CRASHED = "CRASHED"  # worker died mid-attempt (found by recovery); treated as AMBIGUOUS
    # Outcomes of a verification lookup:
    FOUND = "FOUND"  # provider's ledger has the effect
    ABSENT = "ABSENT"  # provider's ledger has no such effect
    LOOKUP_FAILED = "LOOKUP_FAILED"  # could not ask the provider

    @property
    def may_have_applied(self) -> bool:
        return self in (Outcome.AMBIGUOUS, Outcome.CRASHED, Outcome.IN_PROGRESS)


@dataclass(frozen=True)
class Decision:
    """What should happen to an action next. Produced by :mod:`oneshot.policy`
    (pure logic), applied by :class:`oneshot.store.ActionStore` (I/O)."""

    status: ActionStatus
    reason: str
    next_attempt_at: float | None = None
    maybe_applied: bool | None = None  # None = leave unchanged
    effect_id: str | None = None
    error: str | None = None


@dataclass
class Attempt:
    id: int
    action_id: str
    number: int
    kind: str  # "send" | "verify"
    worker_id: str
    started_at: float
    finished_at: float | None
    outcome: Outcome | None
    detail: str | None


@dataclass
class Event:
    id: int
    action_id: str
    at: float
    from_status: ActionStatus | None
    to_status: ActionStatus
    message: str


@dataclass
class Action:
    id: str
    type: str
    payload: dict[str, Any]
    request_key: str
    request_fingerprint: str
    status: ActionStatus
    attempt_count: int
    verify_count: int
    maybe_applied: bool
    next_attempt_at: float | None
    lease_owner: str | None
    lease_expires_at: float | None
    first_sent_at: float | None
    last_sent_at: float | None
    provider_effect_id: str | None
    last_error: str | None
    resolution: str | None
    created_at: float
    updated_at: float
    attempts: list[Attempt] = field(default_factory=list)
    events: list[Event] = field(default_factory=list)

    def to_json(self, *, detail: bool = False) -> dict[str, Any]:
        data: dict[str, Any] = {
            "id": self.id,
            "type": self.type,
            "payload": self.payload,
            "status": self.status.value,
            "attempt_count": self.attempt_count,
            "verify_count": self.verify_count,
            "maybe_applied": self.maybe_applied,
            "next_attempt_at": self.next_attempt_at,
            "provider_effect_id": self.provider_effect_id,
            "last_error": self.last_error,
            "resolution": self.resolution,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }
        if detail:
            data["attempts"] = [
                {
                    "number": a.number,
                    "kind": a.kind,
                    "worker_id": a.worker_id,
                    "started_at": a.started_at,
                    "finished_at": a.finished_at,
                    "outcome": a.outcome.value if a.outcome else None,
                    "detail": a.detail,
                }
                for a in self.attempts
            ]
            data["events"] = [
                {
                    "at": e.at,
                    "from": e.from_status.value if e.from_status else None,
                    "to": e.to_status.value,
                    "message": e.message,
                }
                for e in self.events
            ]
        return data
