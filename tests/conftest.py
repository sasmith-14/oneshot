from __future__ import annotations

import pytest

from oneshot.config import Settings
from oneshot.store import ActionStore


class FakeClock:
    """A controllable clock so time-dependent rules are tested without sleeping."""

    def __init__(self, start: float = 1_000_000.0) -> None:
        self.now = start

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture
def settings(tmp_path) -> Settings:
    return Settings(
        db_path=str(tmp_path / "oneshot.db"),
        provider_timeout_seconds=1.0,
        lease_seconds=5.0,
        max_attempts=3,
        max_verifications=3,
        backoff_base_seconds=0.1,
        backoff_max_seconds=1.0,
        backoff_jitter=False,
        provider_key_retention_seconds=3600,
        key_retention_margin_seconds=60,
        provider_settle_seconds=2.0,
        poll_interval_seconds=0.02,
    )


@pytest.fixture
def store(settings, clock) -> ActionStore:
    return ActionStore(settings.db_path, clock=clock)


CHARGE = {"amount_cents": 1500, "currency": "USD", "customer": "cus_123"}
MESSAGE = {"to": "+15550100", "body": "Your order shipped"}
