import { useMemo } from "react";
import { Link, useSearchParams } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, CircleHelp, Cpu, FlaskConical, Search, Server } from "lucide-react";
import type { Action, Status, SystemStatus } from "@/lib/api";
import { STATUSES } from "@/lib/api";
import { STATUS_META } from "@/lib/status";
import { StatusPill } from "@/components/StatusPill";
import { ago } from "@/lib/time";
import { EASE_OUT } from "@/lib/motion";
import { cn } from "@/lib/utils";

// ------------------------------------------------------------------ health

export function HealthBar({ status }: { status?: SystemStatus }) {
  const worker = status?.workers.find((w) => w.state === "alive") ?? status?.workers[0];
  const s = status?.settings;
  return (
    <dl className="flex flex-wrap items-center gap-x-7 gap-y-2 text-[13px]">
      <Health icon={Server} ok={status?.provider.reachable} label="Provider" value={!status ? "…" : status.provider.reachable ? "reachable" : `unreachable (${status.provider.error})`} />
      <Health
        icon={Cpu}
        ok={worker?.state === "alive"}
        label="Worker"
        value={!status ? "…" : !worker ? "none has run yet" : worker.state === "alive" ? `${worker.id}, last heartbeat ${worker.seconds_since_seen}s ago` : worker.state === "stopped" ? `${worker.id} stopped cleanly` : `${worker.id} silent for ${worker.seconds_since_seen}s`}
        title="Workers write a heartbeat every 2 s. This is for display only: leases, not heartbeats, decide who may write an action."
      />
      <Health icon={FlaskConical} ok={status?.lab ? true : undefined} label="Lab" value={status ? (status.lab ? "on" : "off") : "…"} title="Fault injection and process control exist only when ONESHOT_LAB=1" />
      {s && (
        <span className="text-xs text-muted-foreground lg:ml-auto" title="Timing settings that affect safety">
          Timeout <b className="font-medium text-foreground tabular-nums">{s.provider_timeout_seconds}s</b>, lease <b className="font-medium text-foreground tabular-nums">{s.lease_seconds}s</b>, settle window <b className="font-medium text-foreground tabular-nums">{s.provider_settle_seconds}s</b>
        </span>
      )}
    </dl>
  );
}

function Health({ icon: Icon, ok, label, value, title }: { icon: typeof Server; ok?: boolean; label: string; value: string; title?: string }) {
  return (
    <div className="flex items-center gap-2" title={title}>
      <Icon aria-hidden className="size-4 text-muted-foreground" />
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex items-center gap-1.5">
        <span className={cn("size-1.5 rounded-full", ok === undefined ? "bg-muted-foreground/40" : ok ? "bg-st-succeeded" : "bg-st-failed")} />
        {value}
      </dd>
    </div>
  );
}

// --------------------------------------------------------------- attention

export function Attention({ status }: { status?: SystemStatus }) {
  if (!status) return null;
  const unknown = status.counts.UNKNOWN ?? 0;
  const waiting = (status.counts.PENDING ?? 0) + (status.counts.VERIFYING ?? 0) + (status.counts.IN_FLIGHT ?? 0);
  const alive = status.workers.some((w) => w.state === "alive");
  return (
    <AnimatePresence initial={false}>
      {unknown > 0 && (
        <Banner key="unknown" tone="unknown" icon={CircleHelp}>
          <b className="font-medium">
            {unknown} action{unknown > 1 ? "s are" : " is"} UNKNOWN.
          </b>{" "}
          OneShot could not tell whether the effect happened, so it stopped instead of guessing.{" "}
          <Link to="/?status=UNKNOWN#actions" className="underline underline-offset-2">Show them</Link> or{" "}
          <Link to="/reconcile" className="underline underline-offset-2">reconcile with the provider</Link>.
        </Banner>
      )}
      {!alive && waiting > 0 && (
        <Banner key="worker" tone="verifying" icon={AlertTriangle}>
          <b className="font-medium">No live worker.</b> {waiting} unfinished action{waiting > 1 ? "s are" : " is"} safe on disk and will continue when a worker starts
          {status.lab ? (
            <>
              {" "}(<Link to="/chaos#processes" className="underline underline-offset-2">start one on Chaos</Link>).
            </>
          ) : (
            <> (<code className="font-mono text-xs">uv run oneshot worker</code>).</>
          )}
        </Banner>
      )}
    </AnimatePresence>
  );
}

function Banner({ tone, icon: Icon, children }: { tone: "unknown" | "verifying"; icon: typeof CircleHelp; children: React.ReactNode }) {
  return (
    <motion.div
      role="status"
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.24, ease: EASE_OUT }}
      className="overflow-hidden"
    >
      <div className={cn("mb-3 flex items-start gap-3 rounded-xl border px-4 py-3 text-sm", tone === "unknown" ? "border-st-unknown/35 bg-st-unknown-soft text-st-unknown-fg" : "border-st-verifying/40 bg-st-verifying-soft text-st-verifying-fg")}>
        <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
        <p>{children}</p>
      </div>
    </motion.div>
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
  const max = Math.max(1, ...buckets.map(total));
  return (
    <figure>
      <div className="flex h-16 items-end gap-[3px]" role="img" aria-label={`Submissions in the last five minutes: ${buckets.reduce((n, b) => n + total(b), 0)}`}>
        {buckets.map((b, i) => (
          <div key={i} className="flex h-full flex-1 flex-col-reverse gap-px" title={`${total(b)} submitted ${Math.round((BUCKETS - i) * BUCKET)}s ago`}>
            {STATUSES.map((s) =>
              b[s] ? (
                <motion.div key={s} layout className={cn("w-full rounded-[2px]", STATUS_META[s].dot)} initial={false} animate={{ height: `${(b[s]! / max) * 100}%` }} transition={{ duration: 0.4, ease: EASE_OUT }} />
              ) : null,
            )}
            {total(b) === 0 && <div className="h-px w-full bg-border" />}
          </div>
        ))}
      </div>
      <figcaption className="mt-2 flex justify-between text-xs text-muted-foreground">
        <span>5 minutes ago</span>
        <span>Submissions, coloured by current status</span>
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
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="Filter by status" className="flex flex-wrap gap-1">
          <FilterChip active={!filter} onClick={() => set("status", null)} label="All" count={actions.length} />
          {STATUSES.map((s) => (
            <FilterChip key={s} active={filter === s} onClick={() => set("status", filter === s ? null : s)} label={s} count={counts[s] ?? 0} dot={STATUS_META[s].dot} mono />
          ))}
        </div>
        <label className="relative ml-auto">
          <span className="sr-only">Search actions</span>
          <Search aria-hidden className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            name="q"
            autoComplete="off"
            spellCheck={false}
            defaultValue={q}
            onChange={(e) => set("q", e.target.value || null)}
            placeholder="Search id, type or error…"
            className="h-8 w-56 rounded-lg border bg-card pr-3 pl-8 text-[13px] placeholder:text-muted-foreground"
          />
        </label>
      </div>

      {actions.length === 0 ? (
        <Empty />
      ) : (
        <div className="overflow-hidden rounded-[14px] border bg-card">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Action</th>
                <th className="px-4 py-2.5 font-medium">Type</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 text-right font-medium">Sends</th>
                <th className="hidden px-4 py-2.5 text-right font-medium sm:table-cell">Checks</th>
                <th className="hidden px-4 py-2.5 font-medium md:table-cell">Latest problem</th>
                <th className="px-4 py-2.5 text-right font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              <AnimatePresence initial={false}>
                {shown.map((a) => (
                  <motion.tr
                    key={a.id}
                    layout="position"
                    initial={{ opacity: 0, backgroundColor: "var(--muted)" }}
                    animate={{ opacity: 1, backgroundColor: "rgba(0,0,0,0)" }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.5, ease: EASE_OUT }}
                    className="group border-b last:border-0 hover:bg-muted/50"
                  >
                    <td className="px-4 py-2.5">
                      <Link to={`/actions/${a.id}`} className="font-mono text-xs font-medium underline-offset-2 group-hover:underline" translate="no">
                        {a.id}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{a.type}</td>
                    <td className="px-4 py-2.5"><StatusPill status={a.status} /></td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{a.attempt_count}</td>
                    <td className="hidden px-4 py-2.5 text-right tabular-nums sm:table-cell">{a.verify_count}</td>
                    <td className="hidden max-w-80 truncate px-4 py-2.5 text-xs text-muted-foreground md:table-cell" title={a.last_error ?? undefined}>{a.last_error ?? "None"}</td>
                    <td className="px-4 py-2.5 text-right text-xs whitespace-nowrap text-muted-foreground">{ago(a.created_at)}</td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
          {shown.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted-foreground">No actions match this filter.</p>}
        </div>
      )}
    </div>
  );
}

function FilterChip({ active, onClick, label, count, dot, mono }: { active: boolean; onClick: () => void; label: string; count: number; dot?: string; mono?: boolean }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn("relative flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs transition-colors", active ? "text-foreground" : "text-muted-foreground hover:text-foreground", mono && "font-mono")}
    >
      {active && <motion.span layoutId="filter-chip" className="absolute inset-0 rounded-lg border bg-card shadow-xs" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
      {dot && <span className={cn("relative size-1.5 rounded-full", dot)} />}
      <span className="relative">{label}</span>
      <span className="relative font-sans text-muted-foreground tabular-nums">{count}</span>
    </button>
  );
}

function Empty() {
  return (
    <div className="rounded-[14px] border border-dashed p-10 text-center">
      <p className="font-medium">No actions yet</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Run a failure preset from the Chaos page, or submit one from a terminal. Tokens will start moving across the wire above.</p>
      <div className="mt-4 flex justify-center gap-2">
        <Link to="/chaos" className="rounded-lg bg-foreground px-3 py-2 text-sm font-medium text-background">Open Chaos</Link>
      </div>
      <pre className="mx-auto mt-5 max-w-xl overflow-x-auto rounded-lg bg-muted p-3 text-left font-mono text-xs" data-lenis-prevent>
{`curl -X POST localhost:8700/actions -H 'Idempotency-Key: order-1' \\
  -H 'Content-Type: application/json' \\
  -d '{"type":"payment.charge","payload":{"amount_cents":1500,"customer":"cus_1"}}'`}
      </pre>
    </div>
  );
}
