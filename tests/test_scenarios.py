"""End-to-end failure scenarios: real provider process, real sockets, real crashes.

Each test states the scenario, then asserts two things:
1. OneShot's final belief (action status), and
2. the ground truth in the provider's independent ledger.
The interesting assertions are where those two are compared.
"""

from __future__ import annotations

import signal
import time
from dataclasses import replace

import pytest

from fakeprovider.process import ProviderProcess
from oneshot.config import Settings
from oneshot.domain import ActionStatus, Outcome
from oneshot.failpoints import FAILPOINT_EXIT_CODE
from oneshot.provider_client import ProviderClient
from oneshot.reconciler import FindingKind, Reconciler
from oneshot.store import ActionStore
from oneshot.worker import Worker
from oneshot.worker_process import spawn_worker
from tests.conftest import CHARGE, MESSAGE

pytestmark = pytest.mark.integration
S = ActionStatus


@pytest.fixture
def provider(tmp_path):
    p = ProviderProcess(tmp_path / "provider.db", timeout_hang=1.0, slow_delay=1.2, log_path=tmp_path / "provider.log")
    p.start()
    yield p
    p.stop()


@pytest.fixture
def cfg(tmp_path, provider) -> Settings:
    return Settings(
        db_path=str(tmp_path / "oneshot.db"),
        provider_url=provider.url,
        provider_timeout_seconds=0.5,
        lease_seconds=1.5,
        max_attempts=4,
        max_verifications=3,
        backoff_base_seconds=0.05,
        backoff_max_seconds=0.2,
        backoff_jitter=False,
        provider_settle_seconds=0.8,
        poll_interval_seconds=0.02,
    )


@pytest.fixture
def store(cfg) -> ActionStore:
    return ActionStore(cfg.db_path)


@pytest.fixture
def client(cfg):
    c = ProviderClient(cfg)
    yield c
    c.close()


def drain(store, client, cfg, timeout=15.0) -> None:
    worker = Worker(store, client, cfg, worker_id="test-worker", log=lambda m: None)
    deadline = time.monotonic() + timeout
    while worker.has_unfinished_work():
        assert time.monotonic() < deadline, f"did not settle: {store.counts()}"
        if not worker.step():
            time.sleep(cfg.poll_interval_seconds)


def submit(store, type_="payment.charge", payload=CHARGE, key=None):
    return store.submit(type_, payload, key or f"k-{time.monotonic_ns()}")[0]


def outcomes(store, action_id):
    return [a.outcome for a in store.get(action_id).attempts]


# ------------------------------------------------------------------ basics


def test_happy_path(store, client, cfg, provider):
    a = submit(store)
    drain(store, client, cfg)
    final = store.get(a.id)
    assert final.status is S.SUCCEEDED
    assert [e["id"] for e in provider.effects(a.id)] == [final.provider_effect_id]


def test_transient_failures_are_retried_with_backoff(store, client, cfg, provider):
    provider.add_faults({"mode": "unavailable", "times": 2})
    a = submit(store)
    drain(store, client, cfg)
    assert store.get(a.id).status is S.SUCCEEDED
    assert outcomes(store, a.id) == [Outcome.RETRYABLE, Outcome.RETRYABLE, Outcome.APPLIED]
    assert len(provider.effects(a.id)) == 1


def test_permanent_rejection_is_not_retried(store, client, cfg, provider):
    a = submit(store, payload={**CHARGE, "customer": "cus_declined"})
    drain(store, client, cfg)
    assert store.get(a.id).status is S.FAILED
    assert outcomes(store, a.id) == [Outcome.REJECTED]
    assert provider.effects(a.id) == []


def test_provider_unreachable_is_safe_to_retry_and_ends_failed(store, client, cfg, provider):
    """Connection refused = the request never left. Exhausting retries => definitely FAILED."""
    provider.stop()
    a = submit(store)
    drain(store, client, cfg)
    final = store.get(a.id)
    assert final.status is S.FAILED and not final.maybe_applied
    assert outcomes(store, a.id) == [Outcome.RETRYABLE] * cfg.max_attempts


# ----------------------------------------------------- timeout ambiguity, idempotent


@pytest.mark.parametrize("mode", ["lost_response", "timeout", "slow_success"])
def test_ambiguous_charge_is_retried_with_same_key_and_applied_once(store, client, cfg, provider, mode):
    """Whether the provider applied it (lost_response, slow_success) or not (timeout),
    the client sees the same thing. Same-key retries make both cases end with ONE charge."""
    provider.add_faults({"mode": mode})
    a = submit(store)
    drain(store, client, cfg)
    final = store.get(a.id)
    assert final.status is S.SUCCEEDED
    assert outcomes(store, a.id)[0] is Outcome.AMBIGUOUS
    time.sleep(1.3)  # let any slow provider thread finish before counting
    assert len(provider.effects(a.id)) == 1


# ----------------------------------------------- timeout ambiguity, non-idempotent


def test_lost_response_message_is_verified_not_resent(store, client, cfg, provider):
    provider.add_faults({"mode": "lost_response", "endpoint": "/v1/messages"})
    a = submit(store, "message.send", MESSAGE)
    drain(store, client, cfg)
    final = store.get(a.id)
    assert final.status is S.SUCCEEDED
    assert outcomes(store, a.id) == [Outcome.AMBIGUOUS, Outcome.FOUND]
    assert len(provider.effects(a.id)) == 1


def test_timed_out_message_is_verified_absent_then_resent_once(store, client, cfg, provider):
    provider.add_faults({"mode": "timeout", "endpoint": "/v1/messages", "delay_seconds": 0.6})
    a = submit(store, "message.send", MESSAGE)
    drain(store, client, cfg)
    assert store.get(a.id).status is S.SUCCEEDED
    assert outcomes(store, a.id) == [Outcome.AMBIGUOUS, Outcome.ABSENT, Outcome.APPLIED]
    assert len(provider.effects(a.id)) == 1


def test_duplicate_slips_through_when_provider_is_slower_than_settle_window(store, client, cfg, provider):
    """HONEST GAP. Non-idempotent endpoint + provider slower than our settle assumption:
    verification sees nothing, we resend, then the original lands too. Two messages.
    OneShot cannot prevent this; reconciliation detects it."""
    provider.add_faults({"mode": "slow_success", "endpoint": "/v1/messages", "delay_seconds": 2.5})
    a = submit(store, "message.send", MESSAGE)
    drain(store, client, cfg)
    assert store.get(a.id).status is S.SUCCEEDED
    time.sleep(2.5)  # the slow original finally lands
    assert len(provider.effects(a.id)) == 2  # the duplicate is real
    report = Reconciler(store, client, cfg).run()
    assert [f.action_id for f in report.of(FindingKind.DUPLICATE_EFFECT)] == [a.id]


def test_same_key_retry_is_not_attempted_once_provider_may_have_forgotten_the_key(tmp_path):
    """Provider forgets keys after 1s. OneShot, correctly told so, refuses a blind
    retry once the window is nearly over and verifies instead -> still one effect."""
    with ProviderProcess(tmp_path / "p.db", idempotency_ttl=1.0, slow_delay=1.2) as p:
        cfg = Settings(
            db_path=str(tmp_path / "o.db"), provider_url=p.url, provider_timeout_seconds=0.3, lease_seconds=1.0,
            backoff_base_seconds=1.2, backoff_max_seconds=1.2, backoff_jitter=False,
            provider_key_retention_seconds=1.0, key_retention_margin_seconds=0.2, provider_settle_seconds=0.5,
        )  # fmt: skip
        store, client = ActionStore(cfg.db_path), ProviderClient(cfg)
        p.add_faults({"mode": "lost_response"})
        a = submit(store)
        # First attempt is ambiguous. The window is open *now*, but the retry would be sent
        # 1.2s later, after the provider forgets the key. Policy judges safety at send time,
        # so it verifies instead of retrying blindly.
        drain(store, client, cfg)
        assert store.get(a.id).status is S.SUCCEEDED
        assert outcomes(store, a.id) == [Outcome.AMBIGUOUS, Outcome.FOUND]
        assert len(p.effects(a.id)) == 1
        client.close()


def test_misconfigured_retention_window_causes_a_duplicate(tmp_path):
    """The guarantee is only as good as the configuration: if OneShot believes the
    provider remembers keys for an hour but it really forgets after 0.5s, a late
    same-key retry is treated as new by the provider. This test documents that."""
    with ProviderProcess(tmp_path / "p.db", idempotency_ttl=0.5) as p:
        cfg = Settings(
            db_path=str(tmp_path / "o.db"), provider_url=p.url, provider_timeout_seconds=0.3, lease_seconds=1.0,
            backoff_base_seconds=1.0, backoff_max_seconds=1.0, backoff_jitter=False,
            provider_key_retention_seconds=3600,  # WRONG on purpose
        )  # fmt: skip
        store, client = ActionStore(cfg.db_path), ProviderClient(cfg)
        p.add_faults({"mode": "lost_response"})
        a = submit(store)
        drain(store, client, cfg)
        assert store.get(a.id).status is S.SUCCEEDED
        assert len(p.effects(a.id)) == 2
        client.close()


# -------------------------------------------------------------- crash recovery


def _wait(proc, timeout=20) -> int:
    return proc.wait(timeout=timeout)


def test_worker_crash_after_provider_applied_is_recovered_without_duplicate(store, client, cfg, provider):
    """The nastiest crash: provider applied the charge, worker died before recording it."""
    a = submit(store)
    crashed = spawn_worker(cfg, failpoints=["after_response"])
    assert _wait(crashed) == FAILPOINT_EXIT_CODE
    mid = store.get(a.id)
    assert mid.status is S.IN_FLIGHT and len(provider.effects(a.id)) == 1  # applied, unrecorded

    assert _wait(spawn_worker(cfg)) == 0  # fresh worker: waits for lease expiry, recovers
    final = store.get(a.id)
    assert final.status is S.SUCCEEDED
    assert outcomes(store, a.id) == [Outcome.CRASHED, Outcome.APPLIED]  # 2nd = provider replay
    assert len(provider.effects(a.id)) == 1


def test_worker_crash_before_send_on_message_is_verified_then_sent_once(store, client, cfg, provider):
    a = submit(store, "message.send", MESSAGE)
    assert _wait(spawn_worker(cfg, failpoints=["before_send"])) == FAILPOINT_EXIT_CODE
    assert provider.effects(a.id) == []
    assert _wait(spawn_worker(cfg)) == 0
    assert store.get(a.id).status is S.SUCCEEDED
    assert outcomes(store, a.id) == [Outcome.CRASHED, Outcome.ABSENT, Outcome.APPLIED]
    assert len(provider.effects(a.id)) == 1


def test_sigkill_mid_request_is_recovered(store, client, cfg, provider):
    """A real kill -9 while the request is in the air (provider is slow)."""
    provider.add_faults({"mode": "slow_success", "delay_seconds": 0.4})
    a = submit(store)
    proc = spawn_worker(cfg)
    deadline = time.monotonic() + 5
    while store.get(a.id).status is not S.IN_FLIGHT:
        assert time.monotonic() < deadline
        time.sleep(0.01)
    proc.send_signal(signal.SIGKILL)
    assert _wait(proc) == -signal.SIGKILL
    assert _wait(spawn_worker(cfg)) == 0
    assert store.get(a.id).status is S.SUCCEEDED
    time.sleep(0.5)
    assert len(provider.effects(a.id)) == 1


def test_many_actions_survive_repeated_worker_crashes(store, client, cfg, provider):
    """Crash the worker over and over; every action still ends in a known state, no duplicates."""
    ids = [submit(store, payload={**CHARGE, "amount_cents": 100 + i}).id for i in range(6)]
    for _ in range(3):
        _wait(spawn_worker(cfg, failpoints=["after_response"]))
    assert _wait(spawn_worker(cfg)) == 0
    for action_id in ids:
        assert store.get(action_id).status is S.SUCCEEDED
        assert len(provider.effects(action_id)) == 1


# ------------------------------------------------- provider crash -> UNKNOWN -> reconcile


def test_provider_crash_and_outage_lead_to_unknown_then_reconciliation_resolves(store, client, cfg, provider):
    provider.add_faults({"mode": "crash_after_apply", "endpoint": "/v1/messages"})
    a = submit(store, "message.send", MESSAGE)
    drain(store, client, cfg)  # provider is dead: verification cannot reach it
    unknown = store.get(a.id)
    assert unknown.status is S.UNKNOWN and unknown.maybe_applied

    provider.start()  # provider comes back with its ledger intact
    report = Reconciler(store, client, cfg).run()
    assert [f.action_id for f in report.of(FindingKind.RESOLVED_SUCCEEDED)] == [a.id]
    final = store.get(a.id)
    assert final.status is S.SUCCEEDED and final.resolution.startswith("reconciler")


def test_unknown_with_no_effect_is_resolved_failed(store, client, cfg, provider):
    provider.add_faults({"mode": "crash_before_apply", "endpoint": "/v1/messages"})
    a = submit(store, "message.send", MESSAGE)
    drain(store, client, cfg)
    assert store.get(a.id).status is S.UNKNOWN
    provider.start()
    report = Reconciler(store, client, cfg).run()
    assert [f.action_id for f in report.of(FindingKind.RESOLVED_FAILED)] == [a.id]
    assert store.get(a.id).status is S.FAILED


def test_wiping_oneshot_database_cannot_erase_provider_evidence(tmp_path, cfg, provider):
    store = ActionStore(cfg.db_path)
    client = ProviderClient(cfg)
    a = submit(store)
    drain(store, client, cfg)
    for suffix in ("", "-wal", "-shm"):
        (tmp_path / f"oneshot.db{suffix}").unlink(missing_ok=True)
    fresh = ActionStore(cfg.db_path)
    report = Reconciler(fresh, client, cfg).run()
    assert [f.action_id for f in report.of(FindingKind.ORPHAN_EFFECT)] == [a.id]
    client.close()


def test_agent_retrying_with_new_key_creates_duplicate_that_reconciliation_flags(store, client, cfg, provider):
    """HONEST GAP at the agent layer: a new Idempotency-Key means a new intent to OneShot."""
    a1 = submit(store, key="agent-attempt-1")
    a2 = submit(store, key="agent-attempt-2")  # same content, different key
    drain(store, client, cfg)
    assert len(provider.effects(a1.id)) == 1 and len(provider.effects(a2.id)) == 1
    report = Reconciler(store, client, cfg).run()
    assert [f.action_id for f in report.of(FindingKind.SUSPECTED_DUPLICATE_REQUEST)] == [a2.id]


def test_reconciliation_dry_run_changes_nothing(store, client, cfg, provider):
    provider.add_faults({"mode": "crash_after_apply", "endpoint": "/v1/messages"})
    a = submit(store, "message.send", MESSAGE)
    drain(store, client, cfg)
    provider.start()
    report = Reconciler(store, client, cfg).run(apply=False)
    assert report.of(FindingKind.RESOLVED_SUCCEEDED)
    assert store.get(a.id).status is S.UNKNOWN


def test_reconciliation_fails_loudly_when_provider_is_down(store, client, cfg, provider):
    from oneshot.reconciler import ReconciliationError

    provider.stop()
    with pytest.raises(ReconciliationError):
        Reconciler(store, client, cfg).run()


def test_settings_reject_lease_shorter_than_timeout():
    with pytest.raises(ValueError):
        replace(Settings(), provider_timeout_seconds=5, lease_seconds=6)


# ------------------------------------------- worked example: a new failure mode
# (docs/src/07-how-to-extend.md walks through adding ERROR_AFTER_APPLY)


def test_error_after_apply_charge_is_retried_and_replayed_once(store, client, cfg, provider):
    provider.add_faults({"mode": "error_after_apply"})
    a = submit(store)
    drain(store, client, cfg)
    assert store.get(a.id).status is S.SUCCEEDED
    assert outcomes(store, a.id) == [Outcome.AMBIGUOUS, Outcome.APPLIED]
    assert len(provider.effects(a.id)) == 1


def test_error_after_apply_message_is_verified_not_resent(store, client, cfg, provider):
    provider.add_faults({"mode": "error_after_apply", "endpoint": "/v1/messages"})
    a = submit(store, "message.send", MESSAGE)
    drain(store, client, cfg)
    assert store.get(a.id).status is S.SUCCEEDED
    assert outcomes(store, a.id) == [Outcome.AMBIGUOUS, Outcome.FOUND]
    assert len(provider.effects(a.id)) == 1
