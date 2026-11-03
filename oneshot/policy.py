"""Retry and safety policy: *pure functions*, no I/O.

Given an action, what just happened, and the clock, decide the next status.
Keeping this logic free of databases and sockets means every rule below is
unit-tested directly (tests/test_policy.py) and readable in one place.

The single most important rule in OneShot::

    Retrying is safe if and only if the previous attempt PROVABLY did not apply
    the effect, OR the provider will deduplicate the retry.

Concretely, after an attempt whose outcome is AMBIGUOUS (timeout, dropped
connection, 5xx, crashed worker):

====================================  ==========================================
Provider capability                   What OneShot does
====================================  ==========================================
idempotent, inside retention window   retry with the SAME key (provider dedups)
otherwise, supports lookup            VERIFY: wait for the settle window, then
                                      look at the provider's record first
neither                               UNKNOWN: retrying could duplicate, and
                                      there is no way to check
====================================  ==========================================
"""

from __future__ import annotations

import random
from dataclasses import dataclass

from oneshot.action_types import ActionType
from oneshot.config import Settings
from oneshot.domain import Action, ActionStatus, Decision, Outcome

S = ActionStatus


@dataclass(frozen=True)
class SendResult:
    """Classified result of one send attempt (see oneshot.provider_client)."""

    outcome: Outcome
    detail: str
    http_status: int | None = None
    effect_id: str | None = None
    replayed: bool = False


@dataclass(frozen=True)
class LookupResult:
    """Result of asking the provider for effects carrying our reference."""

    ok: bool
    effect_ids: tuple[str, ...] = ()
    detail: str = ""


# ------------------------------------------------------------------- backoff


def backoff_delay(attempt_number: int, settings: Settings, rng: random.Random | None = None) -> float:
    """Exponential backoff with "full jitter" (AWS Architecture Blog, 2015).

    ``attempt_number`` is the number of the attempt that just finished (1-based).
    Without jitter: base, 2*base, 4*base, ... capped at max. With jitter the
    delay is uniform in [0, that], which spreads out retries from many clients
    so they do not hammer a recovering provider in lockstep.
    """
    ceiling = min(settings.backoff_max_seconds, settings.backoff_base_seconds * 2 ** (attempt_number - 1))
    if not settings.backoff_jitter:
        return ceiling
    return (rng or random).uniform(0, ceiling)


# ---------------------------------------------------------------- the rules


def same_key_retry_is_safe(action: Action, action_type: ActionType, settings: Settings, now: float) -> bool:
    """True if a blind retry with the same Idempotency-Key cannot duplicate the effect.

    Requires (a) the provider honours keys for this action type, and (b) the
    provider still remembers the key: we measure from ``first_sent_at``, which is
    recorded *before* the first request left, so it can only under-estimate the
    key's age, never over-estimate it.
    """
    if not action_type.idempotent or action.first_sent_at is None:
        return False
    age = now - action.first_sent_at
    return age < settings.provider_key_retention_seconds - settings.key_retention_margin_seconds


def _attempts_left(action: Action, settings: Settings) -> bool:
    return action.attempt_count < settings.max_attempts


def after_ambiguous(
    action: Action,
    action_type: ActionType,
    settings: Settings,
    now: float,
    why: str,
    rng: random.Random | None = None,
) -> Decision:
    """The effect MAY have been applied. Decide without risking a duplicate."""
    if _attempts_left(action, settings) and same_key_retry_is_safe(action, action_type, settings, now):
        delay = backoff_delay(action.attempt_count, settings, rng)
        return Decision(
            S.PENDING,
            f"{why}; outcome unknown -> retry in {delay:.2f}s with the SAME idempotency key "
            f"(provider deduplicates, so a retry cannot double-apply)",
            next_attempt_at=now + delay,
            maybe_applied=True,
            error=why,
        )
    if action_type.supports_lookup:
        check_at = max(now, (action.last_sent_at or now) + settings.provider_settle_seconds)
        reason = "retry with same key no longer safe" if action_type.idempotent else "provider does not deduplicate"
        return Decision(
            S.VERIFYING,
            f"{why}; outcome unknown and {reason} -> check provider's record at settle time "
            f"(+{check_at - now:.2f}s) before deciding",
            next_attempt_at=check_at,
            maybe_applied=True,
            error=why,
        )
    return Decision(
        S.UNKNOWN,
        f"{why}; outcome unknown, retry could duplicate and the provider offers no lookup -> needs investigation",
        maybe_applied=True,
        error=why,
    )


def after_send(
    action: Action,
    action_type: ActionType,
    result: SendResult,
    settings: Settings,
    now: float,
    rng: random.Random | None = None,
) -> Decision:
    """Decide what happens after a send attempt returned ``result``."""
    o = result.outcome
    if o is Outcome.APPLIED:
        how = "replayed original result (provider deduplicated)" if result.replayed else "applied"
        return Decision(S.SUCCEEDED, f"provider confirmed: {how} as {result.effect_id}", effect_id=result.effect_id)

    if o is Outcome.REJECTED:
        return Decision(S.FAILED, f"provider rejected permanently ({result.detail}); not applied, not retrying", error=result.detail)

    if o is Outcome.RETRYABLE:
        if _attempts_left(action, settings):
            delay = backoff_delay(action.attempt_count, settings, rng)
            return Decision(
                S.PENDING,
                f"{result.detail}; definitely not applied -> retry in {delay:.2f}s "
                f"(attempt {action.attempt_count + 1}/{settings.max_attempts})",
                next_attempt_at=now + delay,
                error=result.detail,
            )
        if action.maybe_applied:
            # An EARLIER attempt was ambiguous. This attempt failing cleanly does
            # not prove the earlier one did not apply; we must not say FAILED.
            return after_ambiguous(action, action_type, settings, now, f"retries exhausted after {result.detail}", rng)
        return Decision(
            S.FAILED,
            f"{result.detail}; retries exhausted and every attempt was definitely not applied",
            error=result.detail,
        )

    # AMBIGUOUS, IN_PROGRESS, CRASHED: the effect may exist.
    return after_ambiguous(action, action_type, settings, now, result.detail, rng)


def after_verify(
    action: Action,
    action_type: ActionType,
    lookup: LookupResult,
    settings: Settings,
    now: float,
    rng: random.Random | None = None,
) -> tuple[Outcome, Decision]:
    """Decide what happens after consulting the provider's record."""
    if not lookup.ok:
        if action.verify_count < settings.max_verifications:
            delay = backoff_delay(action.verify_count, settings, rng)
            return Outcome.LOOKUP_FAILED, Decision(
                S.VERIFYING,
                f"could not check provider ({lookup.detail}); will try again in {delay:.2f}s "
                f"(check {action.verify_count}/{settings.max_verifications})",
                next_attempt_at=now + delay,
                error=lookup.detail,
            )
        return Outcome.LOOKUP_FAILED, Decision(
            S.UNKNOWN,
            f"could not check provider after {action.verify_count} tries ({lookup.detail}); "
            "outcome cannot be determined -> needs investigation / reconciliation",
            error=lookup.detail,
        )

    if lookup.effect_ids:
        n = len(lookup.effect_ids)
        warning = f" WARNING: provider shows {n} effects for this action (duplicate!)" if n > 1 else ""
        return Outcome.FOUND, Decision(
            S.SUCCEEDED,
            f"provider's record shows the effect was applied ({', '.join(lookup.effect_ids)}); not retrying.{warning}",
            effect_id=lookup.effect_ids[0],
            maybe_applied=True,
        )

    settle_deadline = (action.last_sent_at or now) + settings.provider_settle_seconds
    if now < settle_deadline:
        # Too early: the original request might still be in progress at the provider.
        return Outcome.ABSENT, Decision(
            S.VERIFYING,
            "no record yet, but settle window not over; checking again later",
            next_attempt_at=settle_deadline,
        )
    if _attempts_left(action, settings):
        return Outcome.ABSENT, Decision(
            S.PENDING,
            f"no record {settings.provider_settle_seconds:g}s after the last send -> treated as NOT applied "
            "(assumes provider settles within that window) -> safe to retry",
            next_attempt_at=now,
            maybe_applied=False,
        )
    return Outcome.ABSENT, Decision(
        S.FAILED,
        "no record after settle window and no attempts left -> not applied, giving up",
        maybe_applied=False,
    )
