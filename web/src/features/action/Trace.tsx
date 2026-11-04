import { useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { ActionDetail, Effect } from "@/lib/api";
import { buildTrace, span as fmt, type Span, type SpanTone } from "@/lib/trace";
import { explainOutcome, mayHaveApplied } from "@/lib/explain";
import { STATUS_META } from "@/lib/status";
import { EASE_OUT } from "@/lib/motion";
import { cn } from "@/lib/utils";

const TONE: Record<SpanTone, { bar: string; text: string; label: string }> = {
  ok: { bar: "bg-st-succeeded", text: "text-st-succeeded-fg", label: "confirmed" },
  fail: { bar: "bg-st-failed", text: "text-st-failed-fg", label: "declined" },
  retry: { bar: "bg-st-pending", text: "text-st-pending-fg", label: "nothing happened" },
  lost: { bar: "bg-st-unknown", text: "text-st-unknown-fg", label: "unclear" },
  warn: { bar: "bg-st-verifying", text: "text-st-verifying-fg", label: "lookup failed" },
  running: { bar: "bg-st-inflight os-running", text: "text-st-inflight-fg", label: "running" },
};

/** One action as a trace: what state it was in over time, every send and
 * ledger check as a bar, and where the provider's ledger recorded an effect.
 * Hover for a time read-out; click a bar for the reason behind it. */
export function Trace({ action, effects }: { action: ActionDetail; effects?: Effect[] }) {
  const trace = useMemo(() => buildTrace(action, effects), [action, effects]);
  const { scale, t0 } = trace;
  const [hover, setHover] = useState<number | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const track = useRef<HTMLDivElement>(null);
  const selected = trace.spans.find((s) => s.key === picked) ?? null;

  const left = (t: number) => `${(scale.x(t) * 100).toFixed(3)}%`;
  const width = (a: number, b: number) => `max(3px, ${((scale.x(b) - scale.x(a)) * 100).toFixed(3)}%)`;

  return (
    <div>
      <div className="no-scrollbar overflow-x-auto" data-lenis-prevent-horizontal>
      <div
        className="relative grid min-w-[680px] grid-cols-[132px_minmax(0,1fr)] gap-x-4 sm:grid-cols-[168px_minmax(0,1fr)]"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => onMove(e, track.current, setHover)}
      >
        {/* axis */}
        <div />
        <div ref={track} className="relative h-6 border-b border-line">
          {scale.ticks.map((t) => (
            <span key={t.pos} className="absolute top-0 -translate-x-1/2 font-mono text-[10.5px] whitespace-nowrap text-fg-3 tnum first:translate-x-0 last:-translate-x-full" style={{ left: `${t.pos * 100}%` }}>
              +{fmt(t.t - t0)}
            </span>
          ))}
        </div>

        <Row label="Status" sub="what OneShot said">
          {trace.segments.map((s, i) => (
            <motion.div
              key={`${s.status}-${s.start}`}
              initial={{ scaleX: 0, opacity: 0 }}
              animate={{ scaleX: 1, opacity: 1 }}
              transition={{ duration: 0.45, delay: i * 0.05, ease: EASE_OUT }}
              className={cn("absolute top-1.5 bottom-1.5 flex origin-left items-center overflow-hidden rounded-[5px] px-1.5 font-mono text-[10.5px] font-[560] whitespace-nowrap ring-1 ring-inset ring-current/15", STATUS_META[s.status].badge)}
              style={{ left: left(s.start), width: width(s.start, s.end) }}
              title={`${s.status} for ${fmt(s.end - s.start)}`}
            >
              {scale.x(s.end) - scale.x(s.start) > 0.075 ? s.status : ""}
            </motion.div>
          ))}
        </Row>

        {trace.spans.map((s, i) => (
          <Row
            key={s.key}
            label={s.label}
            sub={s.attempt.outcome ?? "running"}
            onClick={() => setPicked(picked === s.key ? null : s.key)}
            active={picked === s.key}
          >
            <motion.button
              type="button"
              aria-label={`${s.label}: ${s.attempt.outcome ?? "running"}, took ${fmt(s.end - s.start)}`}
              onClick={() => setPicked(picked === s.key ? null : s.key)}
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.4, delay: 0.1 + i * 0.05, ease: EASE_OUT }}
              className={cn("absolute top-2.5 bottom-2.5 origin-left rounded-[4px] transition-[box-shadow] duration-150", TONE[s.tone].bar, picked === s.key && "ring-2 ring-fg ring-offset-2 ring-offset-surface")}
              style={{ left: left(s.start), width: width(s.start, s.end) }}
            />
            <span className="pointer-events-none absolute top-1/2 ml-2 -translate-y-1/2 font-mono text-[10.5px] whitespace-nowrap text-fg-3" style={{ left: `calc(${left(s.end)} + 2px)` }}>
              {fmt(s.end - s.start)}
            </span>
          </Row>
        ))}

        <Row label="Provider ledger" sub="what really happened">
          {trace.effects.length === 0 ? (
            <span className="absolute top-1/2 left-0 -translate-y-1/2 text-[12px] text-fg-3">{effects ? "no effect recorded" : "could not be read"}</span>
          ) : (
            trace.effects.map((e, i) => (
              <motion.span
                key={e.id}
                initial={{ scale: 0, rotate: 45 }}
                animate={{ scale: 1, rotate: 45 }}
                transition={{ delay: 0.35 + i * 0.05, type: "spring", stiffness: 500, damping: 26 }}
                className={cn("absolute top-1/2 -mt-[5px] -ml-[5px] size-[10px] rounded-[2px]", trace.effects.length > 1 ? "bg-st-failed" : "bg-st-succeeded")}
                style={{ left: left(e.at) }}
                title={`${e.id} written at +${fmt(e.at - t0)}`}
              />
            ))
          )}
        </Row>

        {/* compressed gaps and the hover read-out, laid over the track column */}
        <div aria-hidden className="pointer-events-none absolute inset-0 col-start-2" style={{ gridRow: "1 / -1" }}>
          {scale.breaks.map((b) => (
            <span key={b.pos} className="absolute top-6 bottom-0 -translate-x-1/2" style={{ left: `${b.pos * 100}%` }}>
              <span className="absolute inset-y-0 left-1/2 w-[7px] -translate-x-1/2 bg-surface [background-image:repeating-linear-gradient(135deg,var(--line-strong)_0_1px,transparent_1px_5px)]" />
              <span className="absolute top-1 left-1/2 -translate-x-1/2 rounded-[4px] border border-line bg-surface px-1 font-mono text-[10px] whitespace-nowrap text-fg-3">{fmt(b.seconds)} idle</span>
            </span>
          ))}
          {hover !== null && (
            <span className="absolute top-0 bottom-0 w-px bg-signal/70" style={{ left: `${hover * 100}%` }}>
              <span className="absolute -top-0.5 left-1 rounded-[4px] bg-signal px-1 font-mono text-[10px] whitespace-nowrap text-signal-fg">+{fmt(scale.invert(hover) - t0)}</span>
            </span>
          )}
        </div>
      </div>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {selected ? <Detail key={selected.key} span={selected} t0={t0} /> : (
          <motion.p key="hint" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-4 text-[12.5px] text-fg-3">
            Click a bar for what happened and why. Hatched gaps are idle time, shortened so the busy moments stay readable.
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

function onMove(e: React.MouseEvent, track: HTMLElement | null, set: (v: number | null) => void) {
  if (!track) return;
  const r = track.getBoundingClientRect();
  const p = (e.clientX - r.left) / r.width;
  set(p < 0 || p > 1 ? null : p);
}

function Row({ label, sub, children, onClick, active }: { label: string; sub: string; children: React.ReactNode; onClick?: () => void; active?: boolean }) {
  return (
    <>
      <div className={cn("flex min-w-0 flex-col justify-center border-b border-line py-2", onClick && "cursor-pointer")} onClick={onClick}>
        <span className={cn("truncate text-[13px] font-[560]", active && "text-signal")}>{label}</span>
        <span className="truncate font-mono text-[10.5px] text-fg-3">{sub}</span>
      </div>
      <div className="relative h-11 border-b border-line">{children}</div>
    </>
  );
}

function Detail({ span: s, t0 }: { span: Span; t0: number }) {
  const risky = mayHaveApplied(s.attempt);
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.22, ease: EASE_OUT }} className="well mt-4 grid gap-x-8 gap-y-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto]">
      <div>
        <p className="flex flex-wrap items-center gap-2 text-[13.5px]">
          <span className="font-[600]">{s.label}</span>
          <span className={cn("rounded-[5px] px-1.5 py-0.5 font-mono text-[11px] font-[560]", s.running ? STATUS_META.IN_FLIGHT.badge : risky ? STATUS_META.UNKNOWN.badge : "bg-surface")}>{s.attempt.outcome ?? "running…"}</span>
          <span className={cn("text-[12.5px]", TONE[s.tone].text)}>{TONE[s.tone].label}</span>
        </p>
        <p className="mt-1.5 text-[14px] leading-relaxed">{explainOutcome(s.attempt.outcome)}</p>
        {s.attempt.detail && <p className="mt-1 font-mono text-[12px] text-fg-2">{s.attempt.detail}</p>}
      </div>
      <dl className="grid grid-cols-[auto_auto] content-start gap-x-4 gap-y-1 text-[12.5px]">
        <dt className="text-fg-3">started</dt>
        <dd className="font-mono tnum">+{fmt(s.start - t0)}</dd>
        <dt className="text-fg-3">took</dt>
        <dd className="font-mono tnum">{fmt(s.end - s.start)}</dd>
        <dt className="text-fg-3">worker</dt>
        <dd className="font-mono">{s.attempt.worker_id}</dd>
      </dl>
    </motion.div>
  );
}
