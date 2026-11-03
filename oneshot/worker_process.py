"""Spawn ``oneshot worker`` as a child process (used by integration tests and the demo).

Running the worker in its own process is what makes crash tests honest: a
failpoint's ``os._exit`` or a real ``SIGKILL`` kills that process only, with no
chance to run cleanup code, exactly like a production crash.
"""

from __future__ import annotations

import os
import subprocess
import sys
from typing import IO, Iterable

from oneshot.config import Settings


def spawn_worker(
    settings: Settings,
    *,
    failpoints: Iterable[str] = (),
    drain: bool = True,
    max_seconds: float | None = 60,
    worker_id: str | None = None,
    output: IO[bytes] | int | None = subprocess.DEVNULL,
) -> subprocess.Popen[bytes]:
    env = {**os.environ, **settings.to_env(), "ONESHOT_FAILPOINTS": ",".join(failpoints)}
    cmd = [sys.executable, "-m", "oneshot", "worker"]
    if drain:
        cmd.append("--drain")
    if max_seconds is not None:
        cmd += ["--max-seconds", str(max_seconds)]
    if worker_id:
        cmd += ["--id", worker_id]
    return subprocess.Popen(cmd, env=env, stdout=output, stderr=output)
