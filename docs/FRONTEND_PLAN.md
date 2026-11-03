# OneShot web console: agreed plan

> Status: **agreed 2026-11-03. Everything here (M1–M4) is built and tested; the visual system was redesigned in v2, see `FRONTEND_DESIGN.md`.** One planned item changed: the concept-doc PDF about the UI (doc 08) was not written; the Learn page and FRONTEND_DESIGN.md cover it. This file is the shared spec for the frontend. What is built so far is tracked in HANDOFF.md; anything not listed here stays in ROADMAP.md.

## Purpose

An interactive **lab console** that makes the invisible visible. Watch actions move through their states live, break things on purpose, see OneShot's record next to the provider's ledger, and read *why* the backend decided what it did. All of it uses real data from the running stack, not canned animations.

## Decisions

| Topic | Decision |
|---|---|
| Stack | React + Vite + TypeScript, Tailwind CSS v4, shadcn/ui (Radix), TanStack Query |
| Live data | polling every 1 s (no SSE or WebSockets); the trade-off is documented |
| Layout | top navigation bar + full-width main area |
| Pages | Actions (home) · Action detail · Chaos · Reconcile · Provider ledger · Guarantees · Learn |
| Theme | light + dark, follows the system setting, with a toggle |
| Look | modern developer tool: Inter for UI text, JetBrains Mono for ids and payloads (self-hosted, no CDN), rounded cards, soft shadows |
| Status colours | muted/pastel: PENDING grey · IN_FLIGHT blue · VERIFYING amber · SUCCEEDED green · FAILED red · UNKNOWN purple |
| Density | balanced: key facts visible, details one click away |
| Motion | subtle (state transitions, an in-flight pulse, arrows drawing in); honours `prefers-reduced-motion` |
| Explanations | inline plain-English sentence on every event (the backend's raw reason stays visible too) |
| Responsive | desktop-first, still usable on a tablet |
| Lab safety | chaos and process-control routes exist only when `ONESHOT_LAB=1`; otherwise 404, and the UI hides those controls with an explanation. Everything binds to 127.0.0.1 |
| Serving | `make dev` runs the Vite dev server (hot reload); `make web-build` produces static files that FastAPI serves at `http://127.0.0.1:8700/ui/`, so a normal run needs no Node |
| Testing | Vitest for logic and components; end-to-end browser tests with Playwright against the real stack, written in pytest (`tests/test_web_e2e.py`) so they reuse the Chromium already installed for the docs build instead of downloading a second browser |
| Delivery | four milestones, each tested, committed and demoable |

## Pages

**Actions (home).**
- A system health strip: provider reachable, worker heartbeat, faults armed.
- An attention banner when any action is UNKNOWN or the last reconciliation had warning or critical findings.
- One count card per status; clicking a card filters the list.
- An activity sparkline.
- The live list of actions.

**Action detail.**
- A header with the id, type, status and payload, and a **live state diagram** always visible: the current state is lit up and the path taken is highlighted.
- Tabs:
  - **Flow**: swimlanes for Agent / OneShot / Provider / Ledger, built from the recorded attempts. Lost responses show as broken arrows.
  - **Timeline**: every event and attempt, each with a plain-English "why".
  - **Ledger**: OneShot's record and the provider's ledger side by side, with a match or mismatch badge.
- An **evidence-first resolve dialog** for UNKNOWN actions:
  1. Show what the provider's ledger says, with a "check provider now" button.
  2. Pre-select the outcome that matches the evidence.
  3. Require a note before confirming.

**Chaos** (lab only).
- One-click presets in four groups:
  - core failures (happy path, transient 503, decline, timeout);
  - ambiguity (lost response on a charge vs a message, provider crash leading to UNKNOWN, 500 after applying);
  - duplicates (same-key double submit, new-key double submit, slow provider beyond the settle window);
  - process crashes (worker crash mid-flight, then recovery).
- A custom form for any fault, action type and key.

**Reconcile.**
- A run button and a findings table with severity.
- A side-by-side diff of OneShot actions and provider effects, with matches linked and orphans and duplicates highlighted.
- An explanation card per finding type.
- **Run history**, which needs new backend storage.

**Provider ledger** (raw ledger only when lab is on). The provider's raw ledger and its armed faults.

**Guarantees.** G1–G5 and the known duplicate gaps, each with a live check of whether it holds *for the data that exists right now*. That is evidence, not proof that it always holds.

**Learn.** The `docs/src` Markdown rendered in the browser, diagrams included, so the website and the PDFs share one source. The UI's "why" text links into it.

## Architecture

```text
web/                      React app (Vite). Talks to OneShot only over HTTP.
oneshot/api.py            existing JSON API + new read endpoints + the static /ui mount
oneshot/lab.py            lab-only routes and presets (mounted only when ONESHOT_LAB=1)
```

- **The UI lives at `/ui/`.** The JSON API already uses root paths (`/actions`), so serving the SPA at `/` would collide with them. `/` redirects to `/ui/`.
- **The browser never calls the fake provider directly.** It runs on another port, so calling it would mean loosening the browser's cross-origin rules. OneShot exposes what the UI needs:
  - *Public, operator-grade read:* `GET /actions/{id}/provider-record` (the same lookup the `oneshot show` CLI uses).
  - *Lab-only:* pass-through routes to arm and clear faults and read the raw ledger. These belong to the test harness, not the product.
- **Worker heartbeat.** Workers write a heartbeat row every few seconds, so the health strip shows "last seen N s ago" instead of guessing.
- **Presets run in the backend** (`oneshot/lab.py`), not in the browser, so pytest can check them. The UI calls `POST /lab/presets/{name}` and opens the resulting action.
- **Process-crash presets** use a lab supervisor in the API process. It starts the worker, and can kill it or restart it with a one-shot failpoint.

## Milestones

1. **M1:**
   - Backend: worker heartbeats, `GET /system/status`, `GET /actions/{id}/provider-record`, the static `/ui` mount.
   - Web: scaffold, theme, navigation, the Actions board and Action detail with all four visuals.
   - Tests.
2. **M2:** lab routes and supervisor, the Chaos page with all presets, and worker kill and restart. (The resolve dialog, including "check provider now", was finished early in M1.)
3. **M3:** reconciliation run history (table and endpoints), the Reconcile page with findings, diff, explanation cards and history.
4. **M4:** the Provider ledger, Guarantees and Learn pages; a doc 08 on the UI; README screenshots; HANDOFF.

## Honesty rules (apply to every screen)

- UNKNOWN never looks like success or failure; it has its own colour and wording.
- No text claims exactly-once delivery.
- Side-by-side views say which record is authoritative for which question. The provider's ledger answers "did the effect happen?"; OneShot's record answers "what did we tell the agent?"
- Live checks say what they cover: current data, not a proof.
