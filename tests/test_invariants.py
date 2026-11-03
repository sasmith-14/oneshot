"""Core guarantees, checked across EVERY fault mode and action type.

These tests are the safety net for extending OneShot. They iterate over
``FaultMode`` and ``REGISTRY`` dynamically, so a newly added failure mode or
action type is covered automatically, and fails loudly if it breaks a
guarantee. The guarantees (stated precisely in docs/src/00-overview.md):

G1  Every action ends SUCCEEDED, FAILED or UNKNOWN - never stuck.
G2  SUCCEEDED means the provider's ledger has the effect.
    FAILED means the provider's ledger does NOT have it.
G3  For idempotent action types, the provider never applies an action twice.
G4  For non-idempotent action types, the same holds *while the provider
    settles within the configured window* (the documented gap otherwise).
G5  Once the provider is reachable, reconciliation leaves no UNKNOWN behind.
"""

from __future__ import annotations

import random
import time

import httpx
import pytest

from fakeprovider.faults import FaultMode
from fakeprovider.process import ProviderProcess
from oneshot.action_types import REGISTRY
from oneshot.config import Settings
from oneshot.domain import ActionStatus
from oneshot.provider_client import ProviderClient
from oneshot.reconciler import Reconciler
from oneshot.store import ActionStore
from oneshot.worker import Worker
from tests.conftest import CHARGE, MESSAGE

pytestmark = pytest.mark.integration
S = ActionStatus

PAYLOADS = {"payment.charge": CHARGE, "message.send": MESSAGE}
SETTLE = 0.8


def test_every_action_type_has_a_demo_payload():
    """Adding an action type? Give it a payload here so the invariants cover it."""
    assert set(PAYLOADS) == set(REGISTRY)


@pytest.fixture
def env(tmp_path):
    # slow_delay < settle window: G4 is only promised under that assumption.
    provider = ProviderProcess(tmp_path / "p.db", timeout_hang=0.7, slow_delay=0.6).start()
    cfg = Settings(
        db_path=str(tmp_path / "o.db"), provider_url=provider.url, provider_timeout_seconds=0.4,
        lease_seconds=1.0, max_attempts=5, max_verifications=3, backoff_base_seconds=0.05,
        backoff_max_seconds=0.2, backoff_jitter=False, provider_settle_seconds=SETTLE, poll_interval_seconds=0.02,
    )  # fmt: skip
    store, client = ActionStore(cfg.db_path), ProviderClient(cfg)
    yield provider, cfg, store, client
    client.close()
    provider.stop()


def run_until_settled(provider, cfg, store, client, timeout=40.0) -> None:
    """Drive a worker to completion, restarting the provider whenever it crashes
    (as a process supervisor such as systemd would)."""
    worker = Worker(store, client, cfg, worker_id="inv", log=lambda m: None)
    deadline = time.monotonic() + timeout
    while worker.has_unfinished_work():
        assert time.monotonic() < deadline, f"G1 violated - stuck: {store.counts()}"
        if not provider.is_running() and provider.wait_exit(0) is not None:
            provider.start()
        if not worker.step():
            time.sleep(cfg.poll_interval_seconds)
    if not provider.is_running():
        provider.start()


def assert_guarantees(provider, cfg, store, client) -> None:
    time.sleep(SETTLE + 0.3)  # let slow/hanging provider threads finish
    Reconciler(store, client, cfg).run()  # G5
    for action in store.list():
        effects = provider.effects(action.id)
        where = f"{action.id} ({action.type}) {action.status.value} with {len(effects)} effect(s)"
        assert action.status in (S.SUCCEEDED, S.FAILED), f"G1/G5: {where}"
        assert len(effects) <= 1, f"G3/G4 duplicate: {where}"
        assert (action.status is S.SUCCEEDED) == (len(effects) == 1), f"G2: {where}"


@pytest.mark.parametrize("mode", list(FaultMode), ids=lambda m: m.value)
def test_fault_mode_applies_effect_exactly_as_declared(env, mode):
    """Contract for the fake provider: FaultMode.applies_effect must match behaviour."""
    provider, *_ = env
    provider.add_faults({"mode": mode.value})
    try:
        httpx.post(f"{provider.url}/v1/charges", json={**CHARGE, "reference": "r"}, headers={"Idempotency-Key": "k"}, timeout=0.3)
    except httpx.HTTPError:
        pass
    time.sleep(0.9)  # slow/hanging modes
    if not provider.is_running():
        provider.wait_exit()
        provider.start()
    assert (len(provider.effects("r")) == 1) is mode.applies_effect


@pytest.mark.parametrize("type_name", sorted(REGISTRY))
@pytest.mark.parametrize("mode", list(FaultMode), ids=lambda m: m.value)
def test_guarantees_hold_for_every_fault_mode_and_action_type(env, mode, type_name):
    provider, cfg, store, client = env
    provider.add_faults({"mode": mode.value})
    store.submit(type_name, PAYLOADS[type_name], "k1")
    run_until_settled(provider, cfg, store, client)
    assert_guarantees(provider, cfg, store, client)


@pytest.mark.parametrize("seed", [1, 2, 3])
def test_guarantees_hold_under_random_fault_sequences(env, seed):
    """Seeded chaos: many actions, a random fault in front of each request."""
    provider, cfg, store, client = env
    rng = random.Random(seed)
    modes = [m.value for m in FaultMode]
    provider.add_faults(*({"mode": rng.choice(modes)} for _ in range(12)))
    for i in range(6):
        type_name = rng.choice(sorted(REGISTRY))
        payload = dict(PAYLOADS[type_name])
        payload["customer" if type_name == "payment.charge" else "body"] = f"variant-{i}"
        store.submit(type_name, payload, f"seed{seed}-{i}")
    run_until_settled(provider, cfg, store, client)
    assert_guarantees(provider, cfg, store, client)
