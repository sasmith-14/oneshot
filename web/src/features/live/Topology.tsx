import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Bot, BookText, Cpu, Database, Server } from "lucide-react";
import type { Action, LabState, Status, SystemStatus } from "@/lib/api";
import { NODES, journeyFor, type Hop, type HopKind, type NodeId } from "@/lib/journey";
import { noun, reportLine } from "@/lib/headline";
import { STATUS_META } from "@/lib/status";
import { EASE_OUT } from "@/lib/motion";
import { cn } from "@/lib/utils";

// The live system map. Every packet is a status change the console actually
// observed between two polls, replayed along the path it took (see
// lib/journey.ts). Worker heartbeats travel too, faintly. A provider that is
// down, a worker that is silent and an armed fault all show on the nodes.

const X: Record<NodeId, number> = { agent: 0.075, api: 0.2875, worker: 0.5, provider: 0.7125, ledger: 0.925 };
const NODE_W = 156;
const HEIGHT = 232;
const CY = 112;

const COLOUR: Record<HopKind | "heartbeat", string> = {
  request: "var(--fg-2)",
  ok: "var(--st-succeeded)",
  fail: "var(--st-failed)",
  retry: "var(--st-pending)",
  lost: "var(--st-unknown)",
  lookup: "var(--st-verifying)",
  heartbeat: "var(--fg-3)",
};

const LABELS: Record<string, [string, string]> = {
  "agent>api": ["POST /actions", "201 + id"],
  "api>worker": ["claim + lease", "record result"],
  "worker>provider": ["send · lookup", "reply"],
  "provider>ledger": ["apply · read", "effects"],
};

interface Change {
  key: string;
  at: number;
  id: string;
  type: string;
  from: Status | null;
  to: Status;
  attempts: number;
}

const SVGNS = "http://www.w3.org/2000/svg";
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function Topology({ actions, status, lab, effects }: { actions?: Action[]; status?: SystemStatus; lab?: LabState; effects?: number }) {
  const reduce = useReducedMotion();
  const box = useRef<HTMLDivElement>(null);
  const layer = useRef<SVGGElement>(null);
  const paths = useRef(new Map<string, SVGPathElement>());
  const flashes = useRef(new Map<string, SVGPathElement>());
  const rings = useRef(new Map<NodeId, HTMLSpanElement>());
  const [w, setW] = useState(1200);
  const [changes, setChanges] = useState<Change[]>([]);
  const seen = useRef<Map<string, Status> | null>(null);
  const lastBeat = useRef<number | null>(null);
  const live = useRef(0);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pulse = useCallback(
    (node: NodeId, colour: string) => {
      const ring = rings.current.get(node);
      if (!ring) return;
      ring.style.borderColor = colour;
      ring.animate([{ opacity: 0.9, transform: "scale(1)" }, { opacity: 0, transform: "scale(1.09)" }], { duration: reduce ? 700 : 650, easing: "cubic-bezier(0.23, 1, 0.32, 1)" });
    },
    [reduce],
  );

  // Send one packet along one edge; resolve when it lands (or breaks).
  const fly = useCallback(
    (hop: Hop | { from: NodeId; to: NodeId; kind: "heartbeat"; breakAt?: number }) =>
      new Promise<void>((resolve) => {
        const key = `${hop.from}>${hop.to}`;
        const path = paths.current.get(key);
        const g = layer.current;
        const colour = COLOUR[hop.kind];
        if (!path || !g || reduce || live.current > 28) {
          pulse(hop.to, colour);
          resolve();
          return;
        }
        live.current += 1;
        const beat = hop.kind === "heartbeat";
        const len = path.getTotalLength();
        const group = document.createElementNS(SVGNS, "g");
        const dots = [beat ? 2.5 : 4.2, 3, 2.2, 1.5].map((r, i) => {
          const c = document.createElementNS(SVGNS, "circle");
          c.setAttribute("r", String(r));
          c.style.fill = colour;
          c.style.opacity = String(beat ? 0.55 : [1, 0.42, 0.24, 0.12][i]);
          group.appendChild(c);
          return c;
        });
        if (!beat) {
          const halo = document.createElementNS(SVGNS, "circle");
          halo.setAttribute("r", "10");
          halo.style.fill = colour;
          halo.style.opacity = "0.14";
          group.insertBefore(halo, group.firstChild);
          dots.unshift(halo);
        }
        g.appendChild(group);
        const flash = flashes.current.get(key);
        if (flash && !beat) {
          flash.style.stroke = colour;
          flash.animate([{ opacity: 0 }, { opacity: 0.55 }, { opacity: 0 }], { duration: 760, easing: "ease-out" });
        }
        const dur = beat ? 900 : 560;
        const t0 = performance.now();
        const place = (c: SVGCircleElement, p: number) => {
          const pt = path.getPointAtLength(len * Math.max(0, Math.min(1, p)));
          c.setAttribute("cx", pt.x.toFixed(1));
          c.setAttribute("cy", pt.y.toFixed(1));
        };
        const finish = () => {
          live.current -= 1;
          resolve();
        };
        const frame = (now: number) => {
          const raw = Math.min(1, (now - t0) / dur);
          const p = ease(raw);
          const stopAt = hop.breakAt;
          if (stopAt !== undefined && p >= stopAt) {
            // the reply is lost here: stop, mark the break, fade
            const pt = path.getPointAtLength(len * stopAt);
            const x = document.createElementNS(SVGNS, "path");
            x.setAttribute("d", `M${pt.x - 5},${pt.y - 5} L${pt.x + 5},${pt.y + 5} M${pt.x + 5},${pt.y - 5} L${pt.x - 5},${pt.y + 5}`);
            x.style.stroke = colour;
            x.style.strokeWidth = "2.2";
            x.style.strokeLinecap = "round";
            g.appendChild(x);
            group.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: "forwards" });
            x.animate([{ opacity: 0, transform: "scale(.6)" }, { opacity: 1, transform: "scale(1)", offset: 0.15 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], { duration: 1600, fill: "forwards" }).finished.then(() => x.remove());
            setTimeout(() => group.remove(), 320);
            finish();
            return;
          }
          dots.forEach((c, i) => place(c, beat ? p : p - (i === 0 ? 0 : (i - 1) * 0.035)));
          if (raw < 1) requestAnimationFrame(frame);
          else {
            group.remove();
            if (!beat) pulse(hop.to, colour);
            finish();
          }
        };
        requestAnimationFrame(frame);
      }),
    [pulse, reduce],
  );

  const run = useCallback(
    async (hops: Hop[], delay: number) => {
      await new Promise((r) => setTimeout(r, delay));
      for (const hop of hops) {
        await fly(hop);
        await new Promise((r) => setTimeout(r, 40));
      }
    },
    [fly],
  );

  // Watch for status changes between polls.
  useEffect(() => {
    if (!actions) return;
    if (seen.current === null) {
      seen.current = new Map(actions.map((a) => [a.id, a.status]));
      setChanges(
        [...actions]
          .sort((a, b) => b.updated_at - a.updated_at)
          .slice(0, 5)
          .map((a) => ({ key: `${a.id}-${a.status}`, at: a.updated_at, id: a.id, type: a.type, from: null, to: a.status, attempts: a.attempt_count })),
      );
      return;
    }
    const fresh: Change[] = [];
    for (const a of actions) {
      const before = seen.current.has(a.id) ? seen.current.get(a.id)! : null;
      if (before !== a.status) {
        fresh.push({ key: `${a.id}-${a.status}-${a.updated_at}`, at: a.updated_at, id: a.id, type: a.type, from: before, to: a.status, attempts: a.attempt_count });
        seen.current.set(a.id, a.status);
      }
    }
    if (!fresh.length) return;
    fresh.sort((a, b) => a.at - b.at);
    fresh.slice(-8).forEach((c, i) => {
      const j = journeyFor(c.from, c.to);
      if (j.pulse) pulse(j.pulse.node, COLOUR[j.pulse.kind]);
      void run(j.hops, i * 160);
    });
    setChanges((cs) => [...fresh.reverse(), ...cs].slice(0, 5));
  }, [actions, pulse, run]);

  // Worker heartbeats: a faint dot to the store each time one lands.
  const worker = status?.workers.find((x) => x.state === "alive");
  useEffect(() => {
    if (!worker) return;
    if (lastBeat.current !== null && worker.last_seen_at > lastBeat.current) void fly({ from: "worker", to: "api", kind: "heartbeat" });
    lastBeat.current = worker.last_seen_at;
  }, [worker, fly]);

  // geometry, in real pixels
  const nodeW = w < 900 ? 132 : NODE_W;
  const cx = (n: NodeId) => X[n] * w;
  const edge = (a: NodeId, b: NodeId, upper: boolean) => {
    const left = Math.min(cx(a), cx(b));
    const right = Math.max(cx(a), cx(b));
    const x1 = left + nodeW / 2 + 8;
    const x2 = right - nodeW / 2 - 8;
    const y = upper ? CY - 11 : CY + 11;
    const forward = `M${x1},${y} L${x2},${y}`;
    const back = `M${x2},${y} L${x1},${y}`;
    // a forward hop (left to right) rides the upper arc; a return rides the lower
    return cx(a) < cx(b) ? forward : back;
  };

  const providerUp = status ? status.provider.reachable : undefined;
  const faults = lab?.faults?.length ?? 0;
  const counts = status?.counts ?? {};
  const total = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);

  const nodes: { id: NodeId; name: string; role: string; Icon: typeof Bot; value: React.ReactNode; unit: string; state?: "up" | "down" | "idle"; badge?: string }[] = [
    { id: "agent", name: "Agent", role: "asks for actions", Icon: Bot, value: total, unit: "requests" },
    { id: "api", name: "OneShot", role: "API + durable store", Icon: Database, value: (counts.PENDING ?? 0) + (counts.VERIFYING ?? 0), unit: "waiting", state: status ? "up" : undefined },
    { id: "worker", name: "Worker", role: worker ? `pid ${worker.pid}` : "executes, with a lease", Icon: Cpu, value: counts.IN_FLIGHT ?? 0, unit: "in flight", state: status ? (worker ? "up" : "down") : undefined, badge: !worker && status ? "no heartbeat" : undefined },
    { id: "provider", name: "Provider", role: "fake payments + messages", Icon: Server, value: providerUp === false ? "down" : providerUp ? "up" : "…", unit: providerUp === false ? "requests fail" : "reachable", state: providerUp === undefined ? undefined : providerUp ? "up" : "down", badge: faults ? `${faults} fault${faults > 1 ? "s" : ""} armed` : undefined },
    { id: "ledger", name: "Ledger", role: "the provider's truth", Icon: BookText, value: effects ?? "…", unit: "effects", state: providerUp === false ? "idle" : providerUp ? "up" : undefined },
  ];

  return (
    <div>
      <div className="no-scrollbar overflow-x-auto" data-lenis-prevent-horizontal>
        <div ref={box} className="dot-grid relative min-w-[860px]" style={{ height: HEIGHT }} role="img" aria-label="Live system map: agent, OneShot, worker, provider and ledger, with requests moving between them as actions change status">
          <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox={`0 0 ${w} ${HEIGHT}`} aria-hidden>
            <defs>
              <marker id="topo-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0.5 L7.5,4 L0,7.5" fill="none" strokeWidth="1.3" className="stroke-fg-3" />
              </marker>
            </defs>
            {(["agent", "api", "worker", "provider"] as NodeId[]).map((a, i) => {
              const b = NODES[i + 1];
              const k = `${a}>${b}`;
              const down = (b === "provider" || b === "ledger") && providerUp === false;
              return (
                <g key={k}>
                  {[
                    [a, b, true],
                    [b, a, false],
                  ].map(([from, to, upper]) => {
                    const key = `${from}>${to}`;
                    const d = edge(from as NodeId, to as NodeId, upper as boolean);
                    return (
                      <g key={key}>
                        <path
                          d={d}
                          ref={(el) => {
                            if (el) paths.current.set(key, el);
                          }}
                          fill="none"
                          strokeWidth={1.25}
                          markerEnd="url(#topo-arrow)"
                          strokeDasharray={down ? "3 5" : undefined}
                          className={down ? "stroke-st-failed/50" : "stroke-line-strong"}
                        />
                        <path
                          d={d}
                          ref={(el) => {
                            if (el) flashes.current.set(key, el);
                          }}
                          fill="none"
                          strokeWidth={2.5}
                          strokeLinecap="round"
                          style={{ opacity: 0 }}
                        />
                      </g>
                    );
                  })}
                  <text x={(cx(a) + cx(b)) / 2} y={CY - 21} textAnchor="middle" className="fill-fg-3 font-mono text-[10.5px]">{LABELS[k][0]}</text>
                  <text x={(cx(a) + cx(b)) / 2} y={CY + 30} textAnchor="middle" className="fill-fg-3 font-mono text-[10.5px]">{LABELS[k][1]}</text>
                </g>
              );
            })}
            <g ref={layer} />
          </svg>

          {nodes.map((n) => (
            <div key={n.id} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: cx(n.id), top: CY, width: nodeW }}>
              <span
                ref={(el) => {
                  if (el) rings.current.set(n.id, el);
                }}
                aria-hidden
                className="pointer-events-none absolute -inset-[5px] rounded-[16px] border-2 opacity-0"
              />
              <div className={cn("relative rounded-[12px] border bg-surface p-3 shadow-[var(--shadow-card),var(--highlight)] transition-[opacity,border-color] duration-300", n.state === "down" ? "border-dashed border-st-failed/60" : "border-line", n.state === "idle" && "opacity-60")}>
                <div className="flex items-center gap-2">
                  <span className="grid size-6 shrink-0 place-items-center rounded-[7px] border border-line bg-sunken">
                    <n.Icon aria-hidden className="size-3.5 text-fg-2" />
                  </span>
                  <span className="min-w-0 truncate text-[13px] font-[600] tracking-[-0.01em]">{n.name}</span>
                  {n.state && (
                    <span className="relative ml-auto flex size-2 shrink-0" title={n.state === "up" ? "up" : n.state === "down" ? "down" : "unavailable"}>
                      {n.state === "up" && <span className="os-ring absolute inset-0 rounded-full bg-st-succeeded" />}
                      <span className={cn("relative size-2 rounded-full", n.state === "up" ? "bg-st-succeeded" : n.state === "down" ? "bg-st-failed" : "bg-fg-3")} />
                    </span>
                  )}
                </div>
                <p className="mt-0.5 truncate text-[11.5px] text-fg-3">{n.role}</p>
                <p className="mt-2.5 flex items-baseline gap-1.5">
                  <span className={cn("t-figure text-[22px]", n.state === "down" && "text-st-failed-fg")}>{n.value}</span>
                  <span className="text-[11.5px] text-fg-3">{n.unit}</span>
                </p>
              </div>
              <AnimatePresence>
                {n.badge && (
                  <motion.span initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25, ease: EASE_OUT }} className={cn("absolute top-full left-1/2 mt-2 -translate-x-1/2 whitespace-nowrap rounded-[6px] px-1.5 py-0.5 text-[11px] font-[560]", n.id === "provider" ? "bg-st-verifying-soft text-st-verifying-fg" : "bg-st-failed-soft text-st-failed-fg")}>
                    {n.badge}
                  </motion.span>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line px-[18px] py-3 text-[12px] text-fg-2">
        {(
          [
            ["request", "request"],
            ["ok", "confirmed"],
            ["fail", "declined"],
            ["retry", "nothing happened, retry"],
            ["lost", "reply lost"],
            ["lookup", "ledger lookup"],
          ] as [HopKind, string][]
        ).map(([k, label]) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: COLOUR[k] }} />
            {label}
          </span>
        ))}
        <span className="ml-auto text-fg-3">Each dot is a status change seen in the last second</span>
      </div>

      <ol aria-live="polite" aria-label="Latest changes" className="border-t border-line">
        <AnimatePresence initial={false}>
          {changes.length === 0 && <li className="px-[18px] py-3 text-[13px] text-fg-3">Nothing has happened yet. Run a failure on Chaos and watch it cross the wire.</li>}
          {changes.map((c) => (
            <motion.li
              key={c.key}
              layout="position"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.35, ease: EASE_OUT }}
              className="grid grid-cols-[4.75rem_minmax(0,1fr)] items-baseline gap-3 border-b border-line px-[18px] py-2 text-[13px] last:border-0 sm:grid-cols-[4.75rem_9.5rem_minmax(0,1fr)]"
            >
              <time className="font-mono text-[11.5px] text-fg-3 tnum">{new Date(c.at * 1000).toLocaleTimeString("en-GB", { hour12: false })}</time>
              <Link to={`/actions/${c.id}`} className="link-quiet hidden truncate font-mono text-[12px] text-fg-2 sm:block" translate="no">{c.id}</Link>
              <p className="min-w-0 truncate">
                <span className={cn("mr-2 inline-block size-1.5 -translate-y-px rounded-full", STATUS_META[c.to].dot)} />
                {noun(c.type).replace(/^./, (x) => x.toUpperCase())} {reportLine(c.to, c.from, c.attempts)}
              </p>
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
    </div>
  );
}
