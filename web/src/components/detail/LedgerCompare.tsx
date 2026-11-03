import type { ActionDetail, Effect } from "@/lib/api";
import { compare, type Verdict } from "@/lib/compare";
import { StatusBadge } from "@/components/StatusBadge";
import { clock } from "@/lib/time";
import { cn } from "@/lib/utils";
import { CheckCircle2, AlertTriangle, Loader2, Search } from "lucide-react";

const VERDICT_STYLE: Record<Verdict["kind"], { box: string; icon: React.ReactNode }> = {
  match: { box: "bg-st-succeeded-soft text-st-succeeded-fg border-st-succeeded/30", icon: <CheckCircle2 className="size-4" /> },
  running: { box: "bg-st-inflight-soft text-st-inflight-fg border-st-inflight/30", icon: <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> },
  evidence: { box: "bg-st-unknown-soft text-st-unknown-fg border-st-unknown/30", icon: <Search className="size-4" /> },
  mismatch: { box: "bg-st-failed-soft text-st-failed-fg border-st-failed/30", icon: <AlertTriangle className="size-4" /> },
};

export function VerdictBanner({ verdict }: { verdict: Verdict }) {
  const s = VERDICT_STYLE[verdict.kind];
  return (
    <div className={cn("flex gap-2 rounded-lg border px-3 py-2 text-sm", s.box)}>
      <span className="mt-0.5">{s.icon}</span>
      <div>
        <div className="font-medium">{verdict.title}</div>
        <div className="opacity-90">{verdict.detail}</div>
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
        <div className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
          {error ? `Cannot read the provider's ledger right now (${error}). OneShot's own record is shown on the left.` : "Reading the provider's ledger…"}
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-xl border p-4">
          <h3 className="font-medium">OneShot's record</h3>
          <p className="mb-3 text-xs text-muted-foreground">Answers "what did we tell the agent?"</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">status</dt>
            <dd><StatusBadge status={action.status} /></dd>
            <dt className="text-muted-foreground">effect id</dt>
            <dd className="font-mono text-xs">{action.provider_effect_id ?? "none recorded"}</dd>
            <dt className="text-muted-foreground">sends / checks</dt>
            <dd>{action.attempt_count} / {action.verify_count}</dd>
            <dt className="text-muted-foreground">maybe applied</dt>
            <dd title="Set once any attempt was ambiguous and not yet disproved">{action.maybe_applied ? "yes: an attempt was ambiguous" : "no"}</dd>
            {action.resolution && (
              <>
                <dt className="text-muted-foreground">resolution</dt>
                <dd className="text-xs">{action.resolution}</dd>
              </>
            )}
          </dl>
        </section>
        <section className="rounded-xl border p-4">
          <h3 className="font-medium">Provider's ledger</h3>
          <p className="mb-3 text-xs text-muted-foreground">Answers "did the effect really happen?" This is the authoritative record.</p>
          {!effects ? (
            <p className="text-sm text-muted-foreground">-</p>
          ) : effects.length === 0 ? (
            <p className="text-sm text-muted-foreground">No effect with reference <span className="font-mono">{action.id}</span>.</p>
          ) : (
            <ul className="space-y-2">
              {effects.map((e) => (
                <li key={e.id} className={cn("rounded-lg border px-3 py-2 text-sm", effects.length > 1 && "border-st-failed/50")}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-medium">{e.id}</span>
                    <span className="font-mono text-[11px] text-muted-foreground">{clock(e.created_at)}</span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {e.kind} · {e.idempotency_key ? `key ${e.idempotency_key}` : "sent without an idempotency key"}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
