import { Link } from "react-router";
import { AlertTriangle, CircleHelp, Server, Cpu, FlaskConical } from "lucide-react";
import type { Action, Status, SystemStatus } from "@/lib/api";
import { STATUSES } from "@/lib/api";
import { STATUS_META, isActive } from "@/lib/status";
import { StatusBadge } from "@/components/StatusBadge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ago } from "@/lib/time";
import { cn } from "@/lib/utils";

// ------------------------------------------------------------------ health

export function HealthStrip({ status }: { status?: SystemStatus }) {
  const worker = status?.workers.find((w) => w.state === "alive") ?? status?.workers[0];
  const s = status?.settings;
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border bg-card px-4 py-2.5 text-sm">
      <Indicator
        icon={<Server className="size-4" />}
        ok={status?.provider.reachable}
        label="Provider"
        value={status ? (status.provider.reachable ? "reachable" : `unreachable (${status.provider.error})`) : "…"}
        title={status?.provider.url}
      />
      <Indicator
        icon={<Cpu className="size-4" />}
        ok={worker?.state === "alive"}
        label="Worker"
        value={
          !status ? "…" : !worker ? "none has ever run" : worker.state === "alive" ? `${worker.id} · beat ${worker.seconds_since_seen}s ago` : worker.state === "stopped" ? `${worker.id} stopped cleanly` : `${worker.id} silent for ${worker.seconds_since_seen}s (crashed or killed?)`
        }
        title="Workers write a heartbeat every 2 s. Liveness display only: leases, not heartbeats, decide who may write an action."
      />
      <Indicator
        icon={<FlaskConical className="size-4" />}
        ok={status?.lab ? true : undefined}
        label="Lab mode"
        value={status ? (status.lab ? "on (chaos controls enabled)" : "off") : "…"}
        title="Fault injection and process control exist only when ONESHOT_LAB=1"
      />
      {s && (
        <span className="ml-auto font-mono text-xs text-muted-foreground" title="Safety-relevant timing settings of this OneShot instance">
          timeout {s.provider_timeout_seconds}s · lease {s.lease_seconds}s · settle {s.provider_settle_seconds}s
        </span>
      )}
    </div>
  );
}

function Indicator({ icon, ok, label, value, title }: { icon: React.ReactNode; ok?: boolean; label: string; value: string; title?: string }) {
  return (
    <span className="flex items-center gap-2" title={title}>
      <span className="text-muted-foreground">{icon}</span>
      <span className={cn("size-2 rounded-full", ok === undefined ? "bg-muted-foreground/40" : ok ? "bg-st-succeeded" : "bg-st-failed")} />
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </span>
  );
}

// --------------------------------------------------------------- attention

export function AttentionBanner({ status }: { status?: SystemStatus }) {
  if (!status) return null;
  const unknown = status.counts.UNKNOWN ?? 0;
  const waiting = (status.counts.PENDING ?? 0) + (status.counts.VERIFYING ?? 0);
  const workerAlive = status.workers.some((w) => w.state === "alive");
  const banners = [];
  if (unknown > 0)
    banners.push(
      <div key="u" className="flex items-start gap-3 rounded-xl border border-st-unknown/40 bg-st-unknown-soft px-4 py-3 text-sm text-st-unknown-fg">
        <CircleHelp className="mt-0.5 size-4 shrink-0" />
        <div>
          <b>{unknown} action{unknown > 1 ? "s are" : " is"} UNKNOWN.</b> OneShot could not tell whether the effect happened, so it stopped instead of guessing.{" "}
          <Link to="?status=UNKNOWN" className="underline underline-offset-2">Show them</Link>, open one to see the evidence, or run reconciliation.
        </div>
      </div>,
    );
  if (!workerAlive && waiting > 0)
    banners.push(
      <div key="w" className="flex items-start gap-3 rounded-xl border border-st-verifying/40 bg-st-verifying-soft px-4 py-3 text-sm text-st-verifying-fg">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <div>
          <b>No live worker.</b> {waiting} action{waiting > 1 ? "s are" : " is"} waiting. They are safe on disk and will continue when a worker starts (<code className="font-mono">uv run oneshot worker</code>).
        </div>
      </div>,
    );
  return banners.length ? <div className="space-y-2">{banners}</div> : null;
}

// ------------------------------------------------------------- count cards

export function StatusCards({ counts, active, onSelect }: { counts: Partial<Record<Status, number>>; active: Status | null; onSelect: (s: Status | null) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {STATUSES.map((s) => {
        const meta = STATUS_META[s];
        const n = counts[s] ?? 0;
        const selected = active === s;
        return (
          <button
            key={s}
            onClick={() => onSelect(selected ? null : s)}
            title={meta.meaning}
            className={cn(
              "group rounded-xl border bg-card px-4 py-3 text-left shadow-xs transition-all hover:shadow-sm",
              selected && "ring-2 ring-offset-2 ring-offset-background",
              selected && meta.badge,
            )}
          >
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className={cn("size-2 rounded-full", meta.dot, isActive(s) && n > 0 && "os-pulse")} />
              {s}
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{n}</div>
          </button>
        );
      })}
    </div>
  );
}

// --------------------------------------------------------------- sparkline

const BUCKET = 10; // seconds
const BUCKETS = 30; // 5 minutes

export function Sparkline({ actions }: { actions: Action[] }) {
  const now = Date.now() / 1000;
  const start = now - BUCKET * BUCKETS;
  const buckets: Partial<Record<Status, number>>[] = Array.from({ length: BUCKETS }, () => ({}));
  for (const a of actions) {
    if (a.created_at < start) continue;
    const i = Math.min(BUCKETS - 1, Math.floor((a.created_at - start) / BUCKET));
    buckets[i][a.status] = (buckets[i][a.status] ?? 0) + 1;
  }
  const max = Math.max(1, ...buckets.map((b) => Object.values(b).reduce((x, y) => x + (y ?? 0), 0)));
  const W = 600;
  const H = 48;
  const bw = W / BUCKETS;
  return (
    <div className="rounded-xl border bg-card px-4 py-3">
      <div className="mb-2 flex items-baseline justify-between text-xs text-muted-foreground">
        <span>Submissions in the last 5 minutes, coloured by their current status</span>
        <span>10 s per bar</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-12 w-full" preserveAspectRatio="none" role="img" aria-label="Activity over the last five minutes">
        <line x1={0} y1={H - 0.5} x2={W} y2={H - 0.5} className="stroke-border" />
        {buckets.map((b, i) => {
          let y = H;
          return STATUSES.map((s) => {
            const n = b[s] ?? 0;
            if (!n) return null;
            const h = (n / max) * (H - 4);
            y -= h;
            return <rect key={`${i}-${s}`} x={i * bw + 1} y={y} width={bw - 2} height={h} rx={1.5} className={cn("os-transition", STATUS_META[s].dot.replace("bg-", "fill-"))} />;
          });
        })}
      </svg>
    </div>
  );
}

// ------------------------------------------------------------------- table

export function ActionsTable({ actions }: { actions: Action[] }) {
  if (!actions.length)
    return (
      <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
        <p className="font-medium text-foreground">No actions here yet.</p>
        <p className="mt-1">Submit one with the Chaos page (milestone M2) or from a terminal:</p>
        <pre className="mx-auto mt-3 max-w-xl overflow-x-auto rounded-lg bg-muted p-3 text-left font-mono text-xs">
{`curl -X POST localhost:8700/actions -H 'Idempotency-Key: order-1' \\
  -H 'Content-Type: application/json' \\
  -d '{"type":"payment.charge","payload":{"amount_cents":1500,"customer":"cus_1"}}'`}
        </pre>
      </div>
    );
  return (
    <div className="rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Action</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Sends</TableHead>
            <TableHead className="text-right">Checks</TableHead>
            <TableHead>Latest problem</TableHead>
            <TableHead className="text-right">Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {actions.map((a) => (
            <TableRow key={a.id} className="os-fade-in">
              <TableCell>
                <Link to={`/actions/${a.id}`} className="font-mono text-xs font-medium underline-offset-2 hover:underline">
                  {a.id}
                </Link>
              </TableCell>
              <TableCell className="text-muted-foreground">{a.type}</TableCell>
              <TableCell>
                <StatusBadge status={a.status} />
              </TableCell>
              <TableCell className="text-right tabular-nums">{a.attempt_count}</TableCell>
              <TableCell className="text-right tabular-nums">{a.verify_count}</TableCell>
              <TableCell className="max-w-72 truncate text-xs text-muted-foreground" title={a.last_error ?? undefined}>
                {a.last_error ?? "-"}
              </TableCell>
              <TableCell className="text-right text-xs whitespace-nowrap text-muted-foreground">{ago(a.created_at)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
