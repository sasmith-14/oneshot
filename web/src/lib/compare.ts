import type { ActionDetail, Effect } from "./api";

// Compares one action with the provider's record of it, using the same rules as
// oneshot/reconciler.py. This is a per-action *preview*. The reconciler run (the
// Reconcile page) is the authoritative check and the only thing that changes state.

export type Verdict =
  | { kind: "match"; title: string; detail: string }
  | { kind: "running"; title: string; detail: string }
  | { kind: "evidence"; title: string; detail: string; suggest: "SUCCEEDED" | "FAILED" | null }
  | { kind: "mismatch"; title: string; detail: string };

export function compare(action: ActionDetail, effects: Effect[]): Verdict {
  const n = effects.length;
  if (n > 1) {
    return {
      kind: "mismatch",
      title: `Duplicate: ${n} effects for one action`,
      detail: "The provider applied this action more than once. A duplicate slipped past every layer, so it needs compensation (for example a refund) and investigation.",
    };
  }
  switch (action.status) {
    case "PENDING":
    case "IN_FLIGHT":
    case "VERIFYING":
      return {
        kind: "running",
        title: "Still in progress",
        detail: n
          ? "The provider already has the effect; OneShot has not finished recording that yet."
          : "No effect at the provider yet. The worker is still handling this action, so the comparison is not final.",
      };
    case "SUCCEEDED":
      if (n === 0)
        return { kind: "mismatch", title: "Mismatch: missing effect", detail: "OneShot told the agent SUCCEEDED, but the provider has no such effect." };
      if (action.provider_effect_id && action.provider_effect_id !== effects[0].id)
        return { kind: "mismatch", title: "Mismatch: different effect id", detail: `OneShot recorded ${action.provider_effect_id}, but the provider's effect is ${effects[0].id}.` };
      return { kind: "match", title: "Match", detail: "OneShot says SUCCEEDED and the provider has exactly one effect for it." };
    case "FAILED":
      if (n > 0)
        return { kind: "mismatch", title: "Mismatch: unexpected effect", detail: "OneShot told the agent FAILED, but the provider applied it. The agent was told the wrong thing." };
      return { kind: "match", title: "Match", detail: "OneShot says FAILED and the provider has no effect for it." };
    case "UNKNOWN":
      if (n === 1)
        return { kind: "evidence", suggest: "SUCCEEDED", title: "Evidence: it happened", detail: `The provider's ledger has ${effects[0].id}, so this action can safely be resolved as SUCCEEDED.` };
      return {
        kind: "evidence",
        suggest: "FAILED",
        title: "Evidence: no effect at the provider",
        detail: "No effect found. If the settle window has passed since the last send, it is safe to resolve as FAILED; otherwise wait and check again.",
      };
  }
}

/** When did the provider's settle window end for this action's last send? */
export function settleDeadline(action: ActionDetail, settleSeconds: number): number | null {
  const sends = action.attempts.filter((a) => a.kind === "send");
  if (!sends.length) return null;
  return sends[sends.length - 1].started_at + settleSeconds;
}
