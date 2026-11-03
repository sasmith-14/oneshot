# ROADMAP: future ideas (NOT implemented)

Everything on this page is **planned or possible, not built**. For what exists today, see the README's feature list and the test suite. Each item says what it would take.

| Idea | What it would take |
|---|---|
| **PostgreSQL storage backend** | A second store class with `ActionStore`'s public methods, using `SELECT … FOR UPDATE SKIP LOCKED` for claims; parametrize the `store` fixture over both backends (recipe in `docs/src/07-how-to-extend.md`). |
| **Circuit breaker** | Track recent RETRYABLE/AMBIGUOUS rates per provider in the worker; when open, stop claiming that provider's actions for a cool-down. Prevents retry storms during long outages. |
| **Honour `Retry-After`** | Parse the header in `provider_client.classify_response`, carry it on `SendResult`, and use `max(backoff, retry_after)` in `policy.after_send`. Needs a new provider fault mode to test it. |
| **Lease heartbeats** | Let a worker extend its lease while an attempt is running, so attempts may take longer than `lease_seconds`. Only worth it if attempts become long-running. |
| **Windowed, scheduled reconciliation** | Page through the provider ledger with a `created_after` cursor instead of reading it all, and run on a schedule. (Runs and findings are already persisted: `reconcile_runs`.) |
| **Completion callbacks to the agent** | A webhook or long-poll endpoint, so agents need not poll `GET /actions/{id}`. Callback delivery is itself an at-least-once problem (the receiver must deduplicate). |
| **Per-action-type delivery mode** | A capability flag such as `on_ambiguous = "verify" | "at_most_once"`, so non-idempotent actions can choose "never resend" (no duplicates, possible loss). This is a small change in `policy.after_verify`. |
| **Metrics and tracing** | Counters per outcome and status, histograms for attempt latency, OpenTelemetry spans per attempt. This would replace the `print`-based logs. |
| **Authentication and multi-tenancy** | API keys per agent, and idempotency keys scoped per tenant (`UNIQUE(tenant, request_key)`). |
| **Compensation workflows** | On `DUPLICATE_EFFECT` or `UNEXPECTED_EFFECT`, create a compensating action (for example a refund) for human approval. This is the start of sagas for multi-step actions. |
| **Data retention** | Expire old agent idempotency keys and archive terminal actions; document the resulting replay window for agents. |
| **Message-broker dispatch** | Replace polling with a queue, using the action table as a transactional outbox, with a relay that publishes committed rows. |
| **Console: push updates** | Replace 1-second polling with Server-Sent Events from a change feed (an events table cursor). Polling is deliberately simpler and fine locally. |
| **Console: deploy a read-only demo** | A static build that replays a recorded session, so the console can be shown without running the stack. |
| **Richer fault simulation** | Clock skew, network partitions (delayed rather than dropped packets), and an eventually consistent lookup endpoint in the fake provider. |
| **Property-based tests** | Use Hypothesis to generate fault sequences and timings instead of the three fixed seeds in `tests/test_invariants.py`. |
| **Real provider adapter (test mode)** | Deliberately out of scope: the project brief forbids real external APIs. It would need classification rules rewritten from that provider's documentation. |
