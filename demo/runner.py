"""Run demo scenarios and print a final scorecard.

    uv run oneshot demo                     # all scenarios (~1 minute)
    uv run oneshot demo worker-crash        # just one
    uv run oneshot demo --list
"""

from __future__ import annotations

import shutil
import tempfile
import time
from pathlib import Path

from rich.console import Console
from rich.rule import Rule
from rich.table import Table
from rich.text import Text

from demo.context import DemoContext
from demo.scenarios import SCENARIOS, by_name


def main(names: list[str], *, list_only: bool = False, keep: bool = False, console: Console | None = None) -> int:
    console = console or Console()
    if list_only:
        for s in SCENARIOS:
            console.print(f"[bold]{s.name:26}[/] {s.title}")
        return 0

    chosen = by_name(names)
    root = Path(tempfile.mkdtemp(prefix="oneshot-demo-"))
    console.print(Rule("[bold]OneShot demo[/]"))
    console.print(
        "Each scenario uses a fresh provider process with its own ledger, a fresh OneShot database, "
        "and real worker processes. Faults are injected at the provider (or as failpoints in the worker).\n"
        f"Working directory: {root}"
    )
    results: list[tuple[str, int, int, float]] = []
    for i, s in enumerate(chosen, 1):
        console.print()
        console.print(Rule(f"[bold]{i}/{len(chosen)}  {s.name}[/]: {s.title}", align="left"))
        ctx = DemoContext(root / s.name, console, provider_ttl=s.provider_ttl)
        started = time.monotonic()
        try:
            s.run(ctx)
        except Exception as exc:  # noqa: BLE001 - report and continue to the next scenario
            ctx.expect(f"scenario raised {type(exc).__name__}: {exc}", False)
        finally:
            ctx.close()
        console.print(Text.assemble(("  Lesson: ", "bold"), (s.lesson, "italic")))
        passed = sum(c.passed for c in ctx.checks)
        results.append((s.name, passed, len(ctx.checks), time.monotonic() - started))

    console.print()
    table = Table(title="Scorecard (every expectation checked against the provider's real ledger)", title_justify="left")
    table.add_column("scenario")
    table.add_column("checks", justify="right")
    table.add_column("time", justify="right")
    table.add_column("result")
    for name, passed, total, secs in results:
        ok = passed == total
        table.add_row(name, f"{passed}/{total}", f"{secs:.1f}s", Text("PASS" if ok else "FAIL", style="bold green" if ok else "bold red"))
    console.print(table)
    all_ok = all(p == t for _, p, t, _ in results)
    if keep:
        console.print(f"Kept databases and logs in {root}")
    else:
        shutil.rmtree(root, ignore_errors=True)
    return 0 if all_ok else 1
