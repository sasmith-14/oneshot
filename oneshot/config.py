"""Runtime settings, read from environment variables with safe defaults.

Every timing knob that affects safety is here, with the assumption it encodes.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, replace


def _env(name: str, default: str) -> str:
    return os.environ.get(name, default)


@dataclass(frozen=True)
class Settings:
    db_path: str = "var/oneshot.db"
    provider_url: str = "http://127.0.0.1:8701"

    #: How long to wait for the provider before declaring the attempt AMBIGUOUS.
    provider_timeout_seconds: float = 2.0

    #: How long a worker owns an IN_FLIGHT action. MUST comfortably exceed the
    #: provider timeout, otherwise a live-but-slow worker's action could be
    #: "recovered" by another worker while its request is still in the air.
    lease_seconds: float = 15.0

    #: Maximum number of *send* attempts per action (first try included).
    max_attempts: int = 5
    #: Maximum number of verification lookups before giving up to UNKNOWN.
    max_verifications: int = 5

    #: Exponential backoff with full jitter: sleep U(0, min(max, base * 2**(n-1))).
    backoff_base_seconds: float = 0.5
    backoff_max_seconds: float = 30.0
    backoff_jitter: bool = True

    #: How long the provider remembers an Idempotency-Key. OneShot must not be
    #: told a *longer* value than the provider really honours — that is the one
    #: misconfiguration that turns "safe retry" into "duplicate charge".
    provider_key_retention_seconds: float = 24 * 3600
    #: Stop blind same-key retries this long before the retention window closes.
    key_retention_margin_seconds: float = 60.0

    #: ASSUMPTION: once a request has been sent, the provider applies it (or
    #: never will) within this many seconds. Verification treats "no record
    #: after the settle window" as "not applied". If the provider can be slower
    #: than this, verify-then-retry can create duplicates (see docs 03).
    provider_settle_seconds: float = 5.0

    #: Idle sleep between polls in the worker loop.
    poll_interval_seconds: float = 0.2

    def __post_init__(self) -> None:
        if self.lease_seconds <= 2 * self.provider_timeout_seconds:
            raise ValueError("lease_seconds must be more than twice provider_timeout_seconds")
        if self.max_attempts < 1 or self.max_verifications < 1:
            raise ValueError("max_attempts and max_verifications must be >= 1")

    @classmethod
    def from_env(cls) -> "Settings":
        d = cls()
        return cls(
            db_path=_env("ONESHOT_DB", d.db_path),
            provider_url=_env("ONESHOT_PROVIDER_URL", d.provider_url),
            provider_timeout_seconds=float(_env("ONESHOT_PROVIDER_TIMEOUT", str(d.provider_timeout_seconds))),
            lease_seconds=float(_env("ONESHOT_LEASE_SECONDS", str(d.lease_seconds))),
            max_attempts=int(_env("ONESHOT_MAX_ATTEMPTS", str(d.max_attempts))),
            max_verifications=int(_env("ONESHOT_MAX_VERIFICATIONS", str(d.max_verifications))),
            backoff_base_seconds=float(_env("ONESHOT_BACKOFF_BASE", str(d.backoff_base_seconds))),
            backoff_max_seconds=float(_env("ONESHOT_BACKOFF_MAX", str(d.backoff_max_seconds))),
            backoff_jitter=_env("ONESHOT_BACKOFF_JITTER", "1") not in ("0", "false", "no"),
            provider_key_retention_seconds=float(
                _env("ONESHOT_KEY_RETENTION", str(d.provider_key_retention_seconds))
            ),
            key_retention_margin_seconds=float(_env("ONESHOT_KEY_MARGIN", str(d.key_retention_margin_seconds))),
            provider_settle_seconds=float(_env("ONESHOT_SETTLE_SECONDS", str(d.provider_settle_seconds))),
            poll_interval_seconds=float(_env("ONESHOT_POLL_INTERVAL", str(d.poll_interval_seconds))),
        )

    def with_overrides(self, **kwargs) -> "Settings":
        return replace(self, **kwargs)

    def to_env(self) -> dict[str, str]:
        """Inverse of :meth:`from_env` — used to configure child worker processes."""
        return {
            "ONESHOT_DB": self.db_path,
            "ONESHOT_PROVIDER_URL": self.provider_url,
            "ONESHOT_PROVIDER_TIMEOUT": str(self.provider_timeout_seconds),
            "ONESHOT_LEASE_SECONDS": str(self.lease_seconds),
            "ONESHOT_MAX_ATTEMPTS": str(self.max_attempts),
            "ONESHOT_MAX_VERIFICATIONS": str(self.max_verifications),
            "ONESHOT_BACKOFF_BASE": str(self.backoff_base_seconds),
            "ONESHOT_BACKOFF_MAX": str(self.backoff_max_seconds),
            "ONESHOT_BACKOFF_JITTER": "1" if self.backoff_jitter else "0",
            "ONESHOT_KEY_RETENTION": str(self.provider_key_retention_seconds),
            "ONESHOT_KEY_MARGIN": str(self.key_retention_margin_seconds),
            "ONESHOT_SETTLE_SECONDS": str(self.provider_settle_seconds),
            "ONESHOT_POLL_INTERVAL": str(self.poll_interval_seconds),
        }
