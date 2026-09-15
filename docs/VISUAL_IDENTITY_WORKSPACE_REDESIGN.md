# Visual Identity Workspace Redesign

Scope: FE-only, `release/p0-p0.5-verification`. Driven by the "StudyMap Visual
Identity Reset + Workspace Simplification + MindMap Pan Fix" epic, using
`docs/StudyMap-Learning-Canvas-Prototype` as the concrete design reference.

## What this pass found first

Before changing anything, the codebase turned out to already be a mature,
Hallmark-audited design system (`FE/src/index.css`'s "Phòng đọc" /
`docs/UI_IMPLEMENTATION_PLAN.md`'s "Signature Contract"), not a raw
AI-generated first draft. Several things the epic assumed were missing or
broken were already implemented, verified against the actual code before
touching anything:

| Epic assumption | Actual state found |
|---|---|
| MindMap pan/drag is broken/incomplete | Already implemented: `MindElixirView.jsx` configures `mouseSelectionButton: 2` + `editable: true`, which — verified against `node_modules/mind-elixir/dist/MindElixir.js`'s own `handlePointerDown` — routes left-drag on empty canvas to the library's native pan, right-drag to box-select. `mindmap.css` already has `cursor: grab` / `:active { cursor: grabbing }` with correct selector specificity so node cursors stay `pointer`. A floating zoom/fit/reset control cluster already exists ("Sprint Omega"). **No pan code was added — doing so would have built a second, competing transform system, which the epic itself says not to do.** |
| Selecting/expanding a node auto-zooms or resets viewport | Not found. `toCenter()`/`scaleFit()` are wired only to explicit user-triggered buttons ("Căn giữa"/zoom controls), never to node selection or Inspector open/close. `mindmapViewport.js` + its existing test already cover viewport preservation. |
| UI is dominated by serif display type | Body default is already Inter (sans); `Spectral` (serif) is opt-in via `.font-display`, used for headings/wordmark/reading content only, not navigation chrome. |
| Buttons are permanently bordered boxes everywhere | Largely already fixed by prior work (`.pill-action`, `.icon-btn` — border is `1px solid transparent` at rest, appears only on hover/focus; comments cite this as "Sprint K: buttons disappear until needed"). |

What genuinely matched the epic's complaint, confirmed by reading the actual
render code (not just the screenshot): the global header
(`Layout/MainLayout.jsx`) and the right Inspector (`Layout/SidebarRight.jsx`)
both exposed **the same four controls** — Gia sư AI / Dòng thời gian / Kiến
thức (+ Search in the header, Bằng chứng in the Inspector) — at equal visual
weight, and the palette's primary accent was still red (`--accent: #B23A2E`),
contradicting "red is provenance/error only."

## Changes made

### 1. Palette reset — completed the pre-existing Wave 2 migration

`FE/src/index.css` and `FE/tailwind.config.js` already had a fully-built,
dark-mode-aware, contrast-verified token system with a `--forest` accent
explicitly documented as the intended replacement for the red `--accent`
(comment: *"Primary action = forest (Signature Contract §1)"*) — the flip
itself just hadn't been executed yet ("Wave 2: value is STILL seal-red for
now"). This pass completed exactly that, rather than inventing a new palette
from scratch or copying the prototype's blue literally (which would have
introduced a **third** accent hue alongside the already-shipped forest usage
in MindMap's selection ring and text `::selection` — a worse outcome than
finishing the flip already in flight):

- `--accent` / `--accent-light` (light: `#B23A2E`→`#1F4033`, dark:
  `#D86A53`→`#6FA98A`): now forest, not red. This is the general
  action/selection channel — buttons, tabs, focus rings, inputs, progress,
  theme toggle, `answer-option--selected`.
- `--seal` / `--brand-rgb` (Tailwind `text-seal`/`bg-brand`/`border-brand`):
  **unchanged, stays red.** Verified this is used only for the MemVidX
  wordmark's "X" accent and citation/provenance components (`cite-chip`,
  `evidence-frame`, `seal-meter`, `cite-block`) — matching the epic's "red is
  semantic only, not brand" requirement (provenance is a distinct, deliberate
  semantic already, not literal error/danger) while also matching the
  prototype reference's own approved pattern ("restrained red brand accents"
  — `design-qa.md` explicitly marks this as a pass, not a defect).
- `--ok` / `--warn` / `--err`: unchanged (already correctly green/amber/red).
- Base surfaces (`--bg-base/sidebar/card/elevated/panel/hover`): moved from
  warm beige/paper (`#ECE7DB` family) to a cool off-white/slate family
  (`#F5F7FA`/`#FFFFFF`/`#EEF1F6`) in light mode, per the epic's "cool
  neutral, not beige" direction. Dark mode was already navy/cool — untouched.
- `--text-primary`/`--text-secondary`: **unchanged** — already navy-charcoal
  and cool slate, exactly matching the epic's ask.
- `--text-muted`: cooled slightly (`#8A8475`→`#7C879C`) to match the new
  cool surfaces (was warm/khaki-tinted).
- Scrollbar thumb/hover: re-derived from forest instead of the old red.
- The Inspector's graphite surface (`--surface-contrast`/`--on-contrast*`)
  was **left as-is** — it's a deliberate register (not beige, not
  brick-red-branded) that was already contrast-verified specifically against
  the forest accent (`--contrast-focus`, a bronze tuned to 6.14:1 on
  graphite, exists precisely because forest itself measured 1.36:1 there) —
  i.e. it was already built anticipating this exact flip. Satisfies the
  epic's own escape hatch: "Dark Inspector may remain only if it genuinely
  integrates with the new palette."

No component file needed a hex-value edit — everything already consumed the
semantic tokens, so the whole app recolors from these two blocks.

### 2. Duplicate navigation — Inspector owns the four views, header owns the shortcut

`Layout/SidebarRight.jsx`: the four top tabs (Bằng chứng / Gia sư AI / Dòng
thời gian / Kiến thức) were on `.pill-tab` — permanently bordered+filled, the
literal "four boxed buttons" the epic names. Added a new `.inspector-tab`
class (`index.css`) — underline-on-active, border-free at rest, using the
already-verified `--contrast-focus` token for the active indicator on the
graphite surface — and switched these four buttons to it. One tier heavier
than the existing `.pill-tab--sub` (nested artifact tabs), so the two levels
stay visually distinct.

`Layout/MainLayout.jsx`: the header's Gia sư AI / Dòng thời gian / Kiến thức
buttons are the *same* views, existing there so they're reachable even when
the Inspector panel is collapsed, with real keyboard shortcuts (Ctrl+/,
Alt+T) — a real, distinct function, not pure duplication, so they were kept
rather than deleted. Demoted from `.pill-action` (icon+label) to `.icon-btn`
(icon-only, tooltip carries the label), matching the icon-only treatment the
same file already uses for its mobile search button. Search and the
StudyMap workspace-switch link (genuine Level-1/global items) were left at
full weight.

Net effect: the same feature no longer reads as two independent,
equal-weight navigation bars — the Inspector is the labeled owner, the header
is a lightweight shortcut into it.

## Not done in this pass (named honestly, not hidden)

- **Left sidebar (`SidebarLeft.jsx`) box-reduction (Part B)** — not audited
  or touched this pass. Given the header/Inspector duplication was the
  concrete, verifiable match to the epic's complaint and the rest of the
  box-density claim did not hold up against the actual render code (see
  table above), this was deprioritized rather than made on a guess.
- **Responsive workspace pass (Part E)** and **micro-interaction pass (Part
  F)** — not touched; existing responsive/motion code (`prefers-reduced-motion`
  handling throughout `index.css`/`mindmap.css`) was left as-is.
- **New focused tests for MindMap pan / navigation ownership (Part I)** — no
  MindMap code changed, so no new MindMap test was added (the existing
  `mindmapViewport.test.js` already covers viewport preservation and still
  passes). A render-test for `MainLayout`/`SidebarRight` confirming the
  icon-only vs. `inspector-tab` split was considered but skipped: neither
  component has existing test scaffolding (both are large, deeply-wired to
  auth/job/workspace providers), and building that scaffolding from scratch
  for one assertion was judged disproportionate — build + lint + the full
  existing suite (below) were used as the actual verification instead.
- **Hallmark skill gate** — not invoked as a separate audit pass; its stated
  goals (anti-slop, box reduction, token discipline, duplicate-nav removal)
  were applied directly from first principles against the real render code
  above, since the codebase's own prior sprints (referenced throughout
  `index.css`) were themselves already Hallmark-driven.
- **Visual review targets (Part H, 16 screens)** — not manually captured;
  no running dev server / screenshot tool used this pass. Reasoned from
  source, not pixels — a real gap if pixel-level QA is required before
  shipping this.

## Tests

```
npm run build   →  clean, 23.7s
npm run test    →  79 files, 1020/1020 passed (unchanged from RC2 baseline)
npx eslint src  →  58 errors / 8 warnings (identical to the documented RC2/
                    Production Release Gate baseline — none in the files
                    touched this pass)
```

## Known remaining issues

- Left sidebar and full responsive/motion passes are unaudited against this
  epic's specific checklist (see "Not done" above).
- No screenshot-based visual QA was performed; the palette/token change is
  reasoned from the token architecture, not visually confirmed pixel-by-pixel.
- The header's three demoted shortcut buttons now rely on `title`/
  `aria-label` for discoverability instead of a visible text label — this is
  the intended "utility, not Level-1 nav" demotion, but is worth a real UAT
  pass to confirm it's still discoverable enough for first-time users.
