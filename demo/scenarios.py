"""The demo's failure scenarios. Each one is a small, self-checking story.

To add a scenario: write a function taking a DemoContext, decorate it with
@scenario, and use ctx.expect(...) for its success criteria. See
docs/src/07-how-to-extend.md.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Callable

from demo.context import DemoContext
from oneshot.domain import ActionStatus
from oneshot.reconciler import FindingKind

S = ActionStatus


@dataclass(frozen=True)
class Scenario:
    name: str
    title: str
    lesson: str
    run: Callable[[DemoContext], None]
    provider_ttl: float = 24 * 3600


SCENARIOS: list[Scenario] = []


def scenario(name: str, title: str, lesson: str, **kwargs) -> Callable[[Callable[[DemoContext], None]], Callable]:
    def register(fn: Callable[[DemoContext], None]) -> Callable[[DemoContext], None]:
        SCENARIOS.append(Scenario(name, title, lesson, fn, **kwargs))
        return fn

    return register


def charge(customer: str = "cus_ada", cents: int = 4200) -> dict:
    return {"amount_cents": cents, "currency": "USD", "customer": customer}


def message(body: str = "Your order has shipped") -> dict:
    return {"to": "+15550100", "body": body}


# --------------------------------------------------------------------------------


@scenario(
    "happy-path",
    "Nothing goes wrong",
    "The baseline: one request, one effect, SUCCEEDED. Every later scenario is a deviation from this.",
)
def happy_path(ctx: DemoContext) -> None:
    a = ctx.submit("payment.charge", charge(), "agent-order-1001")
    ctx.run_worker()
    ctx.show(a)
    ctx.expect_status(a, S.SUCCEEDED, 1)


@scenario(
    "transient-retry",
    "Provider is briefly unavailable (503 twice)",
    "A 503 with applied=false PROVES nothing happened, so retrying is safe for any action type. "
    "Backoff (0.3s, 0.6s, ...) gives the provider room to recover.",
)
def transient_retry(ctx: DemoContext) -> None:
    ctx.arm({"mode": "unavailable", "times": 2})
    a = ctx.submit("payment.charge", charge(), "agent-order-1002")
    ctx.run_worker()
    ctx.show(a)
    ctx.expect_status(a, S.SUCCEEDED, 1)
    ctx.expect("took exactly 3 send attempts", ctx.refresh(a).attempt_count == 3)


@scenario(
    "permanent-decline",
    "Card is declined",
    "A permanent rejection is a definite answer: FAILED immediately, no retries, nothing applied.",
)
def permanent_decline(ctx: DemoContext) -> None:
    a = ctx.submit("payment.charge", charge(customer="cus_declined"), "agent-order-1003")
    ctx.run_worker()
    ctx.show(a)
    ctx.expect_status(a, S.FAILED, 0)
    ctx.expect("was not retried", ctx.refresh(a).attempt_count == 1)


@scenario(
    "lost-response-charge",
    "Charge applied, but the response is lost (idempotent endpoint)",
    "OneShot cannot know whether the charge happened. Because the provider deduplicates by "
    "Idempotency-Key, retrying with the SAME key is safe: the provider replays the original result.",
)
def lost_response_charge(ctx: DemoContext) -> None:
    ctx.arm({"mode": "lost_response", "endpoint": "/v1/charges"})
    a = ctx.submit("payment.charge", charge(), "agent-order-1004")
    ctx.run_worker()
    ctx.show(a)
    ctx.expect_status(a, S.SUCCEEDED, 1)


@scenario(
    "lost-response-message",
    "Message sent, but the response is lost (NON-idempotent endpoint)",
    "No idempotency => a blind retry could send the message twice. OneShot VERIFIES instead: it waits "
    "for the settle window, looks the reference up in the provider's record, finds it, and does not resend.",
)
def lost_response_message(ctx: DemoContext) -> None:
    ctx.arm({"mode": "lost_response", "endpoint": "/v1/messages"})
    a = ctx.submit("message.send", message(), "agent-notify-2001")
    ctx.run_worker()
    ctx.show(a)
    ctx.expect_status(a, S.SUCCEEDED, 1)
    ctx.expect("was sent only once", ctx.refresh(a).attempt_count == 1)


@scenario(
    "timeout-message",
    "Provider hangs and never applies the message",
    "From the outside this timeout looks IDENTICAL to the lost response above. Verification is what "
    "tells them apart: here the record is absent after the settle window, so a resend is safe.",
)
def timeout_message(ctx: DemoContext) -> None:
    ctx.arm({"mode": "timeout", "endpoint": "/v1/messages", "delay_seconds": 1.2})
    a = ctx.submit("message.send", message(), "agent-notify-2002")
    ctx.run_worker()
    ctx.show(a)
    ctx.expect_status(a, S.SUCCEEDED, 1)


@scenario(
    "agent-duplicates",
    "The agent submits the same request twice",
    "Same Idempotency-Key => OneShot returns the original action (no new work). A NEW key for the same "
    "intent looks like a new request: OneShot executes both, and reconciliation can only WARN about it.",
)
def agent_duplicates(ctx: DemoContext) -> None:
    a = ctx.submit("payment.charge", charge(), "agent-order-1005")
    again = ctx.submit("payment.charge", charge(), "agent-order-1005")
    ctx.expect("same key returned the same action", a.id == again.id)
    b = ctx.submit("payment.charge", charge(), "agent-order-1005-retry")  # agent bug: fresh key
    ctx.run_worker()
    ctx.show(a, b)
    report = ctx.reconcile()
    ctx.expect("reconciliation flags the fresh-key duplicate", [f.action_id for f in report.of(FindingKind.SUSPECTED_DUPLICATE_REQUEST)] == [b.id])


@scenario(
    "worker-crash",
    "OneShot's worker crashes after the provider applied the charge",
    "The worker recorded its intent BEFORE sending. After the crash the action is stuck IN_FLIGHT; a new "
    "worker waits for the lease to expire, treats the attempt as ambiguous, and retries with the same key.",
)
def worker_crash(ctx: DemoContext) -> None:
    a = ctx.submit("payment.charge", charge(), "agent-order-1006")
    ctx.run_worker(failpoints=("after_response",), label="worker process #1")
    mid = ctx.refresh(a)
    ctx.say(f"  After the crash: OneShot says {mid.status.value}; provider ledger has {len(ctx.effects(a))} effect(s).", "yellow")
    ctx.expect("crash left the action IN_FLIGHT while the provider had applied it", mid.status is S.IN_FLIGHT and len(ctx.effects(a)) == 1)
    ctx.run_worker(label="worker process #2 (fresh)")
    ctx.show(a)
    ctx.expect_status(a, S.SUCCEEDED, 1)


@scenario(
    "provider-crash-unknown",
    "Provider crashes right after applying, and stays down",
    "Ambiguous outcome + no way to check = UNKNOWN, an honest 'we do not know'. When the provider is "
    "back, reconciliation reads its ledger and resolves UNKNOWN to SUCCEEDED.",
)
def provider_crash_unknown(ctx: DemoContext) -> None:
    ctx.arm({"mode": "crash_after_apply", "endpoint": "/v1/messages"})
    a = ctx.submit("message.send", message(), "agent-notify-2003")
    ctx.run_worker()
    ctx.show_provider_view()
    ctx.expect("action ended UNKNOWN while the provider was down", ctx.refresh(a).status is S.UNKNOWN)
    ctx.restart_provider()
    report = ctx.reconcile()
    ctx.show(a)
    ctx.expect("reconciliation resolved it", [f.action_id for f in report.of(FindingKind.RESOLVED_SUCCEEDED)] == [a.id])
    ctx.expect_status(a, S.SUCCEEDED, 1)


@scenario(
    "slow-provider-duplicate",
    "HONEST GAP: provider is slower than OneShot's settle assumption",
    "Verify-then-retry assumes the provider finishes within the settle window (1.5s here). This one takes "
    "4s: the lookup finds nothing, OneShot resends, then the original lands. TWO messages. Without provider-side "
    "deduplication a client must choose: retry after verifying (risking this duplicate) or never retry an "
    "ambiguous send (risking a lost message). Reconciliation DETECTS the duplicate; it cannot undo it.",
)
def slow_provider_duplicate(ctx: DemoContext) -> None:
    ctx.arm({"mode": "slow_success", "endpoint": "/v1/messages", "delay_seconds": 4.0})
    a = ctx.submit("message.send", message("Your refund is on its way"), "agent-notify-2004")
    ctx.run_worker()
    ctx.say("  ...waiting for the slow original request to land at the provider", "dim")
    time.sleep(2.5)
    ctx.show(a)
    ctx.expect("the duplicate really happened (2 effects)", len(ctx.effects(a)) == 2)
    report = ctx.reconcile()
    ctx.expect("reconciliation flags DUPLICATE_EFFECT", [f.action_id for f in report.of(FindingKind.DUPLICATE_EFFECT)] == [a.id])


@scenario(
    "database-wiped",
    "OneShot's database is lost",
    "The provider's ledger is independent evidence. Even with OneShot's records gone, reconciliation "
    "shows every effect that really happened as an ORPHAN that needs attention.",
)
def database_wiped(ctx: DemoContext) -> None:
    a = ctx.submit("payment.charge", charge(), "agent-order-1007")
    b = ctx.submit("message.send", message(), "agent-notify-2005")
    ctx.run_worker()
    ctx.show(a, b)
    db = ctx.workdir / "oneshot.db"
    for suffix in ("", "-wal", "-shm"):
        db.with_name(db.name + suffix).unlink(missing_ok=True)
    ctx.say("  OneShot's database files deleted. Creating an empty one.", "bold yellow")
    from oneshot.store import ActionStore

    ctx.store = ActionStore(ctx.settings.db_path)
    report = ctx.reconcile()
    orphans = {f.action_id for f in report.of(FindingKind.ORPHAN_EFFECT)}
    ctx.expect("both real effects are reported as orphans", orphans == {a.id, b.id})


def by_name(names: list[str]) -> list[Scenario]:
    if not names:
        return list(SCENARIOS)
    index = {s.name: s for s in SCENARIOS}
    unknown = [n for n in names if n not in index]
    if unknown:
        raise SystemExit(f"unknown scenario(s): {unknown}. Use --list.")
    return [index[n] for n in names]
