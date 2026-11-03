"""``oneshot`` command-line interface.

Operator commands work directly on the local database (same machine), while
agents are expected to use the HTTP API (``oneshot serve``).
"""

from __future__ import annotations

import argparse
import json
import signal
import sys
import uuid

from rich.console import Console

from oneshot.action_types import REGISTRY, InvalidPayload, get_action_type
from oneshot.config import Settings
from oneshot.domain import ActionStatus
from oneshot.provider_client import ProviderClient
from oneshot.reconciler import Reconciler, ReconciliationError, Severity
from oneshot.render import actions_table, attempts_table, print_timeline, reconcile_table
from oneshot.store import ActionStore, IdempotencyConflict
from oneshot.worker import Worker

console = Console()


def _store(settings: Settings) -> ActionStore:
    return ActionStore(settings.db_path)


def cmd_serve(args: argparse.Namespace, settings: Settings) -> int:
    import uvicorn

    from oneshot.api import create_app

    uvicorn.run(create_app(settings), host=args.host, port=args.port, log_level="warning")
    return 0


def cmd_worker(args: argparse.Namespace, settings: Settings) -> int:
    client = ProviderClient(settings)
    worker = Worker(_store(settings), client, settings, worker_id=args.id)
    # SIGTERM / Ctrl-C: finish the current step, then exit cleanly. (kill -9 is
    # handled too - by lease expiry and recovery, not by this handler.)
    signal.signal(signal.SIGTERM, lambda *_: worker.stop())
    try:
        worker.run(drain=args.drain, max_seconds=args.max_seconds)
    except KeyboardInterrupt:
        pass
    finally:
        client.close()
    return 0


def cmd_submit(args: argparse.Namespace, settings: Settings) -> int:
    try:
        action_type = get_action_type(args.type)
        payload = action_type.validate(json.loads(args.payload))
        key = args.key or f"cli-{uuid.uuid4().hex[:12]}"
        action, created = _store(settings).submit(action_type.name, payload, key)
    except (InvalidPayload, json.JSONDecodeError) as exc:
        console.print(f"[red]invalid request:[/] {exc}")
        return 2
    except IdempotencyConflict as exc:
        console.print(f"[red]conflict:[/] {exc}")
        return 3
    note = "created" if created else "already existed for this Idempotency-Key (no new action)"
    console.print(f"{action.id} {note} (key={key}, status={action.status.value})")
    return 0


def cmd_list(args: argparse.Namespace, settings: Settings) -> int:
    status = ActionStatus(args.status) if args.status else None
    actions = _store(settings).list(status)
    if args.json:
        print(json.dumps([a.to_json() for a in actions], indent=2))
    else:
        console.print(actions_table(actions))
    return 0


def cmd_show(args: argparse.Namespace, settings: Settings) -> int:
    """Investigate one action: our timeline and attempts next to the provider's record."""
    action = _store(settings).get(args.action_id)
    if action is None:
        console.print(f"[red]no such action {args.action_id}[/]")
        return 1
    if args.json:
        print(json.dumps(action.to_json(detail=True), indent=2))
        return 0
    print_timeline(console, action)
    console.print(attempts_table(action))
    client = ProviderClient(settings)
    try:
        lookup = client.lookup(action.id)
    finally:
        client.close()
    if lookup.ok:
        found = ", ".join(lookup.effect_ids) or "no effect"
        console.print(f"  provider's own record for reference {action.id}: [bold]{found}[/]")
    else:
        console.print(f"  provider's record unavailable: {lookup.detail}")
    if action.status is ActionStatus.UNKNOWN:
        console.print("  -> resolve with: oneshot reconcile   or   oneshot resolve ID --as succeeded|failed --note '...'")
    return 0


def cmd_resolve(args: argparse.Namespace, settings: Settings) -> int:
    try:
        action = _store(settings).resolve(
            args.action_id, ActionStatus(args.as_.upper()), args.note, actor=args.actor
        )
    except (KeyError, ValueError) as exc:
        console.print(f"[red]cannot resolve:[/] {exc}")
        return 1
    console.print(f"{action.id} -> {action.status.value} ({action.resolution})")
    return 0


def cmd_reconcile(args: argparse.Namespace, settings: Settings) -> int:
    client = ProviderClient(settings)
    try:
        report = Reconciler(_store(settings), client, settings).run(apply=not args.dry_run)
    except ReconciliationError as exc:
        console.print(f"[red]reconciliation impossible:[/] {exc}")
        return 2
    finally:
        client.close()
    if args.json:
        print(json.dumps(report.to_json(), indent=2))
    else:
        console.print(reconcile_table(report, show_ok=args.all))
    return 1 if any(f.severity is Severity.CRITICAL for f in report.findings) else 0


def cmd_demo(args: argparse.Namespace, settings: Settings) -> int:
    from demo.runner import main as demo_main

    return demo_main(args.scenarios, list_only=args.list, keep=args.keep)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="oneshot", description="Reliable action execution for AI agents (educational).")
    sub = p.add_subparsers(dest="command", required=True)

    s = sub.add_parser("serve", help="run the HTTP API for agents")
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--port", type=int, default=8700)
    s.set_defaults(func=cmd_serve)

    s = sub.add_parser("worker", help="run a worker that executes actions")
    s.add_argument("--drain", action="store_true", help="exit when every action is SUCCEEDED/FAILED/UNKNOWN")
    s.add_argument("--max-seconds", type=float, default=None)
    s.add_argument("--id", default=None, help="worker id (default: host-pid)")
    s.set_defaults(func=cmd_worker)

    s = sub.add_parser("submit", help="submit an action directly to the local store")
    s.add_argument("type", choices=sorted(REGISTRY))
    s.add_argument("payload", help='JSON, e.g. \'{"amount_cents": 1500, "customer": "cus_1"}\'')
    s.add_argument("--key", help="Idempotency-Key (default: random)")
    s.set_defaults(func=cmd_submit)

    s = sub.add_parser("list", help="list actions")
    s.add_argument("--status", choices=[x.value for x in ActionStatus])
    s.add_argument("--json", action="store_true")
    s.set_defaults(func=cmd_list)

    s = sub.add_parser("show", help="investigate one action (timeline, attempts, provider record)")
    s.add_argument("action_id")
    s.add_argument("--json", action="store_true")
    s.set_defaults(func=cmd_show)

    s = sub.add_parser("resolve", help="manually resolve an UNKNOWN action")
    s.add_argument("action_id")
    s.add_argument("--as", dest="as_", required=True, choices=["succeeded", "failed"])
    s.add_argument("--note", required=True)
    s.add_argument("--actor", default="operator")
    s.set_defaults(func=cmd_resolve)

    s = sub.add_parser("reconcile", help="compare OneShot's records with the provider's ledger")
    s.add_argument("--dry-run", action="store_true", help="report only; do not resolve UNKNOWN actions")
    s.add_argument("--all", action="store_true", help="also list exact matches")
    s.add_argument("--json", action="store_true")
    s.set_defaults(func=cmd_reconcile)

    s = sub.add_parser("demo", help="run the failure-scenario demo end to end")
    s.add_argument("scenarios", nargs="*", help="scenario names (default: all)")
    s.add_argument("--list", action="store_true", help="list scenarios and exit")
    s.add_argument("--keep", action="store_true", help="keep the demo's temp directory (databases, logs)")
    s.set_defaults(func=cmd_demo)
    return p


def main(argv: list[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    sys.exit(args.func(args, Settings.from_env()))


if __name__ == "__main__":
    main()
