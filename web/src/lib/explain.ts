import type { ActionEvent, Attempt, Outcome } from "./api";

// Plain-English explanations of what the backend did and *why*.
// The backend's own reason string is always shown next to these. They add
// context for a learner and never replace the recorded facts.

export function explainEvent(e: ActionEvent): string {
  const m = e.message.toLowerCase();
  const key = `${e.from ?? "∅"}→${e.to}`;

  if (m.startsWith("resolved by")) {
    const who = m.includes("reconciler") ? "Reconciliation" : "An operator";
    return e.to === "SUCCEEDED"
      ? `${who} found evidence that the effect happened and closed the case as SUCCEEDED.`
      : `${who} found no effect at the provider after the settle window and closed the case as FAILED.`;
  }

  switch (key) {
    case "∅→PENDING":
      return "OneShot wrote the request to disk before answering the agent. From here on it survives crashes of the API, the worker, or both.";
    case "PENDING→IN_FLIGHT":
      return "A worker claimed the action and recorded the attempt before sending anything (write-ahead intent). If the worker dies mid-send, recovery will see this open attempt.";
    case "IN_FLIGHT→SUCCEEDED":
      return m.includes("replayed")
        ? "The provider recognised the idempotency key and returned the original result. It deduplicated the retry, so the effect exists exactly once at the provider."
        : "The provider confirmed it applied the effect. This is final.";
    case "IN_FLIGHT→FAILED":
      return m.includes("rejected")
        ? "The provider gave a definite, permanent no, so nothing was applied. Retrying would just get the same answer."
        : "Every attempt provably did nothing, and the retry budget is used up. Saying FAILED is safe because no attempt could have applied.";
    case "IN_FLIGHT→PENDING":
      if (m.includes("same idempotency key"))
        return "The outcome is unknown, but this provider deduplicates by key. Resending with the same key cannot apply it twice, so a retry is scheduled.";
      return "The provider proved nothing happened (for example a 503 or a refused connection), so retrying is safe. A retry is scheduled with backoff.";
    case "IN_FLIGHT→VERIFYING":
      if (m.includes("send cancelled"))
        return "Just before resending, a safety check found that an earlier attempt may have applied and the provider may no longer deduplicate. OneShot will check the provider's record instead of sending.";
      return "The outcome is unknown and resending could create a duplicate. OneShot will first check the provider's ledger, after waiting out the settle window.";
    case "IN_FLIGHT→UNKNOWN":
    case "VERIFYING→UNKNOWN":
      return "OneShot cannot tell whether the effect happened and has no safe way to find out right now. It stops and flags the action for reconciliation or a human instead of guessing.";
    case "VERIFYING→SUCCEEDED":
      return m.includes("duplicate")
        ? "The provider's ledger shows the effect more than once. A duplicate slipped through; reconciliation will flag it."
        : "The provider's ledger has the effect. It did happen, even though OneShot never got a clean answer, so no retry is needed.";
    case "VERIFYING→PENDING":
      return "The ledger shows nothing even after the settle window, so the attempt is treated as not applied and a retry is safe. (This relies on the provider settling within that window.)";
    case "VERIFYING→FAILED":
      return "The ledger shows nothing after the settle window and no attempts are left, so the action is recorded as not applied.";
    case "VERIFYING→VERIFYING":
      return m.includes("could not check")
        ? "The provider's lookup could not be reached, so OneShot will try the lookup again later."
        : "The ledger shows nothing yet, but the provider might still be processing. OneShot waits for the settle window to pass before concluding anything.";
    default:
      return "The backend recorded this transition; its own reason is shown above.";
  }
}

const OUTCOME_TEXT: Record<Outcome, string> = {
  APPLIED: "The provider answered yes: the effect is applied.",
  REJECTED: "The provider answered with a permanent no; nothing was applied.",
  RETRYABLE: "Provably not applied (the provider refused or could not be reached), so a retry is safe.",
  IN_PROGRESS: "The provider says the original request with this key is still running, so the effect may appear any moment.",
  AMBIGUOUS: "No usable answer arrived after the request may have been sent, so the effect may or may not exist.",
  CRASHED: "The worker died during this attempt. Recovery treats it as ambiguous, because the request may have been sent.",
  NOT_SENT: "A pre-send safety check cancelled this send, so nothing left OneShot.",
  FOUND: "The provider's ledger contains the effect.",
  ABSENT: "The provider's ledger has no such effect (yet).",
  LOOKUP_FAILED: "OneShot could not ask the provider's ledger.",
};

export function explainOutcome(outcome: Outcome | null): string {
  return outcome ? OUTCOME_TEXT[outcome] : "Still running: no outcome recorded yet.";
}

/** Did this attempt possibly change the outside world? */
export function mayHaveApplied(a: Attempt): boolean {
  return a.outcome === "AMBIGUOUS" || a.outcome === "CRASHED" || a.outcome === "IN_PROGRESS";
}
