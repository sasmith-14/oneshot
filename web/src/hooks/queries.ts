import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

// Everything live polls once a second (see docs/FRONTEND_PLAN.md: polling, not
// push). TanStack Query de-duplicates identical requests across components.
export const POLL_MS = 1000;

export const useSystemStatus = () =>
  useQuery({ queryKey: ["status"], queryFn: api.status, refetchInterval: POLL_MS, retry: false });

export const useActions = () =>
  useQuery({ queryKey: ["actions"], queryFn: api.actions, refetchInterval: POLL_MS });

export const useAction = (id: string) =>
  useQuery({ queryKey: ["action", id], queryFn: () => api.action(id), refetchInterval: POLL_MS, retry: false });

export const useProviderRecord = (id: string) =>
  useQuery({ queryKey: ["provider-record", id], queryFn: () => api.providerRecord(id), refetchInterval: 2 * POLL_MS, retry: false });

export const useActionTypes = () =>
  useQuery({ queryKey: ["action-types"], queryFn: api.actionTypes, staleTime: Infinity });
