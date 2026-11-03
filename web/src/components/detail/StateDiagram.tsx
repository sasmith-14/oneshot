import type { ActionEvent, Status } from "@/lib/api";
import { STATUS_META, isActive } from "@/lib/status";
import { cn } from "@/lib/utils";

// The lifecycle from oneshot/domain.py (ALLOWED_TRANSITIONS), drawn by hand so it
// can light up the current state and the path this action actually took.

type Pt = { x: number; y: number };
const W = 124;
const H = 36;

const NODES: Record<Status, Pt> = {
  PENDING: { x: 80, y: 110 },
  IN_FLIGHT: { x: 290, y: 110 },
  VERIFYING: { x: 500, y: 196 },
  SUCCEEDED: { x: 740, y: 30 },
  FAILED: { x: 740, y: 110 },
  UNKNOWN: { x: 740, y: 196 },
};

interface EdgeSpec {
  from: Status;
  to: Status;
  bend?: number; // sideways offset of the curve's control point, px
  meaning: string;
}

export const EDGES: EdgeSpec[] = [
  { from: "PENDING", to: "IN_FLIGHT", bend: -16, meaning: "a worker claims it and records the attempt before sending" },
  { from: "IN_FLIGHT", to: "PENDING", bend: -16, meaning: "retry: provably not applied, or the provider deduplicates by key" },
  { from: "IN_FLIGHT", to: "SUCCEEDED", bend: -10, meaning: "the provider confirmed the effect" },
  { from: "IN_FLIGHT", to: "FAILED", meaning: "a permanent no, or retries exhausted with every attempt provably not applied" },
  { from: "IN_FLIGHT", to: "VERIFYING", meaning: "ambiguous and a resend could duplicate: check the provider's record first" },
  { from: "IN_FLIGHT", to: "UNKNOWN", bend: -18, meaning: "ambiguous with no safe way to find out" },
  { from: "VERIFYING", to: "SUCCEEDED", bend: -30, meaning: "the provider's ledger has the effect" },
  { from: "VERIFYING", to: "FAILED", meaning: "no record after the settle window and no attempts left" },
  { from: "VERIFYING", to: "UNKNOWN", meaning: "the provider's record could not be checked" },
  { from: "VERIFYING", to: "PENDING", bend: -120, meaning: "no record after the settle window: treated as not applied, retry" },
  { from: "UNKNOWN", to: "SUCCEEDED", bend: 150, meaning: "resolved by reconciliation or a human: the effect exists" },
  { from: "UNKNOWN", to: "FAILED", bend: -22, meaning: "resolved by reconciliation or a human: no effect" },
];

export function pathTaken(events: ActionEvent[]): { edges: Map<string, number>; visited: Set<Status> } {
  const edges = new Map<string, number>();
  const visited = new Set<Status>();
  for (const e of events) {
    visited.add(e.to);
    if (e.from) {
      visited.add(e.from);
      const k = `${e.from}>${e.to}`;
      edges.set(k, (edges.get(k) ?? 0) + 1);
    }
  }
  return { edges, visited };
}

function boundary(c: Pt, toward: Pt, pad = 4): Pt {
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  const t = Math.min((W / 2 + pad) / Math.abs(dx || 1e-9), (H / 2 + pad) / Math.abs(dy || 1e-9));
  return { x: c.x + dx * t, y: c.y + dy * t };
}

function edgeGeometry(e: EdgeSpec) {
  const a = NODES[e.from];
  const b = NODES[e.to];
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const n = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
  const bend = e.bend ?? 0;
  const ctrl = { x: mid.x + n.x * bend, y: mid.y + n.y * bend };
  const start = boundary(a, ctrl);
  const end = boundary(b, ctrl);
  // label point = curve midpoint (t = 0.5 on the quadratic Bézier)
  const label = { x: 0.25 * start.x + 0.5 * ctrl.x + 0.25 * end.x, y: 0.25 * start.y + 0.5 * ctrl.y + 0.25 * end.y };
  return { d: `M${start.x},${start.y} Q${ctrl.x},${ctrl.y} ${end.x},${end.y}`, label };
}

export function StateDiagram({ status, events, className }: { status: Status; events: ActionEvent[]; className?: string }) {
  const { edges, visited } = pathTaken(events);
  const verifyLoops = edges.get("VERIFYING>VERIFYING") ?? 0;

  return (
    <svg viewBox="0 0 840 280" className={cn("w-full", className)} role="img" aria-label={`Lifecycle diagram, current state ${status}`}>
      <defs>
        <marker id="sd-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" className="fill-muted-foreground/35" />
        </marker>
        <marker id="sd-arrow-taken" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" className="fill-foreground" />
        </marker>
      </defs>

      {/* entry */}
      <circle cx={8} cy={NODES.PENDING.y} r={4} className="fill-foreground" />
      <line x1={12} y1={NODES.PENDING.y} x2={NODES.PENDING.x - W / 2 - 4} y2={NODES.PENDING.y} className="stroke-foreground" strokeWidth={1.5} markerEnd="url(#sd-arrow-taken)" />

      {EDGES.map((e) => {
        const key = `${e.from}>${e.to}`;
        const count = edges.get(key) ?? 0;
        const { d, label } = edgeGeometry(e);
        return (
          <g key={key}>
            <title>{`${e.from} → ${e.to}: ${e.meaning}${count ? ` (taken ${count}×)` : ""}`}</title>
            <path d={d} fill="none" strokeWidth={10} className="stroke-transparent" />
            <path
              d={d}
              fill="none"
              strokeWidth={count ? 2 : 1.2}
              strokeDasharray={count ? undefined : "3 4"}
              className={cn("os-transition", count ? "stroke-foreground" : "stroke-muted-foreground/30")}
              markerEnd={count ? "url(#sd-arrow-taken)" : "url(#sd-arrow)"}
            />
            {count > 1 && <CountBubble x={label.x} y={label.y} n={count} />}
          </g>
        );
      })}

      {/* VERIFYING → VERIFYING: "not settled yet / lookup failed, check again" */}
      <g>
        <title>{`VERIFYING → VERIFYING: no answer yet (settle window not over, or lookup failed); check again later${verifyLoops ? ` (taken ${verifyLoops}×)` : ""}`}</title>
        <path
          d={`M${NODES.VERIFYING.x - 22},${NODES.VERIFYING.y + H / 2 + 2} C${NODES.VERIFYING.x - 34},${NODES.VERIFYING.y + 46} ${NODES.VERIFYING.x + 34},${NODES.VERIFYING.y + 46} ${NODES.VERIFYING.x + 22},${NODES.VERIFYING.y + H / 2 + 4}`}
          fill="none"
          strokeWidth={verifyLoops ? 2 : 1.2}
          strokeDasharray={verifyLoops ? undefined : "3 4"}
          className={verifyLoops ? "stroke-foreground" : "stroke-muted-foreground/30"}
          markerEnd={verifyLoops ? "url(#sd-arrow-taken)" : "url(#sd-arrow)"}
        />
        {verifyLoops > 1 && <CountBubble x={NODES.VERIFYING.x} y={NODES.VERIFYING.y + 38} n={verifyLoops} />}
      </g>

      {(Object.keys(NODES) as Status[]).map((s) => (
        <Node key={s} status={s} current={s === status} visited={visited.has(s)} />
      ))}
    </svg>
  );
}

function Node({ status, current, visited }: { status: Status; current: boolean; visited: boolean }) {
  const p = NODES[status];
  const meta = STATUS_META[status];
  return (
    <g>
      <title>{`${status}: ${meta.meaning}`}</title>
      {current && (
        <rect
          x={p.x - W / 2 - 5}
          y={p.y - H / 2 - 5}
          width={W + 10}
          height={H + 10}
          rx={14}
          fill="none"
          strokeWidth={2}
          className={cn(meta.stroke, "opacity-40", isActive(status) && "os-pulse")}
        />
      )}
      <rect
        x={p.x - W / 2}
        y={p.y - H / 2}
        width={W}
        height={H}
        rx={10}
        strokeWidth={current ? 2 : visited ? 1.5 : 1}
        className={cn("os-transition", visited || current ? cn(meta.fill, meta.stroke) : "fill-background stroke-border")}
      />
      <text
        x={p.x}
        y={p.y + 4}
        textAnchor="middle"
        className={cn("font-mono text-[11px] font-medium", visited || current ? meta.text : "fill-muted-foreground")}
      >
        {status}
      </text>
    </g>
  );
}

function CountBubble({ x, y, n }: { x: number; y: number; n: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r={9} className="fill-foreground" />
      <text x={x} y={y + 3.5} textAnchor="middle" className="fill-background font-mono text-[10px] font-semibold">
        {n}×
      </text>
    </g>
  );
}
