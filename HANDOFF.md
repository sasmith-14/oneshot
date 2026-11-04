# HANDOFF

> Living status file, kept current so another session or tool can resume from the repo alone.
> Last updated: 2026-11-04 (web console v3: the editorial "paper of record" redesign).

## Current status: feature-complete v0.1

All seven outcomes from the project brief are implemented, tested and documented:

| Brief item | Where | Verified by |
|---|---|---|
| Durable tracking + explicit UNKNOWN + investigate/resolve | `oneshot/store.py`, `oneshot/domain.py`, `oneshot show`, `oneshot resolve` | `tests/test_store.py`, `tests/test_api.py` |
| Retries with a precise safety policy | `oneshot/policy.py`, `oneshot/provider_client.py` | `tests/test_policy.py`, `tests/test_provider_client.py` |
| Layered duplicate protection + honest gaps | API keys, claims/leases, provider keys, verify-then-retry | `tests/test_scenarios.py` (incl. 3 tests where duplicates *do* occur) |
| Crash recovery | `oneshot/worker.py` (`recover`), `oneshot/failpoints.py` | failpoint + real `SIGKILL` tests in `tests/test_scenarios.py` |
| Reconciliation against an outside record | `oneshot/reconciler.py` | `tests/test_reconciler.py`, scenario tests |
| Fake provider, 9 failure modes, independent ledger | `fakeprovider/` | `tests/test_fake_provider.py`, `tests/test_invariants.py` |
| Visible demo | `demo/`, `uv run oneshot demo` | `tests/test_demo.py` |

Learning docs: `docs/src/*.md` → `docs/pdf/*.pdf` (overview + 7 concept docs + EXPERIMENTS). Also `EXPERIMENTS.md`, `ROADMAP.md`, `README.md`.

### Web console "OneShot Lab" (done; spec `docs/FRONTEND_PLAN.md`, design `docs/FRONTEND_DESIGN.md`)

All seven pages are built: Live (a front page with a headline written from live data, the wire figure and the wire report), Action detail, Chaos (horizontal chapter strips and the lab bench), Reconcile, Ledger, Guarantees and Learn, plus the ⌘K palette. v3 is an editorial look: stone paper, ink, a vermilion "editor's pen", and Instrument Serif, Schibsted Grotesk and IBM Plex Mono (all self-hosted). The tokens, motion inventory and the reasoning are in `docs/FRONTEND_DESIGN.md`.

**Stack:** React 19, Vite 8, TypeScript 7, Tailwind 4, shadcn/ui, TanStack Query (1 s polling), Motion (animations), Lenis (smooth scrolling), cmdk, Sonner, react-markdown with lazily loaded Mermaid, and Fontsource packages for the three faces.

**Code layout:** `web/src/app/` holds the shell, palette, theme and smooth scrolling. `web/src/features/<page>/` holds the pages, `web/src/components/` the shared pieces, and `web/src/lib/` the tested logic: explanations, the headlines the console writes (`headline.ts`), flow, comparison and findings.

**Backend added for the console:**
- `oneshot/lab.py`: only with `ONESHOT_LAB=1`. It holds the presets, fault arming and the process supervisor, which runs with `ONESHOT_LAB_MANAGE=1`.
- `oneshot/guarantees.py`: G1–G5 live checks, run as a reconciliation dry run.
- `oneshot/learn.py`: serves `docs/src` Markdown.
- Store tables: `workers` (heartbeats) and `reconcile_runs`.
- Endpoints: `/system/status`, `/actions/{id}/provider-record`, `/provider/ledger`, `/reconcile/runs[/id]`, `/guarantees`, `/learn/docs[/slug]`, and the SPA at `/ui/`.

**Tests:** Vitest `web/src/**/*.test.ts(x)`, `tests/test_web_api.py`, `tests/test_lab.py`, and the browser end-to-end tests in `tests/test_web_e2e.py` (they need `make web-build`).

## How to run everything

```bash
uv sync --extra docs          # install (Python >= 3.11; uv from https://docs.astral.sh/uv/)
uv run pytest -q              # 161 tests, ~130 s (integration tests spawn real processes; browser e2e needs `make web-build`)
uv run pytest -q -m "not integration"   # unit tests only, < 1 s
uv run oneshot demo           # 12 self-checking failure scenarios, ~25 s
make dev                      # lab mode: API :8700 supervises provider :8701 + worker; console dev server :5173/ui/ (Ctrl-C stops all)
ONESHOT_LAB=0 make dev        # the three processes independently, no lab controls
make web-install && make web-build && make web-test   # console: npm deps, build (served at :8700/ui/), Vitest + typecheck
make docs-capture && make docs   # refresh embedded real output, then rebuild all PDFs
```

If PDF building says Chromium is missing: `uv run --extra docs playwright install chromium` (free, one-time).

## Known bugs / limitations

No known open bugs. Limitations are deliberate and documented (README "Limitations", each doc's "Cannot protect against" box):

- single host (SQLite); no auth, metrics, retention or backups;
- duplicates remain possible in documented cases (agent uses a new key; non-idempotent provider slower than the settle window; misconfigured retention; a stalled worker sending to a non-idempotent provider);
- leases rely on wall-clock time;
- reconciliation reads the whole ledger every run;
- verified on macOS only (Linux expected to work, untested).

Things to know when working on it:

- `pgrep -f "oneshot worker"` can match the `uv run` wrapper instead of the real worker. Kill the PID shown in the worker id `worker-<pid>`.
- Integration tests use real timing (sub-second timeouts). They were stable across repeated runs on the dev machine; on a very slow machine, widen the timings in `tests/test_scenarios.py::cfg`.
- `docs/src/outputs/*.txt` are generated by `scripts/capture_outputs.py`; do not hand-edit them.
- When restarting a single process by hand, use **absolute** `--db` paths. A relative path from the wrong directory silently opens a new, empty provider ledger, which makes every lookup say "no effect". This happened once while building the console.
- The e2e browser tests skip themselves if `web/dist` is missing; run `make web-build` first.
- In lab mode the API *owns* the provider and worker processes (they stop when the API stops), so don't also start them by hand on the same ports.
- Process presets (`worker-*`) take about the lease time (15 s by default) to recover; that wait is the point of the demonstration.
- This shadcn version's `CommandDialog` does not wrap its children in cmdk's `<Command>`; `app/CommandPalette.tsx` adds it. Without it the page crashes.
- Agent skills used for the design (15 of them in `.claude/skills/`, not committed) can be reinstalled from `skills-lock.json`; the commands are in `docs/FRONTEND_DESIGN.md`.
- Headlines use `SetHeadline`, which reveals each line when it scrolls into view. A full-page screenshot that never scrolls will show headings below the fold as blank; scroll first. Under reduced motion they are plain text.
- The theme is paper (light) by default and ignores the OS setting; dark is a remembered choice (`localStorage["oneshot-theme"]`).
- npm blocks `fsevents`' install script (optional macOS file watcher). This is harmless; Vite works without it.

## Next steps (suggested, in order)

1. Pick ROADMAP items: per-action-type at-most-once mode, `Retry-After`, circuit breaker, or the PostgreSQL store.
2. Run the suite on Linux (e.g. a GitHub Actions workflow: `uv sync && uv run pytest -q`).
3. Add Hypothesis-based fault-sequence tests.

## Continuation prompt (paste into Codex / another Claude session)

```text
You are continuing work on "OneShot", a local educational backend in this repository that executes
actions for AI agents reliably (durable tracking, safe retries, duplicate protection, crash recovery,
reconciliation against a fake provider with an independent ledger). Start by reading HANDOFF.md,
README.md and docs/src/00-overview.md, then run `uv sync --extra docs` and `uv run pytest -q`
(expect 161 passing; run `make web-install web-build` first so the 2 browser tests run instead of skipping) and `uv run oneshot demo` (expect every scenario PASS).

Rules: keep it local and free (no real external APIs, no paid services, no secrets); never claim
exactly-once delivery; state every guarantee precisely; every claim must be backed by something you ran;
commit in small, well-described commits; keep module boundaries (domain/store/policy/provider_client/
worker/reconciler/fakeprovider/demo/docs); add tests for every change, and make sure
tests/test_invariants.py still passes; update the Markdown docs, re-run `make docs-capture && make docs`
when outputs or diagrams change, and look at the rendered PDFs; keep ROADMAP.md (not built) separate
from implemented features; update HANDOFF.md before you stop.

Task: <describe the next feature, e.g. "implement the per-action-type at-most-once delivery mode from
ROADMAP.md, with policy unit tests, an invariant-test update, a demo scenario, and doc updates">.
```
