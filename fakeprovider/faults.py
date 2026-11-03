"""Fault injection for the fake provider.

Faults are *scripted*: a test or demo pushes rules onto a queue through the
admin endpoint (``POST /_admin/faults``) and each incoming effect request
consumes the first matching rule. With an empty queue every request succeeds.
Scripted (rather than random) faults make every scenario reproducible.

The fault queue lives in memory on purpose: it is test scaffolding, not
evidence. The *ledger* is the evidence and it is persisted separately.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class FaultMode(str, Enum):
    """How the provider should (mis)behave for one request.

    The comment on each mode says whether the effect is applied and what the
    caller observes. Note how several modes look *identical* to the caller
    while having opposite real outcomes — that is the whole problem OneShot
    exists to handle.
    """

    SUCCESS = "success"
    """Effect applied; 201 response delivered."""

    DECLINE = "decline"
    """Effect NOT applied; 402 permanent business rejection delivered."""

    UNAVAILABLE = "unavailable"
    """Effect NOT applied; 503 delivered with ``applied: false``. Safe to retry."""

    TIMEOUT = "timeout"
    """Effect NOT applied; provider hangs, then drops the connection. Caller sees a timeout."""

    LOST_RESPONSE = "lost_response"
    """Effect APPLIED; connection dropped before any response. Caller sees a disconnect."""

    SLOW_SUCCESS = "slow_success"
    """Effect APPLIED, but only after ``delay_seconds``; caller usually times out first."""

    CRASH_BEFORE_APPLY = "crash_before_apply"
    """Provider process exits before applying. Effect NOT applied. Caller sees a disconnect."""

    CRASH_AFTER_APPLY = "crash_after_apply"
    """Provider process exits right after committing the effect. Effect APPLIED. Caller sees a disconnect."""

    @property
    def applies_effect(self) -> bool:
        return self in {FaultMode.SUCCESS, FaultMode.LOST_RESPONSE, FaultMode.SLOW_SUCCESS, FaultMode.CRASH_AFTER_APPLY}


@dataclass
class FaultRule:
    mode: FaultMode
    endpoint: str | None = None  # e.g. "/v1/charges"; None matches any effect endpoint
    reference: str | None = None  # match a specific client reference; None matches any
    times: int = 1  # how many requests this rule applies to
    delay_seconds: float | None = None  # for TIMEOUT / SLOW_SUCCESS; defaults come from config

    def matches(self, endpoint: str, reference: str | None) -> bool:
        if self.endpoint is not None and self.endpoint != endpoint:
            return False
        if self.reference is not None and self.reference != reference:
            return False
        return True

    def to_json(self) -> dict[str, Any]:
        return {
            "mode": self.mode.value,
            "endpoint": self.endpoint,
            "reference": self.reference,
            "times": self.times,
            "delay_seconds": self.delay_seconds,
        }

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> "FaultRule":
        times = int(data.get("times", 1))
        if times < 1:
            raise ValueError("times must be >= 1")
        delay = data.get("delay_seconds")
        return cls(
            mode=FaultMode(data["mode"]),
            endpoint=data.get("endpoint"),
            reference=data.get("reference"),
            times=times,
            delay_seconds=float(delay) if delay is not None else None,
        )


@dataclass
class FaultPlan:
    """A thread-safe FIFO of fault rules."""

    _rules: list[FaultRule] = field(default_factory=list)
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def add(self, rules: list[FaultRule]) -> None:
        with self._lock:
            self._rules.extend(rules)

    def clear(self) -> None:
        with self._lock:
            self._rules.clear()

    def snapshot(self) -> list[dict[str, Any]]:
        with self._lock:
            return [r.to_json() for r in self._rules]

    def take(self, endpoint: str, reference: str | None) -> FaultRule:
        """Consume and return the first matching rule, or a SUCCESS rule."""
        with self._lock:
            for i, rule in enumerate(self._rules):
                if rule.matches(endpoint, reference):
                    rule.times -= 1
                    if rule.times == 0:
                        del self._rules[i]
                    return FaultRule(rule.mode, rule.endpoint, rule.reference, 1, rule.delay_seconds)
        return FaultRule(FaultMode.SUCCESS)
