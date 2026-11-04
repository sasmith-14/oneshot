import type { NodeId } from "@/lib/journey";
import { NODES } from "@/lib/journey";
import { cn } from "@/lib/utils";

// Where each preset's failure strikes, drawn on the same five-stop route as
// the system map: a node (a process dies, the provider says no) or the reply
// edge between two nodes (the answer is lost or late).

type Spot = { node: NodeId } | { reply: [NodeId, NodeId] } | null;

export const FAULT_AT: Record<string, { spot: Spot; note: string }> = {
  "happy-path": { spot: null, note: "no fault" },
  "transient-retry": { spot: { node: "provider" }, note: "503, nothing applied" },
  "permanent-decline": { spot: { node: "provider" }, note: "402, a definite no" },
  "timeout-charge": { spot: { reply: ["provider", "worker"] }, note: "the reply is late" },
  "lost-response-charge": { spot: { reply: ["provider", "worker"] }, note: "the reply is dropped" },
  "lost-response-message": { spot: { reply: ["provider", "worker"] }, note: "the reply is dropped" },
  "timeout-message": { spot: { reply: ["provider", "worker"] }, note: "the reply is late" },
  "server-error-after-apply": { spot: { reply: ["provider", "worker"] }, note: "500 after applying" },
  "provider-crash-unknown": { spot: { node: "provider" }, note: "crashes after applying" },
  "agent-retry-same-key": { spot: { node: "agent" }, note: "asks twice, same key" },
  "agent-retry-new-key": { spot: { node: "agent" }, note: "asks twice, new key" },
  "slow-provider-duplicate": { spot: { node: "provider" }, note: "slower than the settle window" },
  "worker-crash-after-response": { spot: { node: "worker" }, note: "dies after the reply" },
  "worker-crash-before-send": { spot: { node: "worker" }, note: "dies before sending" },
  "worker-kill-mid-request": { spot: { node: "worker" }, note: "kill -9 mid-request" },
};

const LETTER: Record<NodeId, string> = { agent: "Agent", api: "OneShot", worker: "Worker", provider: "Provider", ledger: "Ledger" };

export function FaultRoute({ preset, className }: { preset: string; className?: string }) {
  const f = FAULT_AT[preset] ?? { spot: null, note: "" };
  const x = (n: NodeId) => 14 + NODES.indexOf(n) * 58;
  const nodeHit = f.spot && "node" in f.spot ? f.spot.node : null;
  const reply = f.spot && "reply" in f.spot ? f.spot.reply : null;
  return (
    <figure className={cn("min-w-0", className)}>
      <svg viewBox="0 0 260 44" className="h-11 w-full max-w-[260px]" role="img" aria-label={`Where it fails: ${f.note || "nowhere"}`}>
        {NODES.slice(0, -1).map((n, i) => {
          const m = NODES[i + 1];
          const isReply = reply && ((reply[0] === m && reply[1] === n) || (reply[0] === n && reply[1] === m));
          return (
            <g key={n}>
              <line x1={x(n) + 6} y1={12} x2={x(m) - 6} y2={12} className="stroke-line-strong" strokeWidth={1.2} />
              <line x1={x(n) + 6} y1={20} x2={x(m) - 6} y2={20} className={isReply ? "stroke-st-unknown" : "stroke-line-strong"} strokeWidth={isReply ? 1.6 : 1.2} strokeDasharray={isReply ? "3 3" : undefined} />
              {isReply && (
                <path d={`M${(x(n) + x(m)) / 2 - 4},${16} l8,8 m0,-8 l-8,8`} className="stroke-st-unknown" strokeWidth={2} strokeLinecap="round" />
              )}
            </g>
          );
        })}
        {NODES.map((n) => (
          <g key={n}>
            {nodeHit === n && <circle cx={x(n)} cy={16} r={9} className="fill-st-failed/15 stroke-st-failed" strokeWidth={1.4} />}
            <circle cx={x(n)} cy={16} r={4.5} className={nodeHit === n ? "fill-st-failed" : "fill-surface stroke-fg-3"} strokeWidth={1.3} />
            <text x={x(n)} y={40} textAnchor="middle" className={cn("text-[9px]", nodeHit === n ? "fill-st-failed-fg font-semibold" : "fill-fg-3")}>{LETTER[n]}</text>
          </g>
        ))}
      </svg>
    </figure>
  );
}
