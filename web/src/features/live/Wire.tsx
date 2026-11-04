import { Link } from "react-router";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import type { Action, Status } from "@/lib/api";
import { NumberRoll } from "@/components/NumberRoll";
import { STATUS_META } from "@/lib/status";
import { SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";

// The wire: each recent action is a token that glides to its new column when
// the backend changes its status. Positions come only from polled real data.
// Drawn as a printed figure: one ink rail, five stations, the tokens below.

interface Column {
  id: string;
  title: string;
  caption: string;
  statuses: Status[];
  tone: Status;
  cap: number;
}

export const COLUMNS: Column[] = [
  { id: "accepted", title: "Accepted", caption: "Saved to disk, waiting for a worker.", statuses: ["PENDING"], tone: "PENDING", cap: 18 },
  { id: "wire", title: "On the wire", caption: "A request may be in the air.", statuses: ["IN_FLIGHT"], tone: "IN_FLIGHT", cap: 18 },
  { id: "checking", title: "Checking the ledger", caption: "Unclear answer: look before resending.", statuses: ["VERIFYING"], tone: "VERIFYING", cap: 18 },
  { id: "settled", title: "Settled", caption: "The provider gave a definite answer.", statuses: ["SUCCEEDED", "FAILED"], tone: "SUCCEEDED", cap: 16 },
  { id: "human", title: "Needs a human", caption: "Stopped instead of guessing.", statuses: ["UNKNOWN"], tone: "UNKNOWN", cap: 18 },
];

/** Which column an action belongs in. Exported for tests. */
export function columnOf(status: Status): string {
  return COLUMNS.find((c) => c.statuses.includes(status))!.id;
}

export function Wire({ actions }: { actions: Action[] }) {
  const byColumn = new Map(COLUMNS.map((c) => [c.id, [] as Action[]]));
  const sorted = [...actions].sort((a, b) => b.updated_at - a.updated_at);
  for (const a of sorted) byColumn.get(columnOf(a.status))!.push(a);

  return (
    <LayoutGroup id="wire">
      <div className="grid grid-cols-2 gap-x-6 gap-y-12 sm:grid-cols-3 lg:grid-cols-5">
        {COLUMNS.map((col, i) => {
          const items = byColumn.get(col.id)!;
          const shown = items.slice(0, col.cap);
          const meta = STATUS_META[col.tone];
          const last = i === COLUMNS.length - 1;
          return (
            <section key={col.id} aria-labelledby={`wire-${col.id}`} className="relative flex min-w-0 flex-col">
              <header className="lg:min-h-[164px]">
                <NumberRoll value={items.length} className={cn("t-display block text-[clamp(3rem,5vw,4.5rem)] leading-[0.9]", items.length === 0 && "text-ink-3")} />
                <h3 id={`wire-${col.id}`} className="mt-3 text-[15.5px] font-semibold">{col.title}</h3>
                <p className="mt-0.5 text-[13.5px] leading-snug text-ink-2">{col.caption}</p>
              </header>

              {/* the rail */}
              <div aria-hidden className={cn("relative my-5 h-3", !last && "lg:-mr-6")}>
                <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-ink" />
                <span className={cn("absolute top-1/2 left-0 size-3 -translate-y-1/2 rounded-full border-[1.5px] border-ink bg-paper", items.length > 0 && meta.dot)} />
                {!last && <span className="absolute top-1/2 right-0 hidden h-0 w-0 -translate-y-1/2 border-y-[4px] border-l-[7px] border-y-transparent border-l-ink lg:block" />}
              </div>

              {items.length === 0 && <p className="font-serif text-[17px] text-ink-3 italic">Nothing here</p>}
              <ul className="flex flex-wrap content-start gap-1.5" aria-live="polite">
                <AnimatePresence initial={false} mode="popLayout">
                  {shown.map((a) => (
                    <Token key={a.id} action={a} />
                  ))}
                </AnimatePresence>
              </ul>
              {items.length > shown.length && (
                <Link to={`/?status=${col.statuses[0]}#actions`} className="ink-link mt-3 self-start text-[13.5px] text-ink-2">
                  and {items.length - shown.length} more
                </Link>
              )}
            </section>
          );
        })}
      </div>
    </LayoutGroup>
  );
}

const MotionLink = motion.create(Link);

function Token({ action }: { action: Action }) {
  const meta = STATUS_META[action.status];
  return (
    <motion.li layout="position" layoutId={`token-${action.id}`} transition={SPRING} initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.94 }}>
      <MotionLink
        to={`/actions/${action.id}`}
        title={`${action.id} · ${action.type} · ${action.status}`}
        whileTap={{ scale: 0.96 }}
        className={cn("flex h-7 items-center gap-1.5 rounded-[2px] px-2 font-mono text-[12px]", meta.badge)}
        translate="no"
      >
        {action.status === "IN_FLIGHT" ? <span aria-hidden className={cn("os-pulse size-1.5 rounded-full", meta.dot)} /> : <span aria-hidden className={cn("size-1.5 rounded-full", meta.dot)} />}
        {action.id.slice(-6)}
        <span className="sr-only">{action.status}</span>
      </MotionLink>
    </motion.li>
  );
}
