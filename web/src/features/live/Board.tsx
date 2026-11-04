import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Search } from "lucide-react";
import type { Action, Status, SystemStatus } from "@/lib/api";
import { STATUSES } from "@/lib/api";
import { STATUS_META } from "@/lib/status";
import { StatusPill } from "@/components/StatusPill";
import { SetHeadline } from "@/components/SetHeadline";
import { NumberRoll } from "@/components/NumberRoll";
import { frontPage, noun, reportLine } from "@/lib/headline";
import { ago } from "@/lib/time";
import { EASE_OUT, RULE_SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";

// ------------------------------------------------------------------ the lead

export function Lead({ status, apiDown }: { status?: SystemStatus; apiDown: boolean }) {
  const fp = frontPage(status, apiDown);
  return (
    <div className="min-w-0">
      <SetHeadline
        key={fp.headline}
        as="h2"
        text={fp.headline}
        className="t-display text-[clamp(3rem,6.6vw,6.25rem)]"
      />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={fp.standfirst} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3, ease: EASE_OUT, delay: 0.15 }}>
          {fp.standfirst && <p className="t-stand mt-6 text-[1.3125rem] text-ink">{fp.standfirst}</p>}
          {fp.links.length > 0 && (
            <p className="mt-7 flex flex-wrap gap-2">
              {fp.links.map((l, i) => (
                <Link key={l.to} to={l.to} className={cn("btn", i === 0 ? "btn-ink" : "btn-line")}>
                  {l.label}
                  {i === 0 && <ArrowRight aria-hidden className="size-4" />}
                </Link>
              ))}
            </p>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

// ------------------------------------------------------ the state of things

export function StateOfThings({ status }: { status?: SystemStatus }) {
  const worker = status?.workers.find((w) => w.state === "alive") ?? status?.workers[0];
  const s = status?.settings;
  return (
    <aside aria-label="The state of things" className="min-w-0">
      <table className="w-full text-[15px]">
        <caption className="sr-only">Actions by status</caption>
        <tbody>
          {STATUSES.map((st) => {
            const n = status?.counts[st] ?? 0;
            return (
              <tr key={st} className="border-b border-rule">
                <th scope="row" className="py-2 text-left font-normal">
                  <Link to={`/?status=${st}#actions`} className="group inline-flex items-center gap-2.5">
                    <span className={cn("size-2 rounded-full", STATUS_META[st].dot)} />
                    <span className="ink-link">{STATUS_META[st].label}</span>
                  </Link>
                </th>
                <td className={cn("py-1.5 text-right font-serif text-[26px] leading-none", n === 0 && "text-ink-2", st === "UNKNOWN" && n > 0 && "text-st-unknown-fg")}>
                  <NumberRoll value={n} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <dl className="mt-6 grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-2 text-[14px]">
        <Fact label="Provider" ok={status?.provider.reachable}>
          {!status ? "…" : status.provider.reachable ? "reachable" : "not answering"}
        </Fact>
        <Fact label="Worker" ok={worker?.state === "alive"} title="Workers write a heartbeat every 2 s. Display only: leases, not heartbeats, decide who may write an action.">
          {!status ? "…" : !worker ? "none has run yet" : worker.state === "alive" ? <><span className="font-mono text-[13px]">{worker.id}</span>, heard from {worker.seconds_since_seen}s ago</> : worker.state === "stopped" ? "stopped cleanly" : `silent for ${worker.seconds_since_seen}s`}
        </Fact>
        <Fact label="Lab" ok={status?.lab ? true : undefined} title="Fault injection and process control exist only when ONESHOT_LAB=1">
          {status ? (status.lab ? "on: failures can be injected" : "off") : "…"}
        </Fact>
        {s && (
          <Fact label="Timing">
            <span>timeout {s.provider_timeout_seconds}s, lease {s.lease_seconds}s, settle {s.provider_settle_seconds}s</span>
          </Fact>
        )}
      </dl>
    </aside>
  );
}

function Fact({ label, ok, title, children }: { label: string; ok?: boolean; title?: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-ink-2" title={title}>{label}</dt>
      <dd className="flex min-w-0 items-baseline gap-2">
        {ok !== undefined && <span aria-hidden className={cn("size-1.5 shrink-0 translate-y-[-2px] rounded-full", ok ? "bg-st-succeeded" : "bg-mark")} />}
        <span className="min-w-0">{children}</span>
      </dd>
    </>
  );
}

// ---------------------------------------------------------- the wire report

interface Report {
  key: string;
  at: number;
  id: string;
  type: string;
  from: Status | null;
  to: Status;
  attempts: number;
}

/** Status changes as they are seen. It starts from each action's latest known
 * status (by updated_at), then adds a line for every change between polls. */
function useWireReport(actions: Action[] | undefined) {
  const seen = useRef<Map<string, Status> | null>(null);
  const [lines, setLines] = useState<Report[]>([]);
  useEffect(() => {
    if (!actions) return;
    if (seen.current === null) {
      seen.current = new Map(actions.map((a) => [a.id, a.status]));
      setLines(
        [...actions]
          .sort((a, b) => b.updated_at - a.updated_at)
          .slice(0, 9)
          .map((a) => ({ key: `${a.id}-${a.status}-${a.updated_at}`, at: a.updated_at, id: a.id, type: a.type, from: null, to: a.status, attempts: a.attempt_count })),
      );
      return;
    }
    const fresh: Report[] = [];
    for (const a of actions) {
      const before = seen.current.get(a.id);
      if (before !== a.status) {
        fresh.push({ key: `${a.id}-${a.status}-${a.updated_at}`, at: a.updated_at, id: a.id, type: a.type, from: before ?? null, to: a.status, attempts: a.attempt_count });
        seen.current.set(a.id, a.status);
      }
    }
    if (fresh.length) setLines((ls) => [...fresh.sort((a, b) => b.at - a.at), ...ls].slice(0, 9));
  }, [actions]);
  return lines;
}

const time = (s: number) => new Date(s * 1000).toLocaleTimeString("en-GB", { hour12: false });

export function WireReport({ actions }: { actions: Action[] | undefined }) {
  const lines = useWireReport(actions);
  if (!lines.length) return <p className="font-serif text-[19px] text-ink-3 italic">Nothing has happened yet.</p>;
  return (
    <ol aria-live="polite" className="border-t-2 border-ink">
      <AnimatePresence initial={false}>
        {lines.map((l) => (
          <motion.li
            key={l.key}
            layout="position"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease: EASE_OUT }}
            className="grid grid-cols-[4.75rem_minmax(0,1fr)] gap-x-4 border-b border-rule py-3 text-[15.5px] leading-snug"
          >
            <time className="pt-[3px] font-mono text-[12.5px] text-ink-2 tnum">{time(l.at)}</time>
            <p>
              <span className="mr-1.5 inline-block translate-y-[-1px] align-middle"><span className={cn("inline-block size-1.5 rounded-full", STATUS_META[l.to].dot)} /></span>
              {noun(l.type).replace(/^./, (c) => c.toUpperCase())}{" "}
              <Link to={`/actions/${l.id}`} className="ink-link font-mono text-[13.5px]" translate="no">{l.id}</Link>{" "}
              {reportLine(l.to, l.from, l.attempts)}
            </p>
          </motion.li>
        ))}
      </AnimatePresence>
    </ol>
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
  const max = Math.max(4, ...buckets.map(total));
  const top = Math.ceil(max / 2) * 2;
  return (
    <figure>
      <p className="mb-5 flex items-baseline gap-3">
        <NumberRoll value={sum} className="t-display text-[64px] leading-none" />
        <span className="text-[15px] text-ink-2">{sum === 1 ? "action" : "actions"} submitted in the last five minutes</span>
      </p>
      <div className="relative h-40">
        {[0.5, 1].map((f) => (
          <div key={f} aria-hidden className="absolute inset-x-0 border-t border-dashed border-rule" style={{ bottom: `${f * 100}%` }}>
            <span className="absolute -top-2.5 right-0 bg-paper pl-1 text-[11.5px] text-ink-3 tnum">{Math.round(top * f)}</span>
          </div>
        ))}
        <div className="absolute inset-0 flex items-end gap-[3px] pr-6" role="img" aria-label={`Submissions in the last five minutes: ${sum}, in ten-second buckets, coloured by current status`}>
          {buckets.map((b, i) => (
            <div key={i} className="flex h-full flex-1 flex-col-reverse" title={`${total(b)} submitted ${Math.round((BUCKETS - i) * BUCKET)}s ago`}>
              {STATUSES.map((s) =>
                b[s] ? (
                  <motion.div key={s} className={cn("w-full", STATUS_META[s].dot)} initial={false} animate={{ height: `${(b[s]! / top) * 100}%` }} transition={{ duration: 0.45, ease: EASE_OUT }} />
                ) : null,
              )}
            </div>
          ))}
        </div>
        <div aria-hidden className="absolute inset-x-0 bottom-0 h-[2px] bg-ink" />
      </div>
      <figcaption className="mt-2.5 flex justify-between text-[12.5px] text-ink-2">
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

  if (actions.length === 0) return <Empty />;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div role="radiogroup" aria-label="Filter by status" className="flex flex-wrap gap-x-5 gap-y-1">
          <FilterTab active={!filter} onClick={() => set("status", null)} label="All" count={actions.length} />
          {STATUSES.map((s) => (
            <FilterTab key={s} active={filter === s} onClick={() => set("status", filter === s ? null : s)} label={STATUS_META[s].label} count={counts[s] ?? 0} dot={STATUS_META[s].dot} />
          ))}
        </div>
        <label className="relative">
          <span className="sr-only">Search actions</span>
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-2" />
          <input
            name="q"
            autoComplete="off"
            spellCheck={false}
            defaultValue={q}
            onChange={(e) => set("q", e.target.value || null)}
            placeholder="Search id, type or error…"
            className="field w-72 pl-9 text-[14.5px] placeholder:text-ink-3"
          />
        </label>
      </div>

      <div className="overflow-x-auto" data-lenis-prevent-horizontal>
        <table className="w-full min-w-[720px] text-[14.5px]">
          <thead>
            <tr className="border-t-2 border-b border-ink text-left text-[13px] text-ink-2">
              <th className="py-3 pr-4 font-normal">Action</th>
              <th className="py-3 pr-4 font-normal">Type</th>
              <th className="py-3 pr-4 font-normal">Status</th>
              <th className="py-3 pr-4 text-right font-normal">Sends</th>
              <th className="py-3 pr-4 text-right font-normal">Ledger checks</th>
              <th className="hidden py-3 pr-4 font-normal lg:table-cell">Latest problem</th>
              <th className="py-3 text-right font-normal">Created</th>
            </tr>
          </thead>
          <tbody>
            <AnimatePresence initial={false}>
              {shown.map((a) => (
                <motion.tr
                  key={a.id}
                  layout="position"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.4, ease: EASE_OUT }}
                  className="border-b border-rule transition-colors duration-150 hover:bg-sheet"
                >
                  <td className="py-3 pr-4">
                    <Link to={`/actions/${a.id}`} className="ink-link font-mono text-[13.5px] font-medium" translate="no">
                      {a.id}
                    </Link>
                  </td>
                  <td className="py-3 pr-4 text-ink-2">{noun(a.type)}</td>
                  <td className="py-3 pr-4"><StatusPill status={a.status} /></td>
                  <td className="py-3 pr-4 text-right tnum">{a.attempt_count}</td>
                  <td className="py-3 pr-4 text-right tnum">{a.verify_count}</td>
                  <td className="hidden max-w-[22rem] truncate py-3 pr-4 text-[13.5px] text-ink-2 lg:table-cell" title={a.last_error ?? undefined}>{a.last_error ?? <span className="text-ink-3">–</span>}</td>
                  <td className="py-3 text-right text-[13.5px] whitespace-nowrap text-ink-2 tnum">{ago(a.created_at)}</td>
                </motion.tr>
              ))}
            </AnimatePresence>
          </tbody>
        </table>
        {shown.length === 0 && <p className="py-12 font-serif text-[19px] text-ink-3 italic">No actions match this filter.</p>}
        {actions.length > 200 && shown.length === 200 && <p className="pt-4 text-[13.5px] text-ink-2">Showing the newest 200. Filter or search to find older ones.</p>}
      </div>
    </div>
  );
}

function FilterTab({ active, onClick, label, count, dot }: { active: boolean; onClick: () => void; label: string; count: number; dot?: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn("relative flex h-10 items-center gap-2 text-[15px] transition-colors duration-150", active ? "text-ink" : "text-ink-2 hover:text-ink")}
    >
      {dot && <span className={cn("size-1.5 rounded-full", dot)} />}
      <span className={cn(active && "font-medium")}>{label}</span>
      <span className="text-ink-3 tnum">{count}</span>
      {active && <motion.span layoutId="filter-mark" aria-hidden className="absolute inset-x-0 bottom-0 h-[2px] bg-mark" transition={RULE_SPRING} />}
    </button>
  );
}

function Empty() {
  return (
    <div className="grid gap-10 border-t-2 border-ink pt-10 lg:grid-cols-12">
      <div className="lg:col-span-5">
        <p className="t-title text-[40px]">Nothing on the wire yet.</p>
        <p className="mt-3 text-[16px] text-ink-2">Run a failure preset on Chaos, or submit an action from a terminal. Tokens start moving across the wire above as soon as a worker picks it up.</p>
        <Link to="/chaos" className="btn btn-ink mt-6">Open Chaos <ArrowRight aria-hidden className="size-4" /></Link>
      </div>
      <pre className="overflow-x-auto bg-sheet p-5 font-mono text-[13px] leading-relaxed lg:col-span-7" data-lenis-prevent>
{`curl -X POST localhost:8700/actions \\
  -H 'Idempotency-Key: order-1' \\
  -H 'Content-Type: application/json' \\
  -d '{"type": "payment.charge",
       "payload": {"amount_cents": 1500, "customer": "cus_1"}}'`}
      </pre>
    </div>
  );
}
