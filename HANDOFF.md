# HANDOFF

> Living status file. Updated at every milestone so another session/tool can resume from the repo alone.

## Current status

Core system complete and tested (provider, store, policy, worker, recovery, reconciler, API, CLI).
In progress: demo runner (`demo/`). Not started: docs/PDFs, EXPERIMENTS, HOW-TO-EXTEND, README polish.

## How to run (so far)

```bash
uv sync --extra docs          # install
uv run pytest -q              # full test suite (~35 s; integration tests spawn real processes)
uv run fakeprovider --port 8701 --db var/provider.db &   # fake provider
uv run oneshot submit payment.charge '{"amount_cents":1500,"customer":"cus_1"}'
uv run oneshot worker --drain
uv run oneshot list ; uv run oneshot reconcile --all
```

## Known bugs / limitations

None open. (One design flaw found and fixed — see commit "fix(policy): judge same-key retry safety at send time".)

## Next steps

1. demo/ runner with scenarios + `oneshot demo`
2. docs/src/*.md → PDFs via scripts/build_docs.py
3. EXPERIMENTS.md, docs 07 how-to-extend with worked example (new fault mode `error_after_apply`)
4. README, ROADMAP, final verification from a clean clone
