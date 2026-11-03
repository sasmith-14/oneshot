"""Deterministic crash injection for OneShot itself ("failpoints").

Crash-recovery code is notoriously hard to test because crashes are random.
Failpoints make them deterministic: set ``ONESHOT_FAILPOINTS`` to a
comma-separated list of names and the process hard-exits (``os._exit``, no
cleanup, no ``finally`` blocks — like ``kill -9``) when it reaches that point.

Defined points (see oneshot/worker.py):

* ``before_send``    — intent recorded (IN_FLIGHT), request NOT yet sent.
* ``after_response`` — provider has answered (effect may be applied), result NOT yet recorded.

Both leave the action IN_FLIGHT with an open attempt; recovery cannot tell
them apart, which is precisely the point. This is the same technique used by
etcd (gofail) and TiKV (fail-rs), in miniature.
"""

from __future__ import annotations

import os
import sys

FAILPOINT_EXIT_CODE = 70


def _active() -> set[str]:
    return {p.strip() for p in os.environ.get("ONESHOT_FAILPOINTS", "").split(",") if p.strip()}


def failpoint(name: str) -> None:
    if name in _active():
        print(f"[failpoint] '{name}' triggered: process exiting abruptly (code {FAILPOINT_EXIT_CODE})", file=sys.stderr, flush=True)
        os._exit(FAILPOINT_EXIT_CODE)
