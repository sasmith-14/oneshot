import { AlertTriangle, CheckCircle2, Loader2, Search } from "lucide-react";
import type { ActionDetail, Effect } from "@/lib/api";
import { compare, type Verdict } from "@/lib/compare";
import { StatusPill } from "@/components/StatusPill";
import { clock } from "@/lib/time";
import { cn } from "@/lib/utils";

const STYLE: Record<Verdict["kind"], { box: string; Icon: typeof CheckCircle2 }> = {
  match: { box: "bg-st-succeeded-soft text-st-succeeded-fg", Icon: CheckCircle2 },
  running: { box: "bg-st-inflight-soft text-st-inflight-fg", Icon: Loader2 },
  evidence: { box: "bg-st-unknown-soft text-st-unknown-fg", Icon: Search },
  mismatch: { box: "bg-st-failed-soft text-st-failed-fg", Icon: AlertTriangle },
};

export function VerdictBanner({ verdict }: { verdict: Verdict }) {
  const { box, Icon } = STYLE[verdict.kind];
  return (
    <div role="status" className={cn("flex gap-3 px-5 py-4", box)}>
      <Icon aria-hidden className={cn("mt-1 size-4 shrink-0", verdict.kind === "running" && "animate-spin motion-reduce:animate-none")} />
      <div>
        <p className="text-[16px] font-semibold">{verdict.title}</p>
        <p className="mt-0.5 text-[15px]">{verdict.detail}</p>
      </div>
    </div>
  );
}

/** Two records side by side, like facing pages: what OneShot told the agent,
 * and what the provider actually did. The provider's page is authoritative. */
export function LedgerCompare({ action, effects, error }: { action: ActionDetail; effects?: Effect[]; error?: string }) {
  return (
    <div className="space-y-10">
      {effects ? (
        <VerdictBanner verdict={compare(action, effects)} />
      ) : (
        <p className="bg-well px-5 py-4 text-[15px] text-ink-2">
          {error ? `The provider's ledger cannot be read right now (${error}). OneShot's own record is shown on the left; an empty right side does not mean nothing happened.` : "Reading the provider's ledger…"}
        </p>
      )}
      <div className="grid gap-y-12 md:grid-cols-2">
        <section className="md:border-r md:border-rule md:pr-10">
          <h3 className="t-title text-[32px]">OneShot's record</h3>
          <p className="mt-1 mb-6 text-[14.5px] text-ink-2">Answers “what did we tell the agent?”</p>
          <dl className="border-t-2 border-ink text-[15px]">
            <Row k="Status"><StatusPill status={action.status} /></Row>
            <Row k="Effect id"><span className="font-mono text-[13px]">{action.provider_effect_id ?? "none recorded"}</span></Row>
            <Row k="Sends and checks"><span className="tnum">{action.attempt_count} and {action.verify_count}</span></Row>
            <Row k="May have applied">{action.maybe_applied ? "Yes, an attempt was ambiguous" : "No"}</Row>
            {action.resolution && <Row k="Resolution"><span className="text-[14px]">{action.resolution}</span></Row>}
          </dl>
        </section>
        <section className="md:pl-10">
          <h3 className="t-title text-[32px]">The provider's ledger</h3>
          <p className="mt-1 mb-6 text-[14.5px] text-ink-2">Answers “did the effect really happen?” This is the authoritative record.</p>
          <div className="border-t-2 border-ink">
            {!effects ? (
              <p className="py-4 text-ink-2">Unavailable</p>
            ) : effects.length === 0 ? (
              <p className="py-4 text-[15px] text-ink-2">No effect carries the reference <span className="font-mono text-[13px]">{action.id}</span>.</p>
            ) : (
              <ul>
                {effects.map((e) => (
                  <li key={e.id} className={cn("border-b border-rule py-3.5", effects.length > 1 && "bg-st-failed-soft px-3")}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-mono text-[13.5px] font-medium">{e.id}</span>
                      <time className="font-mono text-[12.5px] text-ink-2">{clock(e.created_at)}</time>
                    </div>
                    <p className="mt-1 text-[14px] text-ink-2">A {e.kind}, {e.idempotency_key ? `sent with key ${e.idempotency_key}` : "sent without an idempotency key"}.</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[10rem_minmax(0,1fr)] items-center gap-4 border-b border-rule py-3.5">
      <dt className="text-ink-2">{k}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
