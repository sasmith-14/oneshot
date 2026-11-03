/** Seconds (float, as the backend stores them) → "3s ago" / "2m ago". */
export function ago(seconds: number, now: number = Date.now() / 1000): string {
  const d = Math.max(0, now - seconds);
  if (d < 1) return "just now";
  if (d < 60) return `${Math.floor(d)}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

/** Offset from a start time, for timelines: "+0.42s", "+12.0s", "+3m 05s". */
export function offset(at: number, start: number): string {
  const d = at - start;
  if (d < 10) return `+${d.toFixed(2)}s`;
  if (d < 60) return `+${d.toFixed(1)}s`;
  const m = Math.floor(d / 60);
  return `+${m}m ${String(Math.floor(d % 60)).padStart(2, "0")}s`;
}

export function clock(seconds: number): string {
  const t = new Date(seconds * 1000);
  return t.toLocaleTimeString([], { hour12: false }) + "." + String(t.getMilliseconds()).padStart(3, "0");
}
