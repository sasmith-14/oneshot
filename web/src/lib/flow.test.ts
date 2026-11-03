import { describe, expect, it } from "vitest";
import { buildFlow } from "./flow";
import { action, att, eff, ev } from "@/test/fixtures";

describe("buildFlow", () => {
  it("shows a lost response as a broken arrow, with the ledger write in between", () => {
    const a = action({
      attempts: [att({ outcome: "AMBIGUOUS", detail: "connection dropped before a response arrived", started_at: 101, finished_at: 102 })],
    });
    const rows = buildFlow(a, [eff("eff_1", 101.5)]);
    const labels = rows.map((r) => r.label);
    expect(labels).toEqual(["POST /actions", "201 accepted", "#1 POST /v1/messages", "effect eff_1 recorded", "no usable response"]);
    const lost = rows[4];
    expect(lost.kind === "msg" && lost.style).toBe("broken");
  });

  it("marks a refused connection as never arriving, with no response row", () => {
    const rows = buildFlow(action({ attempts: [att({ outcome: "RETRYABLE", detail: "could not connect (ConnectError); request never sent" })] }), []);
    expect(rows).toHaveLength(3);
    expect(rows[2]).toMatchObject({ kind: "msg", style: "broken", to: "provider" });
  });

  it("flags more than one effect as a duplicate", () => {
    const rows = buildFlow(action(), [eff("eff_1", 101), eff("eff_2", 103)]);
    expect(rows.filter((r) => r.label.includes("duplicate"))).toHaveLength(2);
  });

  it("shows an open attempt as pending and a crash as a note", () => {
    const open = buildFlow(action({ attempts: [att({ outcome: null, finished_at: null })] }), []);
    expect(open[2]).toMatchObject({ style: "pending" });
    const crashed = buildFlow(action({ attempts: [att({ outcome: "CRASHED" })] }), []);
    expect(crashed.some((r) => r.kind === "note" && r.label.includes("worker died"))).toBe(true);
  });

  it("adds verification lookups and resolutions in time order", () => {
    const a = action({
      status: "SUCCEEDED",
      attempts: [att({ outcome: "AMBIGUOUS", started_at: 101, finished_at: 102 }), att({ kind: "verify", outcome: "FOUND", detail: "found eff_1", started_at: 110, finished_at: 110.1 })],
      events: [ev("VERIFYING", "UNKNOWN", "could not check", 105), ev("UNKNOWN", "SUCCEEDED", "resolved by reconciler: provider ledger shows effect eff_1", 120)],
    });
    const rows = buildFlow(a, [eff("eff_1", 101.4)]);
    const at = rows.map((r) => r.at);
    expect([...at].sort((x, y) => x - y)).toEqual(at);
    expect(rows.at(-1)).toMatchObject({ kind: "note", label: "resolved → SUCCEEDED" });
  });

  it("says whether the idempotency key was sent", () => {
    const withKey = buildFlow(action({ type: "payment.charge", attempts: [att({})] }), [], { idempotent: true });
    expect(withKey[2]).toMatchObject({ label: "#1 POST /v1/charges", sub: "Idempotency-Key act_1" });
  });
});
