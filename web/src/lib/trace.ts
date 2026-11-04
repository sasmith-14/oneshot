import type { ActionDetail, Attempt, Effect, Outcome, Status } from "./api";

// A trace of one action, like a distributed-tracing waterfall: a band showing
// which status the action was in over time, one span per attempt (sends and
// ledger checks), and a marker wherever the provider's ledger recorded an
// effect. Retries can sit seconds apart and a resolution can come an hour
// later, so long idle gaps are compressed and marked with a break.

export type SpanTone = "ok" | "fail" | "retry" | "lost" | "warn" | "running";

export interface Span {
  key: string;
  label: string;
  attempt: Attempt;
  start: number;
  end: number;
  running: boolean;
  tone: SpanTone;
}

export interface StatusSegment {
  status: Status;
  start: number;
  end: number;
}

export interface Scale {
  /** seconds → position along the track, 0 to 1 */
  x: (t: number) => number;
  /** position 0–1 → seconds (for the hover read-out) */
  invert: (pos: number) => number;
  breaks: { pos: number; seconds: number }[];
  ticks: { pos: number; t: number }[];
}

export interface Trace {
  t0: number;
  t1: number;
  segments: StatusSegment[];
  spans: Span[];
  effects: { id: string; at: number }[];
  scale: Scale;
}

export function toneOf(outcome: Outcome | null): SpanTone {
  switch (outcome) {
    case "APPLIED":
    case "FOUND":
      return "ok";
    case "REJECTED":
      return "fail";
    case "RETRYABLE":
    case "ABSENT":
    case "NOT_SENT":
      return "retry";
    case "AMBIGUOUS":
    case "CRASHED":
      return "lost";
    case "LOOKUP_FAILED":
    case "IN_PROGRESS":
      return "warn";
    default:
      return "running";
  }
}

/** Gaps longer than this many seconds are compressed. */
export const COMPRESS_AFTER = 3;

function visual(gap: number): number {
  if (gap <= COMPRESS_AFTER) return gap;
  // a long wait gets a short, nearly fixed width: its length is printed on the break
  return COMPRESS_AFTER * 1.1 + Math.log2(gap / COMPRESS_AFTER) * COMPRESS_AFTER * 0.05;
}

export function buildScale(times: number[], t0: number, t1: number): Scale {
  const pts = [...new Set([t0, ...times.filter((t) => t >= t0 && t <= t1), t1])].sort((a, b) => a - b);
  const vis: number[] = [0];
  for (let i = 1; i < pts.length; i++) vis.push(vis[i - 1] + visual(pts[i] - pts[i - 1]));
  const total = vis[vis.length - 1] || 1;

  const x = (t: number) => {
    if (t <= pts[0]) return 0;
    if (t >= pts[pts.length - 1]) return 1;
    let i = 1;
    while (pts[i] < t) i++;
    const f = (t - pts[i - 1]) / (pts[i] - pts[i - 1] || 1);
    return (vis[i - 1] + f * (vis[i] - vis[i - 1])) / total;
  };
  const invert = (pos: number) => {
    const v = Math.min(1, Math.max(0, pos)) * total;
    let i = 1;
    while (i < vis.length - 1 && vis[i] < v) i++;
    const f = (v - vis[i - 1]) / (vis[i] - vis[i - 1] || 1);
    return pts[i - 1] + f * (pts[i] - pts[i - 1]);
  };
  const breaks: Scale["breaks"] = [];
  for (let i = 1; i < pts.length; i++) {
    const gap = pts[i] - pts[i - 1];
    if (gap > COMPRESS_AFTER * 2) breaks.push({ pos: (vis[i - 1] + vis[i]) / 2 / total, seconds: gap });
  }
  const ticks = [0, 0.2, 0.4, 0.6, 0.8, 1]
    .filter((p) => !breaks.some((b) => Math.abs(b.pos - p) < 0.06))
    .map((pos) => ({ pos, t: invert(pos) }));
  return { x, invert, breaks, ticks };
}

export function buildTrace(action: ActionDetail, effects: Effect[] | undefined, now: number = Date.now() / 1000): Trace {
  const t0 = action.created_at;
  const active = ["PENDING", "IN_FLIGHT", "VERIFYING"].includes(action.status);
  const stamps = [
    action.updated_at,
    ...action.events.map((e) => e.at),
    ...action.attempts.flatMap((a) => [a.started_at, a.finished_at ?? a.started_at]),
    ...(effects ?? []).map((e) => e.created_at),
  ];
  const t1 = Math.max(t0 + 0.5, ...stamps, active ? now : 0);

  const events = [...action.events].sort((a, b) => a.at - b.at);
  const segments: StatusSegment[] = events.map((e, i) => ({ status: e.to, start: e.at, end: events[i + 1]?.at ?? t1 }));

  let sends = 0;
  let checks = 0;
  const spans: Span[] = [...action.attempts]
    .sort((a, b) => a.started_at - b.started_at)
    .map((a) => {
      const n = a.kind === "send" ? ++sends : ++checks;
      const running = a.finished_at === null;
      return {
        key: `${a.kind}-${a.number}-${a.started_at}`,
        label: a.kind === "send" ? `Send ${n}` : `Ledger check ${n}`,
        attempt: a,
        start: a.started_at,
        end: a.finished_at ?? t1,
        running,
        tone: running ? "running" : toneOf(a.outcome),
      };
    });

  return {
    t0,
    t1,
    segments,
    spans,
    effects: (effects ?? []).map((e) => ({ id: e.id, at: e.created_at })),
    scale: buildScale(stamps.concat(events.map((e) => e.at)), t0, t1),
  };
}

/** "+0.42s", "+12.3s", "+3m 05s", "+1h 02m" */
export function span(seconds: number): string {
  if (seconds < 10) return `${seconds.toFixed(2)}s`;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${String(Math.floor(seconds % 60)).padStart(2, "0")}s`;
  return `${Math.floor(seconds / 3600)}h ${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}m`;
}
