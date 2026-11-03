"""Live checks of the guarantees (G1–G5) against the data that exists right now.

These checks are **evidence, not proof**: they say whether each guarantee holds
for the actions and effects currently on record. The proof-style checks across
every fault mode live in tests/test_invariants.py. All provider checks use a
reconciliation *dry run* (``apply=False``), so viewing this page never changes
any action.
"""

from __future__ import annotations

import time
from typing import Any

from oneshot.action_types import REGISTRY
from oneshot.config import Settings
from oneshot.domain import ActionStatus
from oneshot.provider_client import ProviderClient
from oneshot.reconciler import FindingKind, Reconciler, ReconciliationError
from oneshot.store import ActionStore

STATEMENTS = [
    ("G1", "Every accepted action ends SUCCEEDED, FAILED or UNKNOWN. None is silently stuck or lost.",
     "The OneShot database survives and some worker eventually runs."),
    ("G2", "SUCCEEDED means the provider has the effect; FAILED means it does not.",
     "The provider honours its API contract (4xx and 503 applied:false really mean not applied)."),
    ("G3", "Idempotent actions (payment.charge) are applied at most once.",
     "OneShot's configured key-retention window is not longer than the provider's real one."),
    ("G4", "Non-idempotent actions (message.send) are applied at most once…",
     "…only if the provider always finishes within the settle window. If it is slower, duplicates can occur."),
    ("G5", "Once the provider is reachable, reconciliation resolves every UNKNOWN.",
     "The provider's ledger is available and correct."),
]  # fmt: skip


def check(store: ActionStore, client: ProviderClient, settings: Settings, *, worker_alive: bool) -> dict[str, Any]:
    now = time.time()
    actions = store.list()
    by_id = {a.id: a for a in actions}
    results: dict[str, dict[str, Any]] = {}

    # G1: nothing stuck. An unfinished action is "stuck" only if it is overdue
    # AND no worker is alive to pick it up; overdue with a live worker is just busy.
    unfinished = [a for a in actions if a.status in (ActionStatus.PENDING, ActionStatus.IN_FLIGHT, ActionStatus.VERIFYING)]
    overdue = [
        a for a in unfinished
        if (a.status is ActionStatus.IN_FLIGHT and (a.lease_expires_at or now) < now - settings.lease_seconds)
        or (a.status is not ActionStatus.IN_FLIGHT and (a.next_attempt_at or now) < now - 30)
    ]  # fmt: skip
    if overdue and not worker_alive:
        results["G1"] = _r("attention", f"{len(overdue)} overdue action(s) and no live worker. They are safe on disk and continue when a worker starts.", [a.id for a in overdue])
    elif overdue:
        results["G1"] = _r("attention", f"{len(overdue)} overdue action(s) even though a worker is alive. Check the worker log.", [a.id for a in overdue])
    else:
        finished = len(actions) - len(unfinished)
        results["G1"] = _r("holds", f"{finished} of {len(actions)} actions are final, and the {len(unfinished)} still running are on schedule.")

    try:
        report = Reconciler(store, client, settings).run(apply=False)
        reachable = True
    except ReconciliationError as exc:
        report, reachable = None, False
        for gid in ("G2", "G3", "G4", "G5"):
            results[gid] = _r("unknown", f"Cannot check right now: {exc}.")

    gaps: list[dict[str, Any]] = []
    if report is not None:
        mismatches = report.of(FindingKind.MISSING_EFFECT, FindingKind.UNEXPECTED_EFFECT)
        terminal = sum(1 for a in actions if a.status.is_terminal)
        results["G2"] = (
            _r("violated", f"{len(mismatches)} terminal action(s) disagree with the provider's ledger.", [f.action_id for f in mismatches if f.action_id])
            if mismatches
            else _r("holds", f"All {terminal} SUCCEEDED/FAILED actions agree with the provider's ledger.")
        )
        dups = report.of(FindingKind.DUPLICATE_EFFECT)

        def idem(f) -> bool:
            a = by_id.get(f.action_id or "")
            return bool(a and REGISTRY[a.type].idempotent)

        d_idem = [f for f in dups if idem(f)]
        d_non = [f for f in dups if not idem(f)]
        n_idem = sum(1 for a in actions if REGISTRY[a.type].idempotent)
        results["G3"] = (
            _r("violated", f"{len(d_idem)} idempotent action(s) were applied more than once. Is the retention window misconfigured?", [f.action_id for f in d_idem if f.action_id])
            if d_idem
            else _r("holds", f"None of the {n_idem} idempotent actions was applied more than once.")
        )
        results["G4"] = (
            _r("condition-broken", f"{len(d_non)} non-idempotent action(s) were applied twice. The provider was slower than the {settings.provider_settle_seconds:g}s settle window, which is the documented gap.", [f.action_id for f in d_non if f.action_id])
            if d_non
            else _r("holds", f"No non-idempotent action was applied more than once ({len(actions) - n_idem} checked).")
        )
        unknown = [a for a in actions if a.status is ActionStatus.UNKNOWN]
        resolvable = report.of(FindingKind.RESOLVED_SUCCEEDED, FindingKind.RESOLVED_FAILED)
        waiting = report.of(FindingKind.UNRESOLVED_UNKNOWN)
        if not unknown:
            results["G5"] = _r("holds", "No UNKNOWN actions right now.")
        else:
            results["G5"] = _r(
                "attention",
                f"{len(unknown)} UNKNOWN action(s): reconciliation can resolve {len(resolvable)} now"
                + (f"; {len(waiting)} must wait for the settle window" if waiting else "")
                + ". Run it from the Reconcile page.",
                [a.id for a in unknown],
            )
        for kind, about in [
            (FindingKind.ORPHAN_EFFECT, "effects at the provider with no OneShot action (lost database, or a client bypassed OneShot)"),
            (FindingKind.SUSPECTED_DUPLICATE_REQUEST, "identical requests under different Idempotency-Keys (the agent retried with a new key?)"),
        ]:
            found = report.of(kind)
            gaps.append({"kind": kind.value, "count": len(found), "about": about, "action_ids": [f.action_id for f in found if f.action_id][:20]})

    return {
        "checked_at": now,
        "provider_reachable": reachable,
        "actions": len(actions),
        "guarantees": [{"id": gid, "statement": s, "condition": c, **results[gid]} for gid, s, c in STATEMENTS],
        "gaps": gaps,
    }


def _r(status: str, evidence: str, action_ids: list[str] | None = None) -> dict[str, Any]:
    return {"status": status, "evidence": evidence, "action_ids": (action_ids or [])[:20]}
