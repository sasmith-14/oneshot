"""The catalogue of actions OneShot knows how to execute.

An :class:`ActionType` describes *what the provider guarantees* for one kind of
action. Those capabilities — not the action's name — drive every safety
decision in :mod:`oneshot.policy`:

* ``idempotent``      — the provider deduplicates requests carrying the same
  ``Idempotency-Key`` (within its retention window). Ambiguous outcomes can then
  be retried blindly with the same key.
* ``supports_lookup`` — the provider can be asked "did you apply an effect for
  reference X?". Ambiguous outcomes can then be *verified* before retrying.

Neither capability → an ambiguous outcome goes straight to UNKNOWN.

To add a new action type, see docs/src/07-how-to-extend.md.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable


class InvalidPayload(ValueError):
    pass


@dataclass(frozen=True)
class ActionType:
    name: str
    provider_path: str
    idempotent: bool
    supports_lookup: bool
    validate: Callable[[dict[str, Any]], dict[str, Any]]
    """Validate and normalise an agent-supplied payload. Raise InvalidPayload."""
    build_request: Callable[[str, dict[str, Any]], dict[str, Any]]
    """(action_id, payload) -> provider request body. Must include the reference."""
    summary: Callable[[dict[str, Any]], str]
    """Short human description for logs, CLI and demo output."""


# --------------------------------------------------------------------- charge


def _validate_charge(p: dict[str, Any]) -> dict[str, Any]:
    amount = p.get("amount_cents")
    if not isinstance(amount, int) or isinstance(amount, bool) or amount <= 0:
        raise InvalidPayload("amount_cents must be a positive integer")
    currency = p.get("currency", "USD")
    if not isinstance(currency, str) or len(currency) != 3:
        raise InvalidPayload("currency must be a 3-letter code")
    customer = p.get("customer")
    if not isinstance(customer, str) or not customer:
        raise InvalidPayload("customer is required")
    return {"amount_cents": amount, "currency": currency.upper(), "customer": customer}


PAYMENT_CHARGE = ActionType(
    name="payment.charge",
    provider_path="/v1/charges",
    idempotent=True,
    supports_lookup=True,
    validate=_validate_charge,
    build_request=lambda action_id, p: {**p, "reference": action_id},
    summary=lambda p: f"charge {p['customer']} {p['amount_cents'] / 100:.2f} {p['currency']}",
)

# -------------------------------------------------------------------- message


def _validate_message(p: dict[str, Any]) -> dict[str, Any]:
    to, body = p.get("to"), p.get("body")
    if not isinstance(to, str) or not to:
        raise InvalidPayload("to is required")
    if not isinstance(body, str) or not body:
        raise InvalidPayload("body is required")
    return {"to": to, "body": body}


MESSAGE_SEND = ActionType(
    name="message.send",
    provider_path="/v1/messages",
    idempotent=False,  # the provider's legacy messages endpoint ignores Idempotency-Key
    supports_lookup=True,
    validate=_validate_message,
    build_request=lambda action_id, p: {**p, "reference": action_id},
    summary=lambda p: f"message to {p['to']}: {p['body']!r}",
)


REGISTRY: dict[str, ActionType] = {t.name: t for t in (PAYMENT_CHARGE, MESSAGE_SEND)}


def get_action_type(name: str) -> ActionType:
    try:
        return REGISTRY[name]
    except KeyError:
        raise InvalidPayload(f"unknown action type {name!r}; known: {sorted(REGISTRY)}") from None
