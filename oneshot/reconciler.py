"""Reconciliation: compare OneShot's records with the provider's own ledger.

The provider's ledger is fetched over HTTP from the provider process; OneShot
never "reconciles" against its own notes. For every action and every effect,
the reconciler classifies the pair and, where it is safe, *resolves* it.

What it may change (and why only this):

* ``UNKNOWN`` actions are resolved — SUCCEEDED when the provider has the
  effect, FAILED when it provably does not (absent past the settle window).
  UNKNOWN exists precisely to be resolved by better information.

What it only *flags* for a human (never auto-corrects):

* SUCCEEDED but no effect at the provider (MISSING_EFFECT)
* FAILED but the provider applied it (UNEXPECTED_EFFECT)
* more than one effect for one action (DUPLICATE_EFFECT)
* effects the provider applied that OneShot has no record of (ORPHAN_EFFECT)
* separate actions with identical content submitted close together
  (SUSPECTED_DUPLICATE_REQUEST)

Terminal states have already been reported to the agent; silently flipping
them would hide an incident. Fixing money (refunds, compensations) is a
business decision outside OneShot.
"""

from __future__ import annotations

import time
from collections import defaultdict
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable

from oneshot.config import Settings
from oneshot.domain import Action, ActionStatus
from oneshot.provider_client import ProviderClient
from oneshot.store import ActionStore


class Severity(str, Enum):
    OK = "ok"
    INFO = "info"
    RESOLVED = "resolved"
    WARNING = "warning"
    CRITICAL = "critical"


class FindingKind(str, Enum):
    MATCH = "MATCH"
    STILL_RUNNING = "STILL_RUNNING"
    RESOLVED_SUCCEEDED = "RESOLVED_SUCCEEDED"
    RESOLVED_FAILED = "RESOLVED_FAILED"
    UNRESOLVED_UNKNOWN = "UNRESOLVED_UNKNOWN"
    MISSING_EFFECT = "MISSING_EFFECT"
    UNEXPECTED_EFFECT = "UNEXPECTED_EFFECT"
    DUPLICATE_EFFECT = "DUPLICATE_EFFECT"
    ORPHAN_EFFECT = "ORPHAN_EFFECT"
    SUSPECTED_DUPLICATE_REQUEST = "SUSPECTED_DUPLICATE_REQUEST"


SEVERITY = {
    FindingKind.MATCH: Severity.OK,
    FindingKind.STILL_RUNNING: Severity.INFO,
    FindingKind.RESOLVED_SUCCEEDED: Severity.RESOLVED,
    FindingKind.RESOLVED_FAILED: Severity.RESOLVED,
    FindingKind.UNRESOLVED_UNKNOWN: Severity.WARNING,
    FindingKind.SUSPECTED_DUPLICATE_REQUEST: Severity.WARNING,
    FindingKind.MISSING_EFFECT: Severity.CRITICAL,
    FindingKind.UNEXPECTED_EFFECT: Severity.CRITICAL,
    FindingKind.DUPLICATE_EFFECT: Severity.CRITICAL,
    FindingKind.ORPHAN_EFFECT: Severity.CRITICAL,
}


@dataclass(frozen=True)
class Finding:
    kind: FindingKind
    message: str
    action_id: str | None = None
    effect_ids: tuple[str, ...] = ()

    @property
    def severity(self) -> Severity:
        return SEVERITY[self.kind]

    def to_json(self) -> dict[str, Any]:
        return {
            "kind": self.kind.value,
            "severity": self.severity.value,
            "action_id": self.action_id,
            "effect_ids": list(self.effect_ids),
            "message": self.message,
        }


@dataclass
class Report:
    actions_checked: int = 0
    effects_checked: int = 0
    applied: bool = True
    findings: list[Finding] = field(default_factory=list)

    def of(self, *kinds: FindingKind) -> list[Finding]:
        return [f for f in self.findings if f.kind in kinds]

    @property
    def needs_attention(self) -> list[Finding]:
        return [f for f in self.findings if f.severity in (Severity.WARNING, Severity.CRITICAL)]

    def to_json(self) -> dict[str, Any]:
        summary: dict[str, int] = defaultdict(int)
        for f in self.findings:
            summary[f.kind.value] += 1
        return {
            "actions_checked": self.actions_checked,
            "effects_checked": self.effects_checked,
            "applied": self.applied,
            "summary": dict(summary),
            "findings": [f.to_json() for f in self.findings],
        }


class ReconciliationError(Exception):
    pass


class Reconciler:
    def __init__(
        self,
        store: ActionStore,
        client: ProviderClient,
        settings: Settings,
        *,
        clock: Callable[[], float] = time.time,
        duplicate_request_window_seconds: float = 300.0,
    ) -> None:
        self.store = store
        self.client = client
        self.settings = settings
        self.clock = clock
        self.duplicate_request_window_seconds = duplicate_request_window_seconds

    def run(self, *, apply: bool = True) -> Report:
        try:
            ledger = self.client.ledger()
        except Exception as exc:  # noqa: BLE001 - any failure means we cannot reconcile
            raise ReconciliationError(f"cannot read the provider's ledger: {type(exc).__name__}: {exc}") from exc

        actions = self.store.list()
        by_reference: dict[str | None, list[dict[str, Any]]] = defaultdict(list)
        for effect in ledger:
            by_reference[effect.get("reference")].append(effect)

        report = Report(actions_checked=len(actions), effects_checked=len(ledger), applied=apply)
        known_ids = {a.id for a in actions}

        for action in actions:
            effects = by_reference.get(action.id, [])
            report.findings.extend(self._check_action(action, effects, apply))

        for reference, effects in by_reference.items():
            if reference not in known_ids:
                for e in effects:
                    report.findings.append(
                        Finding(
                            FindingKind.ORPHAN_EFFECT,
                            f"provider applied {e['kind']} {e['id']} (reference={reference}) but OneShot has no "
                            "such action (database lost/restored from backup, or a client bypassed OneShot)",
                            action_id=reference,
                            effect_ids=(e["id"],),
                        )
                    )

        report.findings.extend(self._suspected_duplicate_requests(actions))
        return report

    # ----------------------------------------------------------------------

    def _check_action(self, action: Action, effects: list[dict[str, Any]], apply: bool) -> list[Finding]:
        ids = tuple(e["id"] for e in effects)
        out: list[Finding] = []
        st = action.status

        if len(ids) > 1:
            out.append(
                Finding(
                    FindingKind.DUPLICATE_EFFECT,
                    f"provider applied this action {len(ids)} times ({', '.join(ids)}); "
                    "duplicate slipped past every layer - compensate (e.g. refund) and investigate",
                    action.id,
                    ids,
                )
            )

        if st in (ActionStatus.PENDING, ActionStatus.IN_FLIGHT, ActionStatus.VERIFYING):
            out.append(Finding(FindingKind.STILL_RUNNING, f"{st.value}; the worker is still handling it", action.id, ids))
        elif st is ActionStatus.SUCCEEDED:
            if not ids:
                out.append(
                    Finding(
                        FindingKind.MISSING_EFFECT,
                        "OneShot says SUCCEEDED but the provider has no such effect",
                        action.id,
                    )
                )
            elif len(ids) == 1:
                out.append(Finding(FindingKind.MATCH, "SUCCEEDED and exactly one effect at provider", action.id, ids))
        elif st is ActionStatus.FAILED:
            if ids:
                out.append(
                    Finding(
                        FindingKind.UNEXPECTED_EFFECT,
                        "OneShot says FAILED but the provider applied it - the agent was told the wrong thing",
                        action.id,
                        ids,
                    )
                )
            else:
                out.append(Finding(FindingKind.MATCH, "FAILED and no effect at provider", action.id))
        elif st is ActionStatus.UNKNOWN:
            out.append(self._resolve_unknown(action, ids, apply))
        return out

    def _resolve_unknown(self, action: Action, ids: tuple[str, ...], apply: bool) -> Finding:
        if ids:
            if apply:
                self.store.resolve(
                    action.id,
                    ActionStatus.SUCCEEDED,
                    f"provider ledger shows effect {', '.join(ids)}",
                    actor="reconciler",
                    effect_id=ids[0],
                )
            return Finding(FindingKind.RESOLVED_SUCCEEDED, f"UNKNOWN -> SUCCEEDED: provider has {', '.join(ids)}", action.id, ids)

        settled_at = (action.last_sent_at or action.created_at) + self.settings.provider_settle_seconds
        if self.clock() < settled_at:
            return Finding(
                FindingKind.UNRESOLVED_UNKNOWN,
                "no effect at provider yet, but the settle window has not passed; run again later",
                action.id,
            )
        if apply:
            self.store.resolve(
                action.id,
                ActionStatus.FAILED,
                f"no effect at provider {self.settings.provider_settle_seconds:g}s+ after last send",
                actor="reconciler",
            )
        return Finding(
            FindingKind.RESOLVED_FAILED,
            "UNKNOWN -> FAILED: provider has no effect and the settle window has passed",
            action.id,
        )

    def _suspected_duplicate_requests(self, actions: list[Action]) -> list[Finding]:
        """Different Idempotency-Keys, identical content, close in time.

        OneShot cannot know whether the agent *meant* to do the same thing twice
        (two identical coffees) or retried with a fresh key by mistake. So this
        is a WARNING for a human, never an automatic block.
        """
        groups: dict[str, list[Action]] = defaultdict(list)
        for a in actions:
            groups[a.request_fingerprint].append(a)
        findings = []
        for group in groups.values():
            group.sort(key=lambda a: a.created_at)
            for earlier, later in zip(group, group[1:]):
                if later.created_at - earlier.created_at <= self.duplicate_request_window_seconds:
                    findings.append(
                        Finding(
                            FindingKind.SUSPECTED_DUPLICATE_REQUEST,
                            f"{later.id} has the same type and payload as {earlier.id}, submitted "
                            f"{later.created_at - earlier.created_at:.1f}s apart under different Idempotency-Keys",
                            later.id,
                        )
                    )
        return findings
