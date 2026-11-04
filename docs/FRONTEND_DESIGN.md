# OneShot console: design system (v4, "mission control")

The page set, data and behaviour from `FRONTEND_PLAN.md` are unchanged. This file records the look, the research behind it, and how it is verified.

## History

| Version | What | Why it changed |
|---|---|---|
| v2 | a modern developer tool with a kanban "wire" | the client found it generic |
| v3 | an editorial "paper of record" (serif, paper, a red pen), later recoloured Cobalt with Archivo | the client did not like the look at all, and the first palette matched their portfolio |
| **v4** | **mission control**: an observability-grade console built around a live system map and a trace view | chosen by the designer, with full creative freedom, within the client's standing inputs (below) |

**Standing inputs from the client's earlier answers** (kept):
- the stack: React, Vite, TypeScript, Tailwind and shadcn;
- top navigation, desktop-first, balanced density, 2D visuals;
- muted status colours: PENDING grey, IN_FLIGHT blue, VERIFYING amber, SUCCEEDED green, FAILED red, UNKNOWN purple;
- plain-English explanations inline;
- smooth animation and interactive scrolling;
- a System / Light / Dark theme switch, with System as the default;
- two neutral colours and one accent;
- the ⌘K palette;
- the custom cursor and subtle grain.

## Research

- **Vizceral** (Netflix's traffic visualiser) and later topology tools: animate dots along the edges of a service graph, tie the dots to real traffic rather than decoration, mark degraded links, and cap the number of animated elements.
- **Vercel Workflows' trace viewer** (redesigned June 2026, minimap added July 2026): inspect a run from start to finish as a waterfall of spans.
- **Workflow dashboards** (Workflow Core, agent-workflow UIs): show the taken branch highlighted and the untaken branches dimmed.
- **Linear's 2026 refresh**: soften contrast in the chrome so data stands out ("don't compete for attention you haven't earned").
- **The installed design skills** (below), used as checklists. `design-taste-frontend`'s app-screen chapter supplied these rules:
  - answer one question per screen;
  - KPIs are type, not tiles;
  - colour goes on data, not chrome;
  - honest zeros;
  - tables are rules and alignment;
  - one control for the most frequent job, one click from the first screen.

## The idea

> OneShot's whole subject is a request crossing a network that can fail. So the console **shows the wire itself**.

Three signature pieces, each driven only by real data:

1. **The system map** (`features/live/Topology.tsx`).
   - **The path:** Agent → OneShot (API and store) → Worker → Provider → Ledger, with a send line and a return line between each pair.
   - **Packets:** every status change seen between two polls is replayed as packets along the path it took, using `lib/journey.ts`. Its unit tests check, among other things, that a lost reply is drawn as lost and never as success.
   - **Breaks:** a lost reply stops halfway with a ✕.
   - **Ledger lookups** travel worker → provider → ledger and back.
   - **Heartbeats:** each worker heartbeat sends a faint dot to the store.
   - **Node state:** a provider that is down turns its node and edges dashed red, a silent worker says so, and armed faults show on the provider.
   - **Engine:** a single `requestAnimationFrame` loop moves SVG circles, with no React render per frame and at most 28 packets at once.
2. **The trace** (`features/action/Trace.tsx`, model in `lib/trace.ts`).
   - **Rows:** a status band shows what OneShot said over time, one bar per send or ledger check is coloured by outcome, and a diamond marks where the provider's ledger recorded the effect. So a reply lost after the effect was written is visible at a glance.
   - **Idle gaps** over 3 s are compressed and marked with their length.
   - **Interaction:** hovering reads out the time; clicking a bar explains it in plain English.
3. **The bipartite diff** (Reconcile): OneShot's actions on the left and the provider's effects on the right, linked by drawn curves. Duplicates fan out, orphans and missing effects break, and hovering highlights a pair.

## Making it live (revision, 2026-11-04)

The client asked for the console to feel alive, not dead. Colour and motion were added only where they carry meaning or show that the system is running:

- **Ambient aurora.** Three soft fields of the accent colours (orange, blue, violet) drift slowly behind the page. They are radial gradients with no blur filter and move by transform only, over 34–47 s. The panels are slightly translucent, so the glow tints them.
- **Identity colours.** Each part of the system has its own hue:

  | Part | Hue |
  |---|---|
  | Agent | cyan |
  | OneShot | the signal orange |
  | Worker | blue |
  | Provider | pink |
  | Ledger | green |

  On the map each node has a coloured top edge, a tinted icon, and a soft glow that breathes while the node is healthy.
- **Current on the wires.** Dashes flow along every send and return line in the direction of travel, in the colour of the part they lead to. A provider that is down stops the flow and turns its wires dashed red. Packets are larger, with a halo.
- **Status inks are more vivid** in both themes. Counts above zero are tinted with their status colour.
- **Chaos colours.** Each Chaos group keeps one hue: core is blue, ambiguous outcomes are violet, duplicates are amber and process crashes are rose. Cards light up in that hue on hover, and a card with a run in progress glows orange.
- **Reduced motion.** All of it is still under `prefers-reduced-motion`, checked in a browser: 21 running animations normally, 0 with reduced motion.

## The 3D lifecycle on Learn (2026-11-04)

The client asked for the Learn diagram to be more 3D and immersive. `features/learn/Story3D.tsx` builds it with CSS 3D transforms and Motion. There is no WebGL and no new dependency, so text stays crisp and the page stays light.

- **Blocks:** each state is a raised block on a tilted floor. Unreached states are low, states on the route are higher, and the current state rises highest, with a pool of its colour under it.
- **Floor:** every allowed transition is painted on the floor, dashed. The route taken so far is drawn in the signal orange, and the step's own transition glows, with current flowing along it.
- **Packet:** a glowing packet hops along that transition, over and over.
- **Labels** are billboards: they always face the viewer, however the camera turns.
- **Camera:** it springs to a new angle and focus for each step as the story scrolls. The mouse tilts the scene a few degrees, dragging orbits it, and double-clicking resets.
- **Reduced motion:** the camera jumps instead of flying, the packet rests at the end of its edge, and tilt and orbit are off.
- **Flat view:** a **3D / Flat** toggle keeps the 2D state machine available.

Verified in a browser at five story steps in dark mode and one in light, with no page errors. That review caught two geometry bugs, now fixed:
- the back wall of each block was as tall as the block was deep;
- the labels were too low, so the tilted label plane cut into the block.

The camera follow was also softened so the whole route stays in frame.

## Tokens (`web/src/index.css`)

**Neutrals.** Two neutrals (canvas and ink) with tone steps, and one accent.

| Token | Light | Dark | Role |
|---|---|---|---|
| `canvas` | `#F4F5FA` | `#090A11` (blue-black) | page ground |
| `surface` | `#FFFFFF` | `#111317` | panels |
| `sunken` | `#ECEEF1` | `#0D0F12` | wells, segmented controls |
| `line` / `line-strong` | `#E3E6EA` / `#CDD2D9` | `#22262D` / `#323741` | borders, edges |
| `fg` / `fg-2` / `fg-3` | `#0C0E12` / `#50565F` / `#858B95` | `#ECEEF1` / `#A0A6B0` / `#6A707B` | text tiers |
| `signal` | `#F25A1D` | `#FF6A2B` | **the one accent**: the live mark, focus rings, the primary "Break something" action, the path an action took, reading progress |

**Status inks.** Each status has three tokens, `st-*`, `st-*-soft` and `st-*-fg`. They are muted, readable in both themes, and kept clear of the orange accent: VERIFYING is a yellow amber and FAILED a rose red.

**Type.**
- **Mona Sans** (variable, with a width axis) for everything. Headlines run wider (`font-stretch` 110–112%) and heavier (640) for a confident, engineered voice. The UI base size is 14 px.
- **JetBrains Mono** for literal values only: ids, timestamps, statuses, payloads.
- Both are self-hosted (OFL).

**Shape and depth.**
- Panels: 12 px radius; controls: 8 px; chips: 6 px.
- Panels have a 1 px border, a hairline shadow and a faint top highlight in dark mode.
- Pop-overs alone get a real shadow.
- The system map and the Learn diagram sit on a dot grid.

## Motion inventory

| Element | Motion | Purpose |
|---|---|---|
| System map | packets with short trails along real paths; the edge flashes in the packet's colour; the receiving node's ring pulses | shows each observed change as movement |
| Trace | spans grow from the left in sequence; effects pop in; crosshair on hover | reading a run as it unfolded |
| Status strip | proportion bars ease to new values; numbers roll | draws the eye to a change |
| Navigation, tabs, filters, theme switch | a raised pill slides between items (shared `layoutId`, critically damped spring) | shows where you are |
| Page change | 260 ms fade and 8 px rise | continuity |
| Headlines | set line by line from a mask, once | the typographic signature |
| Chaos | a card in a live run gets an accent border and shows the action's status updating in place | cause and effect on one card |
| Learn | the diagram is pinned while the story scrolls; the active step gets an accent rule; reading progress and the active table-of-contents item | scrolling with a purpose |
| Guarantees | a margin line follows reading; each check's ring and glyph draw in | ties the claim to the evidence |
| Reconcile | diff curves draw in on scroll; hovering highlights a pair | linking two records |

**Rules.**
- Only transform and opacity are animated. The exceptions are the SVG `pathLength` draws and the packet positions.
- Strong ease-out curves; UI motion under 300 ms; nothing bounces.
- Keyboard actions are not animated.
- Under `prefers-reduced-motion`:
  - no packets fly, and the receiving node pulses instead;
  - headlines are plain text;
  - there is no smooth scrolling and no custom cursor.

## Agent skills used

Installed in `.claude/skills/` (not committed; `skills-lock.json` records their sources and hashes):

| Skill | Source | Used for |
|---|---|---|
| `frontend-design` | anthropics/skills | committing to one direction |
| `design-taste-frontend` | leonxlnx/taste-skill | app-screen rules and the generated-look registry |
| `emil-design-eng`, `animate`, `animation-performance`, `review-animations`, `break-ui` | emilkowalski/skills | motion decisions, the transform-only rule, frame budget |
| `better-typography`, `better-colors`, `better-layout`, `better-accessibility`, `better-interface` | jakubkrehel/skills | type, contrast, grid, focus and screen-reader names |
| `web-design-guidelines`, `vercel-react-best-practices`, `vercel-react-view-transitions` | vercel-labs/agent-skills | interface guidelines and React performance |

Reinstall them with:

```bash
npx skills add anthropics/skills --skill frontend-design --agent claude-code
npx skills add vercel-labs/agent-skills --skill web-design-guidelines --skill vercel-react-best-practices --skill vercel-react-view-transitions --agent claude-code
npx skills add emilkowalski/skills --skill animate --skill animation-performance --skill review-animations --skill emil-design-eng --skill break-ui --agent claude-code
npx skills add jakubkrehel/skills --skill better-typography --skill better-colors --skill better-layout --skill better-accessibility --skill better-interface --agent claude-code
npx skills add leonxlnx/taste-skill --skill design-taste-frontend --agent claude-code
```

## Customising

- **Colours:** the `:root` and `.dark` blocks in `web/src/index.css`. Mermaid reads the same tokens at render time.
- **Type sizes:** `.t-hero`, `.t-title`, `.t-h2`, `.t-h3` and `.t-figure` in `index.css`.
- **Motion:** `web/src/lib/motion.ts`. Packet timing and colours are at the top of `features/live/Topology.tsx`.
- **What animates for each status change:** `web/src/lib/journey.ts`.
- **Where each Chaos preset strikes:** `features/chaos/FaultRoute.tsx`.
- **Headlines the console writes:** `web/src/lib/headline.ts`.
- **Turning off the grain or the cursor:**
  - grain: remove `class="grain"` from `web/index.html`;
  - cursor: remove `<Cursor />` from `app/Shell.tsx`.

## How it is verified

- **Vitest** (`make web-test`). Beyond the existing logic tests:
  - the journeys: a happy path replayed in full, lost replies drawn as lost, every hop between neighbours;
  - the trace model: segments, tones, the effect inside a lost send, running spans, gap compression;
  - headline writing;
  - the System / Light / Dark switch.
- **Browser end-to-end tests** (`tests/test_web_e2e.py`, real API, provider and worker in headless Chromium; any page error fails a test):
  - the trace shows the ambiguous send and the ledger check that found the effect, explained on click;
  - then the sequence, timeline and ledger tabs;
  - resolving an UNKNOWN with evidence;
  - a Chaos preset, reconciliation, guarantees and ⌘K;
  - Learn rendering Mermaid;
  - every page under reduced motion.
- **Packets:** checked in a real browser by firing a lost-response preset at the running stack and capturing frames.
- **Screenshots reviewed:**
  - every page in dark mode, plus Live, Chaos and Reconcile in light;
  - an action with five ledger checks and a 38-minute resolution;
  - Learn mid-scroll;
  - the palette;
  - Live at 390 px.
