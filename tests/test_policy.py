"""The safety rules, tested as pure functions (no I/O, controllable time)."""

from __future__ import annotations

import random
from dataclasses import replace

import pytest

from oneshot import policy
from oneshot.action_types import MESSAGE_SEND, PAYMENT_CHARGE, REGISTRY, ActionType
from oneshot.domain import Action, ActionStatus, Outcome
from oneshot.policy import LookupResult, SendResult

S = ActionStatus
NOW = 1_000_000.0

# A capability combination with no safe way to retry or check.
BLIND = replace(MESSAGE_SEND, name="test.blind", supports_lookup=False)


def make_action(**overrides) -> Action:
    base = dict(
        id="act_1", type="payment.charge", payload={}, request_key="k", request_fingerprint="f",
        status=S.IN_FLIGHT, attempt_count=1, verify_count=0, maybe_applied=False, next_attempt_at=None,
        lease_owner="w", lease_expires_at=NOW + 5, first_sent_at=NOW - 1, last_sent_at=NOW - 1,
        provider_effect_id=None, last_error=None, resolution=None, created_at=NOW - 1, updated_at=NOW - 1,
    )  # fmt: skip
    base.update(overrides)
    return Action(**base)


AMBIGUOUS = SendResult(Outcome.AMBIGUOUS, "timed out")


# -------------------------------------------------------------- definite outcomes


def test_applied_succeeds(settings):
    d = policy.after_send(make_action(), PAYMENT_CHARGE, SendResult(Outcome.APPLIED, "201", 201, "eff_1"), settings, NOW)
    assert d.status is S.SUCCEEDED and d.effect_id == "eff_1"


def test_permanent_rejection_fails_without_retry(settings):
    d = policy.after_send(make_action(), PAYMENT_CHARGE, SendResult(Outcome.REJECTED, "402"), settings, NOW)
    assert d.status is S.FAILED


@pytest.mark.parametrize("action_type", list(REGISTRY.values()) + [BLIND], ids=lambda t: t.name)
def test_provably_not_applied_is_retried_for_every_action_type(settings, action_type: ActionType):
    """Retrying after a definite non-application is safe even without idempotency."""
    d = policy.after_send(make_action(), action_type, SendResult(Outcome.RETRYABLE, "503"), settings, NOW)
    assert d.status is S.PENDING and d.next_attempt_at > NOW


def test_retries_exhausted_with_only_clean_failures_is_failed(settings):
    a = make_action(attempt_count=settings.max_attempts)
    d = policy.after_send(a, PAYMENT_CHARGE, SendResult(Outcome.RETRYABLE, "503"), settings, NOW)
    assert d.status is S.FAILED


def test_retries_exhausted_after_an_ambiguous_attempt_is_never_failed(settings):
    """A clean 503 now does not prove the earlier timed-out attempt did nothing."""
    a = make_action(attempt_count=settings.max_attempts, maybe_applied=True)
    d = policy.after_send(a, PAYMENT_CHARGE, SendResult(Outcome.RETRYABLE, "503"), settings, NOW)
    assert d.status is S.VERIFYING


# ------------------------------------------------------------ ambiguous outcomes


def test_ambiguous_idempotent_retries_with_same_key(settings):
    d = policy.after_send(make_action(), PAYMENT_CHARGE, AMBIGUOUS, settings, NOW)
    assert d.status is S.PENDING and d.maybe_applied is True
    assert "SAME idempotency key" in d.reason


def test_ambiguous_non_idempotent_verifies_instead_of_retrying(settings):
    d = policy.after_send(make_action(type="message.send"), MESSAGE_SEND, AMBIGUOUS, settings, NOW)
    assert d.status is S.VERIFYING
    # Not before the settle window: the original request might still be landing.
    assert d.next_attempt_at == pytest.approx(NOW - 1 + settings.provider_settle_seconds)


def test_ambiguous_without_idempotency_or_lookup_is_unknown(settings):
    d = policy.after_send(make_action(), BLIND, AMBIGUOUS, settings, NOW)
    assert d.status is S.UNKNOWN


def test_in_progress_and_crash_are_treated_as_ambiguous(settings):
    for outcome in (Outcome.IN_PROGRESS, Outcome.CRASHED):
        d = policy.after_send(make_action(type="message.send"), MESSAGE_SEND, SendResult(outcome, "x"), settings, NOW)
        assert d.status is S.VERIFYING


def test_same_key_retry_stops_before_provider_forgets_the_key(settings):
    old = make_action(first_sent_at=NOW - settings.provider_key_retention_seconds + 30)  # inside the margin
    assert not policy.same_key_retry_is_safe(old, PAYMENT_CHARGE, settings, NOW)
    d = policy.after_send(old, PAYMENT_CHARGE, AMBIGUOUS, settings, NOW)
    assert d.status is S.VERIFYING  # verify instead of a blind retry that could duplicate


# ------------------------------------------------------------------ verification


def test_verify_found_means_succeeded(settings):
    _, d = policy.after_verify(make_action(status=S.VERIFYING), MESSAGE_SEND, LookupResult(True, ("eff_9",)), settings, NOW)
    assert d.status is S.SUCCEEDED and d.effect_id == "eff_9"


def test_verify_absent_after_settle_retries(settings):
    a = make_action(status=S.VERIFYING, last_sent_at=NOW - settings.provider_settle_seconds - 1)
    outcome, d = policy.after_verify(a, MESSAGE_SEND, LookupResult(True, ()), settings, NOW)
    assert outcome is Outcome.ABSENT and d.status is S.PENDING and d.maybe_applied is False


def test_verify_absent_before_settle_waits(settings):
    a = make_action(status=S.VERIFYING, last_sent_at=NOW - 0.5)
    _, d = policy.after_verify(a, MESSAGE_SEND, LookupResult(True, ()), settings, NOW)
    assert d.status is S.VERIFYING


def test_verify_failures_end_in_unknown(settings):
    a = make_action(status=S.VERIFYING, verify_count=settings.max_verifications)
    outcome, d = policy.after_verify(a, MESSAGE_SEND, LookupResult(False, detail="down"), settings, NOW)
    assert outcome is Outcome.LOOKUP_FAILED and d.status is S.UNKNOWN


def test_verify_found_twice_flags_duplicate(settings):
    _, d = policy.after_verify(make_action(status=S.VERIFYING), MESSAGE_SEND, LookupResult(True, ("e1", "e2")), settings, NOW)
    assert d.status is S.SUCCEEDED and "duplicate" in d.reason


# ---------------------------------------------------------------------- backoff


def test_backoff_grows_exponentially_and_is_capped(settings):
    s = replace(settings, backoff_base_seconds=0.5, backoff_max_seconds=4.0, backoff_jitter=False)
    assert [policy.backoff_delay(n, s) for n in range(1, 7)] == [0.5, 1.0, 2.0, 4.0, 4.0, 4.0]


def test_jittered_backoff_stays_within_bounds(settings):
    s = replace(settings, backoff_base_seconds=0.5, backoff_max_seconds=4.0, backoff_jitter=True)
    rng = random.Random(42)
    for n in range(1, 8):
        ceiling = min(4.0, 0.5 * 2 ** (n - 1))
        assert all(0 <= policy.backoff_delay(n, s, rng) <= ceiling for _ in range(200))
