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
    <div role="status" className={cn("flex gap-3 rounded-[10px] px-4 py-3.5", box)}>
      <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", verdict.kind === "running" && "animate-spin motion-reduce:animate-none")} />
      <div>
        <p className="text-[14px] font-semibold">{verdict.title}</p>
        <p className="mt-0.5 text-[13.5px]">{verdict.detail}</p>
      </div>
    </div>
  );
}

/** The two records side by side. The provider's is authoritative for "did it
 * happen?"; OneShot's for "what did we tell the agent?". */
export function LedgerCompare({ action, effects, error }: { action: ActionDetail; effects?: Effect[]; error?: string }) {
  return (
    <div className="space-y-4">
      {effects ? (
        <VerdictBanner verdict={compare(action, effects)} />
      ) : (
        <p className="well px-4 py-3 text-[13.5px] text-fg-2">
          {error ? `The provider's ledger cannot be read right now (${error}). OneShot's own record is shown on the left; an empty right side does not mean nothing happened.` : "Reading the provider's ledger…"}
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <section className="well p-4">
          <h3 className="t-h3">OneShot's record</h3>
          <p className="mb-3 text-[12.5px] text-fg-3">Answers “what did we tell the agent?”</p>
          <dl className="text-[13.5px]">
            <Row k="Status"><StatusPill status={action.status} /></Row>
            <Row k="Effect id"><span className="font-mono text-[12.5px]">{action.provider_effect_id ?? "none recorded"}</span></Row>
            <Row k="Sends and checks"><span className="tnum">{action.attempt_count} and {action.verify_count}</span></Row>
            <Row k="May have applied">{action.maybe_applied ? "Yes, an attempt was ambiguous" : "No"}</Row>
            {action.resolution && <Row k="Resolution"><span className="text-[12.5px]">{action.resolution}</span></Row>}
          </dl>
        </section>
        <section className="well p-4">
          <h3 className="t-h3">The provider's ledger</h3>
          <p className="mb-3 text-[12.5px] text-fg-3">Answers “did the effect really happen?” This is the authoritative record.</p>
          {!effects ? (
            <p className="text-[13.5px] text-fg-3">Unavailable</p>
          ) : effects.length === 0 ? (
            <p className="text-[13.5px] text-fg-2">No effect carries the reference <span className="font-mono text-[12.5px]">{action.id}</span>.</p>
          ) : (
            <ul className="space-y-2">
              {effects.map((e) => (
                <li key={e.id} className={cn("rounded-[8px] border bg-surface px-3 py-2.5", effects.length > 1 ? "border-st-failed/40" : "border-line")}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-mono text-[12.5px] font-[560]">{e.id}</span>
                    <time className="font-mono text-[11.5px] text-fg-3">{clock(e.created_at)}</time>
                  </div>
                  <p className="mt-0.5 text-[12.5px] text-fg-2">A {e.kind}, {e.idempotency_key ? `sent with key ${e.idempotency_key}` : "sent without an idempotency key"}.</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] items-center gap-3 border-b border-line py-2.5 last:border-0">
      <dt className="text-fg-3">{k}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
