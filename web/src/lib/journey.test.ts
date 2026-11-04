import { describe, expect, it } from "vitest";
import { STATUSES, type Status } from "./api";
import { isNeighbour, journeyFor } from "./journey";

const path = (prev: Status | null, next: Status) => journeyFor(prev, next).hops.map((h) => `${h.from}>${h.to}:${h.kind}`);

describe("journeyFor", () => {
  it("replays a whole happy path seen in one poll", () => {
    expect(path(null, "SUCCEEDED")).toEqual([
      "agent>api:request",
      "api>worker:request",
      "worker>provider:request",
      "provider>ledger:ok",
      "provider>worker:ok",
      "worker>api:ok",
    ]);
  });

  it("draws a lost reply as lost, never as success", () => {
    const hops = journeyFor("IN_FLIGHT", "VERIFYING").hops;
    expect(hops).toHaveLength(1);
    expect(hops[0]).toMatchObject({ from: "provider", to: "worker", kind: "lost" });
    expect(hops[0].breakAt).toBeGreaterThan(0);
    expect(path("IN_FLIGHT", "VERIFYING").join()).not.toMatch(/ledger/);
  });

  it("looks in the ledger before deciding after an unclear answer", () => {
    expect(path("VERIFYING", "SUCCEEDED").slice(0, 2)).toEqual(["worker>provider:lookup", "provider>ledger:lookup"]);
    expect(path("VERIFYING", "PENDING").at(-1)).toBe("provider>worker:retry");
    expect(path("VERIFYING", "UNKNOWN")).toEqual(["worker>provider:lost"]);
  });

  it("sends nothing across the wire for a resolution, and nothing for final states", () => {
    expect(journeyFor("UNKNOWN", "SUCCEEDED")).toEqual({ hops: [], pulse: { node: "api", kind: "ok" } });
    expect(path("SUCCEEDED", "FAILED")).toEqual([]);
    expect(path("PENDING", "PENDING")).toEqual([]);
  });

  it("only ever moves between neighbouring nodes", () => {
    for (const prev of [null, ...STATUSES] as (Status | null)[])
      for (const next of STATUSES) for (const hop of journeyFor(prev, next).hops) expect(isNeighbour(hop.from, hop.to)).toBe(true);
  });
});
