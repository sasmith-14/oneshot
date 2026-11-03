"""Run real commands and save their output for the docs (docs/src/outputs/*.txt).

    uv run python scripts/capture_outputs.py            # everything (~2-3 minutes)
    uv run python scripts/capture_outputs.py demo-worker-crash tests-policy

The docs embed these files verbatim with ``{{include outputs/<name>.txt}}``, so
every "observed output" in the PDFs is something that actually ran. Each file
starts with the exact command and the capture date. Only two edits are made:
the temp-directory path is replaced by $TMPDIR, and a trailing timing line is
kept as-is (it is real, and it will differ on your machine).
"""

from __future__ import annotations

import datetime as dt
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "src" / "outputs"

sys.path.insert(0, str(ROOT))
from demo.scenarios import SCENARIOS  # noqa: E402

PYTEST = ["-m", "pytest", "--no-header", "-p", "no:cacheprovider"]

CAPTURES: dict[str, list[str]] = {
    "tests-all": PYTEST + ["-q"],
    "tests-store": PYTEST + ["-v", "tests/test_store.py"],
    "tests-policy": PYTEST + ["-v", "tests/test_policy.py"],
    "tests-classification": PYTEST + ["-v", "tests/test_provider_client.py"],
    "tests-provider": PYTEST + ["-v", "tests/test_fake_provider.py"],
    "tests-scenarios": PYTEST + ["-v", "tests/test_scenarios.py"],
    "tests-reconciler": PYTEST + ["-v", "tests/test_reconciler.py", "tests/test_api.py"],
    "tests-invariants": PYTEST + ["-v", "tests/test_invariants.py"],
    **{f"demo-{s.name}": ["-m", "oneshot", "demo", s.name] for s in SCENARIOS},
}


def capture(name: str, args: list[str]) -> None:
    env = {**os.environ, "COLUMNS": "100", "NO_COLOR": "1", "TERM": "dumb"}
    proc = subprocess.run([sys.executable, *args], cwd=ROOT, env=env, capture_output=True, text=True)
    text = proc.stdout + proc.stderr
    text = text.replace(tempfile.gettempdir().rstrip("/"), "$TMPDIR").replace(str(ROOT) + "/", "")
    shown = "python " + " ".join(a for a in args if a not in ("--no-header", "-p", "no:cacheprovider"))
    header = f"$ {shown}\n# captured {dt.date.today().isoformat()} by scripts/capture_outputs.py (exit code {proc.returncode})\n\n"
    (OUT / f"{name}.txt").write_text(header + text.rstrip() + "\n")
    print(f"{'ok' if proc.returncode == 0 else 'EXIT ' + str(proc.returncode):8} {name}")


def main(names: list[str]) -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    unknown = [n for n in names if n not in CAPTURES]
    if unknown:
        print(f"unknown capture(s): {unknown}; known: {sorted(CAPTURES)}")
        return 2
    for name in names or CAPTURES:
        capture(name, CAPTURES[name])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
