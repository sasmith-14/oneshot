import { useQuery } from "@tanstack/react-query";
import { api, lab, ops } from "@/lib/api";

// Live data polls once a second (polling, not push: see docs/FRONTEND_PLAN.md).
// TanStack Query shares one request between every component using the same key.
export const POLL_MS = 1000;

export const useSystemStatus = () => useQuery({ queryKey: ["status"], queryFn: api.status, refetchInterval: POLL_MS, retry: false });
export const useActions = () => useQuery({ queryKey: ["actions"], queryFn: api.actions, refetchInterval: POLL_MS });
export const useAction = (id: string) => useQuery({ queryKey: ["action", id], queryFn: () => api.action(id), refetchInterval: POLL_MS, retry: false });
export const useProviderRecord = (id: string) =>
  useQuery({ queryKey: ["provider-record", id], queryFn: () => api.providerRecord(id), refetchInterval: 2 * POLL_MS, retry: false });
export const useActionTypes = () => useQuery({ queryKey: ["action-types"], queryFn: api.actionTypes, staleTime: Infinity });

export const useLabState = (enabled = true) =>
  useQuery({ queryKey: ["lab-state"], queryFn: lab.state, refetchInterval: POLL_MS, retry: false, enabled });
export const usePresets = (enabled = true) => useQuery({ queryKey: ["presets"], queryFn: lab.presets, staleTime: Infinity, enabled });

export const useLedger = () => useQuery({ queryKey: ["ledger"], queryFn: ops.ledger, refetchInterval: 2 * POLL_MS, retry: false });
export const useRuns = () => useQuery({ queryKey: ["runs"], queryFn: ops.runs, refetchInterval: 5 * POLL_MS });
export const useRun = (id: number | null) => useQuery({ queryKey: ["run", id], queryFn: () => ops.run(id!), enabled: id !== null, staleTime: Infinity });
export const useGuarantees = () => useQuery({ queryKey: ["guarantees"], queryFn: ops.guarantees, refetchInterval: 3 * POLL_MS, retry: false });
export const useDocs = () => useQuery({ queryKey: ["docs"], queryFn: ops.docs, staleTime: Infinity });
export const useDoc = (slug: string) => useQuery({ queryKey: ["doc", slug], queryFn: () => ops.doc(slug), staleTime: Infinity, retry: false });
