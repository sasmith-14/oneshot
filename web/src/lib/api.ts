// Typed client for the OneShot JSON API. The console talks to OneShot only
// through these calls; it never reads the database or calls the provider directly.

export const STATUSES = ["PENDING", "IN_FLIGHT", "VERIFYING", "SUCCEEDED", "FAILED", "UNKNOWN"] as const;
export type Status = (typeof STATUSES)[number];

export type Outcome =
  | "APPLIED"
  | "REJECTED"
  | "RETRYABLE"
  | "IN_PROGRESS"
  | "AMBIGUOUS"
  | "CRASHED"
  | "NOT_SENT"
  | "FOUND"
  | "ABSENT"
  | "LOOKUP_FAILED";

export interface Attempt {
  number: number;
  kind: "send" | "verify";
  worker_id: string;
  started_at: number;
  finished_at: number | null;
  outcome: Outcome | null;
  detail: string | null;
}

export interface ActionEvent {
  at: number;
  from: Status | null;
  to: Status;
  message: string;
}

export interface Action {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  status: Status;
  attempt_count: number;
  verify_count: number;
  maybe_applied: boolean;
  next_attempt_at: number | null;
  provider_effect_id: string | null;
  last_error: string | null;
  resolution: string | null;
  created_at: number;
  updated_at: number;
}

export interface ActionDetail extends Action {
  attempts: Attempt[];
  events: ActionEvent[];
}

export interface Effect {
  id: string;
  kind: string;
  reference: string | null;
  idempotency_key: string | null;
  payload: Record<string, unknown>;
  created_at: number;
}

export interface ProviderRecord {
  action_id: string;
  checked_at: number;
  effects: Effect[];
}

export interface WorkerInfo {
  id: string;
  pid: number;
  started_at: number;
  last_seen_at: number;
  stopped_at: number | null;
  state: "alive" | "silent" | "stopped";
  seconds_since_seen: number;
}

export interface SystemStatus {
  now: number;
  lab: boolean;
  counts: Partial<Record<Status, number>>;
  provider: { url: string; reachable: boolean; error: string | null };
  workers: WorkerInfo[];
  worker_silent_after_seconds: number;
  settings: {
    provider_timeout_seconds: number;
    lease_seconds: number;
    max_attempts: number;
    max_verifications: number;
    provider_settle_seconds: number;
    provider_key_retention_seconds: number;
  };
}

export interface ActionType {
  name: string;
  idempotent_at_provider: boolean;
  provider_lookup: boolean;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!resp.ok) {
    let detail = resp.statusText;
    try {
      const body = await resp.json();
      detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail ?? body);
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(resp.status, detail);
  }
  return resp.json() as Promise<T>;
}

export const api = {
  status: () => request<SystemStatus>("/system/status"),
  actions: () => request<Action[]>("/actions"),
  action: (id: string) => request<ActionDetail>(`/actions/${encodeURIComponent(id)}`),
  providerRecord: (id: string) => request<ProviderRecord>(`/actions/${encodeURIComponent(id)}/provider-record`),
  actionTypes: () => request<ActionType[]>("/action-types"),
  resolve: (id: string, status: "SUCCEEDED" | "FAILED", note: string) =>
    request<ActionDetail>(`/actions/${encodeURIComponent(id)}/resolve`, {
      method: "POST",
      body: JSON.stringify({ status, note, actor: "operator (web console)" }),
    }),
};

// ---------------------------------------------------------------- v2 endpoints

export type Severity = "ok" | "info" | "resolved" | "warning" | "critical";

export interface Finding {
  kind: string;
  severity: Severity;
  action_id: string | null;
  effect_ids: string[];
  message: string;
}

export interface ReconcileReport {
  run_id: number;
  actions_checked: number;
  effects_checked: number;
  applied: boolean;
  summary: Record<string, number>;
  findings: Finding[];
}

export interface ReconcileRun {
  id: number;
  at: number;
  applied: boolean;
  actions_checked: number;
  effects_checked: number;
  summary: Record<string, number>;
  findings?: Finding[];
}

export interface Guarantee {
  id: string;
  statement: string;
  condition: string;
  status: "holds" | "violated" | "condition-broken" | "attention" | "unknown";
  evidence: string;
  action_ids: string[];
}

export interface GuaranteeReport {
  checked_at: number;
  provider_reachable: boolean;
  actions: number;
  guarantees: Guarantee[];
  gaps: { kind: string; count: number; about: string; action_ids: string[] }[];
}

export interface FaultRule {
  mode: string;
  endpoint: string | null;
  reference: string | null;
  times: number;
  delay_seconds: number | null;
}

export interface LabEvent {
  at: number;
  kind: "worker" | "provider" | "preset" | "fault";
  message: string;
}

export interface LabState {
  managed: boolean;
  worker: { running: boolean; pid: number | null; failpoints: string[]; auto_restart: boolean; restarts: number };
  provider: { running: boolean; url: string };
  events: LabEvent[];
  faults: FaultRule[] | null;
}

export interface Preset {
  name: string;
  group: string;
  title: string;
  what: string;
  expect: string;
  needs_managed: boolean;
}

export interface PresetCatalogue {
  groups: { id: string; title: string; about: string }[];
  presets: Preset[];
}

export interface PresetResult {
  preset: Preset;
  action_ids: string[];
  note: string;
}

export interface DocInfo {
  slug: string;
  title: string;
  words: number;
}

export const lab = {
  state: () => request<LabState>("/lab/state"),
  presets: () => request<PresetCatalogue>("/lab/presets"),
  run: (name: string) => request<PresetResult>(`/lab/presets/${encodeURIComponent(name)}`, { method: "POST" }),
  arm: (rule: { mode: string; endpoint?: string; times?: number; delay_seconds?: number }) =>
    request<{ faults: FaultRule[] }>("/lab/faults", { method: "POST", body: JSON.stringify(rule) }),
  clear: () => request<{ faults: FaultRule[] }>("/lab/faults", { method: "DELETE" }),
  startWorker: () => request<{ pid: number }>("/lab/worker/start", { method: "POST" }),
  killWorker: () => request<{ pid: number }>("/lab/worker/kill", { method: "POST" }),
  crashWorker: (point: "before_send" | "after_response") =>
    request<{ pid: number }>("/lab/worker/crash", { method: "POST", body: JSON.stringify({ point }) }),
  restartProvider: () => request<{ ok: boolean }>("/lab/provider/restart", { method: "POST" }),
};

export const ops = {
  reconcile: (apply: boolean) => request<ReconcileReport>(`/reconcile?apply=${apply}`, { method: "POST" }),
  runs: () => request<ReconcileRun[]>("/reconcile/runs"),
  run: (id: number) => request<ReconcileRun>(`/reconcile/runs/${id}`),
  ledger: () => request<{ checked_at: number; effects: Effect[] }>("/provider/ledger"),
  guarantees: () => request<GuaranteeReport>("/guarantees"),
  docs: () => request<DocInfo[]>("/learn/docs"),
  doc: (slug: string) => request<{ slug: string; title: string; markdown: string }>(`/learn/docs/${encodeURIComponent(slug)}`),
};
