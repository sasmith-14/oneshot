import { describe, expect, it } from "vitest";
import { compare, settleDeadline } from "./compare";
import { action, att, eff } from "@/test/fixtures";

// Mirrors oneshot/reconciler.py's per-action rules.
describe("compare", () => {
  it.each([
    ["SUCCEEDED", 1, "match"],
    ["SUCCEEDED", 0, "mismatch"],
    ["FAILED", 0, "match"],
    ["FAILED", 1, "mismatch"],
    ["UNKNOWN", 1, "evidence"],
    ["UNKNOWN", 0, "evidence"],
    ["VERIFYING", 0, "running"],
    ["PENDING", 2, "mismatch"],
  ] as const)("%s with %i effect(s) -> %s", (status, n, kind) => {
    const effects = Array.from({ length: n }, (_, i) => eff(`eff_${i}`));
    expect(compare(action({ status }), effects).kind).toBe(kind);
  });

  it("suggests the resolution the evidence supports", () => {
    const yes = compare(action({ status: "UNKNOWN" }), [eff("eff_1")]);
    const no = compare(action({ status: "UNKNOWN" }), []);
    expect(yes.kind === "evidence" && yes.suggest).toBe("SUCCEEDED");
    expect(no.kind === "evidence" && no.suggest).toBe("FAILED");
  });

  it("catches a recorded effect id that differs from the provider's", () => {
    expect(compare(action({ provider_effect_id: "eff_9" }), [eff("eff_1")]).kind).toBe("mismatch");
  });

  it("computes the settle deadline from the last send", () => {
    expect(settleDeadline(action({ attempts: [att({ started_at: 10 }), att({ kind: "verify", started_at: 50 }), att({ started_at: 20 })] }), 5)).toBe(25);
    expect(settleDeadline(action(), 5)).toBeNull();
  });
});
