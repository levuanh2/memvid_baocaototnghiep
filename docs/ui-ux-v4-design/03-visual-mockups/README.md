# Option B visual mockups

This directory contains inspectable, static HTML/CSS prototypes. They are design
artifacts only: no production component is imported or changed.

## Batch 1 — global navigation + Workspace Chat

Open `workspace.html` in a browser. Query parameters select the state:

- `?theme=light&layout=desk` — chosen direction
- `?theme=dark&layout=desk` — chosen direction, dark theme
- `?theme=light&layout=focus` — explored alternative

The same chosen prototype is designed at 1440×900, 820×1180, 390×844, and a
320px-wide stress viewport. Rendered evidence is under `screenshots/`.

### BEFORE evidence used

- `docs/ui-ux-audit-v4/screenshots/codex1-visual-workspace-chat-1920x1080-light.png`
- `docs/ui-ux-audit-v4/screenshots/codex1-visual-workspace-chat-820x1180-dark.png`
- `docs/ui-ux-audit-v4/screenshots/codex1-visual-workspace-chat-430x932-light.png`
- `docs/ui-ux-audit-v4/screenshots/ux-09-chat-result-citations.png`

The audit capture at 820px is the decisive constraint: the persistent 252px
source panel and 328px evidence panel leave an unusably narrow conversation.
The phone layout avoids that squeeze, but removes almost all source/evidence
context from the visible workspace.

Fresh real-app evidence was captured on 2026-10-25 against the local Postgres
backend and a newly registered account with `FE/e2e/fixtures/sample-doc.txt`:

- `screenshots/before-live-workspace-1440x900-light.png`
- `screenshots/before-live-workspace-820x1180-dark.png`
- `screenshots/before-live-workspace-390x844-light.png`

These are not relabelled audit files. `capture-live-before.mjs` records the
reproducible UI flow used to create them.

## Design plan (before building)

### Compact tokens

| Role | Light | Dark | Why |
|---|---:|---:|---|
| Learning blue | `#126CF2` | `#6EA8FF` | The shipped identity and the single active/action colour |
| Canvas | `#F4F8FC` | `#15233B` | Existing product foundation |
| Surface | `#FFFFFF` | `#1B2C49` | Work surfaces separated by tone, not generic card shadows |
| Ink | `#102A5D` | `#ECE7DB` | Existing high-recognition text colour |
| Muted | `#587095` | `#AFC1DD` | Metadata with readable contrast |
| Error | `#F1333A` | `#D86A53` | Preserves semantic separation from the accent |

Typography uses **Aptos / Segoe UI** for controls and **Georgia** only for the
answer body. This is intentional: controls feel contemporary and compact while
the answer reads like study material, not dashboard telemetry. Labels stay in
sentence case; no decorative all-caps or monospace metadata.

### Layout sketches

Chosen A — “learning desk”:

```text
desktop  [brand | workspace modes | library/search/theme/account]
         [source shelf][ conversation + blue citation thread ][evidence]

tablet   [brand | icon modes | library/theme/account]
         [56px source rail][ conversation ][292px evidence]

mobile   [brand | mode switch | library/account]
         [conversation]
         [sources | ask | evidence]  <- thumb-reachable dock
```

Alternative B — “focus transcript”:

```text
desktop  [same global header]
         [72px source rail][ wide transcript with evidence expanded inline ]
```

Alignment is left-led throughout. The answer column is capped at 720px for
reading, while citations align to a visible blue trace that continues into the
evidence inspector.

### Self-critique before building

The first sketch risked becoming a familiar three-column SaaS shell. It was
revised in three product-specific ways: the left side is a document *shelf*
rather than a generic app nav; the central organizing device is a citation
trace, not a field of cards; and the right panel mirrors cited passages instead
of hosting unrelated widgets. Decorative gradients, dashboard stat cards, and
uniform pill-shaped containers were removed.

## Decision

**Choose A, the learning desk.** Evidence remains persistent on desktop because
source-grounded answers are the product promise, and the source shelf remains
independently scannable. At tablet width the shelf compresses to a 56px rail,
recovering roughly 196px for the answer without changing state ownership. On
mobile, both contextual surfaces become explicit actions in a fixed dock; this
keeps the composer and answer full-width while preserving named, reachable
entry points.

Alternative B is calmer and excellent for long reading, but putting citations
inline makes evidence compete with the response and weakens the Inspector as a
stable comparison surface. It is retained as a useful future “focus reading”
mode, not selected as the default Workspace architecture.

The proposal preserves simultaneous Chat/MindMap/Summary mounting, keeps source
and inspector state ownership separate, and does not imply route remounting.
The source and evidence close actions remain mode-aware presentation controls.

## Rendered AFTER evidence

| Candidate | Theme / viewport | File |
|---|---|---|
| Learning desk (chosen) | Light · 1440×900 | `screenshots/workspace-desk-1440x900-light.png` |
| Learning desk (chosen) | Dark · 1440×900 | `screenshots/workspace-desk-1440x900-dark.png` |
| Learning desk (chosen) | Light · 820×1180 | `screenshots/workspace-desk-820x1180-light.png` |
| Learning desk (chosen) | Dark · 820×1180 | `screenshots/workspace-desk-820x1180-dark.png` |
| Learning desk (chosen) | Light · 390×844 | `screenshots/workspace-desk-390x844-light.png` |
| Learning desk (chosen) | Dark · 390×844 | `screenshots/workspace-desk-390x844-dark.png` |
| Learning desk (chosen) | Light · 320×844 stress | `screenshots/workspace-desk-320x844-light-stress.png` |
| Focus transcript (alternative) | Light · 1440×900 | `screenshots/workspace-focus-1440x900-light.png` |
| Focus transcript (alternative) | Dark · 1440×900 | `screenshots/workspace-focus-1440x900-dark.png` |

`render.ps1` regenerates the full set with Playwright at exact CSS viewports;
this avoids Windows headless-Chrome's misleading sub-500px viewport clamp.

### Agy review changes applied

The independent review in `08-independent-agy-review.md` identified three
issues in the first checkpoint. This working prototype now:

- preserves the Inspector's established **320px floor** at tablet widths;
- moves mobile source/evidence access into the conversation header instead of
  a persistent bottom dock that would collide with the software keyboard;
- uses the canonical token names (`--bg-base`, `--bg-card`, `--text-primary`,
  `--accent-subtle`, `--border-color`) shared with the map grammar.

## Batch 2 — MindMap + StudyMap visual parity

Open `maps.html` with `?screen=mindmap&theme=light` or
`?screen=studymap&theme=dark`. `render-maps.ps1` produces both engines at
1440×900, 820×1180, 390×844, and a 320px stress width.

### BEFORE evidence used

- `docs/ui-ux-audit-v4/screenshots/codex1-visual-workspace-mindmap-1280x800-light.png`
- `docs/ui-ux-audit-v4/screenshots/codex1-visual-workspace-mindmap-768x1024-dark.png`
- `docs/ui-ux-audit-v4/screenshots/codex1-visual-workspace-mindmap-390x844-light.png`
- `docs/ui-ux-audit-v4/screenshots/codex1-visual-study-map-1440x900-light.png`
- `docs/ui-ux-audit-v4/screenshots/codex1-visual-study-map-820x1180-dark.png`
- `docs/ui-ux-audit-v4/screenshots/codex1-visual-study-map-390x844-light.png`

### Shared visual contract

Both prototypes implement Agy's normative grammar in
`05-shared-map-visual-grammar/`: blue root, bordered section nodes, compact
concept nodes, calibrated connectors, sans-serif graph labels, dot-lattice
canvas, and the same blue selection halo. The example dataset is identical so
visual parity can be judged directly.

The engines remain intentionally distinct:

- **MindMap** keeps editable card nodes, branch-coloured curves, source scope,
  artifact toolbar, Appearance, Export Studio, and a node Inspector.
- **StudyMap** keeps its read-only SVG lineage, search, layout switch, quick
  image export, presentation affordance, and concept study action.

On mobile, both switch to a readable depth-one tree rather than scaling the
desktop graph until its labels become illegible. Context becomes a bottom
sheet, but the canvas retains enough height to explain the current position.

### Export-fidelity guardrail

The MindMap mockup changes the proposed *live* node grammar only. It does not
propose changing node identity, connector topology, export selection markers,
offscreen capture, or Exact-node Export V3 geometry. Any implementation must
apply the shared tokens through the existing export-aware appearance path and
re-run live/export node, connector, selection, and rendered-page parity gates.

`verify-maps.mjs` checks 14 states for exact viewport, horizontal overflow,
selected-node visibility, and a usable canvas width.
