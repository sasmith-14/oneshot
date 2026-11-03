"""The fake provider's own, independent ledger of effects it actually applied.

This is the "outside record" that OneShot reconciles against. It lives in a
separate SQLite file owned only by the provider process, so killing or wiping
OneShot's database never erases the evidence of what really happened.

Two tables:

* ``effects`` — one row per effect the provider applied (a charge made, a
  message sent). Rows are only ever inserted, never updated or deleted.
* ``idempotency_keys`` — the provider's duplicate-protection memory for
  endpoints that honour an ``Idempotency-Key`` header. A key is reserved
  (``in_progress``) when a request starts, and completed in the *same
  transaction* that inserts the effect, so "effect applied" and "key
  completed" can never disagree after a crash.
"""

from __future__ import annotations

import json
import sqlite3
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

_SCHEMA = """
CREATE TABLE IF NOT EXISTS effects (
    seq             INTEGER PRIMARY KEY AUTOINCREMENT,
    id              TEXT NOT NULL UNIQUE,
    kind            TEXT NOT NULL,
    reference       TEXT,
    idempotency_key TEXT,
    payload_json    TEXT NOT NULL,
    created_at      REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_effects_reference ON effects(reference);

CREATE TABLE IF NOT EXISTS idempotency_keys (
    key            TEXT PRIMARY KEY,
    request_hash   TEXT NOT NULL,
    status         TEXT NOT NULL CHECK (status IN ('in_progress', 'completed')),
    response_code  INTEGER,
    response_json  TEXT,
    created_at     REAL NOT NULL
);
"""


@dataclass(frozen=True)
class Effect:
    id: str
    kind: str
    reference: str | None
    idempotency_key: str | None
    payload: dict[str, Any]
    created_at: float

    def to_json(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "kind": self.kind,
            "reference": self.reference,
            "idempotency_key": self.idempotency_key,
            "payload": self.payload,
            "created_at": self.created_at,
        }


@dataclass(frozen=True)
class KeyRecord:
    key: str
    request_hash: str
    status: str
    response_code: int | None
    response_body: dict[str, Any] | None
    created_at: float


class ProviderLedger:
    """Thread-safe access to the provider's SQLite ledger.

    Each call opens a short-lived connection, which is the simplest correct
    way to use SQLite from a threaded HTTP server.
    """

    def __init__(self, path: str | Path) -> None:
        self.path = str(path)
        self._lock = threading.Lock()  # serialises writers inside this process
        with self._connect() as conn:
            conn.executescript(_SCHEMA)

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=FULL")  # durability over speed: this is the evidence
        return conn

    # ------------------------------------------------------------------ startup

    def clear_abandoned_reservations(self) -> int:
        """Drop ``in_progress`` keys left behind by a crash.

        Safe because applying an effect and completing its key happen in one
        transaction: an ``in_progress`` key that survived a restart belongs to
        a request whose effect was definitely *not* applied.
        """
        with self._lock, self._connect() as conn:
            cur = conn.execute("DELETE FROM idempotency_keys WHERE status = 'in_progress'")
            return cur.rowcount

    # ---------------------------------------------------------- idempotency keys

    def reserve_key(self, key: str, request_hash: str, ttl_seconds: float) -> tuple[str, KeyRecord | None]:
        """Atomically look up or reserve an idempotency key.

        Returns ``(decision, record)`` where decision is one of:

        * ``"reserved"``   — key is new (or its previous use expired); caller owns it now.
        * ``"replay"``     — key already completed; ``record`` holds the stored response.
        * ``"in_progress"``— another request with this key is still being processed.
        * ``"mismatch"``   — key was used with a different request body.
        """
        now = time.time()
        with self._lock, self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                row = conn.execute("SELECT * FROM idempotency_keys WHERE key = ?", (key,)).fetchone()
                if row is not None and now - row["created_at"] > ttl_seconds:
                    # Retention window passed: the provider has *forgotten* this key.
                    # A retry arriving now is treated as brand new — this is exactly
                    # how duplicates slip through when a client retries too late.
                    conn.execute("DELETE FROM idempotency_keys WHERE key = ?", (key,))
                    row = None
                if row is None:
                    conn.execute(
                        "INSERT INTO idempotency_keys (key, request_hash, status, created_at) "
                        "VALUES (?, ?, 'in_progress', ?)",
                        (key, request_hash, now),
                    )
                    conn.execute("COMMIT")
                    return "reserved", None
                conn.execute("COMMIT")
            except BaseException:
                conn.execute("ROLLBACK")
                raise
        record = _key_record(row)
        if record.request_hash != request_hash:
            return "mismatch", record
        if record.status == "in_progress":
            return "in_progress", record
        return "replay", record

    def release_key(self, key: str) -> None:
        """Forget a reservation for a request that applied nothing and should be retryable."""
        with self._lock, self._connect() as conn:
            conn.execute("DELETE FROM idempotency_keys WHERE key = ? AND status = 'in_progress'", (key,))

    def complete_key_without_effect(self, key: str, code: int, body: dict[str, Any]) -> None:
        """Remember a final, non-applied answer (e.g. a decline) so retries replay it."""
        with self._lock, self._connect() as conn:
            conn.execute(
                "UPDATE idempotency_keys SET status='completed', response_code=?, response_json=? WHERE key=?",
                (code, json.dumps(body), key),
            )

    # ------------------------------------------------------------------ effects

    def apply_effect(
        self,
        *,
        kind: str,
        reference: str | None,
        idempotency_key: str | None,
        payload: dict[str, Any],
        response_code: int,
        response_builder,
    ) -> tuple[Effect, dict[str, Any]]:
        """Insert an effect and (if keyed) complete its idempotency key, atomically.

        ``response_builder(effect) -> dict`` produces the response body that will
        be stored for future replays.
        """
        now = time.time()
        with self._lock, self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                seq = conn.execute("SELECT COALESCE(MAX(seq), 0) + 1 FROM effects").fetchone()[0]
                effect = Effect(
                    id=f"eff_{seq:05d}",
                    kind=kind,
                    reference=reference,
                    idempotency_key=idempotency_key,
                    payload=payload,
                    created_at=now,
                )
                conn.execute(
                    "INSERT INTO effects (id, kind, reference, idempotency_key, payload_json, created_at) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (effect.id, kind, reference, idempotency_key, json.dumps(payload, sort_keys=True), now),
                )
                body = response_builder(effect)
                if idempotency_key is not None:
                    conn.execute(
                        "UPDATE idempotency_keys SET status='completed', response_code=?, response_json=? "
                        "WHERE key=?",
                        (response_code, json.dumps(body), idempotency_key),
                    )
                conn.execute("COMMIT")
            except BaseException:
                conn.execute("ROLLBACK")
                raise
        return effect, body

    def effects(self, reference: str | None = None) -> list[Effect]:
        with self._connect() as conn:
            if reference is None:
                rows = conn.execute("SELECT * FROM effects ORDER BY seq").fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM effects WHERE reference = ? ORDER BY seq", (reference,)
                ).fetchall()
        return [_effect(r) for r in rows]


def _effect(row: sqlite3.Row) -> Effect:
    return Effect(
        id=row["id"],
        kind=row["kind"],
        reference=row["reference"],
        idempotency_key=row["idempotency_key"],
        payload=json.loads(row["payload_json"]),
        created_at=row["created_at"],
    )


def _key_record(row: sqlite3.Row) -> KeyRecord:
    return KeyRecord(
        key=row["key"],
        request_hash=row["request_hash"],
        status=row["status"],
        response_code=row["response_code"],
        response_body=json.loads(row["response_json"]) if row["response_json"] else None,
        created_at=row["created_at"],
    )
