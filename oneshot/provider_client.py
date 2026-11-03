"""HTTP client for the external provider, with precise outcome classification.

The classification below is the foundation of every retry decision, so each
branch states *why* it maps where it does. When unsure, classify as AMBIGUOUS:
a wrong AMBIGUOUS costs an extra lookup; a wrong RETRYABLE costs a duplicate.

Note that the 4xx-means-not-applied and 503-with-``applied:false`` rules come
from the (fake) provider's API contract. Against a real provider you must read
its documentation and decide again; this mapping is not universal.
"""

from __future__ import annotations

from typing import Any

import httpx

from oneshot.action_types import ActionType
from oneshot.config import Settings
from oneshot.domain import Action, Outcome
from oneshot.policy import LookupResult, SendResult


def classify_response(resp: httpx.Response) -> SendResult:
    code = resp.status_code
    try:
        body: Any = resp.json()
    except ValueError:
        body = None
    if 200 <= code < 300:
        effect_id = body.get("id") if isinstance(body, dict) else None
        if effect_id is None:
            # "Success" without the effect id we need is not something we can trust.
            return SendResult(Outcome.AMBIGUOUS, f"HTTP {code} without effect id", code)
        return SendResult(
            Outcome.APPLIED,
            f"HTTP {code}",
            code,
            effect_id=effect_id,
            replayed=resp.headers.get("Idempotent-Replayed") == "true",
        )
    if code == 409:
        # Provider: "a request with this key is still being processed". The
        # original may yet apply, so this is NOT a clean failure.
        return SendResult(Outcome.IN_PROGRESS, "HTTP 409: original request still in progress", code)
    if code in (429, 503) and isinstance(body, dict) and body.get("applied") is False:
        # Explicit contract: rejected before doing anything. Safe to retry.
        return SendResult(Outcome.RETRYABLE, f"HTTP {code} {body.get('error', '')} (applied=false)".strip(), code)
    if 400 <= code < 500 and code not in (408, 429):
        error = body.get("error") if isinstance(body, dict) else None
        return SendResult(Outcome.REJECTED, f"HTTP {code} {error or ''}".strip(), code)
    # 5xx (and 408/429/503 without an explicit applied=false): the server may
    # have done the work before failing. Ambiguous.
    return SendResult(Outcome.AMBIGUOUS, f"HTTP {code} (server error; may have applied)", code)


def classify_exception(exc: httpx.HTTPError) -> SendResult:
    # Never connected => the request never left this machine => not applied.
    if isinstance(exc, (httpx.ConnectError, httpx.ConnectTimeout, httpx.PoolTimeout)):
        return SendResult(Outcome.RETRYABLE, f"could not connect ({type(exc).__name__}); request never sent")
    # Connected and (possibly) sent, then no usable answer => may have applied.
    if isinstance(exc, httpx.ReadTimeout):
        return SendResult(Outcome.AMBIGUOUS, "timed out waiting for the response")
    if isinstance(exc, httpx.RemoteProtocolError):
        return SendResult(Outcome.AMBIGUOUS, "connection dropped before a response arrived")
    # ReadError, WriteError, WriteTimeout and anything unforeseen: be conservative.
    return SendResult(Outcome.AMBIGUOUS, f"transport error after connecting ({type(exc).__name__})")


class ProviderClient:
    def __init__(self, settings: Settings, transport: httpx.BaseTransport | None = None) -> None:
        self.settings = settings
        timeout = httpx.Timeout(settings.provider_timeout_seconds, connect=min(1.0, settings.provider_timeout_seconds))
        self._http = httpx.Client(base_url=settings.provider_url, timeout=timeout, transport=transport)

    def close(self) -> None:
        self._http.close()

    def send(self, action: Action, action_type: ActionType) -> SendResult:
        """Send the action. The provider idempotency key is the action id: stable
        across every retry and every crash, because it was persisted at submit time."""
        headers = {"Idempotency-Key": action.id} if action_type.idempotent else {}
        body = action_type.build_request(action.id, action.payload)
        try:
            resp = self._http.post(action_type.provider_path, json=body, headers=headers)
        except httpx.HTTPError as exc:
            return classify_exception(exc)
        return classify_response(resp)

    def lookup(self, reference: str) -> LookupResult:
        """Ask the provider's ledger which effects carry this reference."""
        try:
            resp = self._http.get("/v1/effects", params={"reference": reference})
            resp.raise_for_status()
            effects = resp.json()["effects"]
        except (httpx.HTTPError, ValueError, KeyError) as exc:
            return LookupResult(ok=False, detail=f"lookup failed: {type(exc).__name__}")
        return LookupResult(ok=True, effect_ids=tuple(e["id"] for e in effects))

    def ledger(self) -> list[dict[str, Any]]:
        """Every effect the provider ever applied (used by reconciliation). Raises on failure."""
        resp = self._http.get("/v1/effects")
        resp.raise_for_status()
        return resp.json()["effects"]
