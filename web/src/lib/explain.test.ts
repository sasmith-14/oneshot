import { describe, expect, it } from "vitest";
import { explainEvent, explainOutcome } from "./explain";
import { ev } from "@/test/fixtures";
import { EDGES } from "@/components/StateMachine";

// Real reason strings from oneshot/policy.py, so these tests break if the
// backend's wording changes in a way the explanations depend on.
describe("explainEvent", () => {
  it("distinguishes a same-key retry from a provably-not-applied retry", () => {
    const sameKey = explainEvent(ev("IN_FLIGHT", "PENDING", "timed out; outcome unknown -> retry in 0.50s with the SAME idempotency key (provider deduplicates, so a retry cannot double-apply)"));
    const notApplied = explainEvent(ev("IN_FLIGHT", "PENDING", "HTTP 503 unavailable (applied=false); definitely not applied -> retry in 0.50s (attempt 2/5)"));
    expect(sameKey).toMatch(/deduplicates by key/);
    expect(notApplied).toMatch(/proved nothing happened/);
  });

  it("explains FAILED differently for a decline and for exhausted retries", () => {
    expect(explainEvent(ev("IN_FLIGHT", "FAILED", "provider rejected permanently (HTTP 402 declined); not applied, not retrying"))).toMatch(/permanent no/);
    expect(explainEvent(ev("IN_FLIGHT", "FAILED", "HTTP 503; retries exhausted and every attempt was definitely not applied"))).toMatch(/retry budget/);
  });

  it("flags a duplicate found during verification", () => {
    expect(explainEvent(ev("VERIFYING", "SUCCEEDED", "provider's record shows ... WARNING: provider shows 2 effects for this action (duplicate!)"))).toMatch(/duplicate slipped through/);
  });

  it("explains the pre-send veto", () => {
    expect(explainEvent(ev("IN_FLIGHT", "VERIFYING", "send cancelled: an earlier attempt may have applied ... -> check provider's record instead"))).toMatch(/safety check/);
  });

  it("names who resolved an UNKNOWN", () => {
    expect(explainEvent(ev("UNKNOWN", "SUCCEEDED", "resolved by reconciler: provider ledger shows effect eff_1"))).toMatch(/^Reconciliation/);
    expect(explainEvent(ev("UNKNOWN", "FAILED", "resolved by operator (web console): checked"))).toMatch(/^An operator/);
  });

  it("has a specific explanation for every legal transition in the diagram", () => {
    for (const e of EDGES) {
      const text = explainEvent(ev(e.from, e.to, e.from === "UNKNOWN" ? "resolved by reconciler: x" : "x"));
      expect(text, `${e.from}->${e.to}`).not.toMatch(/its own reason is shown above/);
    }
  });

  it("never claims exactly-once", () => {
    for (const e of EDGES) expect(explainEvent(ev(e.from, e.to, "x"))).not.toMatch(/exactly.once delivery/i);
  });
});

describe("explainOutcome", () => {
  it("says an open attempt is still running", () => {
    expect(explainOutcome(null)).toMatch(/Still running/);
    expect(explainOutcome("AMBIGUOUS")).toMatch(/may or may not/);
  });
});
