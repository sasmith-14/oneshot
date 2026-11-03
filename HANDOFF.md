# HANDOFF

> Living status file. Updated at every milestone so another session/tool can resume from the repo alone.

## Current status

Phase 0 — scaffolding. Repository initialised, dependencies pinned (`uv.lock`), Mermaid vendored for offline PDF rendering.

## Plan (build order)

1. Scaffold (pyproject, uv, gitignore, HANDOFF) — **done**
2. Fake external provider with independent ledger + fault injection
3. OneShot core: domain/state machine, SQLite action store
4. Provider client (outcome classification) + retry policy
5. Executor (worker) + crash recovery
6. HTTP API + CLI
7. Reconciler
8. Demo runner
9. Invariant / extension tests
10. Docs (Markdown + Mermaid → PDF), EXPERIMENTS, HOW-TO-EXTEND, ROADMAP
11. README polish, clean-checkout verification, final report

## How to run (so far)

```bash
uv sync --extra docs
```

## Known bugs / limitations

None yet.

## Continuation prompt

See bottom of this file once phase 2 lands.
