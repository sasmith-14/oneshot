"""Run the fake provider as a real child process.

Used by the integration tests and the demo. A separate process is essential:
the CRASH_* fault modes call ``os._exit``, which must kill the *provider*, not
the test runner, and timeouts/disconnects must travel over a real socket.
"""

from __future__ import annotations

import socket
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import httpx


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class ProviderProcess:
    def __init__(
        self,
        db_path: str | Path,
        *,
        port: int | None = None,
        idempotency_ttl: float = 24 * 3600,
        timeout_hang: float = 3.0,
        slow_delay: float = 2.0,
        log_path: str | Path | None = None,
    ) -> None:
        self.db_path = str(db_path)
        self.port = port or free_port()
        self.idempotency_ttl = idempotency_ttl
        self.timeout_hang = timeout_hang
        self.slow_delay = slow_delay
        self.log_path = str(log_path) if log_path else None
        self._proc: subprocess.Popen[bytes] | None = None
        self._log_file: Any = None

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def start(self) -> "ProviderProcess":
        cmd = [
            sys.executable, "-m", "fakeprovider",
            "--port", str(self.port),
            "--db", self.db_path,
            "--idempotency-ttl", str(self.idempotency_ttl),
            "--timeout-hang", str(self.timeout_hang),
            "--slow-delay", str(self.slow_delay),
        ]  # fmt: skip
        if self.log_path:
            self._log_file = open(self.log_path, "ab")
            out = self._log_file
        else:
            out = subprocess.DEVNULL
        self._proc = subprocess.Popen(cmd, stdout=out, stderr=out)
        self._wait_healthy()
        return self

    def _wait_healthy(self, timeout: float = 10.0) -> None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self._proc is not None and self._proc.poll() is not None:
                raise RuntimeError(f"fake provider exited early with code {self._proc.returncode}")
            try:
                if httpx.get(f"{self.url}/healthz", timeout=0.5).status_code == 200:
                    return
            except httpx.HTTPError:
                pass
            time.sleep(0.05)
        raise RuntimeError("fake provider did not become healthy")

    def is_running(self) -> bool:
        return self._proc is not None and self._proc.poll() is None

    def wait_exit(self, timeout: float = 5.0) -> int | None:
        if self._proc is None:
            return None
        try:
            return self._proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            return None

    def stop(self) -> None:
        if self._proc is not None and self._proc.poll() is None:
            self._proc.terminate()
            try:
                self._proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._proc.kill()
                self._proc.wait()
        self._proc = None
        if self._log_file is not None:
            self._log_file.close()
            self._log_file = None

    def restart(self) -> "ProviderProcess":
        self.stop()
        return self.start()

    # ---- admin helpers -----------------------------------------------------

    def add_faults(self, *rules: dict[str, Any]) -> None:
        httpx.post(f"{self.url}/_admin/faults", json=list(rules), timeout=2).raise_for_status()

    def clear_faults(self) -> None:
        httpx.delete(f"{self.url}/_admin/faults", timeout=2).raise_for_status()

    def effects(self, reference: str | None = None) -> list[dict[str, Any]]:
        params = {"reference": reference} if reference else None
        resp = httpx.get(f"{self.url}/v1/effects", params=params, timeout=2)
        resp.raise_for_status()
        return resp.json()["effects"]

    def __enter__(self) -> "ProviderProcess":
        return self.start()

    def __exit__(self, *exc: object) -> None:
        self.stop()
