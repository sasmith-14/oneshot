import { describe, expect, it } from "vitest";
import { count, frontPage, noun, reportLine, storyHeadline } from "./headline";
import type { SystemStatus } from "./api";
import { action } from "@/test/fixtures";

function status(over: Partial<SystemStatus> = {}): SystemStatus {
  return {
    now: 0,
    lab: true,
    counts: {},
    provider: { url: "", reachable: true, error: null },
    workers: [{ id: "w", pid: 1, started_at: 0, last_seen_at: 0, stopped_at: null, state: "alive", seconds_since_seen: 1 }],
    worker_silent_after_seconds: 10,
    settings: { provider_timeout_seconds: 5, lease_seconds: 30, max_attempts: 5, max_verifications: 3, provider_settle_seconds: 3, provider_key_retention_seconds: 600 },
    ...over,
  };
}

describe("frontPage", () => {
  it("leads with UNKNOWN actions, in words", () => {
    const fp = frontPage(status({ counts: { UNKNOWN: 3, SUCCEEDED: 9 } }), false);
    expect(fp.headline).toBe("Three actions need a human.");
    expect(fp.tone).toBe("attention");
    expect(frontPage(status({ counts: { UNKNOWN: 1 } }), false).headline).toBe("One action needs a human.");
  });

  it("reports a missing worker only when something is waiting", () => {
    const none = status({ workers: [], counts: { PENDING: 2 } });
    expect(frontPage(none, false).headline).toBe("Two actions are waiting for a worker.");
    expect(frontPage(status({ workers: [], counts: { SUCCEEDED: 2 } }), false).headline).toBe("Both actions are settled.");
  });

  it("says plainly when everything is settled, and never claims more than the counts", () => {
    const fp = frontPage(status({ counts: { SUCCEEDED: 12, FAILED: 2 } }), false);
    expect(fp.headline).toBe("All 14 actions are settled.");
    expect(fp.standfirst).toBe("12 succeeded and two failed. Each has a definite answer, and nothing is waiting.");
  });

  it("handles an empty record, an unreachable provider and a dead API", () => {
    expect(frontPage(status(), false).headline).toBe("Nothing has been asked for yet.");
    expect(frontPage(status({ provider: { url: "", reachable: false, error: "refused" } }), false).headline).toBe("The provider is not answering.");
    expect(frontPage(undefined, true).tone).toBe("trouble");
  });
});

describe("words", () => {
  it("spells small numbers and names action types", () => {
    expect(count(0)).toBe("no");
    expect(count(10)).toBe("ten");
    expect(count(11)).toBe("11");
    expect(noun("payment.charge")).toBe("charge");
    expect(noun("message.send")).toBe("message");
  });

  it("writes a report line and a story headline for every status", () => {
    expect(reportLine("SUCCEEDED", "VERIFYING")).toMatch(/ledger/);
    expect(reportLine("UNKNOWN", "VERIFYING")).toMatch(/did not guess/);
    expect(storyHeadline(action({ status: "SUCCEEDED", verify_count: 1 }))).toBe("The reply was lost. The ledger says it happened.");
    expect(storyHeadline(action({ status: "UNKNOWN", type: "payment.charge" }))).toBe("Nobody can yet say if this charge happened.");
  });
});
