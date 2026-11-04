# OneShot console: design system (v3, "the paper of record")

The v3 redesign of the web console. The page set, data and behaviour from `FRONTEND_PLAN.md` are unchanged; this file records the look, and why.

## The brief, restated

- **Subject:** a console for watching an execution engine handle failure: lost responses, crashes, duplicates, and the moments where it refuses to guess.
- **Audience:** the person learning backend reliability from this project, and anyone reviewing it as portfolio work.
- **Client's choices (from the design Q&A):**
  - *Look and colour:* an editorial/print look; warm paper, ink and red; a serif, a grotesk and a mono.
  - *Motion and scrolling:* purposeful but rich motion; a masthead that condenses on scroll; the pinned story on Learn; horizontal chapter strips; headlines set line by line; an "ink settle" page transition.
  - *Page structure:* a masthead with section navigation; Live as a stacked front page (headline, wire figure, report); airy working pages.
  - *Small things:* plain, factual headlines; fine ink line art; paper grain; a custom cursor.
  - *Theme (revised 2026-11-04):* a three-way System / Light / Dark switch; System, which follows the OS, is the default.

## The idea

> On this console, **the provider's ledger, the record of what really happened,** becomes **a paper of record**.

Every page is a section of that paper:
- Live is the front page, and its headline is written from live data ("Three actions need a human.").
- Each action has its own story page.
- The provider's ledger is set like an accountant's book, with a double rule under the total.
- The signature figure is **the wire**: one ink rail, five stations, and tokens that glide between them as the backend changes status.

This idea comes from the subject itself. OneShot's whole job is keeping a trustworthy record, and the ledger is the authority.

## Avoiding the generated look

The `design-taste-frontend` skill lists the editorial look as the current most-generated style: a cream ground with terracotta, hairlines everywhere, and serif display used as a shortcut to "premium". The client asked for editorial, so v3 keeps it but removes each of those tells:

| Tell | What v3 does instead |
|---|---|
| Yellow-cream ground with terracotta or rust | A low-chroma **stone** paper (`#F2F0EB`, chroma ≈ 0.006) and a true **vermilion** (`#E1361C`), not brown-orange |
| Hairlines everywhere ("broadsheet cosplay") | Rules appear only where print uses them: a heavy rule under the masthead, 2 px rules over tables, hairlines between table rows. Surfaces are separated by a tone step (`sheet`, `well`), never by an outlined box |
| Eyebrows, index numbers, tracked caps | None. Order is shown by position and words; labels are sentence case |
| Monospace as a "technical" voice | Mono appears only for literal values: ids, timestamps, enum values, code |
| Colour everywhere | Colour means state. Vermilion is the editor's pen (below); status inks appear only where a status is reported |

## Tokens (`web/src/index.css`)

| Token | Light | Dark | Role |
|---|---|---|---|
| `paper` | `#F2F0EB` | `#12110E` | the ground |
| `sheet` | `#F9F8F5` | `#1A1915` | raised surfaces (preset stories, diagrams, dialogs) |
| `well` | `#E8E5DE` | `#23211C` | recessed surfaces, skeletons |
| `ink` | `#17150F` | `#ECE7DB` | text, rules, primary buttons |
| `ink-2` | `#57534A` | `#A8A193` | secondary text (contrast ≥ 6:1 on paper) |
| `ink-3` | `#8C877C` | `#777164` | empty states and zero counts only |
| `rule` | `#D6D2C8` | `#34312A` | hairlines inside tables |
| `mark` | `#E1361C` | `#F2533A` | **the editor's pen**: the active section, the path an action took, a link under the cursor, the live mark, reading progress |

**Status inks.** Each status has three tokens: `st-*`, `st-*-soft` and `st-*-fg`.

| Status | Ink |
|---|---|
| PENDING | graphite |
| IN_FLIGHT | blue-black |
| VERIFYING | ochre |
| SUCCEEDED | green |
| FAILED | oxblood, deliberately far from the vermilion so failure never reads as "the editor's mark" |
| UNKNOWN | violet |

**Type.** Three self-hosted faces, all OFL and free:

| Face | Used for | Why |
|---|---|---|
| **Instrument Serif** | the wordmark, page titles, headlines, big numbers | a condensed display serif that sets tight at large sizes |
| **Schibsted Grotesk** | everything read or clicked | a variable grotesk designed for a news publisher, so it belongs in a newspaper |
| **IBM Plex Mono** | literal values only | ids, timestamps, enum values, code |

Sizes:
- Display runs from 52 to 140 px, at `line-height` 0.82–1.0 and −0.018 em tracking.
- Body text is 16–17 px at 1.55–1.68.
- The standfirst is 19 px.
- The small floor is 12.5 px, used only for mono timestamps.

**Shape.** Corners are square (2–4 px) and buttons are flat. A button is either an ink fill or an ink outline, and it scales to 0.97 when pressed.

## Layout

```text
Wednesday, 4 November 2026          16 actions on record          ● Live  Jump to ⌘K  ◐
OneShot.                                         The record of every action an agent…
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Live   Chaos   Reconcile   Ledger   Guarantees   Learn          (red mark on the heavy rule)
─────────────────────────────────────────────────────────────────────────────────────────
Page title (serif, large)                                                  [page actions]
Standfirst: one sentence on what this page is for.
```

- **Frame:** one 1320 px frame with equal 20/32/40 px margins and a 12-column grid inside it.
- **Section gaps:** sections sit 96–112 px apart.
- **Condensed bar:** when the masthead scrolls away, a slim bar slides down (transform only) with the wordmark, the sections and the tools.
- **Colophon:** the footer closes the page with the name set at full width.

## Motion inventory

| Element | Motion | Why |
|---|---|---|
| Headlines | set line by line: each line rises out of a mask, once, measured after fonts load (`components/SetHeadline.tsx`) | the one typographic signature; it reads like type dropping into a forme |
| Page change | "ink settle": 280 ms opacity with a 10 px rise; exit 120 ms | continuity without delay |
| Masthead | the slim bar slides in when the masthead leaves view | navigation is always one move away |
| Section and tab mark | a red bar slides between items on a critically damped spring | shows where you are |
| The wire | tokens glide between stations on a spring (shared `layoutId`), driven only by polled data | shows the status change itself |
| Wire report | new lines slide in at the top as changes are seen between polls | the paper updating |
| Lifecycle figure | the path taken is drawn in red (`pathLength`) | the editor marking the route |
| Flow diagram | **Replay** steps through the recorded facts | watch a failure happen in order |
| Chaos | horizontal chapter strips: native scroll, mouse drag, step buttons, a red progress line; snapping on touch; the vertical wheel is never hijacked | browse stories without losing the page |
| Learn | the diagram is pinned while the story scrolls and lights each step; a red reading-progress line; a table of contents with an active marker | scrolling with a purpose |
| Guarantees | a red line in the margin follows reading; each check's ring and glyph draw in when reached | ties the claim to the evidence |
| Cursor | an ink dot under the pointer, and a ring on a spring that grows over anything clickable; it inverts against what it is over; mouse only, never under reduced motion; text fields keep the caret | a printed-page feel, and precise feedback |
| Counts | numbers roll to their new value | draws the eye to a change |

**Rules.**
- Only `transform` and `opacity` are animated, except the link underline, which animates `background-size`.
- UI motion is ≤ 300 ms with a strong ease-out (`cubic-bezier(0.23, 1, 0.32, 1)`).
- Nothing enters from `scale(0)`.
- Nothing bounces.
- Keyboard actions (⌘K, keys 1–6) are not animated.
- Under `prefers-reduced-motion`: headlines are plain text, there is no smooth scrolling and no custom cursor, and pulses stop.

## The agent skills used

Installed in `.claude/skills/` (not committed; `skills-lock.json` records their sources and hashes), and used as checklists while building:

| Skill | Source | Used for |
|---|---|---|
| `frontend-design` | anthropics/skills | committing to one direction |
| `design-taste-frontend` | leonxlnx/taste-skill | the generated-look registry above; app-screen rules (one question per screen, KPIs as type, honest zeros) |
| `emil-design-eng`, `animate`, `animation-performance`, `review-animations`, `break-ui` | emilkowalski/skills | motion decisions, durations and easing, transform-only motion, worst-case data |
| `better-typography`, `better-colors`, `better-layout`, `better-accessibility`, `better-interface` | jakubkrehel/skills | type scale and wrapping, contrast, grid, focus and screen-reader names |
| `web-design-guidelines`, `vercel-react-best-practices`, `vercel-react-view-transitions` | vercel-labs/agent-skills | interface guidelines and React performance |

Reinstall them with:

```bash
npx skills add anthropics/skills --skill frontend-design --agent claude-code
npx skills add vercel-labs/agent-skills --skill web-design-guidelines --skill vercel-react-best-practices --skill vercel-react-view-transitions --agent claude-code
npx skills add emilkowalski/skills --skill animate --skill animation-performance --skill review-animations --skill emil-design-eng --skill break-ui --agent claude-code
npx skills add jakubkrehel/skills --skill better-typography --skill better-colors --skill better-layout --skill better-accessibility --skill better-interface --agent claude-code
npx skills add leonxlnx/taste-skill --skill design-taste-frontend --agent claude-code
```

Their scripts were read before use. Only `assets.mjs` uses the network (it searches public image archives); it was not run, because this console uses no photographs.

**Where the client's choices override a skill.** `design-taste-frontend` bans serif display, more than two typefaces, hairlines and a custom cursor. The client explicitly chose a serif, three faces, a masthead with rules and a custom cursor. Those choices win; the table under "Avoiding the generated look" is how the tells were removed anyway.

## Customising

- **Colours and type:** the token blocks at the top of `web/src/index.css`. Dark mode is the `.dark` block. Mermaid reads the live tokens, so diagrams follow automatically.
- **Theme:** `app/theme.ts` (System / Light / Dark; System is stored as no choice, so it keeps following the OS) and `app/ThemeSwitch.tsx`. The pre-paint copy of the logic is in `web/index.html`.
- **Palette previews (not yet chosen):** four alternative two-neutrals-plus-one-accent palettes (`cobalt`, `sage`, `magenta`, `night`) sit under `html[data-palette=…]` in `index.css`. Pick one with `?palette=<name>` in the URL; `?palette=paper` returns to the default. `night` is dark-first and ignores the theme switch.
- **Motion:** `web/src/lib/motion.ts` holds the easing curves and springs. The headline reveal timing is in `components/SetHeadline.tsx`, and the cursor in `app/Cursor.tsx`.
- **Headlines the console writes:** `web/src/lib/headline.ts`, with tests in `headline.test.ts`.
- **The wire's stations and captions:** `web/src/features/live/Wire.tsx`.
- **Preset stories:** `oneshot/lab.py`.
- **Turning off the grain or the cursor:**
  - grain: remove `class="paper-grain"` from `web/index.html`;
  - cursor: remove `<Cursor />` from `app/Shell.tsx`.

## How it is verified

- **Vitest** (`make web-test`):
  - headline writing for every system state;
  - explanations, flow building and the ledger comparison;
  - finding guides;
  - the wire's columns;
  - the state machine matching `ALLOWED_TRANSITIONS`.
- **Browser end-to-end tests** (`tests/test_web_e2e.py`). They run against the real API, provider and worker in headless Chromium, and any page error fails a test:
  - a lost-response story across all three tabs;
  - resolving an UNKNOWN with evidence;
  - a Chaos preset, then reconciliation, then the guarantees;
  - the ⌘K palette;
  - Learn rendering Mermaid;
  - every page under reduced motion.
- **Interaction checks** (scripted in Playwright while building), on the chapter strips:
  - a sideways wheel scrolls the strip and leaves the page alone;
  - a vertical wheel over the strip scrolls the page;
  - the step buttons and mouse drag move it.
- **Screenshots reviewed:**
  - every page in light mode;
  - Live and an action page in dark mode;
  - Learn and Guarantees mid-scroll (pinned story, condensed bar, cursor);
  - Live at 390 px and Chaos at 820 px.
