import { describe, expect, it } from "vitest";
import { FINDING_GUIDE, diffRows } from "./findings";

describe("findings", () => {
  it("has a plain-English guide for every reconciler finding kind", () => {
    const kinds = ["MATCH", "STILL_RUNNING", "RESOLVED_SUCCEEDED", "RESOLVED_FAILED", "UNRESOLVED_UNKNOWN", "MISSING_EFFECT", "UNEXPECTED_EFFECT", "DUPLICATE_EFFECT", "ORPHAN_EFFECT", "SUSPECTED_DUPLICATE_REQUEST"];
    for (const k of kinds) expect(FINDING_GUIDE[k]?.todo, k).toBeTruthy();
  });

  it("pairs actions with effects and finds duplicates, orphans and mismatches", () => {
    const rows = diffRows(
      [
        { id: "a", status: "SUCCEEDED", provider_effect_id: "e1" },
        { id: "b", status: "SUCCEEDED", provider_effect_id: null },
        { id: "c", status: "SUCCEEDED", provider_effect_id: "e2" },
        { id: "d", status: "FAILED", provider_effect_id: null },
        { id: "f", status: "FAILED", provider_effect_id: null },
      ],
      [
        { id: "e1", reference: "a" },
        { id: "e2", reference: "c" },
        { id: "e3", reference: "c" },
        { id: "e4", reference: "zzz" },
        { id: "e5", reference: "f" },
      ],
    );
    expect(rows.map((r) => [r.actionId, r.kind])).toEqual([
      ["a", "match"],
      ["b", "missing"],
      ["c", "duplicate"],
      ["d", "none"],
      ["f", "unexpected"],
      [null, "orphan"],
    ]);
  });
});
