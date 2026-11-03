import type { ActionDetail, Attempt, Effect } from "./api";

// Turns the recorded facts (attempts, events, the provider's effects) into the
// rows of a sequence diagram. Every row comes from a real timestamp: nothing
// is invented, and if a fact is missing the row is missing.

export type Lane = "agent" | "oneshot" | "provider" | "ledger";
export const LANES: { id: Lane; label: string; hint: string }[] = [
  { id: "agent", label: "Agent", hint: "the AI agent that asked for the action" },
  { id: "oneshot", label: "OneShot", hint: "API + worker + its database" },
  { id: "provider", label: "Provider", hint: "the external service (fake, separate process)" },
  { id: "ledger", label: "Provider ledger", hint: "the provider's own record of what really happened" },
];

export type Tone = "ok" | "bad" | "warn" | "neutral" | "unknown";
export type ArrowStyle = "solid" | "dashed" | "broken" | "pending";

export type FlowRow =
  | { kind: "msg"; at: number; from: Lane; to: Lane; label: string; sub?: string; style: ArrowStyle; tone: Tone }
  | { kind: "note"; at: number; lane: Lane; label: string; sub?: string; tone: Tone };

const ENDPOINTS: Record<string, string> = {
  "payment.charge": "POST /v1/charges",
  "message.send": "POST /v1/messages",
};

export interface FlowOptions {
  /** provider honours the idempotency key for this action type */
  idempotent?: boolean;
}

export function buildFlow(action: ActionDetail, effects: Effect[] | undefined, opts: FlowOptions = {}): FlowRow[] {
  const rows: FlowRow[] = [];
  rows.push({
    kind: "msg", at: action.created_at, from: "agent", to: "oneshot",
    label: "POST /actions", sub: "with Idempotency-Key", style: "solid", tone: "neutral",
  });
  rows.push({
    kind: "msg", at: action.created_at, from: "oneshot", to: "agent",
    label: "201 accepted", sub: "saved to disk first", style: "dashed", tone: "ok",
  });

  for (const a of action.attempts) {
    if (a.kind === "send") rows.push(...sendRows(action, a, opts));
    else rows.push(...verifyRows(action, a));
  }

  const many = (effects?.length ?? 0) > 1;
  for (const e of effects ?? []) {
    rows.push({
      kind: "msg", at: e.created_at, from: "provider", to: "ledger",
      label: many ? `effect ${e.id} recorded (duplicate!)` : `effect ${e.id} recorded`,
      sub: e.idempotency_key ? `key ${e.idempotency_key}` : "no idempotency key",
      style: "solid", tone: many ? "bad" : "ok",
    });
  }

  for (const ev of action.events) {
    if (ev.message.startsWith("resolved by")) {
      rows.push({ kind: "note", at: ev.at, lane: "oneshot", label: `resolved → ${ev.to}`, sub: ev.message.replace(/^resolved by /, ""), tone: ev.to === "SUCCEEDED" ? "ok" : "bad" });
    } else if (ev.to === "UNKNOWN") {
      rows.push({ kind: "note", at: ev.at, lane: "oneshot", label: "UNKNOWN: needs investigation", sub: "stopped instead of guessing", tone: "unknown" });
    }
  }

  for (const r of rows) if (r.sub && r.sub === r.label) delete r.sub;

  // Stable sort by time: rows recorded at the same instant keep their logical order.
  return rows.map((r, i) => ({ r, i })).sort((x, y) => x.r.at - y.r.at || x.i - y.i).map((x) => x.r);
}

function sendRows(action: ActionDetail, a: Attempt, opts: FlowOptions): FlowRow[] {
  const endpoint = ENDPOINTS[action.type] ?? `send ${action.type}`;
  const keyNote = opts.idempotent === undefined ? undefined : opts.idempotent ? `Idempotency-Key ${action.id}` : "no idempotency key (not supported)";
  const label = `#${a.number} ${endpoint}`;
  const end = a.finished_at ?? a.started_at;
  const detail = a.detail ?? undefined;

  switch (a.outcome) {
    case null:
      return [{ kind: "msg", at: a.started_at, from: "oneshot", to: "provider", label, sub: "waiting for a response…", style: "pending", tone: "neutral" }];
    case "NOT_SENT":
      return [{ kind: "note", at: a.started_at, lane: "oneshot", label: `#${a.number} send cancelled before leaving`, sub: "pre-send safety check", tone: "warn" }];
    case "CRASHED":
      return [
        { kind: "msg", at: a.started_at, from: "oneshot", to: "provider", label, sub: "may or may not have been sent", style: "dashed", tone: "unknown" },
        { kind: "note", at: end, lane: "oneshot", label: "worker died mid-attempt", sub: "found later by crash recovery", tone: "unknown" },
      ];
    case "RETRYABLE":
      if (/could not connect|never sent/i.test(a.detail ?? "")) {
        return [{ kind: "msg", at: a.started_at, from: "oneshot", to: "provider", label, sub: "connection refused: never arrived", style: "broken", tone: "warn" }];
      }
      return [
        { kind: "msg", at: a.started_at, from: "oneshot", to: "provider", label, sub: keyNote, style: "solid", tone: "neutral" },
        { kind: "msg", at: end, from: "provider", to: "oneshot", label: "not applied, try later", sub: detail, style: "solid", tone: "warn" },
      ];
    case "APPLIED":
      return [
        { kind: "msg", at: a.started_at, from: "oneshot", to: "provider", label, sub: keyNote, style: "solid", tone: "neutral" },
        { kind: "msg", at: end, from: "provider", to: "oneshot", label: "applied", sub: detail, style: "solid", tone: "ok" },
      ];
    case "REJECTED":
      return [
        { kind: "msg", at: a.started_at, from: "oneshot", to: "provider", label, sub: keyNote, style: "solid", tone: "neutral" },
        { kind: "msg", at: end, from: "provider", to: "oneshot", label: "rejected (permanent)", sub: detail, style: "solid", tone: "bad" },
      ];
    case "IN_PROGRESS":
      return [
        { kind: "msg", at: a.started_at, from: "oneshot", to: "provider", label, sub: keyNote, style: "solid", tone: "neutral" },
        { kind: "msg", at: end, from: "provider", to: "oneshot", label: "409 original still in progress", sub: detail, style: "solid", tone: "warn" },
      ];
    default: // AMBIGUOUS (and anything unforeseen): the response never usefully arrived
      return [
        { kind: "msg", at: a.started_at, from: "oneshot", to: "provider", label, sub: keyNote, style: "solid", tone: "neutral" },
        { kind: "msg", at: end, from: "provider", to: "oneshot", label: "no usable response", sub: detail, style: "broken", tone: "unknown" },
      ];
  }
}

function verifyRows(action: ActionDetail, a: Attempt): FlowRow[] {
  const ask: FlowRow = {
    kind: "msg", at: a.started_at, from: "oneshot", to: "provider",
    label: `check #${a.number} GET /v1/effects`, sub: `reference=${action.id}`, style: "solid", tone: "neutral",
  };
  const end = a.finished_at ?? a.started_at;
  switch (a.outcome) {
    case null:
      return [{ ...ask, style: "pending", sub: "waiting for the lookup…" }];
    case "FOUND":
      return [ask, { kind: "msg", at: end, from: "provider", to: "oneshot", label: "found: it happened", sub: a.detail ?? undefined, style: "solid", tone: "ok" }];
    case "ABSENT":
      return [ask, { kind: "msg", at: end, from: "provider", to: "oneshot", label: "no record", sub: a.detail ?? undefined, style: "solid", tone: "neutral" }];
    default:
      return [ask, { kind: "msg", at: end, from: "provider", to: "oneshot", label: "lookup failed", sub: a.detail ?? undefined, style: "broken", tone: "warn" }];
  }
}
