import type { ActionDetail, Attempt, ActionEvent } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { explainEvent, explainOutcome, mayHaveApplied } from "@/lib/explain";
import { STATUS_META } from "@/lib/status";
import { clock, offset } from "@/lib/time";
import { cn } from "@/lib/utils";
import { ArrowRight } from "lucide-react";

type Item = { at: number; order: number } & ({ type: "event"; e: ActionEvent } | { type: "attempt"; a: Attempt });

/** Status changes and attempt outcomes in time order, each with its recorded
 * reason (verbatim from the backend) and a plain-English explanation. */
export function Timeline({ action }: { action: ActionDetail }) {
  const items: Item[] = [
    ...action.events.map((e, i) => ({ type: "event" as const, e, at: e.at, order: i * 2 + 1 })),
    // An attempt is placed when its outcome was recorded (just before the
    // status change that outcome caused), or at its start while still open.
    ...action.attempts.map((a, i) => ({ type: "attempt" as const, a, at: a.finished_at ?? a.started_at, order: i * 2 })),
  ].sort((x, y) => x.at - y.at || (x.type === y.type ? x.order - y.order : x.type === "attempt" ? -1 : 1));

  return (
    <ol className="relative ml-2 space-y-1 border-l pl-6">
      {items.map((it, i) => (
        <li key={i} className="os-fade-in relative py-2">
          {it.type === "event" ? <EventItem e={it.e} start={action.created_at} /> : <AttemptItem a={it.a} start={action.created_at} />}
        </li>
      ))}
    </ol>
  );
}

function Stamp({ at, start }: { at: number; start: number }) {
  return (
    <span className="font-mono text-[11px] text-muted-foreground" title={clock(at)}>
      {offset(at, start)}
    </span>
  );
}

function EventItem({ e, start }: { e: ActionEvent; start: number }) {
  return (
    <>
      <span className={cn("absolute -left-[31px] top-3.5 size-2.5 rounded-full ring-4 ring-background", STATUS_META[e.to].dot)} />
      <div className="flex flex-wrap items-center gap-2">
        <Stamp at={e.at} start={start} />
        {e.from && <StatusBadge status={e.from} explain={false} />}
        {e.from && <ArrowRight className="size-3.5 text-muted-foreground" />}
        <StatusBadge status={e.to} />
      </div>
      <p className="mt-1.5 font-mono text-xs break-words text-muted-foreground">{e.message}</p>
      <p className="mt-1 text-sm leading-relaxed">{explainEvent(e)}</p>
    </>
  );
}

function AttemptItem({ a, start }: { a: Attempt; start: number }) {
  const risky = mayHaveApplied(a);
  const took = a.finished_at ? `${(a.finished_at - a.started_at).toFixed(2)}s` : null;
  return (
    <>
      <span className={cn("absolute -left-[29px] top-4 size-1.5 rounded-full ring-4 ring-background", risky ? "bg-st-unknown" : "bg-muted-foreground/50")} />
      <div className="rounded-lg border bg-muted/40 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Stamp at={a.finished_at ?? a.started_at} start={start} />
          <span className="font-medium">
            {a.kind === "send" ? "Send" : "Provider check"} #{a.number}
          </span>
          <span
            className={cn(
              "rounded px-1.5 py-0.5 font-mono text-[11px]",
              a.outcome == null ? "os-pulse bg-st-inflight-soft text-st-inflight-fg" : risky ? "bg-st-unknown-soft text-st-unknown-fg" : "bg-background",
            )}
          >
            {a.outcome ?? "running…"}
          </span>
          <span className="text-xs text-muted-foreground">
            by {a.worker_id}
            {took && ` · took ${took}`}
          </span>
        </div>
        {a.detail && <p className="mt-1 font-mono text-xs text-muted-foreground">{a.detail}</p>}
        <p className="mt-1 text-sm">{explainOutcome(a.outcome)}</p>
      </div>
    </>
  );
}
