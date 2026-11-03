import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Pause, Play, RotateCcw } from "lucide-react";
import type { FlowRow, Lane, Tone } from "@/lib/flow";
import { LANES } from "@/lib/flow";
import { offset } from "@/lib/time";
import { EASE_OUT } from "@/lib/motion";
import { cn } from "@/lib/utils";

// A sequence diagram drawn from real timestamps, one row per recorded fact,
// with a Replay control that steps through the facts in order.

const X: Record<Lane, number> = { agent: 150, oneshot: 380, provider: 610, ledger: 840 };
const TOP = 58;
const ROW = 52;
const WIDTH = 930;

const TONE: Record<Tone, { stroke: string; fill: string; text: string }> = {
  ok: { stroke: "stroke-st-succeeded", fill: "fill-st-succeeded", text: "fill-st-succeeded-fg" },
  bad: { stroke: "stroke-st-failed", fill: "fill-st-failed", text: "fill-st-failed-fg" },
  warn: { stroke: "stroke-st-verifying", fill: "fill-st-verifying", text: "fill-st-verifying-fg" },
  unknown: { stroke: "stroke-st-unknown", fill: "fill-st-unknown", text: "fill-st-unknown-fg" },
  neutral: { stroke: "stroke-muted-foreground", fill: "fill-muted-foreground", text: "fill-foreground" },
};

const clip = (s: string | undefined, n: number) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s);

export function FlowSequence({ rows, start }: { rows: FlowRow[]; start: number }) {
  const [step, setStep] = useState<number | null>(null); // null: show everything
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing || step === null) return;
    if (step >= rows.length) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setStep((s) => (s ?? 0) + 1), 750);
    return () => clearTimeout(t);
  }, [playing, step, rows.length]);

  const visible = step ?? rows.length;
  const height = TOP + rows.length * ROW + 20;
  const current = step !== null && step > 0 ? rows[step - 1] : null;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            if (step === null || step >= rows.length) setStep(0);
            setPlaying((p) => !(p && step !== null && step < rows.length));
          }}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-foreground px-3 text-[13px] font-medium text-background"
        >
          {playing ? <Pause aria-hidden className="size-3.5" /> : <Play aria-hidden className="size-3.5" />}
          {playing ? "Pause" : step !== null && step < rows.length ? "Resume" : "Replay"}
        </button>
        {step !== null && (
          <button type="button" onClick={() => { setStep(null); setPlaying(false); }} className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[13px]">
            <RotateCcw aria-hidden className="size-3.5" /> Show all
          </button>
        )}
        <span className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
          {step === null ? `${rows.length} recorded facts` : `Step ${Math.min(step, rows.length)} of ${rows.length}`}
        </span>
        <AnimatePresence mode="wait">
          {current && (
            <motion.span key={step} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} className="text-[13px]">
              {current.label}
              {current.sub && <span className="text-muted-foreground"> ({current.sub})</span>}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      <div className="overflow-x-auto" data-lenis-prevent>
        <svg viewBox={`0 0 ${WIDTH} ${height}`} className="w-full min-w-[720px]" role="img" aria-label="Message flow between agent, OneShot, provider and ledger">
          <defs>
            {Object.entries(TONE).map(([k, t]) => (
              <marker key={k} id={`fs-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" className={t.fill} />
              </marker>
            ))}
          </defs>
          {LANES.map((l) => (
            <g key={l.id}>
              <title>{l.hint}</title>
              <rect x={X[l.id] - 76} y={6} width={152} height={30} rx={9} className="fill-muted stroke-border" />
              <text x={X[l.id]} y={25} textAnchor="middle" className="fill-foreground text-[12.5px] font-medium">{l.label}</text>
              <line x1={X[l.id]} y1={38} x2={X[l.id]} y2={height - 6} className="stroke-border" strokeDasharray="2 5" />
            </g>
          ))}
          {rows.map((r, i) => {
            const y = TOP + i * ROW + 22;
            const shown = i < visible;
            return (
              <motion.g key={i} initial={false} animate={{ opacity: shown ? 1 : 0.08 }} transition={{ duration: 0.25, ease: EASE_OUT }}>
                <text x={10} y={y + 4} className="fill-muted-foreground font-mono text-[10px]">{offset(r.at, start)}</text>
                {r.kind === "msg" ? <Message row={r} y={y} animate={step !== null && i === visible - 1} /> : <Note row={r} y={y} />}
              </motion.g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function Message({ row, y, animate }: { row: Extract<FlowRow, { kind: "msg" }>; y: number; animate: boolean }) {
  const x1 = X[row.from];
  const x2 = X[row.to];
  const dir = Math.sign(x2 - x1);
  const a = x1 + dir * 4;
  const b = x2 - dir * 4;
  const mid = (x1 + x2) / 2;
  const t = TONE[row.tone];
  const draw = animate ? { initial: { pathLength: 0 }, animate: { pathLength: 1 }, transition: { duration: 0.45, ease: EASE_OUT } } : {};
  return (
    <g>
      <title>{[row.label, row.sub].filter(Boolean).join(": ")}</title>
      {row.style === "broken" ? (
        <>
          <motion.path d={`M${a},${y} L${a + (b - a) * 0.3},${y}`} strokeWidth={1.8} strokeDasharray="5 4" className={t.stroke} fill="none" {...draw} />
          <g className={t.stroke} strokeWidth={2.2} strokeLinecap="round">
            <line x1={a + (b - a) * 0.3 - 4} y1={y - 4} x2={a + (b - a) * 0.3 + 4} y2={y + 4} />
            <line x1={a + (b - a) * 0.3 - 4} y1={y + 4} x2={a + (b - a) * 0.3 + 4} y2={y - 4} />
          </g>
        </>
      ) : (
        <motion.path
          d={`M${a},${y} L${b},${y}`}
          fill="none"
          strokeWidth={1.8}
          strokeDasharray={row.style === "solid" ? undefined : "5 4"}
          className={cn(t.stroke, row.style === "pending" && "os-pulse")}
          markerEnd={`url(#fs-${row.tone})`}
          {...draw}
        />
      )}
      <text x={mid} y={y - 9} textAnchor="middle" className={cn("text-[12px] font-medium", t.text)}>{clip(row.label, 40)}</text>
      {row.sub && <text x={mid} y={y + 16} textAnchor="middle" className="fill-muted-foreground font-mono text-[10px]">{clip(row.sub, 46)}</text>}
    </g>
  );
}

function Note({ row, y }: { row: Extract<FlowRow, { kind: "note" }>; y: number }) {
  const x = X[row.lane];
  const t = TONE[row.tone];
  return (
    <g>
      <title>{[row.label, row.sub].filter(Boolean).join(": ")}</title>
      <rect x={x - 128} y={y - 18} width={256} height={row.sub ? 38 : 28} rx={9} strokeWidth={1.5} className={cn("fill-card", t.stroke)} />
      <text x={x} y={y - (row.sub ? 1 : -1)} textAnchor="middle" className={cn("text-[11.5px] font-medium", t.text)}>{clip(row.label, 40)}</text>
      {row.sub && <text x={x} y={y + 13} textAnchor="middle" className="fill-muted-foreground font-mono text-[9.5px]">{clip(row.sub, 46)}</text>}
    </g>
  );
}
