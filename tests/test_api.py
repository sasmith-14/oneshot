"""HTTP API: agent-facing duplicate protection and the resolve workflow."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from oneshot.api import create_app
from oneshot.domain import ActionStatus, Decision, Outcome
from oneshot.store import ActionStore
from tests.conftest import CHARGE


@pytest.fixture
def api(settings):
    return TestClient(create_app(settings))


def post(api, key, body=None):
    return api.post("/actions", json=body or {"type": "payment.charge", "payload": CHARGE}, headers={"Idempotency-Key": key})


def test_submit_then_replay_same_key(api):
    first = post(api, "agent-1")
    second = post(api, "agent-1")
    assert first.status_code == 201
    assert second.status_code == 200 and second.headers["Idempotent-Replayed"] == "true"
    assert first.json()["id"] == second.json()["id"]
    assert len(api.get("/actions").json()) == 1


def test_key_reuse_with_different_payload_is_422(api):
    post(api, "agent-1")
    resp = post(api, "agent-1", {"type": "payment.charge", "payload": {**CHARGE, "amount_cents": 1}})
    assert resp.status_code == 422


def test_idempotency_key_is_required(api):
    assert api.post("/actions", json={"type": "payment.charge", "payload": CHARGE}).status_code == 422


def test_invalid_payload_and_unknown_type_are_400(api):
    assert post(api, "a", {"type": "payment.charge", "payload": {"amount_cents": -5, "customer": "x"}}).status_code == 400
    assert post(api, "b", {"type": "rocket.launch", "payload": {}}).status_code == 400


def test_payload_is_normalised_before_fingerprinting(api):
    """'usd' and 'USD' are the same request, so the same key must replay, not conflict."""
    post(api, "k", {"type": "payment.charge", "payload": {**CHARGE, "currency": "usd"}})
    assert post(api, "k", {"type": "payment.charge", "payload": CHARGE}).status_code == 200


def test_get_action_has_timeline(api):
    action_id = post(api, "agent-1").json()["id"]
    detail = api.get(f"/actions/{action_id}").json()
    assert detail["status"] == "PENDING"
    assert detail["events"][0]["to"] == "PENDING"
    assert api.get("/actions/act_nope").status_code == 404


def test_resolve_only_unknown(api, settings):
    action_id = post(api, "agent-1").json()["id"]
    body = {"status": "SUCCEEDED", "note": "checked dashboard"}
    assert api.post(f"/actions/{action_id}/resolve", json=body).status_code == 409

    store = ActionStore(settings.db_path)
    action, attempt = store.claim_next("w", 5)
    store.apply_decision(action.id, attempt.id, "w", Outcome.AMBIGUOUS, "x", Decision(ActionStatus.UNKNOWN, "?"))
    resp = api.post(f"/actions/{action_id}/resolve", json=body)
    assert resp.status_code == 200 and resp.json()["status"] == "SUCCEEDED"
    assert "operator: checked dashboard" in resp.json()["resolution"]
