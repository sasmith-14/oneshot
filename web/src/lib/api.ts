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
