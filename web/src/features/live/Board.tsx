import { useMemo } from "react";
import { Link, useSearchParams } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Search } from "lucide-react";
import type { Action, Status, SystemStatus } from "@/lib/api";
import { STATUSES } from "@/lib/api";
import { STATUS_META } from "@/lib/status";
import { StatusPill } from "@/components/StatusPill";
import { NumberRoll } from "@/components/NumberRoll";
import { noun } from "@/lib/headline";
import { ago } from "@/lib/time";
import { EASE_OUT, RULE_SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";

// ------------------------------------------------------------ status strip

/** Status → the suffix of its colour tokens (--st-<suffix>, -soft, -fg). */
const VAR: Record<Status, string> = { PENDING: "pending", IN_FLIGHT: "inflight", VERIFYING: "verifying", SUCCEEDED: "succeeded", FAILED: "failed", UNKNOWN: "unknown" };
/** Written out in full so Tailwind finds the class names. */
const FG: Record<Status, string> = { PENDING: "text-st-pending-fg", IN_FLIGHT: "text-st-inflight-fg", VERIFYING: "text-st-verifying-fg", SUCCEEDED: "text-st-succeeded-fg", FAILED: "text-st-failed-fg", UNKNOWN: "text-st-unknown-fg" };

/** Six counts in one strip. Each cell filters the action list below. */
export function StatusStrip({ status }: { status?: SystemStatus }) {
  const [params] = useSearchParams();
  const active = params.get("status");
  const total = status ? Object.values(status.counts).reduce((a, b) => a + (b ?? 0), 0) : 0;
  return (
    <nav aria-label="Actions by status" className="panel grid grid-cols-2 overflow-hidden sm:grid-cols-3 lg:grid-cols-6">
      {STATUSES.map((s, i) => {
        const n = status?.counts[s] ?? 0;
        const on = active === s;
        return (
          <Link
            key={s}
            to={on ? "/#actions" : `/?status=${s}#actions`}
            aria-current={on || undefined}
            className={cn(
              "group relative flex flex-col gap-3 px-4 py-3.5 transition-colors duration-150 hover:bg-sunken",
              i > 0 && "border-line lg:border-l",
              i % 2 === 1 && "border-l sm:border-l-0",
              i % 3 !== 0 && "sm:border-l",
              i >= 2 && "border-t sm:border-t-0",
              i >= 3 && "sm:border-t lg:border-t-0",
            )}
          >
            {n > 0 && <span aria-hidden className="pointer-events-none absolute inset-0 opacity-80" style={{ background: `linear-gradient(180deg, var(--st-${VAR[s]}-soft), transparent 85%)` }} />}
            {on && <motion.span layoutId="strip-on" aria-hidden className="absolute inset-x-0 top-0 h-0.5 bg-signal" transition={RULE_SPRING} />}
            <span className="relative flex items-center gap-2 text-[12.5px] text-fg-2">
              <span className={cn("size-1.5 rounded-full", STATUS_META[s].dot)} />
              {STATUS_META[s].label}
            </span>
            <NumberRoll value={n} className={cn("t-figure relative text-[26px]", n === 0 ? "text-fg-3" : FG[s])} />
            <span aria-hidden className="relative h-1 overflow-hidden rounded-full bg-sunken">
              <motion.span className={cn("block h-full origin-left rounded-full", STATUS_META[s].dot)} initial={false} animate={{ scaleX: total ? n / total : 0 }} transition={{ duration: 0.6, ease: EASE_OUT }} />
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

// ------------------------------------------------------------- needs you

export function NeedsYou({ actions }: { actions: Action[] }) {
  const unknown = actions.filter((a) => a.status === "UNKNOWN").slice(0, 5);
  if (!unknown.length)
    return (
      <div className="flex items-start gap-3">
        <span className="mt-1 size-2 shrink-0 rounded-full bg-st-succeeded" />
        <p className="text-[13.5px] text-fg-2">Nothing needs a person. Every action either has a definite answer or is still being worked on.</p>
      </div>
    );
  return (
    <ul className="-my-1">
      {unknown.map((a) => (
        <li key={a.id}>
          <Link to={`/actions/${a.id}`} className="group flex items-center gap-3 rounded-[8px] px-2 py-2 transition-colors duration-150 hover:bg-sunken">
            <span className="size-1.5 shrink-0 rounded-full bg-st-unknown" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-mono text-[12.5px]" translate="no">{a.id}</span>
              <span className="block truncate text-[12px] text-fg-3">{noun(a.type)}, {a.last_error ?? "outcome unknown"}</span>
            </span>
            <ArrowRight aria-hidden className="size-3.5 text-fg-3 transition-transform duration-150 group-hover:translate-x-0.5" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

// --------------------------------------------------------------- activity

const BUCKET = 10;
const BUCKETS = 30;

export function Activity({ actions, now }: { actions: Action[]; now: number }) {
  const start = now - BUCKET * BUCKETS;
  const buckets: Partial<Record<Status, number>>[] = Array.from({ length: BUCKETS }, () => ({}));
  for (const a of actions) {
    if (a.created_at < start) continue;
    const i = Math.min(BUCKETS - 1, Math.floor((a.created_at - start) / BUCKET));
    buckets[i][a.status] = (buckets[i][a.status] ?? 0) + 1;
  }
  const total = (b: Partial<Record<Status, number>>) => Object.values(b).reduce((x, y) => x + (y ?? 0), 0);
  const sum = buckets.reduce((n, b) => n + total(b), 0);
  const top = Math.max(4, ...buckets.map(total));
  return (
    <figure>
      <p className="mb-4 flex items-baseline gap-2">
        <NumberRoll value={sum} className="t-figure text-[28px]" />
        <span className="text-[12.5px] text-fg-2">submitted in the last 5 minutes</span>
      </p>
      <div className="relative h-24">
        <div aria-hidden className="absolute inset-x-0 top-0 border-t border-dashed border-line" />
        <div aria-hidden className="absolute inset-x-0 top-1/2 border-t border-dashed border-line" />
        <div className="absolute inset-0 flex items-end gap-[3px]" role="img" aria-label={`Submissions in the last five minutes: ${sum}, in ten-second buckets, coloured by current status`}>
          {buckets.map((b, i) => (
            <div key={i} className="flex h-full flex-1 flex-col-reverse gap-px" title={`${total(b)} submitted ${Math.round((BUCKETS - i) * BUCKET)}s ago`}>
              {STATUSES.map((s) =>
                b[s] ? <motion.div key={s} className={cn("w-full rounded-[2px]", STATUS_META[s].dot)} initial={false} animate={{ height: `${(b[s]! / top) * 100}%` }} transition={{ duration: 0.45, ease: EASE_OUT }} /> : null,
              )}
              {total(b) === 0 && <div className="h-[2px] w-full rounded-full bg-line" />}
            </div>
          ))}
        </div>
      </div>
      <figcaption className="mt-2 flex justify-between text-[11.5px] text-fg-3">
        <span>5 min ago</span>
        <span>now</span>
      </figcaption>
    </figure>
  );
}

// ------------------------------------------------------------------ list

export function ActionList({ actions }: { actions: Action[] }) {
  const [params, setParams] = useSearchParams();
  const raw = params.get("status");
  const filter = raw && (STATUSES as readonly string[]).includes(raw) ? (raw as Status) : null;
  const q = params.get("q") ?? "";
  const counts = useMemo(() => {
    const c: Partial<Record<Status, number>> = {};
    for (const a of actions) c[a.status] = (c[a.status] ?? 0) + 1;
    return c;
  }, [actions]);
  const shown = actions
    .filter((a) => (!filter || a.status === filter) && (!q || a.id.includes(q) || a.type.includes(q) || (a.last_error ?? "").toLowerCase().includes(q.toLowerCase())))
    .slice(0, 200);

  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true, preventScrollReset: true });
  };

  return (
    <section id="actions" aria-labelledby="actions-title" className="panel min-w-0 overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-[18px] py-3">
        <h2 id="actions-title" className="t-h3 mr-auto">Actions</h2>
        <div role="radiogroup" aria-label="Filter by status" className="no-scrollbar flex gap-0.5 overflow-x-auto rounded-[9px] border border-line bg-sunken p-0.5">
          <FilterTab active={!filter} onClick={() => set("status", null)} label="All" count={actions.length} />
          {STATUSES.map((s) => (
            <FilterTab key={s} active={filter === s} onClick={() => set("status", filter === s ? null : s)} label={STATUS_META[s].label} count={counts[s] ?? 0} dot={STATUS_META[s].dot} />
          ))}
        </div>
        <label className="relative">
          <span className="sr-only">Search actions</span>
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-3" />
          <input name="q" autoComplete="off" spellCheck={false} defaultValue={q} onChange={(e) => set("q", e.target.value || null)} placeholder="Search id, type, error" className="field h-8 w-52 pl-8 text-[13px] placeholder:text-fg-3" />
        </label>
      </div>

      {actions.length === 0 ? (
        <Empty />
      ) : (
        <div className="max-h-[560px] overflow-auto" data-lenis-prevent>
          <table className="w-full min-w-[720px] text-[13px]">
            <thead className="sticky top-0 z-10 bg-surface">
              <tr className="border-b border-line text-left text-[12px] text-fg-3">
                <th className="py-2.5 pr-4 pl-[18px] font-[500]">Action</th>
                <th className="py-2.5 pr-4 font-[500]">Type</th>
                <th className="py-2.5 pr-4 font-[500]">Status</th>
                <th className="py-2.5 pr-4 text-right font-[500]">Sends</th>
                <th className="py-2.5 pr-4 text-right font-[500]">Checks</th>
                <th className="hidden py-2.5 pr-4 font-[500] xl:table-cell">Latest problem</th>
                <th className="py-2.5 pr-[18px] text-right font-[500]">Created</th>
              </tr>
            </thead>
            <tbody>
              <AnimatePresence initial={false}>
                {shown.map((a) => (
                  <motion.tr key={a.id} layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.35, ease: EASE_OUT }} className="border-b border-line transition-colors duration-150 last:border-0 hover:bg-sunken">
                    <td className="py-2.5 pr-4 pl-[18px]">
                      <Link to={`/actions/${a.id}`} className="link-quiet font-mono text-[12.5px] font-[520]" translate="no">{a.id}</Link>
                    </td>
                    <td className="py-2.5 pr-4 text-fg-2">{noun(a.type)}</td>
                    <td className="py-2.5 pr-4"><StatusPill status={a.status} /></td>
                    <td className="py-2.5 pr-4 text-right tnum">{a.attempt_count}</td>
                    <td className="py-2.5 pr-4 text-right tnum">{a.verify_count}</td>
                    <td className="hidden max-w-[18rem] truncate py-2.5 pr-4 text-[12.5px] text-fg-2 xl:table-cell" title={a.last_error ?? undefined}>{a.last_error ?? <span className="text-fg-3">–</span>}</td>
                    <td className="py-2.5 pr-[18px] text-right text-[12.5px] whitespace-nowrap text-fg-2 tnum">{ago(a.created_at)}</td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
          {shown.length === 0 && <p className="px-[18px] py-10 text-center text-[13px] text-fg-3">No actions match this filter.</p>}
        </div>
      )}
    </section>
  );
}

function FilterTab({ active, onClick, label, count, dot }: { active: boolean; onClick: () => void; label: string; count: number; dot?: string }) {
  return (
    <button type="button" role="radio" aria-checked={active} onClick={onClick} className={cn("relative flex h-7 items-center gap-1.5 rounded-[7px] px-2.5 text-[12.5px] whitespace-nowrap transition-colors duration-150", active ? "font-[560] text-fg" : "text-fg-2 hover:text-fg")}>
      {active && <motion.span layoutId="filter-pill" aria-hidden className="absolute inset-0 rounded-[7px] border border-line bg-surface shadow-[var(--shadow-card)]" transition={RULE_SPRING} />}
      {dot && <span className={cn("relative size-1.5 rounded-full", dot)} />}
      <span className="relative">{label}</span>
      <span className="relative text-fg-3 tnum">{count}</span>
    </button>
  );
}

function Empty() {
  return (
    <div className="grid gap-6 p-6 lg:grid-cols-2 lg:items-center">
      <div>
        <p className="t-h2">Nothing has been asked for yet</p>
        <p className="mt-1.5 text-[13.5px] text-fg-2">Run a failure preset, or submit an action from a terminal. It appears on the system map above the moment a worker picks it up.</p>
        <Link to="/chaos" className="btn btn-signal mt-4">Open Chaos <ArrowRight aria-hidden className="size-3.5" /></Link>
      </div>
      <pre className="well overflow-x-auto p-4 font-mono text-[12px] leading-relaxed text-fg-2" data-lenis-prevent>
{`curl -X POST localhost:8700/actions \\
  -H 'Idempotency-Key: order-1' \\
  -H 'Content-Type: application/json' \\
  -d '{"type": "payment.charge",
       "payload": {"amount_cents": 1500, "customer": "cus_1"}}'`}
      </pre>
    </div>
  );
}
