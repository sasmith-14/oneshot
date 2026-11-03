"""Durable action tracking on SQLite.

Design rules this module enforces:

1. **Write-ahead intent.** An attempt row is inserted, and the action moved to
   IN_FLIGHT, in the *same transaction* that claims the action — before any
   network call. After a crash, an IN_FLIGHT action with an open attempt tells
   recovery: "a request may have been sent; its outcome is unknown".
2. **Leases, checked on every write.** A worker may only record a result while
   it still owns the lease (``lease_owner = me``). A worker that stalled past
   its lease and woke up late cannot overwrite the decision of the worker that
   took over.
3. **Legal transitions only.** Every status change is validated against
   :data:`oneshot.domain.ALLOWED_TRANSITIONS` and recorded in the ``events``
   table in the same transaction, giving a complete audit trail.
4. **Idempotent submission.** The agent's ``Idempotency-Key`` is UNIQUE; a
   repeated submission returns the original action instead of creating a new one.

SQLite with WAL lets the API process and worker processes share one file.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import time
import uuid
from contextlib import closing, contextmanager
from pathlib import Path
from typing import Any, Callable, Iterator

from oneshot.domain import (
    Action,
    ActionStatus,
    Attempt,
    Decision,
    Event,
    Outcome,
    check_transition,
)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS actions (
    id                  TEXT PRIMARY KEY,
    type                TEXT NOT NULL,
    payload_json        TEXT NOT NULL,
    request_key         TEXT NOT NULL UNIQUE,     -- agent-supplied Idempotency-Key
    request_fingerprint TEXT NOT NULL,            -- hash of (type, payload)
    status              TEXT NOT NULL,
    attempt_count       INTEGER NOT NULL DEFAULT 0,
    verify_count        INTEGER NOT NULL DEFAULT 0,
    maybe_applied       INTEGER NOT NULL DEFAULT 0, -- 1 once any attempt was ambiguous and not yet disproved
    next_attempt_at     REAL,
    lease_owner         TEXT,
    lease_expires_at    REAL,
    first_sent_at       REAL,
    last_sent_at        REAL,
    provider_effect_id  TEXT,
    last_error          TEXT,
    resolution          TEXT,
    created_at          REAL NOT NULL,
    updated_at          REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_actions_due ON actions(status, next_attempt_at);

CREATE TABLE IF NOT EXISTS attempts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    action_id   TEXT NOT NULL REFERENCES actions(id),
    number      INTEGER NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('send', 'verify')),
    worker_id   TEXT NOT NULL,
    started_at  REAL NOT NULL,
    finished_at REAL,
    outcome     TEXT,
    detail      TEXT
);
CREATE INDEX IF NOT EXISTS idx_attempts_action ON attempts(action_id);

CREATE TABLE IF NOT EXISTS events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    action_id   TEXT NOT NULL REFERENCES actions(id),
    at          REAL NOT NULL,
    from_status TEXT,
    to_status   TEXT NOT NULL,
    message     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_action ON events(action_id);

-- Liveness only (for operators and the web console). Correctness never depends
-- on this table: leases, not heartbeats, decide who may write an action.
CREATE TABLE IF NOT EXISTS workers (
    id           TEXT PRIMARY KEY,
    pid          INTEGER NOT NULL,
    started_at   REAL NOT NULL,
    last_seen_at REAL NOT NULL,
    stopped_at   REAL
);
"""


class IdempotencyConflict(Exception):
    """The agent reused an Idempotency-Key for a *different* request."""

    def __init__(self, existing: Action) -> None:
        super().__init__(f"Idempotency-Key already used for a different request (action {existing.id})")
        self.existing = existing


class LeaseLost(Exception):
    """This worker no longer owns the action; its result must not be recorded."""


def fingerprint(type_name: str, payload: dict[str, Any]) -> str:
    canonical = json.dumps({"type": type_name, "payload": payload}, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()


def new_action_id() -> str:
    return "act_" + uuid.uuid4().hex[:12]


class ActionStore:
    def __init__(self, path: str | Path, clock: Callable[[], float] = time.time) -> None:
        self.path = str(path)
        self.clock = clock
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        with closing(self._connect()) as conn:
            conn.executescript(_SCHEMA)

    # ------------------------------------------------------------ connection

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, timeout=15, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=FULL")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    @contextmanager
    def _tx(self) -> Iterator[sqlite3.Connection]:
        """A write transaction. BEGIN IMMEDIATE takes SQLite's write lock up front,
        so read-then-update sequences (claim, take-over) are atomic across processes."""
        conn = self._connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            yield conn
            conn.execute("COMMIT")
        except BaseException:
            conn.execute("ROLLBACK")
            raise
        finally:
            conn.close()

    # ------------------------------------------------------------- submission

    def submit(self, type_name: str, payload: dict[str, Any], request_key: str) -> tuple[Action, bool]:
        """Durably accept an action. Returns ``(action, created)``.

        Same key + same request → the original action, ``created=False``.
        Same key + different request → :class:`IdempotencyConflict`.
        """
        fp = fingerprint(type_name, payload)
        now = self.clock()
        with self._tx() as conn:
            row = conn.execute("SELECT * FROM actions WHERE request_key = ?", (request_key,)).fetchone()
            if row is not None:
                existing = _action(row)
                if existing.request_fingerprint != fp:
                    raise IdempotencyConflict(existing)
                return existing, False
            action_id = new_action_id()
            conn.execute(
                "INSERT INTO actions (id, type, payload_json, request_key, request_fingerprint, status, "
                "next_attempt_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)",
                (action_id, type_name, json.dumps(payload, sort_keys=True), request_key, fp, now, now, now),
            )
            _event(conn, action_id, now, None, ActionStatus.PENDING, "accepted and durably recorded")
            row = conn.execute("SELECT * FROM actions WHERE id = ?", (action_id,)).fetchone()
        return _action(row), True

    # ---------------------------------------------------------------- reading

    def get(self, action_id: str, *, detail: bool = True) -> Action | None:
        with closing(self._connect()) as conn:
            row = conn.execute("SELECT * FROM actions WHERE id = ?", (action_id,)).fetchone()
            if row is None:
                return None
            action = _action(row)
            if detail:
                action.attempts = [
                    _attempt(r)
                    for r in conn.execute("SELECT * FROM attempts WHERE action_id = ? ORDER BY id", (action_id,))
                ]
                action.events = [
                    _event_row(r)
                    for r in conn.execute("SELECT * FROM events WHERE action_id = ? ORDER BY id", (action_id,))
                ]
        return action

    def list(self, status: ActionStatus | None = None, limit: int = 1000) -> list[Action]:
        with closing(self._connect()) as conn:
            if status is None:
                rows = conn.execute("SELECT * FROM actions ORDER BY created_at LIMIT ?", (limit,))
            else:
                rows = conn.execute(
                    "SELECT * FROM actions WHERE status = ? ORDER BY created_at LIMIT ?", (status.value, limit)
                )
            return [_action(r) for r in rows]

    def counts(self) -> dict[str, int]:
        with closing(self._connect()) as conn:
            rows = conn.execute("SELECT status, COUNT(*) AS n FROM actions GROUP BY status").fetchall()
        return {r["status"]: r["n"] for r in rows}

    # ------------------------------------------------------------ heartbeats

    def heartbeat(self, worker_id: str, pid: int) -> None:
        """Record that a worker is alive. A killed worker simply stops beating;
        ``stopped_at`` is only set on a clean shutdown."""
        now = self.clock()
        with self._tx() as conn:
            conn.execute(
                "INSERT INTO workers (id, pid, started_at, last_seen_at) VALUES (?, ?, ?, ?) "
                "ON CONFLICT(id) DO UPDATE SET last_seen_at = excluded.last_seen_at, stopped_at = NULL",
                (worker_id, pid, now, now),
            )

    def worker_stopped(self, worker_id: str) -> None:
        now = self.clock()
        with self._tx() as conn:
            conn.execute("UPDATE workers SET stopped_at = ?, last_seen_at = ? WHERE id = ?", (now, now, worker_id))

    def workers(self, limit: int = 20) -> list[dict[str, Any]]:
        """Most recently seen workers first."""
        with closing(self._connect()) as conn:
            rows = conn.execute("SELECT * FROM workers ORDER BY last_seen_at DESC LIMIT ?", (limit,)).fetchall()
        return [dict(r) for r in rows]

    # --------------------------------------------------------------- claiming

    def claim_next(self, worker_id: str, lease_seconds: float) -> tuple[Action, Attempt] | None:
        """Atomically take the next due action and record the attempt *before* doing it.

        * PENDING   → IN_FLIGHT, ``attempt_count += 1``, open a ``send`` attempt.
        * VERIFYING → stays VERIFYING under our lease, ``verify_count += 1``, open a ``verify`` attempt.
        """
        now = self.clock()
        with self._tx() as conn:
            row = conn.execute(
                "SELECT * FROM actions WHERE next_attempt_at <= ? AND ("
                "  status = 'PENDING' OR"
                "  (status = 'VERIFYING' AND (lease_expires_at IS NULL OR lease_expires_at < ?))"
                ") ORDER BY next_attempt_at LIMIT 1",
                (now, now),
            ).fetchone()
            if row is None:
                return None
            action = _action(row)
            # A verify attempt abandoned by a crashed worker is closed out first.
            conn.execute(
                "UPDATE attempts SET finished_at = ?, outcome = ?, detail = ? "
                "WHERE action_id = ? AND finished_at IS NULL",
                (now, Outcome.LOOKUP_FAILED.value, "abandoned: worker lost during lookup", action.id),
            )
            lease_until = now + lease_seconds
            if action.status is ActionStatus.PENDING:
                check_transition(action.status, ActionStatus.IN_FLIGHT)
                number = action.attempt_count + 1
                conn.execute(
                    "UPDATE actions SET status='IN_FLIGHT', attempt_count=?, lease_owner=?, lease_expires_at=?, "
                    "first_sent_at=COALESCE(first_sent_at, ?), last_sent_at=?, updated_at=? WHERE id=?",
                    (number, worker_id, lease_until, now, now, now, action.id),
                )
                kind = "send"
                _event(conn, action.id, now, action.status, ActionStatus.IN_FLIGHT, f"attempt {number}: claimed by {worker_id}, intent recorded before sending")
            else:
                number = action.verify_count + 1
                conn.execute(
                    "UPDATE actions SET verify_count=?, lease_owner=?, lease_expires_at=?, updated_at=? WHERE id=?",
                    (number, worker_id, lease_until, now, action.id),
                )
                kind = "verify"
            cur = conn.execute(
                "INSERT INTO attempts (action_id, number, kind, worker_id, started_at) VALUES (?, ?, ?, ?, ?)",
                (action.id, number, kind, worker_id, now),
            )
            attempt_id = cur.lastrowid
            action = _action(conn.execute("SELECT * FROM actions WHERE id = ?", (action.id,)).fetchone())
            attempt = _attempt(conn.execute("SELECT * FROM attempts WHERE id = ?", (attempt_id,)).fetchone())
        return action, attempt

    # --------------------------------------------------------------- recovery

    def expired_in_flight(self) -> list[Action]:
        """IN_FLIGHT actions whose worker's lease has run out: the worker crashed,
        was killed, or stalled. Their last attempt's outcome is unknown."""
        now = self.clock()
        with closing(self._connect()) as conn:
            rows = conn.execute(
                "SELECT * FROM actions WHERE status = 'IN_FLIGHT' AND lease_expires_at < ?", (now,)
            ).fetchall()
        return [_action(r) for r in rows]

    def take_over(self, action_id: str, worker_id: str, lease_seconds: float) -> tuple[Action, Attempt] | None:
        """Claim an expired IN_FLIGHT action for recovery. Returns its open attempt."""
        now = self.clock()
        with self._tx() as conn:
            cur = conn.execute(
                "UPDATE actions SET lease_owner = ?, lease_expires_at = ?, updated_at = ? "
                "WHERE id = ? AND status = 'IN_FLIGHT' AND lease_expires_at < ?",
                (worker_id, now + lease_seconds, now, action_id, now),
            )
            if cur.rowcount != 1:
                return None  # someone else recovered it, or it finished after all
            action = _action(conn.execute("SELECT * FROM actions WHERE id = ?", (action_id,)).fetchone())
            row = conn.execute(
                "SELECT * FROM attempts WHERE action_id = ? AND kind = 'send' AND finished_at IS NULL "
                "ORDER BY id DESC LIMIT 1",
                (action_id,),
            ).fetchone()
            if row is None:  # pragma: no cover - claim_next always opens one atomically
                raise RuntimeError(f"IN_FLIGHT action {action_id} has no open attempt")
        return action, _attempt(row)

    # -------------------------------------------------------------- deciding

    def apply_decision(
        self,
        action_id: str,
        attempt_id: int,
        worker_id: str,
        outcome: Outcome,
        detail: str,
        decision: Decision,
    ) -> Action:
        """Close the attempt and move the action, *only if we still hold the lease*."""
        now = self.clock()
        with self._tx() as conn:
            row = conn.execute("SELECT * FROM actions WHERE id = ?", (action_id,)).fetchone()
            current = _action(row)
            if current.lease_owner != worker_id:
                raise LeaseLost(f"{worker_id} no longer owns {action_id} (owner: {current.lease_owner})")
            check_transition(current.status, decision.status)
            conn.execute(
                "UPDATE attempts SET finished_at = ?, outcome = ?, detail = ? WHERE id = ?",
                (now, outcome.value, detail, attempt_id),
            )
            maybe_applied = current.maybe_applied if decision.maybe_applied is None else decision.maybe_applied
            conn.execute(
                "UPDATE actions SET status=?, next_attempt_at=?, maybe_applied=?, "
                "provider_effect_id=COALESCE(?, provider_effect_id), last_error=COALESCE(?, last_error), "
                "lease_owner=NULL, lease_expires_at=NULL, updated_at=? WHERE id=?",
                (
                    decision.status.value,
                    decision.next_attempt_at,
                    int(maybe_applied),
                    decision.effect_id,
                    decision.error,
                    now,
                    action_id,
                ),
            )
            _event(conn, action_id, now, current.status, decision.status, decision.reason)
            return _action(conn.execute("SELECT * FROM actions WHERE id = ?", (action_id,)).fetchone())

    def resolve(
        self, action_id: str, status: ActionStatus, note: str, *, actor: str, effect_id: str | None = None
    ) -> Action:
        """Resolve an UNKNOWN action (by reconciliation or by a human). Audited."""
        if status not in (ActionStatus.SUCCEEDED, ActionStatus.FAILED):
            raise ValueError("an UNKNOWN action can only be resolved to SUCCEEDED or FAILED")
        now = self.clock()
        with self._tx() as conn:
            row = conn.execute("SELECT * FROM actions WHERE id = ?", (action_id,)).fetchone()
            if row is None:
                raise KeyError(action_id)
            current = _action(row)
            if current.status is not ActionStatus.UNKNOWN:
                raise ValueError(f"only UNKNOWN actions can be resolved; {action_id} is {current.status.value}")
            check_transition(current.status, status)
            resolution = f"{actor}: {note}"
            conn.execute(
                "UPDATE actions SET status=?, resolution=?, provider_effect_id=COALESCE(?, provider_effect_id), "
                "maybe_applied=?, next_attempt_at=NULL, updated_at=? WHERE id=?",
                (status.value, resolution, effect_id, int(status is ActionStatus.SUCCEEDED), now, action_id),
            )
            _event(conn, action_id, now, current.status, status, f"resolved by {resolution}")
            return _action(conn.execute("SELECT * FROM actions WHERE id = ?", (action_id,)).fetchone())


# ------------------------------------------------------------------ row mapping


def _event(
    conn: sqlite3.Connection,
    action_id: str,
    at: float,
    from_status: ActionStatus | None,
    to_status: ActionStatus,
    message: str,
) -> None:
    conn.execute(
        "INSERT INTO events (action_id, at, from_status, to_status, message) VALUES (?, ?, ?, ?, ?)",
        (action_id, at, from_status.value if from_status else None, to_status.value, message),
    )


def _action(row: sqlite3.Row) -> Action:
    return Action(
        id=row["id"],
        type=row["type"],
        payload=json.loads(row["payload_json"]),
        request_key=row["request_key"],
        request_fingerprint=row["request_fingerprint"],
        status=ActionStatus(row["status"]),
        attempt_count=row["attempt_count"],
        verify_count=row["verify_count"],
        maybe_applied=bool(row["maybe_applied"]),
        next_attempt_at=row["next_attempt_at"],
        lease_owner=row["lease_owner"],
        lease_expires_at=row["lease_expires_at"],
        first_sent_at=row["first_sent_at"],
        last_sent_at=row["last_sent_at"],
        provider_effect_id=row["provider_effect_id"],
        last_error=row["last_error"],
        resolution=row["resolution"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _attempt(row: sqlite3.Row) -> Attempt:
    return Attempt(
        id=row["id"],
        action_id=row["action_id"],
        number=row["number"],
        kind=row["kind"],
        worker_id=row["worker_id"],
        started_at=row["started_at"],
        finished_at=row["finished_at"],
        outcome=Outcome(row["outcome"]) if row["outcome"] else None,
        detail=row["detail"],
    )


def _event_row(row: sqlite3.Row) -> Event:
    return Event(
        id=row["id"],
        action_id=row["action_id"],
        at=row["at"],
        from_status=ActionStatus(row["from_status"]) if row["from_status"] else None,
        to_status=ActionStatus(row["to_status"]),
        message=row["message"],
    )
