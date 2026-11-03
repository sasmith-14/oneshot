# OneShot Lab: design system (v2)

The v2 redesign of the web console. The decisions from the planning discussion (`FRONTEND_PLAN.md`) still hold. This file adds the visual system and the research behind it.

## The brief, restated

- **Subject:** a console for watching an execution engine handle failure: lost responses, crashes, duplicates, and the moments where it refuses to guess.
- **Audience:** the person learning backend reliability from this project, and anyone reviewing it as portfolio work.
- **Primary job:** make what happened *on the wire* and *in the provider's ledger* visible, and explain every decision in plain language.

## Research summary (what was used, and why)

| Need | Choice | Why this, not the alternative |
|---|---|---|
| Animation | **Motion for React** (`motion`, formerly Framer Motion) | Layout animations and shared `layoutId` let a token glide when its status changes, springs are interruptible, `useScroll`/`useTransform` handle scroll-linked effects, and `MotionConfig reducedMotion="user"` respects the OS setting. GSAP (now free) is excellent, but two animation libraries would be redundant. |
| Smooth scrolling | **Lenis**, on long reading pages only | Smooths wheel scrolling. Turned off for `prefers-reduced-motion` and on touch devices, following the accessibility cautions (Thoughtworks Radar, community guidance). |
| Command palette | **cmdk** (via the shadcn `Command` component) | ⌘K navigation is a standard in developer tools (Linear, Raycast, Vercel): open any action by id, run any preset, switch pages. |
| Feedback | **Sonner** toasts with `aria-live` | Every lab action confirms what changed, and failures say how to fix them. |
| Documents | **react-markdown** + remark-gfm, **Mermaid** loaded lazily | The Learn pages render the same Markdown as the PDFs. The Mermaid bundle is code-split, so it loads only on Learn. |
| Quality gates | Anthropic `frontend-design` skill; Vercel `web-design-guidelines`, `react-best-practices` and `react-view-transitions` skills (installed in `.claude/skills/`) | Used as checklists for design choices, accessibility, re-render and bundle hygiene. |

Motion rules, distilled from the sources:
- UI transitions are under about 300 ms, with a strong ease-out (`cubic-bezier(0.23, 1, 0.32, 1)`) or a critically damped spring.
- Entrances start at a scale of 0.96–0.98, never 0.
- Only `transform` and `opacity` are animated.
- Actions started from the keyboard are not animated.
- Motion answers a state change; there is no decoration on a loop.

## Tokens

**Colour means state. Nothing else is coloured.** The interface is ink on paper; hue appears only where an action's status or a finding's severity is being communicated.

| Token | Light | Dark | Role |
|---|---|---|---|
| ink | `#15171C` | `#E8EAEE` | text, primary buttons |
| paper | `#F7F8FA` | `#101217` | page background |
| panel | `#FFFFFF` | `#161920` | raised surfaces |
| rule | `#E4E6EB` | `#262A33` | hairlines |
| mute | `#6A7180` | `#8B93A3` | secondary text |

Status hues (muted and pastel, the same in both themes, with adjusted lightness): PENDING slate, IN_FLIGHT blue, VERIFYING amber, SUCCEEDED green, FAILED red, UNKNOWN violet.

**Type.**
- Inter for the interface. JetBrains Mono only for things that *are* code: ids, timestamps, payloads and enum values.
- Scale: 12 / 13 / 14 / 16 / 20 / 28 / 40 px.
- Page titles are 28–40 px semibold with a letter spacing of −0.02 em.
- Body text is 14–15 px with a line height of 1.55.
- Headings are sentence case. No all-caps eyebrows.

**Shape.**
- Radius follows hierarchy: 14 px for panels, 9 px for controls, fully round for status pills and tokens.
- Hairlines separate sections. Cards are used only for objects you act on, such as presets and findings.

## Layout

```text
┌ OneShot ─ Live  Chaos  Reconcile  Ledger  Guarantees  Learn ───── ⌘K  ● live  ◐ ┐
│                                                                                │
│ Page title                                              [primary action]       │
│ One sentence on what this page is for.                                         │
│ ─────────────────────────────────────────────────────────────────────────────  │
│ content, left-aligned, max width 1240                                          │
└────────────────────────────────────────────────────────────────────────────────┘
```

## The one memorable thing: **The Wire**

The home page opens with a live pipeline instead of a row of identical count cards. It has five columns:

> Accepted → On the wire → Checking the ledger → Settled · Needs a human

Each recent action is a token that **physically glides to its new column** when the backend changes its status. This uses a shared layout animation driven by real polled data. A token that goes ON the wire pulses, a token that lands in "Needs a human" is violet, and clicking a token opens its full story. Everything else on the page stays quiet so this stays the focus.

## Motion inventory (everything that moves, and why)

| Element | Motion | Purpose |
|---|---|---|
| Wire tokens | spring layout move between columns | shows the status change itself |
| Nav and tab indicator | shared `layoutId` slide | shows where you are |
| Route change | 160 ms fade + 6 px rise | continuity without delay |
| State diagram | path taken is drawn in (`pathLength`) | shows the route this action took |
| Flow diagram | **Replay** button steps through the recorded facts | lets you watch a failure happen in order |
| Learn | scroll progress bar, sticky table of contents, "Life of an action" scrollytelling (a sticky diagram that lights up as you read) | interactive scrolling with a purpose |
| Guarantees | each guarantee's live check fills in as it scrolls into view | ties the claim to the evidence |
| Counters | number roll on change | draws the eye to a change |

All of it is reduced to instant changes under `prefers-reduced-motion`.

## Self-review against the brief (pass 2)

- *First instinct:* six identical status cards, as in v1. That is the "SaaS card kit" default, so it was **replaced by The Wire**, which shows the same counts in the column headers and also shows *movement*.
- *First instinct:* an uppercase "LAB CONSOLE" tag next to the logo. That is a decorative eyebrow, so it was **removed**. The lab state is shown where it matters, on Chaos.
- *First instinct:* fade-and-rise every section on scroll. That is generic, so it was **limited to the Learn scrollytelling and the Guarantees checks**, where scrolling *means* something.
- *Kept from the brief, deliberately:* Inter + JetBrains Mono, top navigation, pastel status colours, and light and dark themes. These are the client's explicit choices.

## Reinstalling the agent skills

The skill files are third-party, so they are not committed. `skills-lock.json` records their sources and hashes. To reinstall them into `.claude/skills/`:

```bash
npx skills add anthropics/skills --skill frontend-design --agent claude-code
npx skills add vercel-labs/agent-skills --skill web-design-guidelines --skill vercel-react-best-practices --skill vercel-react-view-transitions --agent claude-code
```

## How it is verified

- **Vitest** (`make web-test`): explanations, flow building, the ledger comparison, finding guides and diff pairing, the Wire's columns, and the state machine matching `ALLOWED_TRANSITIONS`.
- **Browser end-to-end tests** (`tests/test_web_e2e.py`, real API + provider + worker, headless Chromium):
  - a lost-response story across all three tabs;
  - resolving an UNKNOWN with evidence;
  - a Chaos preset, then reconciliation, then the guarantees;
  - the ⌘K palette;
  - Learn rendering Mermaid;
  - every page under reduced motion.

  Any page error fails the test.
- **Backend** (`tests/test_lab.py`): every preset that does not need process control ends exactly as its card says. The supervisor really kills, crashes and restarts processes.
- **Screenshots** of every page, in light and dark, mid-scroll and mid-failure, were reviewed while building.

Two bugs were found this way and fixed:
- The command palette crashed the page, because this shadcn version's `CommandDialog` does not create the cmdk root. A browser test caught it.
- Two different presets sent identical charges, which reconciliation correctly flagged as a suspected duplicate request. The presets now use unique payloads, and a test checks it.
