"""Outcome classification: every HTTP result/exception maps to a precise Outcome."""

from __future__ import annotations

import httpx
import pytest

from oneshot.domain import Outcome
from oneshot.provider_client import classify_exception, classify_response

REQ = httpx.Request("POST", "http://provider/v1/charges")


def resp(code: int, body=None, headers=None) -> httpx.Response:
    return httpx.Response(code, json=body, headers=headers, request=REQ)


@pytest.mark.parametrize(
    ("response", "expected"),
    [
        (resp(201, {"id": "eff_1"}), Outcome.APPLIED),
        (resp(201, {"no": "id"}), Outcome.AMBIGUOUS),  # success we cannot verify is not success
        (resp(402, {"error": "declined", "applied": False}), Outcome.REJECTED),
        (resp(400, {"error": "invalid_request"}), Outcome.REJECTED),
        (resp(422, {"error": "idempotency_key_reused"}), Outcome.REJECTED),
        (resp(409, {"error": "request_in_progress"}), Outcome.IN_PROGRESS),
        (resp(503, {"error": "unavailable", "applied": False}), Outcome.RETRYABLE),
        (resp(429, {"error": "rate_limited", "applied": False}), Outcome.RETRYABLE),
        (resp(503, None), Outcome.AMBIGUOUS),  # a 503 from a proxy promises nothing
        (resp(500, {"error": "boom"}), Outcome.AMBIGUOUS),
        (resp(502, None), Outcome.AMBIGUOUS),
        (resp(504, None), Outcome.AMBIGUOUS),
    ],
)
def test_response_classification(response, expected):
    assert classify_response(response).outcome is expected


def test_replay_is_detected():
    r = classify_response(resp(201, {"id": "eff_1"}, {"Idempotent-Replayed": "true"}))
    assert r.outcome is Outcome.APPLIED and r.replayed


@pytest.mark.parametrize(
    ("exc", "expected"),
    [
        (httpx.ConnectError("refused", request=REQ), Outcome.RETRYABLE),
        (httpx.ConnectTimeout("slow handshake", request=REQ), Outcome.RETRYABLE),
        (httpx.ReadTimeout("no answer", request=REQ), Outcome.AMBIGUOUS),
        (httpx.RemoteProtocolError("disconnected", request=REQ), Outcome.AMBIGUOUS),
        (httpx.ReadError("reset", request=REQ), Outcome.AMBIGUOUS),
        (httpx.WriteTimeout("partial write", request=REQ), Outcome.AMBIGUOUS),
    ],
)
def test_exception_classification(exc, expected):
    assert classify_exception(exc).outcome is expected
