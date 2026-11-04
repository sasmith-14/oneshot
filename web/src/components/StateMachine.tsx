import { motion } from "motion/react";
import type { ActionEvent, Status } from "@/lib/api";
import { STATUS_META, isActive } from "@/lib/status";
import { EASE_OUT } from "@/lib/motion";
import { cn } from "@/lib/utils";

// The lifecycle from oneshot/domain.py (ALLOWED_TRANSITIONS), drawn by hand so the
// current state can glow and the path an action actually took can draw itself in.

type Pt = { x: number; y: number };
const W = 128;
const H = 38;

const NODES: Record<Status, Pt> = {
  PENDING: { x: 84, y: 112 },
  IN_FLIGHT: { x: 296, y: 112 },
  VERIFYING: { x: 508, y: 200 },
  SUCCEEDED: { x: 746, y: 30 },
  FAILED: { x: 746, y: 112 },
  UNKNOWN: { x: 746, y: 200 },
};

export interface EdgeSpec {
  from: Status;
  to: Status;
  bend?: number;
  meaning: string;
}

export const EDGES: EdgeSpec[] = [
  { from: "PENDING", to: "IN_FLIGHT", bend: -16, meaning: "a worker claims it and records the attempt before sending" },
  { from: "IN_FLIGHT", to: "PENDING", bend: -16, meaning: "retry: provably not applied, or the provider deduplicates by key" },
  { from: "IN_FLIGHT", to: "SUCCEEDED", bend: -10, meaning: "the provider confirmed the effect" },
  { from: "IN_FLIGHT", to: "FAILED", meaning: "a permanent no, or retries exhausted with every attempt provably not applied" },
  { from: "IN_FLIGHT", to: "VERIFYING", meaning: "ambiguous, and a resend could duplicate: check the provider's record first" },
  { from: "IN_FLIGHT", to: "UNKNOWN", bend: -18, meaning: "ambiguous with no safe way to find out" },
  { from: "VERIFYING", to: "SUCCEEDED", bend: -30, meaning: "the provider's ledger has the effect" },
  { from: "VERIFYING", to: "FAILED", meaning: "no record after the settle window and no attempts left" },
  { from: "VERIFYING", to: "UNKNOWN", meaning: "the provider's record could not be checked" },
  { from: "VERIFYING", to: "PENDING", bend: -120, meaning: "no record after the settle window: treated as not applied, so retry" },
  { from: "UNKNOWN", to: "SUCCEEDED", bend: 150, meaning: "resolved by reconciliation or a human: the effect exists" },
  { from: "UNKNOWN", to: "FAILED", bend: -22, meaning: "resolved by reconciliation or a human: no effect" },
];

export interface Path {
  edges: Map<string, number>;
  visited: Set<Status>;
}

export function pathTaken(events: ActionEvent[]): Path {
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

function boundary(c: Pt, toward: Pt, pad = 5): Pt {
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  const t = Math.min((W / 2 + pad) / Math.abs(dx || 1e-9), (H / 2 + pad) / Math.abs(dy || 1e-9));
  return { x: c.x + dx * t, y: c.y + dy * t };
}

function geometry(e: EdgeSpec) {
  const a = NODES[e.from];
  const b = NODES[e.to];
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const n = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
  const bend = e.bend ?? 0;
  const ctrl = { x: (a.x + b.x) / 2 + n.x * bend, y: (a.y + b.y) / 2 + n.y * bend };
  const s = boundary(a, ctrl);
  const t = boundary(b, ctrl);
  const mid = { x: 0.25 * s.x + 0.5 * ctrl.x + 0.25 * t.x, y: 0.25 * s.y + 0.5 * ctrl.y + 0.25 * t.y };
  return { d: `M${s.x.toFixed(1)},${s.y.toFixed(1)} Q${ctrl.x.toFixed(1)},${ctrl.y.toFixed(1)} ${t.x.toFixed(1)},${t.y.toFixed(1)}`, mid };
}
const GEOMETRY = new Map(EDGES.map((e) => [`${e.from}>${e.to}`, geometry(e)]));
const LOOP = `M${NODES.VERIFYING.x - 22},${NODES.VERIFYING.y + H / 2 + 3} C${NODES.VERIFYING.x - 36},${NODES.VERIFYING.y + 50} ${NODES.VERIFYING.x + 36},${NODES.VERIFYING.y + 50} ${NODES.VERIFYING.x + 22},${NODES.VERIFYING.y + H / 2 + 5}`;

export function StateMachine({
  current,
  path,
  focus,
  className,
  label,
}: {
  current: Status | null;
  path: Path;
  /** an edge key like "IN_FLIGHT>VERIFYING" to emphasise (used by Learn) */
  focus?: string;
  className?: string;
  label?: string;
}) {
  const loops = path.edges.get("VERIFYING>VERIFYING") ?? 0;
  return (
    <svg viewBox="0 0 840 280" className={cn("w-full", className)} role="img" aria-label={label ?? `Lifecycle diagram${current ? `, current state ${current}` : ""}`}>
      <defs>
        <marker id="sm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" className="fill-fg-3/60" />
        </marker>
        <marker id="sm-arrow-on" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" className="fill-signal" />
        </marker>
      </defs>

      <circle cx={10} cy={NODES.PENDING.y} r={4.5} className="fill-fg" />
      <line x1={15} y1={NODES.PENDING.y} x2={NODES.PENDING.x - W / 2 - 5} y2={NODES.PENDING.y} className="stroke-fg" strokeWidth={1.4} markerEnd="url(#sm-arrow)" />

      {EDGES.map((e) => {
        const key = `${e.from}>${e.to}`;
        const count = path.edges.get(key) ?? 0;
        const on = count > 0 || focus === key;
        const { d, mid } = GEOMETRY.get(key)!;
        return (
          <g key={key}>
            <title>{`${e.from} → ${e.to}: ${e.meaning}${count ? ` (taken ${count}×)` : ""}`}</title>
            <path d={d} fill="none" strokeWidth={12} className="stroke-transparent" />
            <path d={d} fill="none" strokeWidth={1.2} strokeDasharray="2 4" className="stroke-fg-3/50" markerEnd="url(#sm-arrow)" />
            {on && (
              <motion.path
                d={d}
                fill="none"
                strokeWidth={2}
                strokeLinecap="round"
                className="stroke-signal"
                markerEnd="url(#sm-arrow-on)"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{ duration: 0.55, ease: EASE_OUT }}
              />
            )}
            {count > 1 && <Count x={mid.x} y={mid.y} n={count} />}
          </g>
        );
      })}

      <g>
        <title>{`VERIFYING → VERIFYING: no answer yet (settle window not over, or lookup failed); check again${loops ? ` (taken ${loops}×)` : ""}`}</title>
        <path d={LOOP} fill="none" strokeWidth={1.2} strokeDasharray="2 4" className="stroke-fg-3/50" markerEnd="url(#sm-arrow)" />
        {(loops > 0 || focus === "VERIFYING>VERIFYING") && (
          <motion.path d={LOOP} fill="none" strokeWidth={2.2} className="stroke-signal" markerEnd="url(#sm-arrow-on)" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.5, ease: EASE_OUT }} />
        )}
        {loops > 1 && <Count x={NODES.VERIFYING.x} y={NODES.VERIFYING.y + 42} n={loops} />}
      </g>

      {(Object.keys(NODES) as Status[]).map((s) => (
        <Node key={s} status={s} current={s === current} visited={path.visited.has(s)} />
      ))}
    </svg>
  );
}

function Node({ status, current, visited }: { status: Status; current: boolean; visited: boolean }) {
  const p = NODES[status];
  const meta = STATUS_META[status];
  const lit = visited || current;
  return (
    <g>
      <title>{`${status}: ${meta.meaning}`}</title>
      {current && (
        <motion.rect
          x={p.x - W / 2 - 6}
          y={p.y - H / 2 - 6}
          width={W + 12}
          height={H + 12}
          rx={11}
          fill="none"
          strokeWidth={2}
          className={cn(meta.stroke)}
          initial={{ opacity: 0 }}
          animate={{ opacity: isActive(status) ? [0.15, 0.55, 0.15] : 0.4 }}
          transition={isActive(status) ? { duration: 1.6, repeat: Infinity, ease: "easeInOut" } : { duration: 0.3 }}
        />
      )}
      <rect x={p.x - W / 2} y={p.y - H / 2} width={W} height={H} rx={8} strokeWidth={current ? 2 : lit ? 1.2 : 1} className={cn("transition-[fill,stroke] duration-300", current ? cn(meta.fill, "stroke-fg") : lit ? cn(meta.fill, meta.stroke) : "fill-surface stroke-line")} />
      <text x={p.x} y={p.y + 4} textAnchor="middle" className={cn("font-mono text-[11.5px] font-medium", lit ? meta.text : "fill-fg-3")}>
        {status}
      </text>
    </g>
  );
}

function Count({ x, y, n }: { x: number; y: number; n: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r={10} className="fill-signal" />
      <text x={x} y={y + 3.5} textAnchor="middle" className="fill-white font-mono text-[10px] font-medium">{n}×</text>
    </g>
  );
}
