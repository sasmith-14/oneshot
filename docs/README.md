# OneShot learning docs

| PDF | Source | Topic |
|---|---|---|
| [00-overview.pdf](pdf/00-overview.pdf) | [src/00-overview.md](src/00-overview.md) | The whole system end to end; guarantees; key decisions |
| [01-durable-action-tracking.pdf](pdf/01-durable-action-tracking.pdf) | [src/01-durable-action-tracking.md](src/01-durable-action-tracking.md) | State machine, store, write-ahead intent, UNKNOWN |
| [02-retries-and-outcome-classification.pdf](pdf/02-retries-and-outcome-classification.pdf) | [src/02-…](src/02-retries-and-outcome-classification.md) | When a retry is safe; backoff; verification |
| [03-duplicate-protection.pdf](pdf/03-duplicate-protection.pdf) | [src/03-…](src/03-duplicate-protection.md) | The layers, and where duplicates still slip through |
| [04-crash-recovery.pdf](pdf/04-crash-recovery.pdf) | [src/04-…](src/04-crash-recovery.md) | Leases, failpoints, recovery |
| [05-reconciliation.pdf](pdf/05-reconciliation.pdf) | [src/05-…](src/05-reconciliation.md) | Comparing against the provider's ledger |
| [06-fake-provider.pdf](pdf/06-fake-provider.pdf) | [src/06-…](src/06-fake-provider.md) | How failures are simulated |
| [07-how-to-extend.pdf](pdf/07-how-to-extend.pdf) | [src/07-…](src/07-how-to-extend.md) | Extension recipes + worked example |
| [EXPERIMENTS.pdf](pdf/EXPERIMENTS.pdf) | [../EXPERIMENTS.md](../EXPERIMENTS.md) | Hands-on experiments |

## Regenerating the PDFs

```bash
make docs          # = uv run --extra docs python scripts/build_docs.py
```

This uses only free tooling: Python-Markdown, Pygments, and Playwright driving headless Chromium. Mermaid diagrams are rendered offline from the pinned bundle in `tooling/vendor/` (Mermaid 12.2.0, MIT licence). If Chromium is missing, the script tells you to run `uv run --extra docs playwright install chromium` once. The build fails if any diagram does not render.

`{{include outputs/<name>.txt}}` lines embed real command output from `src/outputs/`. To refresh that output (re-runs the tests and every demo scenario):

```bash
make docs-capture && make docs
```
