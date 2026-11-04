import { describe, expect, it } from "vitest";
import { buildScale, buildTrace, span, toneOf } from "./trace";
import { action, att, eff, ev } from "@/test/fixtures";

describe("buildScale", () => {
  it("is linear when nothing needs compressing", () => {
    const s = buildScale([101, 102], 100, 104);
    expect(s.x(100)).toBe(0);
    expect(s.x(104)).toBe(1);
    expect(s.x(102)).toBeCloseTo(0.5);
    expect(s.breaks).toHaveLength(0);
    expect(s.invert(s.x(101.3))).toBeCloseTo(101.3);
  });

  it("compresses a long idle gap and marks it with a break", () => {
    // 2 s of activity, then an hour of nothing, then a resolution
    const s = buildScale([101, 102], 100, 102 + 3600);
    expect(s.breaks).toHaveLength(1);
    expect(s.breaks[0].seconds).toBe(3600);
    // the active first two seconds still get a fair share of the width
    expect(s.x(102)).toBeGreaterThan(0.08);
    // and order is preserved
    expect(s.x(101)).toBeLessThan(s.x(102));
  });
});

describe("buildTrace", () => {
  it("builds status segments, spans with tones, and ledger effects", () => {
    const a = action({
      status: "SUCCEEDED",
      created_at: 100,
      updated_at: 106,
      events: [ev(null, "PENDING", "", 100), ev("PENDING", "IN_FLIGHT", "", 100.1), ev("IN_FLIGHT", "VERIFYING", "", 100.5), ev("VERIFYING", "SUCCEEDED", "", 106)],
      attempts: [
        att({ kind: "send", number: 1, started_at: 100.1, finished_at: 100.5, outcome: "AMBIGUOUS" }),
        att({ kind: "verify", number: 1, started_at: 105.9, finished_at: 106, outcome: "FOUND" }),
      ],
    });
    const t = buildTrace(a, [eff("eff_1", 100.3)]);
    expect(t.segments.map((s) => s.status)).toEqual(["PENDING", "IN_FLIGHT", "VERIFYING", "SUCCEEDED"]);
    expect(t.segments[2]).toMatchObject({ start: 100.5, end: 106 });
    expect(t.spans.map((s) => [s.label, s.tone])).toEqual([["Send 1", "lost"], ["Ledger check 1", "ok"]]);
    // the effect was written while the reply was being lost: it sits inside the send span
    expect(t.effects[0].at).toBeGreaterThan(t.spans[0].start);
    expect(t.effects[0].at).toBeLessThan(t.spans[0].end);
  });

  it("keeps a running attempt open until now", () => {
    const a = action({ status: "IN_FLIGHT", created_at: 100, updated_at: 100.1, attempts: [att({ started_at: 100.1, finished_at: null, outcome: null })] });
    const t = buildTrace(a, [], 103);
    expect(t.spans[0]).toMatchObject({ running: true, tone: "running", end: 103 });
  });

  it("names tones and durations", () => {
    expect(toneOf("REJECTED")).toBe("fail");
    expect(toneOf("LOOKUP_FAILED")).toBe("warn");
    expect(span(0.4)).toBe("0.40s");
    expect(span(185)).toBe("3m 05s");
    expect(span(3720)).toBe("1h 02m");
  });
});
