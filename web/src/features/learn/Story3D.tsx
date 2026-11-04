import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { motion, useMotionTemplate, useReducedMotion, useSpring, useTransform, type MotionValue } from "motion/react";
import type { Status } from "@/lib/api";
import { EDGES, type Path } from "@/components/StateMachine";

// The lifecycle as a small 3D world, built with CSS 3D transforms (no WebGL):
// each state is a raised block on a tilted floor, every allowed transition is
// a line painted on the floor, the route taken so far is drawn in the signal
// colour, and a glowing packet hops along the transition the current step is
// about. The camera flies to each step; the mouse tilts it and a drag orbits
// it. Labels are billboards: they always face the viewer.

const BOARD = { w: 1000, h: 540 };
const POS: Record<Status, { x: number; y: number }> = {
  PENDING: { x: 140, y: 290 },
  IN_FLIGHT: { x: 385, y: 290 },
  VERIFYING: { x: 625, y: 432 },
  SUCCEEDED: { x: 868, y: 120 },
  FAILED: { x: 868, y: 290 },
  UNKNOWN: { x: 868, y: 452 },
};
const FOOT = { w: 150, d: 76 };
const VAR: Record<Status, string> = { PENDING: "pending", IN_FLIGHT: "inflight", VERIFYING: "verifying", SUCCEEDED: "succeeded", FAILED: "failed", UNKNOWN: "unknown" };

function edgePath(from: Status, to: Status, bend = 0): string {
  const a = POS[from];
  const b = POS[to];
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const n = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
  const k = bend * 1.45;
  const c = { x: (a.x + b.x) / 2 + n.x * k, y: (a.y + b.y) / 2 + n.y * k };
  return `M${a.x},${a.y} Q${c.x.toFixed(1)},${c.y.toFixed(1)} ${b.x},${b.y}`;
}
const LOOP = `M${POS.VERIFYING.x - 40},${POS.VERIFYING.y + 30} C${POS.VERIFYING.x - 70},${POS.VERIFYING.y + 120} ${POS.VERIFYING.x + 70},${POS.VERIFYING.y + 120} ${POS.VERIFYING.x + 40},${POS.VERIFYING.y + 30}`;
const PATHS = new Map<string, string>([...EDGES.map((e) => [`${e.from}>${e.to}`, edgePath(e.from, e.to, e.bend)] as const), ["VERIFYING>VERIFYING", LOOP]]);

export function Story3D({ current, path, focus, index, label }: { current: Status; path: Path; focus?: string; index: number; label: string }) {
  const reduce = useReducedMotion();
  const stage = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(0.8);

  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setFit(Math.max(0.4, Math.min(0.95, e.contentRect.width / 1180))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // camera: where it looks, how it is tilted and turned, per step
  const spring = reduce ? { stiffness: 1000, damping: 100 } : { stiffness: 70, damping: 18, mass: 1 };
  const node = POS[current];
  const fx = useSpring(BOARD.w / 2, spring);
  const fy = useSpring(BOARD.h / 2, spring);
  const baseRx = useSpring(56, spring);
  const baseRz = useSpring(-26, spring);
  const zoom = useSpring(1, spring);
  useEffect(() => {
    fx.set(BOARD.w / 2 + (node.x - BOARD.w / 2) * 0.22);
    fy.set(BOARD.h / 2 + (node.y - BOARD.h / 2) * 0.25);
    baseRx.set(54 + (index % 2) * 4);
    baseRz.set(-34 + index * 3.2);
    zoom.set(0.98 + (index % 3) * 0.03);
  }, [node.x, node.y, index, fx, fy, baseRx, baseRz, zoom]);

  // pointer: a small tilt while hovering, and a drag that orbits
  const tiltX = useSpring(0, { stiffness: 120, damping: 20 });
  const tiltZ = useSpring(0, { stiffness: 120, damping: 20 });
  const orbit = useSpring(0, { stiffness: 140, damping: 22 });
  const drag = useRef<{ x: number; start: number } | null>(null);
  const rx = useTransform(() => baseRx.get() + tiltX.get());
  const rz = useTransform(() => baseRz.get() + tiltZ.get() + orbit.get());
  const scale = useTransform(() => zoom.get() * fit);
  const bx = useTransform(() => -fx.get());
  const by = useTransform(() => -fy.get());

  return (
    <div
      ref={stage}
      role="img"
      aria-label={label}
      className="relative h-[clamp(320px,38vw,460px)] touch-pan-y overflow-hidden select-none"
      style={{ perspective: 1500, perspectiveOrigin: "50% 28%" }}
      onPointerMove={(e) => {
        if (reduce) return;
        const r = e.currentTarget.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        tiltX.set(-py * 7);
        tiltZ.set(px * 7);
        if (drag.current) orbit.set(drag.current.start + (e.clientX - drag.current.x) * 0.18);
      }}
      onPointerLeave={() => {
        tiltX.set(0);
        tiltZ.set(0);
        drag.current = null;
      }}
      onPointerDown={(e) => {
        if (reduce || e.pointerType !== "mouse") return;
        drag.current = { x: e.clientX, start: orbit.get() };
      }}
      onPointerUp={() => (drag.current = null)}
      onDoubleClick={() => orbit.set(0)}
    >
      {/* the room: a soft floor-light under the scene */}
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(60% 55% at 50% 62%, color-mix(in oklab, var(--signal) 9%, transparent), transparent 70%)" }} />

      <motion.div className="absolute top-[50%] left-1/2" style={{ rotateX: rx, rotateZ: rz, scale, transformStyle: "preserve-3d" }}>
        <motion.div className="absolute top-0 left-0" style={{ width: BOARD.w, height: BOARD.h, x: bx, y: by, transformStyle: "preserve-3d" }}>
          <Floor path={path} focus={focus} />
          {(Object.keys(POS) as Status[]).map((s) => (
            <Block key={s} status={s} current={s === current} visited={path.visited.has(s)} rx={rx} rz={rz} />
          ))}
          <Packet focus={focus} rx={rx} rz={rz} reduce={!!reduce} />
        </motion.div>
      </motion.div>

      <p className="pointer-events-none absolute right-3 bottom-2 text-[11px] text-fg-3">{reduce ? "" : "Move to tilt · drag to orbit · double-click to reset"}</p>
    </div>
  );
}

function Floor({ path, focus }: { path: Path; focus?: string }) {
  return (
    <div className="absolute inset-0" style={{ transformStyle: "preserve-3d" }}>
      {/* the floor itself: a dot grid that fades into the dark at its edges */}
      <div
        className="dot-grid absolute -inset-24 rounded-[40px]"
        style={{ maskImage: "radial-gradient(closest-side, black 55%, transparent)", WebkitMaskImage: "radial-gradient(closest-side, black 55%, transparent)", backgroundSize: "26px 26px" }}
      />
      <svg viewBox={`0 0 ${BOARD.w} ${BOARD.h}`} width={BOARD.w} height={BOARD.h} className="absolute inset-0 overflow-visible" aria-hidden>
        <defs>
          <marker id="s3d-arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" className="fill-signal" />
          </marker>
        </defs>
        {[...PATHS.entries()].map(([key, d]) => {
          const taken = path.edges.has(key);
          const isFocus = key === focus;
          return (
            <g key={key}>
              <path d={d} fill="none" strokeWidth={2} strokeDasharray="2 9" strokeLinecap="round" className="stroke-line-strong" />
              {taken && (
                <motion.path d={d} fill="none" strokeWidth={isFocus ? 6 : 4} strokeLinecap="round" className="stroke-signal" initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: isFocus ? 1 : 0.55 }} transition={{ duration: 0.9, ease: [0.23, 1, 0.32, 1] }} />
              )}
              {isFocus && <path d={d} fill="none" strokeWidth={14} strokeLinecap="round" className="stroke-signal" style={{ opacity: 0.16 }} />}
              {isFocus && <path id={`s3d-${key}`} d={d} fill="none" strokeWidth={2} className="wire-flow stroke-canvas" style={{ opacity: 0.7 }} />}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function Block({ status, current, visited, rx, rz }: { status: Status; current: boolean; visited: boolean; rx: MotionValue<number>; rz: MotionValue<number> }) {
  const { x, y } = POS[status];
  const v = VAR[status];
  const lit = current || visited;
  const h = useSpring(current ? 56 : visited ? 26 : 12, { stiffness: 160, damping: 18 });
  useEffect(() => h.set(current ? 56 : visited ? 26 : 12), [current, visited, h]);
  const top = lit ? `var(--st-${v}-soft)` : "var(--raised)";
  const edge = lit ? `var(--st-${v})` : "var(--line-strong)";
  const side = lit ? `color-mix(in oklab, var(--st-${v}) 62%, black)` : "color-mix(in oklab, var(--raised) 78%, black)";
  const side2 = lit ? `color-mix(in oklab, var(--st-${v}) 45%, black)` : "color-mix(in oklab, var(--raised) 64%, black)";
  const topZ = useMotionTemplate`translateZ(${h}px) translate(-50%, -50%)`;
  const half = useTransform(h, (z) => z / 2);
  const south = useMotionTemplate`translateY(${FOOT.d / 2}px) translateZ(${half}px) rotateX(-90deg) translate(-50%, -50%)`;
  const north = useMotionTemplate`translateY(${-FOOT.d / 2}px) translateZ(${half}px) rotateX(90deg) translate(-50%, -50%)`;
  const east = useMotionTemplate`translateX(${FOOT.w / 2}px) translateZ(${half}px) rotateY(90deg) translate(-50%, -50%)`;
  const west = useMotionTemplate`translateX(${-FOOT.w / 2}px) translateZ(${half}px) rotateY(-90deg) translate(-50%, -50%)`;
  const labelZ = useTransform(h, (z) => z + 54);
  const nrz = useTransform(rz, (r) => -r);
  const nrx = useTransform(rx, (r) => -r);
  const billboard = useMotionTemplate`translateZ(${labelZ}px) rotateZ(${nrz}deg) rotateX(${nrx}deg) translate(-50%, -100%)`;

  return (
    <div className="absolute" style={{ left: x, top: y, transformStyle: "preserve-3d" }}>
      {/* shadow, or a coloured pool of light under the current state */}
      <div
        aria-hidden
        className="absolute -translate-x-1/2 -translate-y-1/2 rounded-[50%] transition-opacity duration-500"
        style={{
          width: FOOT.w + (current ? 120 : 50),
          height: FOOT.d + (current ? 90 : 40),
          background: current ? `radial-gradient(closest-side, color-mix(in oklab, var(--st-${v}) 55%, transparent), transparent)` : "radial-gradient(closest-side, rgba(0,0,0,.28), transparent)",
        }}
      />
      <motion.div className="absolute" style={{ width: FOOT.w, height: h, transform: north, background: side2, transformOrigin: "0 0" }} />
      <motion.div className="absolute" style={{ width: FOOT.w, height: h, transform: south, background: side, transformOrigin: "0 0" }} />
      <motion.div className="absolute" style={{ width: h, height: FOOT.d, transform: east, background: side2, transformOrigin: "0 0" }} />
      <motion.div className="absolute" style={{ width: h, height: FOOT.d, transform: west, background: side, transformOrigin: "0 0" }} />
      <motion.div
        className="absolute rounded-[6px]"
        style={{ width: FOOT.w, height: FOOT.d, transform: topZ, transformOrigin: "0 0", background: top, boxShadow: `inset 0 0 0 ${current ? 3 : 1.5}px ${edge}` }}
      />
      {/* the label stands up and faces the viewer */}
      <motion.div className="absolute whitespace-nowrap" style={{ transform: billboard, transformOrigin: "0 0" }}>
        <span
          className="flex items-center gap-1.5 rounded-[7px] border px-2 py-1 font-mono text-[13px] font-[600] shadow-[var(--shadow-pop)]"
          style={{
            borderColor: lit ? `color-mix(in oklab, var(--st-${v}) 50%, transparent)` : "var(--line)",
            background: lit ? `var(--st-${v}-soft)` : "var(--raised)",
            color: lit ? `var(--st-${v}-fg)` : "var(--fg-3)",
            opacity: lit ? 1 : 0.92,
          }}
        >
          {current && <span className="size-2 rounded-full" style={{ background: `var(--st-${v})`, boxShadow: `0 0 10px var(--st-${v})` }} />}
          {status}
        </span>
      </motion.div>
    </div>
  );
}

/** A glowing packet that hops along the transition the step is about. */
function Packet({ focus, rx, rz, reduce }: { focus?: string; rx: MotionValue<number>; rz: MotionValue<number>; reduce: boolean }) {
  const el = useRef<HTMLDivElement>(null);
  const d = focus ? PATHS.get(focus) : undefined;
  const measure = useMemo(() => {
    if (!d || typeof document === "undefined") return null;
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", d);
    return p;
  }, [d]);

  useEffect(() => {
    const node = el.current;
    if (!node || !measure) return;
    const len = measure.getTotalLength();
    let raf = 0;
    const t0 = performance.now();
    const frame = (now: number) => {
      const t = reduce ? 1 : ((now - t0) % 1900) / 1900;
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const pt = measure.getPointAtLength(len * Math.min(1, e * 1.05));
      const z = 14 + Math.sin(Math.PI * e) * 46;
      node.style.transform = `translate3d(${pt.x}px, ${pt.y}px, ${z}px) rotateZ(${-rz.get()}deg) rotateX(${-rx.get()}deg) translate(-50%, -50%)`;
      node.style.opacity = reduce ? "1" : String(Math.min(1, Math.sin(Math.PI * t) * 3));
      if (!reduce) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [measure, reduce, rx, rz]);

  if (!d) return null;
  return (
    <div
      ref={el}
      aria-hidden
      className="absolute top-0 left-0 size-5 rounded-full"
      style={{ transformOrigin: "0 0", background: "radial-gradient(circle at 35% 35%, #fff, var(--signal) 45%, color-mix(in oklab, var(--signal) 40%, black) 100%)", boxShadow: "0 0 18px 4px color-mix(in oklab, var(--signal) 60%, transparent)" }}
    />
  );
}
