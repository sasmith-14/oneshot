import type { Severity } from "./api";

// Plain-English guide for every reconciliation finding (oneshot/reconciler.py).
export interface FindingGuide {
  title: string;
  means: string;
  how: string;
  todo: string;
}

export const FINDING_GUIDE: Record<string, FindingGuide> = {
  MATCH: {
    title: "Match",
    means: "OneShot's final answer agrees with the provider's ledger.",
    how: "The normal case.",
    todo: "Nothing.",
  },
  STILL_RUNNING: {
    title: "Still running",
    means: "The action is not final yet, so there is nothing to compare.",
    how: "A worker is retrying, verifying, or waiting for its next attempt.",
    todo: "Run reconciliation again later.",
  },
  RESOLVED_SUCCEEDED: {
    title: "Resolved: it happened",
    means: "An UNKNOWN action was resolved to SUCCEEDED because the provider's ledger has the effect.",
    how: "The outcome was ambiguous and OneShot could not check at the time, for example because the provider was down.",
    todo: "Nothing. The audit trail records the resolution.",
  },
  RESOLVED_FAILED: {
    title: "Resolved: it did not happen",
    means: "An UNKNOWN action was resolved to FAILED. The ledger has no effect, and the settle window has passed.",
    how: "The request never reached the provider, or the provider never applied it.",
    todo: "Nothing. The agent can safely try again with a new request.",
  },
  UNRESOLVED_UNKNOWN: {
    title: "Unknown, too early to tell",
    means: "No effect at the provider yet, but the settle window has not passed, so “absent” is not conclusive.",
    how: "Reconciliation ran soon after the last send.",
    todo: "Run reconciliation again after the settle window.",
  },
  MISSING_EFFECT: {
    title: "Missing effect",
    means: "OneShot told the agent SUCCEEDED, but the provider has no such effect.",
    how: "The provider lost data, or broke its API contract.",
    todo: "Investigate with the provider. This is critical: the agent believes something happened that did not.",
  },
  UNEXPECTED_EFFECT: {
    title: "Unexpected effect",
    means: "OneShot told the agent FAILED, but the provider applied it.",
    how: "The provider said “not applied” and then applied anyway, which breaks its contract.",
    todo: "Tell the agent and consider compensating (for example a refund). Terminal states are never flipped automatically.",
  },
  DUPLICATE_EFFECT: {
    title: "Duplicate effect",
    means: "The provider applied one action more than once.",
    how: "A documented gap: a non-idempotent provider slower than the settle window, or a misconfigured key-retention window.",
    todo: "Compensate the extra effect (for example refund it) and check the settle and retention settings.",
  },
  ORPHAN_EFFECT: {
    title: "Orphan effect",
    means: "The provider has an effect that OneShot has no record of.",
    how: "OneShot's database was lost or restored from an old backup, or a client called the provider directly.",
    todo: "Investigate where it came from. OneShot cannot know whether the agent wanted it.",
  },
  SUSPECTED_DUPLICATE_REQUEST: {
    title: "Suspected duplicate request",
    means: "Two actions with identical content were submitted close together under different Idempotency-Keys.",
    how: "The agent probably retried with a fresh key instead of reusing the original one. It might also have meant to do it twice.",
    todo: "Ask the agent's owner. OneShot only warns, because it cannot know the intent.",
  },
};

export const SEVERITY_ORDER: Severity[] = ["critical", "warning", "resolved", "info", "ok"];

export const SEVERITY_STYLE: Record<Severity, { label: string; chip: string; dot: string }> = {
  critical: { label: "Critical", chip: "bg-st-failed-soft text-st-failed-fg border-st-failed/30", dot: "bg-st-failed" },
  warning: { label: "Warning", chip: "bg-st-verifying-soft text-st-verifying-fg border-st-verifying/30", dot: "bg-st-verifying" },
  resolved: { label: "Resolved", chip: "bg-st-unknown-soft text-st-unknown-fg border-st-unknown/30", dot: "bg-st-unknown" },
  info: { label: "Info", chip: "bg-st-inflight-soft text-st-inflight-fg border-st-inflight/30", dot: "bg-st-inflight" },
  ok: { label: "OK", chip: "bg-st-succeeded-soft text-st-succeeded-fg border-st-succeeded/30", dot: "bg-st-succeeded" },
};

/** Pair OneShot actions with provider effects for the side-by-side view. */
export interface DiffRow {
  actionId: string | null;
  effectIds: string[];
  kind: "match" | "missing" | "duplicate" | "orphan" | "none" | "unexpected";
}

export function diffRows(
  actions: { id: string; status: string; provider_effect_id: string | null }[],
  effects: { id: string; reference: string | null }[],
): DiffRow[] {
  const byRef = new Map<string, string[]>();
  for (const e of effects) {
    const k = e.reference ?? "";
    byRef.set(k, [...(byRef.get(k) ?? []), e.id]);
  }
  const rows: DiffRow[] = actions.map((a) => {
    const ids = byRef.get(a.id) ?? [];
    byRef.delete(a.id);
    let kind: DiffRow["kind"];
    if (ids.length > 1) kind = "duplicate";
    else if (a.status === "SUCCEEDED") kind = ids.length ? "match" : "missing";
    else if (a.status === "FAILED") kind = ids.length ? "unexpected" : "none";
    else kind = ids.length ? "match" : "none";
    return { actionId: a.id, effectIds: ids, kind };
  });
  for (const ids of byRef.values()) rows.push({ actionId: null, effectIds: ids, kind: "orphan" });
  return rows;
}
