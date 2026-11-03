# Convenience targets. Every target is a thin wrapper around a documented uv command.
.PHONY: install test test-unit demo dev docs docs-capture clean

install:        ## install all dependencies (including the docs extra)
	uv sync --extra docs

test:           ## full test suite (unit + integration; ~100 s)
	uv run pytest -q

test-unit:      ## fast unit tests only (no subprocesses; < 1 s)
	uv run pytest -q -m "not integration"

demo:           ## run every failure scenario, self-checking (~25 s)
	uv run oneshot demo

dev:            ## run provider + API + worker locally (Ctrl-C to stop)
	./scripts/dev.sh

docs:           ## regenerate every PDF in docs/pdf from docs/src + EXPERIMENTS.md
	uv run --extra docs python scripts/build_docs.py

docs-capture:   ## re-run tests and demos and refresh docs/src/outputs (then run `make docs`)
	uv run python scripts/capture_outputs.py

clean:          ## delete local runtime state
	rm -rf var docs/build
