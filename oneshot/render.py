"""Terminal rendering (rich) shared by the CLI and the demo."""

from __future__ import annotations

from rich.console import Console
from rich.table import Table
from rich.text import Text

from oneshot.action_types import REGISTRY
from oneshot.domain import Action, ActionStatus
from oneshot.reconciler import Report, Severity

STATUS_STYLE = {
    ActionStatus.PENDING: "cyan",
    ActionStatus.IN_FLIGHT: "blue",
    ActionStatus.VERIFYING: "magenta",
    ActionStatus.SUCCEEDED: "bold green",
    ActionStatus.FAILED: "bold red",
    ActionStatus.UNKNOWN: "bold yellow",
}

SEVERITY_STYLE = {
    Severity.OK: "green",
    Severity.INFO: "cyan",
    Severity.RESOLVED: "bold green",
    Severity.WARNING: "bold yellow",
    Severity.CRITICAL: "bold red",
}


def status_text(status: ActionStatus) -> Text:
    return Text(status.value, style=STATUS_STYLE[status])


def summary(action: Action) -> str:
    t = REGISTRY.get(action.type)
    return t.summary(action.payload) if t else action.type


def actions_table(actions: list[Action], title: str = "Actions") -> Table:
    table = Table(title=title, title_justify="left")
    table.add_column("id")
    table.add_column("type")
    table.add_column("what")
    table.add_column("status")
    table.add_column("sends", justify="right")
    table.add_column("checks", justify="right")
    table.add_column("provider effect")
    for a in actions:
        table.add_row(
            a.id, a.type, summary(a), status_text(a.status), str(a.attempt_count), str(a.verify_count),
            a.provider_effect_id or "-",
        )  # fmt: skip
    return table


def print_timeline(console: Console, action: Action) -> None:
    """Every status change of one action, with the reason recorded at the time."""
    console.print(Text.assemble(("  ", ""), (action.id, "bold"), f"  {summary(action)}  ", status_text(action.status)))
    t0 = action.created_at
    for e in action.events:
        arrow = Text.assemble(
            status_text(e.from_status) if e.from_status else Text("(new)", style="dim"),
            " -> ",
            status_text(e.to_status),
        )
        console.print(Text.assemble(("    ", ""), (f"+{e.at - t0:6.2f}s ", "dim"), arrow, ("  " + e.message, "")))
    if action.resolution:
        console.print(Text(f"    resolution: {action.resolution}", style="italic"))


def attempts_table(action: Action) -> Table:
    table = Table(title=f"Attempts for {action.id}", title_justify="left")
    for col in ("#", "kind", "worker", "outcome", "duration", "detail"):
        table.add_column(col)
    for a in action.attempts:
        dur = f"{a.finished_at - a.started_at:.2f}s" if a.finished_at else "(open)"
        table.add_row(str(a.number), a.kind, a.worker_id, a.outcome.value if a.outcome else "-", dur, a.detail or "")
    return table


def reconcile_table(report: Report, *, show_ok: bool = False) -> Table:
    verb = "applied" if report.applied else "dry run"
    table = Table(
        title=f"Reconciliation ({verb}): {report.actions_checked} actions vs {report.effects_checked} provider effects",
        title_justify="left",
    )
    table.add_column("finding")
    table.add_column("action")
    table.add_column("provider effects")
    table.add_column("details")
    for f in report.findings:
        if f.severity is Severity.OK and not show_ok:
            continue
        table.add_row(
            Text(f.kind.value, style=SEVERITY_STYLE[f.severity]),
            f.action_id or "-",
            ", ".join(f.effect_ids) or "-",
            f.message,
        )
    ok = sum(1 for f in report.findings if f.severity is Severity.OK)
    table.caption = f"{ok} action(s) matched the provider exactly" + ("" if show_ok else " (hidden; use --all)")
    return table
