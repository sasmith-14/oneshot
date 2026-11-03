"""Reconciler classification, using a stub ledger to construct every mismatch kind.

(End-to-end reconciliation against the real provider process is covered in
test_scenarios.py; here we pin down each rule in isolation.)
"""

from __future__ import annotations

from oneshot.domain import ActionStatus, Decision, Outcome
from oneshot.reconciler import FindingKind, Reconciler, Severity
from tests.conftest import CHARGE

S = ActionStatus


class StubLedgerClient:
    def __init__(self, effects):
        self._effects = effects

    def ledger(self):
        return self._effects


def effect(eid, ref):
    return {"id": eid, "kind": "charge", "reference": ref, "payload": {}, "created_at": 0}


def finish(store, status, *, effect_id=None, key=None, payload=CHARGE):
    action, _ = store.submit("payment.charge", payload, key or f"k-{status.value}-{effect_id}")
    a, attempt = store.claim_next("w", 5)
    store.apply_decision(a.id, attempt.id, "w", Outcome.APPLIED, "x", Decision(status, "test", effect_id=effect_id))
    return a.id


def kinds(report):
    return {(f.kind, f.action_id) for f in report.findings}


def test_each_mismatch_is_classified(store, settings, clock):
    ok = finish(store, S.SUCCEEDED, effect_id="e1", payload={**CHARGE, "amount_cents": 1})
    missing = finish(store, S.SUCCEEDED, effect_id="e2", payload={**CHARGE, "amount_cents": 2})
    unexpected = finish(store, S.FAILED, payload={**CHARGE, "amount_cents": 3})
    dup = finish(store, S.SUCCEEDED, effect_id="e4", payload={**CHARGE, "amount_cents": 4})
    ledger = [effect("e1", ok), effect("e3", unexpected), effect("e4", dup), effect("e5", dup), effect("e9", "act_ghost")]

    report = Reconciler(store, StubLedgerClient(ledger), settings, clock=clock).run()
    assert kinds(report) >= {
        (FindingKind.MATCH, ok),
        (FindingKind.MISSING_EFFECT, missing),
        (FindingKind.UNEXPECTED_EFFECT, unexpected),
        (FindingKind.DUPLICATE_EFFECT, dup),
        (FindingKind.ORPHAN_EFFECT, "act_ghost"),
    }
    # Terminal states are flagged, never rewritten.
    assert store.get(unexpected).status is S.FAILED
    assert store.get(missing).status is S.SUCCEEDED
    assert all(f.severity is Severity.CRITICAL for f in report.findings if f.action_id in (missing, unexpected, dup))


def test_unknown_is_only_resolved_failed_after_the_settle_window(store, settings, clock):
    action_id = finish(store, S.UNKNOWN)
    reconciler = Reconciler(store, StubLedgerClient([]), settings, clock=clock)
    assert reconciler.run().of(FindingKind.UNRESOLVED_UNKNOWN)
    assert store.get(action_id).status is S.UNKNOWN
    clock.advance(settings.provider_settle_seconds + 0.1)
    assert reconciler.run().of(FindingKind.RESOLVED_FAILED)
    assert store.get(action_id).status is S.FAILED


def test_identical_requests_under_different_keys_are_only_a_warning(store, settings, clock):
    first = finish(store, S.SUCCEEDED, effect_id="e1", key="a")
    second = finish(store, S.SUCCEEDED, effect_id="e2", key="b")
    report = Reconciler(store, StubLedgerClient([effect("e1", first), effect("e2", second)]), settings, clock=clock).run()
    [finding] = report.of(FindingKind.SUSPECTED_DUPLICATE_REQUEST)
    assert finding.action_id == second and finding.severity is Severity.WARNING
