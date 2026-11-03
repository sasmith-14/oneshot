import { Link } from "react-router";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { Check, ChevronRight, CreditCard, MessageSquare, X } from "lucide-react";
import type { Action, Status } from "@/lib/api";
import { NumberRoll } from "@/components/NumberRoll";
import { STATUS_META } from "@/lib/status";
import { SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";

// The signature view: each action is a token that glides to a new column when
// the backend changes its status. Positions come only from polled real data.

interface Column {
  id: string;
  title: string;
  caption: string;
  statuses: Status[];
  tone: Status;
  cap: number;
}

export const COLUMNS: Column[] = [
  { id: "accepted", title: "Accepted", caption: "Saved to disk, waiting for a worker", statuses: ["PENDING"], tone: "PENDING", cap: 18 },
  { id: "wire", title: "On the wire", caption: "A request may be in the air", statuses: ["IN_FLIGHT"], tone: "IN_FLIGHT", cap: 18 },
  { id: "checking", title: "Checking the ledger", caption: "Unclear outcome, so look before resending", statuses: ["VERIFYING"], tone: "VERIFYING", cap: 18 },
  { id: "settled", title: "Settled", caption: "The provider gave a definite answer", statuses: ["SUCCEEDED", "FAILED"], tone: "SUCCEEDED", cap: 16 },
  { id: "human", title: "Needs a human", caption: "Unknown: stopped instead of guessing", statuses: ["UNKNOWN"], tone: "UNKNOWN", cap: 18 },
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
      <div className="relative overflow-hidden rounded-[14px] border bg-card">
        <div className="grid grid-cols-2 divide-y sm:grid-cols-3 lg:grid-cols-5 lg:divide-x lg:divide-y-0">
          {COLUMNS.map((col, i) => {
            const items = byColumn.get(col.id)!;
            const shown = items.slice(0, col.cap);
            const meta = STATUS_META[col.tone];
            return (
              <section key={col.id} aria-labelledby={`wire-${col.id}`} className="relative flex min-h-[220px] flex-col p-4">
                <header className="mb-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 id={`wire-${col.id}`} className="flex items-center gap-2 text-[13px] font-medium">
                      <span className={cn("size-2 rounded-full", meta.dot)} />
                      {col.title}
                    </h3>
                    <NumberRoll value={items.length} className="text-xl font-semibold" />
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{col.caption}</p>
                </header>
                {items.length === 0 && (
                  <p className="grid flex-1 place-items-center rounded-xl border border-dashed text-xs text-muted-foreground/70">Nothing here</p>
                )}
                <ul className="flex flex-wrap content-start gap-1.5" aria-live="polite">
                  <AnimatePresence initial={false} mode="popLayout">
                    {shown.map((a) => (
                      <Token key={a.id} action={a} />
                    ))}
                  </AnimatePresence>
                </ul>
                {items.length > shown.length && (
                  <Link to={`/?status=${col.statuses[0]}#actions`} className="mt-2 text-xs text-muted-foreground underline-offset-2 hover:underline">
                    {items.length - shown.length} more
                  </Link>
                )}
                {i < COLUMNS.length - 1 && (
                  <ChevronRight aria-hidden className="absolute top-1/2 -right-2 z-10 hidden size-4 -translate-y-1/2 rounded-full border bg-card text-muted-foreground lg:block" />
                )}
              </section>
            );
          })}
        </div>
      </div>
    </LayoutGroup>
  );
}

const MotionLink = motion.create(Link);

function Token({ action }: { action: Action }) {
  const meta = STATUS_META[action.status];
  const Icon = action.type === "message.send" ? MessageSquare : CreditCard;
  return (
    <motion.li layout="position" layoutId={`token-${action.id}`} transition={SPRING} initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.92 }}>
      <MotionLink
        to={`/actions/${action.id}`}
        title={`${action.id} · ${action.type} · ${action.status}`}
        whileHover={{ y: -1 }}
        whileTap={{ scale: 0.97 }}
        className={cn("flex items-center gap-1.5 rounded-full border py-1 pr-2.5 pl-2 font-mono text-[11px] shadow-[0_1px_0_rgba(0,0,0,0.03)]", meta.badge)}
        translate="no"
      >
        <Icon aria-hidden className="size-3 opacity-70" />
        {action.id.slice(-6)}
        {action.status === "SUCCEEDED" && <Check aria-label="succeeded" className="size-3" />}
        {action.status === "FAILED" && <X aria-label="failed" className="size-3" />}
        {action.status === "IN_FLIGHT" && <span aria-hidden className={cn("os-pulse size-1.5 rounded-full", meta.dot)} />}
      </MotionLink>
    </motion.li>
  );
}
