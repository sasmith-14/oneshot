"""Durable tracking: idempotent submission, write-ahead claims, leases, legal transitions."""

from __future__ import annotations

import threading

import pytest

from oneshot.domain import ActionStatus, Decision, IllegalTransition, Outcome, check_transition
from oneshot.store import ActionStore, IdempotencyConflict, LeaseLost
from tests.conftest import CHARGE

S = ActionStatus


# -------------------------------------------------------------- state machine


def test_terminal_states_cannot_change():
    for terminal in (S.SUCCEEDED, S.FAILED):
        for target in S:
            with pytest.raises(IllegalTransition):
                check_transition(terminal, target)


def test_unknown_can_only_be_resolved_to_a_final_answer():
    check_transition(S.UNKNOWN, S.SUCCEEDED)
    check_transition(S.UNKNOWN, S.FAILED)
    with pytest.raises(IllegalTransition):
        check_transition(S.UNKNOWN, S.PENDING)  # never silently retried


# ---------------------------------------------------------- idempotent submit


def test_same_key_same_request_returns_original(store):
    a1, created1 = store.submit("payment.charge", CHARGE, "agent-key-1")
    a2, created2 = store.submit("payment.charge", CHARGE, "agent-key-1")
    assert created1 and not created2
    assert a1.id == a2.id
    assert len(store.list()) == 1


def test_same_key_different_request_is_a_conflict(store):
    store.submit("payment.charge", CHARGE, "agent-key-1")
    with pytest.raises(IdempotencyConflict):
        store.submit("payment.charge", {**CHARGE, "amount_cents": 99}, "agent-key-1")


def test_concurrent_duplicate_submissions_create_one_action(settings):
    """Two API processes racing on the same key: the UNIQUE constraint + BEGIN IMMEDIATE decide."""
    stores = [ActionStore(settings.db_path) for _ in range(8)]
    ids: list[str] = []
    barrier = threading.Barrier(len(stores))

    def submit(s: ActionStore) -> None:
        barrier.wait()
        ids.append(s.submit("payment.charge", CHARGE, "race-key")[0].id)

    threads = [threading.Thread(target=submit, args=(s,)) for s in stores]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(set(ids)) == 1
    assert len(stores[0].list()) == 1


# ------------------------------------------------------------ claim and lease


def test_claim_records_intent_before_any_send(store):
    action, _ = store.submit("payment.charge", CHARGE, "k")
    claimed, attempt = store.claim_next("w1", lease_seconds=5)
    assert claimed.id == action.id
    assert claimed.status is S.IN_FLIGHT
    assert claimed.attempt_count == 1 and claimed.first_sent_at is not None
    stored = store.get(action.id)
    assert stored.attempts[0].finished_at is None  # open attempt = "may have been sent"
    assert stored.attempts[0].kind == "send"


def test_an_action_is_claimed_by_only_one_worker(settings):
    s = ActionStore(settings.db_path)
    for i in range(20):
        s.submit("payment.charge", {**CHARGE, "amount_cents": 100 + i}, f"k{i}")
    claimed: list[str] = []
    lock = threading.Lock()

    def worker(name: str) -> None:
        mine = ActionStore(settings.db_path)
        while (c := mine.claim_next(name, lease_seconds=30)) is not None:
            with lock:
                claimed.append(c[0].id)

    threads = [threading.Thread(target=worker, args=(f"w{i}",)) for i in range(5)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(claimed) == 20 and len(set(claimed)) == 20


def test_future_retries_are_not_claimed_early(store, clock):
    store.submit("payment.charge", CHARGE, "k")
    action, attempt = store.claim_next("w1", 5)
    store.apply_decision(
        action.id, attempt.id, "w1", Outcome.RETRYABLE, "503",
        Decision(S.PENDING, "retry later", next_attempt_at=clock.now + 10),
    )  # fmt: skip
    assert store.claim_next("w1", 5) is None
    clock.advance(10)
    assert store.claim_next("w1", 5) is not None


def test_worker_that_lost_its_lease_cannot_record_a_result(store, clock):
    store.submit("payment.charge", CHARGE, "k")
    action, attempt = store.claim_next("slow-worker", lease_seconds=5)
    clock.advance(6)  # slow worker stalls past its lease
    taken = store.take_over(action.id, "rescuer", lease_seconds=5)
    assert taken is not None
    with pytest.raises(LeaseLost):
        store.apply_decision(
            action.id, attempt.id, "slow-worker", Outcome.APPLIED, "late", Decision(S.SUCCEEDED, "late")
        )


def test_take_over_only_after_lease_expiry(store, clock):
    store.submit("payment.charge", CHARGE, "k")
    action, _ = store.claim_next("w1", lease_seconds=5)
    assert store.take_over(action.id, "w2", 5) is None
    assert store.expired_in_flight() == []
    clock.advance(5.1)
    assert [a.id for a in store.expired_in_flight()] == [action.id]
    assert store.take_over(action.id, "w2", 5) is not None


def test_every_transition_is_audited(store):
    store.submit("payment.charge", CHARGE, "k")
    action, attempt = store.claim_next("w1", 5)
    store.apply_decision(action.id, attempt.id, "w1", Outcome.APPLIED, "201", Decision(S.SUCCEEDED, "ok", effect_id="eff_1"))
    events = store.get(action.id).events
    assert [(e.from_status, e.to_status) for e in events] == [
        (None, S.PENDING),
        (S.PENDING, S.IN_FLIGHT),
        (S.IN_FLIGHT, S.SUCCEEDED),
    ]


def test_resolve_is_only_for_unknown(store):
    store.submit("payment.charge", CHARGE, "k")
    action, attempt = store.claim_next("w1", 5)
    with pytest.raises(ValueError):
        store.resolve(action.id, S.SUCCEEDED, "nope", actor="test")
    store.apply_decision(action.id, attempt.id, "w1", Outcome.AMBIGUOUS, "timeout", Decision(S.UNKNOWN, "?"))
    resolved = store.resolve(action.id, S.FAILED, "checked provider dashboard", actor="alice")
    assert resolved.status is S.FAILED
    assert resolved.resolution == "alice: checked provider dashboard"
