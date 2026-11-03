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

/** Status changes and attempt outcomes in time order, each with the backend's
 * own reason (verbatim) and a plain-English explanation of why. */
export function Timeline({ action }: { action: ActionDetail }) {
  const items: Item[] = [
    ...action.events.map((e, i) => ({ type: "event" as const, e, at: e.at, order: i * 2 + 1 })),
    // An attempt sits where its outcome was recorded (just before the status
    // change it caused), or where it started while it is still open.
    ...action.attempts.map((a, i) => ({ type: "attempt" as const, a, at: a.finished_at ?? a.started_at, order: i * 2 })),
  ].sort((x, y) => x.at - y.at || (x.type === y.type ? x.order - y.order : x.type === "attempt" ? -1 : 1));

  return (
    <ol className="relative ml-2 border-l pl-7">
      {items.map((it, i) => (
        <motion.li key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.3, ease: EASE_OUT, delay: Math.min(i, 10) * 0.025 }} className="relative py-2.5">
          {it.type === "event" ? <EventItem e={it.e} start={action.created_at} /> : <AttemptItem a={it.a} start={action.created_at} />}
        </motion.li>
      ))}
    </ol>
  );
}

const Stamp = ({ at, start }: { at: number; start: number }) => (
  <time className="font-mono text-[11px] text-muted-foreground tabular-nums" title={clock(at)}>{offset(at, start)}</time>
);

function EventItem({ e, start }: { e: ActionEvent; start: number }) {
  return (
    <>
      <span aria-hidden className={cn("absolute top-4 -left-[34px] size-3 rounded-full ring-4 ring-card", STATUS_META[e.to].dot)} />
      <div className="flex flex-wrap items-center gap-2">
        <Stamp at={e.at} start={start} />
        {e.from && <StatusPill status={e.from} explain={false} />}
        {e.from && <ArrowRight aria-label="to" className="size-3.5 text-muted-foreground" />}
        <StatusPill status={e.to} />
      </div>
      <p className="mt-2 text-[14.5px] leading-relaxed">{explainEvent(e)}</p>
      <p className="mt-1 font-mono text-[11.5px] break-words text-muted-foreground">{e.message}</p>
    </>
  );
}

function AttemptItem({ a, start }: { a: Attempt; start: number }) {
  const risky = mayHaveApplied(a);
  const took = a.finished_at ? `${(a.finished_at - a.started_at).toFixed(2)}s` : null;
  return (
    <>
      <span aria-hidden className={cn("absolute top-5 -left-[31px] size-1.5 rounded-full ring-4 ring-card", risky ? "bg-st-unknown" : "bg-muted-foreground/50")} />
      <div className={cn("rounded-xl border px-3.5 py-2.5", risky ? "border-st-unknown/30 bg-st-unknown-soft/40" : "bg-muted/40")}>
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <Stamp at={a.finished_at ?? a.started_at} start={start} />
          <span className="font-medium">{a.kind === "send" ? `Send #${a.number}` : `Ledger check #${a.number}`}</span>
          <span className={cn("rounded-md px-1.5 py-0.5 font-mono text-[11px]", a.outcome == null ? "os-pulse bg-st-inflight-soft text-st-inflight-fg" : risky ? "bg-st-unknown-soft text-st-unknown-fg" : "bg-card")}>{a.outcome ?? "running…"}</span>
          <span className="text-xs text-muted-foreground">
            by <span className="font-mono">{a.worker_id}</span>
            {took && `, took ${took}`}
          </span>
        </div>
        <p className="mt-1 text-[13.5px]">{explainOutcome(a.outcome)}</p>
        {a.detail && <p className="mt-0.5 font-mono text-[11.5px] text-muted-foreground">{a.detail}</p>}
      </div>
    </>
  );
}
