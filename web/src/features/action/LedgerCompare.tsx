import { AlertTriangle, CheckCircle2, Loader2, Search } from "lucide-react";
import type { ActionDetail, Effect } from "@/lib/api";
import { compare, type Verdict } from "@/lib/compare";
import { StatusPill } from "@/components/StatusPill";
import { clock } from "@/lib/time";
import { cn } from "@/lib/utils";

const STYLE: Record<Verdict["kind"], { box: string; Icon: typeof CheckCircle2 }> = {
  match: { box: "bg-st-succeeded-soft text-st-succeeded-fg border-st-succeeded/30", Icon: CheckCircle2 },
  running: { box: "bg-st-inflight-soft text-st-inflight-fg border-st-inflight/30", Icon: Loader2 },
  evidence: { box: "bg-st-unknown-soft text-st-unknown-fg border-st-unknown/30", Icon: Search },
  mismatch: { box: "bg-st-failed-soft text-st-failed-fg border-st-failed/30", Icon: AlertTriangle },
};

export function VerdictBanner({ verdict }: { verdict: Verdict }) {
  const { box, Icon } = STYLE[verdict.kind];
  return (
    <div role="status" className={cn("flex gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm", box)}>
      <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", verdict.kind === "running" && "animate-spin motion-reduce:animate-none")} />
      <div>
        <p className="font-medium">{verdict.title}</p>
        <p className="opacity-90">{verdict.detail}</p>
      </div>
    </div>
  );
}

export function LedgerCompare({ action, effects, error }: { action: ActionDetail; effects?: Effect[]; error?: string }) {
  return (
    <div className="space-y-4">
      {effects ? (
        <VerdictBanner verdict={compare(action, effects)} />
      ) : (
        <p className="rounded-xl border border-dashed px-3.5 py-2.5 text-sm text-muted-foreground">
          {error ? `The provider's ledger cannot be read right now (${error}). OneShot's own record is shown on the left; an empty right side does not mean nothing happened.` : "Reading the provider's ledger…"}
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-[14px] border p-5">
          <h3 className="font-medium">OneShot's record</h3>
          <p className="mb-4 text-xs text-muted-foreground">Answers “what did we tell the agent?”</p>
          <dl className="grid grid-cols-[auto_1fr] items-center gap-x-5 gap-y-2.5 text-sm">
            <dt className="text-muted-foreground">Status</dt>
            <dd><StatusPill status={action.status} /></dd>
            <dt className="text-muted-foreground">Effect id</dt>
            <dd className="font-mono text-xs">{action.provider_effect_id ?? "none recorded"}</dd>
            <dt className="text-muted-foreground">Sends and checks</dt>
            <dd className="tabular-nums">{action.attempt_count} and {action.verify_count}</dd>
            <dt className="text-muted-foreground">May have applied</dt>
            <dd>{action.maybe_applied ? "Yes, an attempt was ambiguous" : "No"}</dd>
            {action.resolution && (
              <>
                <dt className="text-muted-foreground">Resolution</dt>
                <dd className="text-xs">{action.resolution}</dd>
              </>
            )}
          </dl>
        </section>
        <section className="rounded-[14px] border p-5">
          <h3 className="font-medium">Provider's ledger</h3>
          <p className="mb-4 text-xs text-muted-foreground">Answers “did the effect really happen?” This is the authoritative record.</p>
          {!effects ? (
            <p className="text-sm text-muted-foreground">Unavailable</p>
          ) : effects.length === 0 ? (
            <p className="text-sm text-muted-foreground">No effect carries the reference <span className="font-mono">{action.id}</span>.</p>
          ) : (
            <ul className="space-y-2">
              {effects.map((e) => (
                <li key={e.id} className={cn("rounded-xl border px-3.5 py-2.5 text-sm", effects.length > 1 && "border-st-failed/50 bg-st-failed-soft/40")}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-medium">{e.id}</span>
                    <time className="font-mono text-[11px] text-muted-foreground">{clock(e.created_at)}</time>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{e.kind}, {e.idempotency_key ? `sent with key ${e.idempotency_key}` : "sent without an idempotency key"}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
