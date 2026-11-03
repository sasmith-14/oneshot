import type { Status } from "./api";

// One place for how each status looks and what it means. Class strings are
// written out in full so Tailwind can find them when it scans the source.

export interface StatusMeta {
  label: string;
  meaning: string;
  /** soft background + readable text + border, for badges and cards */
  badge: string;
  /** solid dot / accent colour */
  dot: string;
  /** SVG fill / stroke for diagrams */
  fill: string;
  stroke: string;
  text: string;
}

export const STATUS_META: Record<Status, StatusMeta> = {
  PENDING: {
    label: "Pending",
    meaning: "Durably accepted; waiting for its first attempt or a scheduled retry.",
    badge: "bg-st-pending-soft text-st-pending-fg border-st-pending/30",
    dot: "bg-st-pending",
    fill: "fill-st-pending-soft",
    stroke: "stroke-st-pending",
    text: "fill-st-pending-fg",
  },
  IN_FLIGHT: {
    label: "In flight",
    meaning: "A worker holds the lease and recorded the attempt before sending. The request may or may not have reached the provider yet.",
    badge: "bg-st-inflight-soft text-st-inflight-fg border-st-inflight/30",
    dot: "bg-st-inflight",
    fill: "fill-st-inflight-soft",
    stroke: "stroke-st-inflight",
    text: "fill-st-inflight-fg",
  },
  VERIFYING: {
    label: "Verifying",
    meaning: "The last outcome is ambiguous, so OneShot checks the provider's own record before deciding whether a retry is safe.",
    badge: "bg-st-verifying-soft text-st-verifying-fg border-st-verifying/30",
    dot: "bg-st-verifying",
    fill: "fill-st-verifying-soft",
    stroke: "stroke-st-verifying",
    text: "fill-st-verifying-fg",
  },
  SUCCEEDED: {
    label: "Succeeded",
    meaning: "The provider confirmed the effect was applied. Final.",
    badge: "bg-st-succeeded-soft text-st-succeeded-fg border-st-succeeded/30",
    dot: "bg-st-succeeded",
    fill: "fill-st-succeeded-soft",
    stroke: "stroke-st-succeeded",
    text: "fill-st-succeeded-fg",
  },
  FAILED: {
    label: "Failed",
    meaning: "The effect was definitely not applied and OneShot stopped trying. Final.",
    badge: "bg-st-failed-soft text-st-failed-fg border-st-failed/30",
    dot: "bg-st-failed",
    fill: "fill-st-failed-soft",
    stroke: "stroke-st-failed",
    text: "fill-st-failed-fg",
  },
  UNKNOWN: {
    label: "Unknown",
    meaning: "OneShot cannot tell whether the effect happened. It stopped instead of guessing; reconciliation or a human must resolve it.",
    badge: "bg-st-unknown-soft text-st-unknown-fg border-st-unknown/30",
    dot: "bg-st-unknown",
    fill: "fill-st-unknown-soft",
    stroke: "stroke-st-unknown",
    text: "fill-st-unknown-fg",
  },
};

export const ACTIVE_STATUSES: Status[] = ["PENDING", "IN_FLIGHT", "VERIFYING"];

export function isActive(status: Status): boolean {
  return ACTIVE_STATUSES.includes(status);
}
