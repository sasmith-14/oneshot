import type { Status } from "./api";

// What the topology animates when an action's status is seen to change between
// two polls. Polling is coarse (1 s), so one observed change can stand for
// several real steps (PENDING → SUCCEEDED in one poll means claim, send, apply
// and reply). The journey replays those steps along the real path. It never
// invents an outcome: a lost reply is drawn as lost, not as success.

export const NODES = ["agent", "api", "worker", "provider", "ledger"] as const;
export type NodeId = (typeof NODES)[number];

export type HopKind = "request" | "ok" | "fail" | "retry" | "lost" | "lookup";

export interface Hop {
  from: NodeId;
  to: NodeId;
  kind: HopKind;
  /** where along the edge a lost packet stops (0–1) */
  breakAt?: number;
}

export interface Journey {
  hops: Hop[];
  /** a node that flashes with no packet, e.g. a resolution by reconciliation */
  pulse?: { node: NodeId; kind: HopKind };
}

const h = (from: NodeId, to: NodeId, kind: HopKind, breakAt?: number): Hop => ({ from, to, kind, breakAt });

const REQUEST = h("agent", "api", "request");
const CLAIM = h("api", "worker", "request");
const SEND = h("worker", "provider", "request");
const APPLY = h("provider", "ledger", "ok");
const REPLY_OK = h("provider", "worker", "ok");
const REPLY_NO = h("provider", "worker", "fail");
const REPLY_RETRY = h("provider", "worker", "retry");
const REPLY_LOST = h("provider", "worker", "lost", 0.5);
const RECORD_OK = h("worker", "api", "ok");
const RECORD_NO = h("worker", "api", "fail");
const LOOKUP = [h("worker", "provider", "lookup"), h("provider", "ledger", "lookup")];
const FOUND = [h("ledger", "provider", "ok"), h("provider", "worker", "ok")];
const ABSENT = [h("ledger", "provider", "retry"), h("provider", "worker", "retry")];
const LOOKUP_FAILS = [h("worker", "provider", "lost", 0.6)];

/** The steps from a claimed send to the observed status. */
function fromInFlight(next: Status): Hop[] {
  switch (next) {
    case "SUCCEEDED":
      return [APPLY, REPLY_OK, RECORD_OK];
    case "FAILED":
      return [REPLY_NO, RECORD_NO];
    case "VERIFYING":
      return [REPLY_LOST];
    case "PENDING":
      return [REPLY_RETRY];
    case "UNKNOWN":
      return [REPLY_LOST, ...LOOKUP_FAILS];
    default:
      return [];
  }
}

export function journeyFor(prev: Status | null, next: Status): Journey {
  if (prev === next) return { hops: [] };
  if (prev === null) {
    const rest = next === "PENDING" ? [] : journeyFor("PENDING", next).hops;
    return { hops: [REQUEST, ...rest] };
  }
  switch (prev) {
    case "PENDING":
      return { hops: next === "IN_FLIGHT" ? [CLAIM, SEND] : [CLAIM, SEND, ...fromInFlight(next)] };
    case "IN_FLIGHT":
      return { hops: fromInFlight(next) };
    case "VERIFYING":
      if (next === "SUCCEEDED") return { hops: [...LOOKUP, ...FOUND, RECORD_OK] };
      if (next === "PENDING") return { hops: [...LOOKUP, ...ABSENT] };
      if (next === "FAILED") return { hops: [...LOOKUP, ...ABSENT, RECORD_NO] };
      if (next === "UNKNOWN") return { hops: LOOKUP_FAILS };
      return { hops: [] };
    case "UNKNOWN":
      // resolved by reconciliation or a person: no request crosses the wire
      return { hops: [], pulse: { node: "api", kind: next === "SUCCEEDED" ? "ok" : "fail" } };
    default:
      // SUCCEEDED and FAILED are final
      return { hops: [] };
  }
}

/** Every hop goes between neighbours on the path, so the topology only needs
 * one forward and one return edge per neighbouring pair. */
export function isNeighbour(a: NodeId, b: NodeId): boolean {
  return Math.abs(NODES.indexOf(a) - NODES.indexOf(b)) === 1;
}
