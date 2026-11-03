import type { ActionDetail, Attempt, ActionEvent, Effect } from "@/lib/api";

export function action(over: Partial<ActionDetail> = {}): ActionDetail {
  return {
    id: "act_1", type: "message.send", payload: { to: "+1", body: "hi" }, status: "SUCCEEDED",
    attempt_count: 1, verify_count: 0, maybe_applied: false, next_attempt_at: null,
    provider_effect_id: null, last_error: null, resolution: null, created_at: 100, updated_at: 100,
    attempts: [], events: [], ...over,
  };
}

export const att = (over: Partial<Attempt>): Attempt => ({
  number: 1, kind: "send", worker_id: "w", started_at: 101, finished_at: 102, outcome: "APPLIED", detail: null, ...over,
});

export const ev = (from: ActionEvent["from"], to: ActionEvent["to"], message = "", at = 100): ActionEvent => ({ from, to, message, at });

export const eff = (id: string, created_at = 101.5): Effect => ({
  id, kind: "message", reference: "act_1", idempotency_key: null, payload: {}, created_at,
});
