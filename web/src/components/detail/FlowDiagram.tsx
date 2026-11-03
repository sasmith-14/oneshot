import type { FlowRow, Lane, Tone } from "@/lib/flow";
import { LANES } from "@/lib/flow";
import { offset } from "@/lib/time";
import { cn } from "@/lib/utils";

// A sequence diagram drawn from real timestamps: one row per recorded fact.

const LANE_X: Record<Lane, number> = { agent: 150, oneshot: 375, provider: 600, ledger: 825 };
const TOP = 54;
const ROW = 50;
const WIDTH = 920;

const TONE: Record<Tone, { stroke: string; fill: string; text: string; marker: string }> = {
  ok: { stroke: "stroke-st-succeeded", fill: "fill-st-succeeded", text: "fill-st-succeeded-fg", marker: "ok" },
  bad: { stroke: "stroke-st-failed", fill: "fill-st-failed", text: "fill-st-failed-fg", marker: "bad" },
  warn: { stroke: "stroke-st-verifying", fill: "fill-st-verifying", text: "fill-st-verifying-fg", marker: "warn" },
  unknown: { stroke: "stroke-st-unknown", fill: "fill-st-unknown", text: "fill-st-unknown-fg", marker: "unknown" },
  neutral: { stroke: "stroke-muted-foreground", fill: "fill-muted-foreground", text: "fill-foreground", marker: "neutral" },
};

function clip(s: string | undefined, n = 42): string | undefined {
  if (!s) return s;
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export function FlowDiagram({ rows, start }: { rows: FlowRow[]; start: number }) {
  const height = TOP + rows.length * ROW + 24;
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${WIDTH} ${height}`} className="min-w-[720px] w-full" role="img" aria-label="Message flow between agent, OneShot, provider and ledger">
        <defs>
          {Object.values(TONE).map((t) => (
            <marker key={t.marker} id={`fl-${t.marker}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" className={t.fill} />
            </marker>
          ))}
        </defs>

        {LANES.map((l) => (
          <g key={l.id}>
            <title>{l.hint}</title>
            <rect x={LANE_X[l.id] - 70} y={6} width={140} height={28} rx={8} className="fill-muted stroke-border" />
            <text x={LANE_X[l.id]} y={24} textAnchor="middle" className="fill-foreground text-[12px] font-medium">
              {l.label}
            </text>
            <line x1={LANE_X[l.id]} y1={36} x2={LANE_X[l.id]} y2={height - 8} className="stroke-border" strokeDasharray="2 4" />
          </g>
        ))}

        {rows.map((r, i) => {
          const y = TOP + i * ROW + 22;
          return (
            <g key={i} className="os-fade-in" style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}>
              <text x={8} y={y + 4} className="fill-muted-foreground font-mono text-[10px]">
                {offset(r.at, start)}
              </text>
              {r.kind === "msg" ? <Message row={r} y={y} /> : <Note row={r} y={y} />}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function Message({ row, y }: { row: Extract<FlowRow, { kind: "msg" }>; y: number }) {
  const x1 = LANE_X[row.from];
  const x2 = LANE_X[row.to];
  const dir = Math.sign(x2 - x1);
  const a = x1 + dir * 4;
  const b = x2 - dir * 4;
  const mid = (x1 + x2) / 2;
  const t = TONE[row.tone];
  const title = [row.label, row.sub].filter(Boolean).join(": ");

  let line;
  if (row.style === "broken") {
    // The arrow never completes: it stops partway with an ✕.
    const stop = a + (b - a) * 0.3;
    line = (
      <>
        <line x1={a} y1={y} x2={stop} y2={y} strokeWidth={1.8} strokeDasharray="5 4" className={t.stroke} />
        <g className={t.stroke} strokeWidth={2.2} strokeLinecap="round">
          <line x1={stop - 4} y1={y - 4} x2={stop + 4} y2={y + 4} />
          <line x1={stop - 4} y1={y + 4} x2={stop + 4} y2={y - 4} />
        </g>
      </>
    );
  } else {
    line = (
      <line
        x1={a}
        y1={y}
        x2={b}
        y2={y}
        strokeWidth={1.8}
        strokeDasharray={row.style === "dashed" || row.style === "pending" ? "5 4" : undefined}
        className={cn(t.stroke, row.style === "pending" && "os-pulse")}
        markerEnd={`url(#fl-${t.marker})`}
      />
    );
  }

  return (
    <g>
      <title>{title}</title>
      {line}
      <text x={mid} y={y - 9} textAnchor="middle" className={cn("text-[11.5px] font-medium", t.text)}>
        {clip(row.label, 38)}
      </text>
      {row.sub && (
        <text x={mid} y={y + 15} textAnchor="middle" className="fill-muted-foreground font-mono text-[10px]">
          {clip(row.sub, 46)}
        </text>
      )}
    </g>
  );
}

function Note({ row, y }: { row: Extract<FlowRow, { kind: "note" }>; y: number }) {
  const x = LANE_X[row.lane];
  const t = TONE[row.tone];
  return (
    <g>
      <title>{[row.label, row.sub].filter(Boolean).join(": ")}</title>
      <rect x={x - 125} y={y - 17} width={250} height={row.sub ? 36 : 26} rx={8} strokeWidth={1.5} className={cn("fill-background", t.stroke)} />
      <text x={x} y={y - (row.sub ? 1 : 0)} textAnchor="middle" className={cn("text-[11px] font-medium", t.text)}>
        {clip(row.label, 40)}
      </text>
      {row.sub && (
        <text x={x} y={y + 12} textAnchor="middle" className="fill-muted-foreground font-mono text-[9.5px]">
          {clip(row.sub, 44)}
        </text>
      )}
    </g>
  );
}
