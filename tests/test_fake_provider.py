"""The fake provider must behave like a real flaky service, over a real socket.

These tests talk to it with plain httpx, without any OneShot code, so they
pin down the provider's contract independently of the client built on it.
"""

from __future__ import annotations

import time

import httpx
import pytest

from fakeprovider.faults import FaultMode
from fakeprovider.process import ProviderProcess

pytestmark = pytest.mark.integration

CHARGE = {"amount_cents": 1500, "currency": "USD", "customer": "cus_123", "reference": "act_test"}
MESSAGE = {"to": "+15550100", "body": "hello", "reference": "act_msg"}


@pytest.fixture
def provider(tmp_path):
    with ProviderProcess(tmp_path / "provider.db", timeout_hang=1.5, slow_delay=1.0) as p:
        yield p


def post(provider, path, body, key=None, timeout=1.0):
    headers = {"Idempotency-Key": key} if key else {}
    return httpx.post(f"{provider.url}{path}", json=body, headers=headers, timeout=timeout)


def test_success_records_effect_in_ledger(provider):
    resp = post(provider, "/v1/charges", CHARGE, key="k1")
    assert resp.status_code == 201
    effects = provider.effects("act_test")
    assert len(effects) == 1 and effects[0]["id"] == resp.json()["id"]


def test_same_idempotency_key_replays_without_new_effect(provider):
    first = post(provider, "/v1/charges", CHARGE, key="k1")
    second = post(provider, "/v1/charges", CHARGE, key="k1")
    assert second.status_code == 201
    assert second.headers["Idempotent-Replayed"] == "true"
    assert second.json() == first.json()
    assert len(provider.effects("act_test")) == 1


def test_key_reused_with_different_body_is_rejected(provider):
    post(provider, "/v1/charges", CHARGE, key="k1")
    resp = post(provider, "/v1/charges", {**CHARGE, "amount_cents": 9999}, key="k1")
    assert resp.status_code == 422
    assert len(provider.effects("act_test")) == 1


def test_messages_endpoint_ignores_idempotency_keys(provider):
    """The legacy endpoint is the honest gap: same key, two effects."""
    post(provider, "/v1/messages", MESSAGE, key="k1")
    post(provider, "/v1/messages", MESSAGE, key="k1")
    assert len(provider.effects("act_msg")) == 2


def test_decline_and_unavailable_apply_nothing(provider):
    provider.add_faults({"mode": "decline"}, {"mode": "unavailable"})
    assert post(provider, "/v1/charges", CHARGE, key="k1").status_code == 402
    assert post(provider, "/v1/charges", {**CHARGE, "reference": "r2"}, key="k2").status_code == 503
    assert provider.effects() == []


def test_unavailable_releases_key_so_retry_can_succeed(provider):
    provider.add_faults({"mode": "unavailable"})
    assert post(provider, "/v1/charges", CHARGE, key="k1").status_code == 503
    assert post(provider, "/v1/charges", CHARGE, key="k1").status_code == 201
    assert len(provider.effects("act_test")) == 1


def test_lost_response_applies_effect_but_client_sees_disconnect(provider):
    provider.add_faults({"mode": "lost_response"})
    with pytest.raises(httpx.RemoteProtocolError):
        post(provider, "/v1/charges", CHARGE, key="k1")
    assert len(provider.effects("act_test")) == 1  # it DID happen
    # A retry with the same key gets the original answer, not a second charge.
    retry = post(provider, "/v1/charges", CHARGE, key="k1")
    assert retry.status_code == 201 and retry.headers["Idempotent-Replayed"] == "true"
    assert len(provider.effects("act_test")) == 1


def test_timeout_applies_nothing_but_client_cannot_tell(provider):
    provider.add_faults({"mode": "timeout"})
    with pytest.raises(httpx.ReadTimeout):
        post(provider, "/v1/charges", CHARGE, key="k1", timeout=0.5)
    time.sleep(1.3)  # let the provider finish hanging
    assert provider.effects() == []


def test_slow_success_applies_after_client_gave_up(provider):
    provider.add_faults({"mode": "slow_success"})
    with pytest.raises(httpx.ReadTimeout):
        post(provider, "/v1/charges", CHARGE, key="k1", timeout=0.3)
    # While the original is still processing, a retry with the same key is told to wait.
    assert post(provider, "/v1/charges", CHARGE, key="k1").status_code == 409
    time.sleep(1.0)
    assert len(provider.effects("act_test")) == 1


def test_crash_after_apply_keeps_evidence_across_restart(provider):
    provider.add_faults({"mode": "crash_after_apply"})
    with pytest.raises(httpx.TransportError):
        post(provider, "/v1/charges", CHARGE, key="k1")
    assert provider.wait_exit() == 3
    provider.restart()
    assert len(provider.effects("act_test")) == 1
    # Key completion was in the same transaction as the effect, so a retry replays.
    assert post(provider, "/v1/charges", CHARGE, key="k1").headers.get("Idempotent-Replayed") == "true"


def test_crash_before_apply_leaves_no_effect_and_frees_key(provider):
    provider.add_faults({"mode": "crash_before_apply"})
    with pytest.raises(httpx.TransportError):
        post(provider, "/v1/charges", CHARGE, key="k1")
    provider.wait_exit()
    provider.restart()
    assert provider.effects() == []
    assert post(provider, "/v1/charges", CHARGE, key="k1").status_code == 201


def test_expired_idempotency_key_allows_a_duplicate(tmp_path):
    """Retention windows are finite. Retry after expiry => provider sees a new request."""
    with ProviderProcess(tmp_path / "p.db", idempotency_ttl=0.5) as p:
        post(p, "/v1/charges", CHARGE, key="k1")
        time.sleep(0.7)
        post(p, "/v1/charges", CHARGE, key="k1")
        assert len(p.effects("act_test")) == 2


def test_every_fault_mode_is_documented_as_applying_or_not():
    # Guards the extension point: a new FaultMode must declare whether it applies an effect.
    for mode in FaultMode:
        assert isinstance(mode.applies_effect, bool)
