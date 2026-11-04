import { ArrowRight } from "lucide-react";
import { motion } from "motion/react";
import type { ActionDetail, ActionEvent, Attempt } from "@/lib/api";
import { StatusPill } from "@/components/StatusPill";
import { explainEvent, explainOutcome, mayHaveApplied } from "@/lib/explain";
import { STATUS_META } from "@/lib/status";
import { clock, offset } from "@/lib/time";
import { EASE_OUT } from "@/lib/motion";
import { cn } from "@/lib/utils";

type Item = { at: number; order: number } & ({ type: "event"; e: ActionEvent } | { type: "attempt"; a: Attempt });

/** Status changes and attempt outcomes in time order, set like a chronology:
 * the time in the margin, the plain-English reason, and the backend's own
 * words beneath it (verbatim). */
export function Timeline({ action }: { action: ActionDetail }) {
  const items: Item[] = [
    ...action.events.map((e, i) => ({ type: "event" as const, e, at: e.at, order: i * 2 + 1 })),
    // An attempt sits where its outcome was recorded (just before the status
    // change it caused), or where it started while it is still open.
    ...action.attempts.map((a, i) => ({ type: "attempt" as const, a, at: a.finished_at ?? a.started_at, order: i * 2 })),
  ].sort((x, y) => x.at - y.at || (x.type === y.type ? x.order - y.order : x.type === "attempt" ? -1 : 1));

  return (
    <ol className="relative max-w-4xl">
      {items.map((it, i) => (
        <motion.li
          key={i}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: EASE_OUT, delay: Math.min(i, 10) * 0.035 }}
          className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-5 border-b border-line py-4 last:border-0 sm:grid-cols-[6.5rem_minmax(0,1fr)]"
        >
          <time className="pt-1 font-mono text-[11.5px] text-fg-3 tnum" title={clock(it.at)}>{offset(it.at, action.created_at)}</time>
          <div className="min-w-0">{it.type === "event" ? <EventItem e={it.e} /> : <AttemptItem a={it.a} />}</div>
        </motion.li>
      ))}
    </ol>
  );
}

function EventItem({ e }: { e: ActionEvent }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {e.from && <StatusPill status={e.from} explain={false} />}
        {e.from && <ArrowRight aria-label="to" className="size-4 text-fg-2" />}
        <StatusPill status={e.to} />
      </div>
      <p className="mt-2.5 text-[14.5px] leading-relaxed">{explainEvent(e)}</p>
      <p className="mt-1 font-mono text-[11.5px] break-words text-fg-3">{e.message}</p>
    </>
  );
}

function AttemptItem({ a }: { a: Attempt }) {
  const risky = mayHaveApplied(a);
  const took = a.finished_at ? `${(a.finished_at - a.started_at).toFixed(2)}s` : null;
  return (
    <div className={cn("rounded-[10px] border px-4 py-3", risky ? "border-st-unknown/30 bg-st-unknown-soft/60" : "border-line bg-sunken")}>
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[13.5px]">
        <span className="font-semibold">{a.kind === "send" ? `Send ${a.number}` : `Ledger check ${a.number}`}</span>
        <span className={cn("rounded-[5px] px-1.5 py-0.5 font-mono text-[11px] font-[560]", a.outcome == null ? "os-pulse " + STATUS_META.IN_FLIGHT.badge : risky ? STATUS_META.UNKNOWN.badge : "bg-surface")}>{a.outcome ?? "running…"}</span>
        <span className="text-[12.5px] text-fg-3">
          by <span className="font-mono">{a.worker_id}</span>
          {took && `, took ${took}`}
        </span>
      </p>
      <p className="mt-1 text-[14px]">{explainOutcome(a.outcome)}</p>
      {a.detail && <p className="mt-1 font-mono text-[11.5px] text-fg-3">{a.detail}</p>}
    </div>
  );
}
