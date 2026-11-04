import type { Action, ActionDetail, Status, SystemStatus } from "./api";

// The console writes its own headlines from live data. They are plain and
// factual, like a wire-service report: no jokes, no hype, never a guess.

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
export const count = (n: number) => (n <= 10 ? WORDS[n] : n.toLocaleString("en-GB"));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** "payment.charge" → "charge", "message.send" → "message" */
export function noun(type: string): string {
  if (type.startsWith("payment")) return "charge";
  if (type.startsWith("message")) return "message";
  return type.split(".")[0];
}

export interface FrontPage {
  headline: string;
  standfirst: string;
  tone: "calm" | "attention" | "trouble";
  links: { label: string; to: string }[];
}

export function frontPage(status: SystemStatus | undefined, apiDown: boolean): FrontPage {
  if (apiDown) {
    return { headline: "The OneShot API is not answering.", standfirst: "Nothing on this page can update until it is back. Actions already accepted are safe on disk.", tone: "trouble", links: [] };
  }
  if (!status) return { headline: "Reading the record…", standfirst: "", tone: "calm", links: [] };
  const c = (s: Status) => status.counts[s] ?? 0;
  const total = Object.values(status.counts).reduce((a, b) => a + (b ?? 0), 0);
  const unknown = c("UNKNOWN");
  const waiting = c("PENDING") + c("IN_FLIGHT") + c("VERIFYING");
  const alive = status.workers.some((w) => w.state === "alive");

  if (unknown > 0)
    return {
      headline: `${cap(count(unknown))} ${plural(unknown, "action needs", "actions need")} a human.`,
      standfirst: `OneShot could not tell whether ${plural(unknown, "it", "they")} happened, so it stopped instead of guessing. Check the provider's record and resolve ${plural(unknown, "it", "them")}, or let reconciliation do it.`,
      tone: "attention",
      links: [
        { label: `Show ${plural(unknown, "it", "them")}`, to: "/?status=UNKNOWN#actions" },
        { label: "Reconcile with the provider", to: "/reconcile" },
      ],
    };
  if (!status.provider.reachable)
    return {
      headline: "The provider is not answering.",
      standfirst: "Sends fail and ledger checks cannot run. Ambiguous actions will wait, then stop at UNKNOWN rather than guess.",
      tone: "trouble",
      links: status.lab ? [{ label: "Restart it on Chaos", to: "/chaos#bench" }] : [],
    };
  if (!alive && waiting > 0)
    return {
      headline: `${cap(count(waiting))} ${plural(waiting, "action is", "actions are")} waiting for a worker.`,
      standfirst: `${plural(waiting, "It is", "They are")} safe on disk and will continue when a worker starts.`,
      tone: "attention",
      links: status.lab ? [{ label: "Start one on Chaos", to: "/chaos#bench" }] : [],
    };
  if (c("VERIFYING") > 0)
    return {
      headline: `Checking the ledger for ${count(c("VERIFYING"))} ${plural(c("VERIFYING"), "action", "actions")}.`,
      standfirst: "An answer came back unclear, so OneShot is reading the provider's own record before it decides whether a resend is safe.",
      tone: "calm",
      links: [{ label: "Watch them", to: "/?status=VERIFYING#actions" }],
    };
  if (waiting > 0)
    return {
      headline: `${cap(count(waiting))} ${plural(waiting, "action is", "actions are")} on the way.`,
      standfirst: "Accepted and saved to disk. A worker is taking them through the wire now.",
      tone: "calm",
      links: [],
    };
  if (total === 0)
    return {
      headline: "Nothing has been asked for yet.",
      standfirst: "Run a failure preset on Chaos, or submit an action from a terminal, and watch it cross the wire below.",
      tone: "calm",
      links: status.lab ? [{ label: "Open Chaos", to: "/chaos" }] : [],
    };
  return {
    headline: total === 1 ? "The one action is settled." : total === 2 ? "Both actions are settled." : `All ${count(total)} actions are settled.`,
    standfirst: `${cap(count(c("SUCCEEDED")))} succeeded and ${count(c("FAILED"))} failed. Each has a definite answer, and nothing is waiting.`,
    tone: "calm",
    links: [{ label: "Check them against the ledger", to: "/reconcile" }],
  };
}

/** One line of the wire report: what happened to an action, in a sentence. */
export function reportLine(to: Status, from: Status | null, attempts = 0): string {
  switch (to) {
    case "PENDING":
      return from === "IN_FLIGHT" ? "will be retried: the last send provably did nothing, or the provider deduplicates it." : from === "VERIFYING" ? "will be resent: the ledger has no record of it." : attempts > 0 ? "is waiting to retry." : "was accepted and saved to disk.";
    case "IN_FLIGHT":
      return "went on the wire.";
    case "VERIFYING":
      return "came back unclear. OneShot is checking the provider's ledger.";
    case "SUCCEEDED":
      return from === "VERIFYING" ? "was found in the provider's ledger. It happened." : from === "UNKNOWN" ? "was resolved: the effect exists." : "succeeded.";
    case "FAILED":
      return from === "UNKNOWN" ? "was resolved: no effect at the provider." : "failed. Nothing was applied.";
    case "UNKNOWN":
      return "stopped at UNKNOWN. OneShot could not tell, so it did not guess.";
  }
}

/** The headline of one action's page: its story so far, in one line. */
export function storyHeadline(a: Action | ActionDetail): string {
  const n = noun(a.type);
  const sends = a.attempt_count;
  switch (a.status) {
    case "PENDING":
      return sends === 0 ? `A ${n}, waiting for a worker.` : `A ${n}, waiting to try again.`;
    case "IN_FLIGHT":
      return `A ${n} is on the wire.`;
    case "VERIFYING":
      return `An unclear answer. Checking the ledger.`;
    case "SUCCEEDED":
      if (a.resolution) return `Resolved: the ${n} happened.`;
      if (a.verify_count > 0) return `The reply was lost. The ledger says it happened.`;
      return sends > 1 ? `The ${n} went through on send ${count(sends)}.` : `The ${n} went through first time.`;
    case "FAILED":
      if (a.resolution) return `Resolved: the ${n} never happened.`;
      return a.last_error && /reject|declin/i.test(a.last_error) ? `The provider said no to this ${n}.` : `The ${n} failed. Nothing was applied.`;
    case "UNKNOWN":
      return `Nobody can yet say if this ${n} happened.`;
  }
}
