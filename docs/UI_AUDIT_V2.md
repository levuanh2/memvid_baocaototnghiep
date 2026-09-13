# UI Audit V2 — Paper & Graphite Redesign, Phase 1

Read-only audit. No files modified. Scored against the **Paper & Graphite** spec
(`paper-graphite-redesign.html` — tokens: `--bg #F3EEE1`, `--bg-raised #EAE1CC`,
`--surface-contrast #221F19` fixed dark register, `--text #1C1912`, `--accent
#1F4033` forest, `--accent-warm #A06A3B` bronze, `--signal #A93F23` rust;
Fraunces / Inter / IBM Plex Mono; 3px radius ceiling on interactive controls
only; motion ceiling ~180ms, ease only, no spring/bounce).

**Correction note (added after Phase 3, post-Codex/hallmark review)**: every
mention of "Fraunces" or "italic" below is quoting the *original* Paper &
Graphite spec as written before this audit discovered MemVid's own existing
"Phòng Đọc" identity (§0). `UI_IMPLEMENTATION_PLAN.md`'s **MemVid Signature
Contract** supersedes both — Spectral stays, no role uses italic. Read every
"Violates Paper & Graphite" line below as "differs from the original spec,"
not as "the corrected target"; the Implementation Plan is the authoritative
target now.

## 0. Framing — read this before anything else below

MemVid is **not** a generic gray shadcn dashboard. It already ships a complete,
deliberate, internally-consistent design language — call it **"Phòng Đọc /
Reading Room"**: warm paper (`--bg-base #ECE7DB`), deep ink text (`--text-primary
#1B2A41`), **one** seal-red accent (`--accent #B23A2E`, explicitly commented
"reserved for provenance/active/error"), Spectral serif + Inter + IBM Plex Mono
in the exact editorial/dense/instrument role-split Paper & Graphite itself
prescribes, first-class hand-tuned dark mode (not an auto-invert), and several
genuine signature components already (`.cite-chip`, `.seal-meter`, `.apparatus-*`,
`.panel-spine`, `.evidence-frame`). Confirmed by grep: **zero** `gray-*` Tailwind
classes anywhere in `FE/src`. Also confirmed: **Framer Motion is not in
`package.json` and has zero imports anywhere** — the brief's stack list is
stale; all real motion is plain CSS `@keyframes`/`transition`.

**What this changes about scope**: this is a **re-skin of one bespoke system
into another**, not a rescue from "gray card, purple gradient, glassmorphism."
The real gap against Paper & Graphite is narrower and more specific than the
original brief assumed:

1. **One accent color does every job** — primary action, links, focus ring,
   selection, active tab, hover, *and* error (`--err` and `--accent` are the
   literal same hex, `#B23A2E`, in light mode). Paper & Graphite's three-role
   split (forest = action/selection, bronze = data/hover, rust = signal-only,
   never twice on a screen) doesn't exist as a *concept* yet.
2. **No permanent "graphite" register** — dark mode is a whole-app toggle
   (`html.dark`), not a fixed material some surfaces always wear regardless of
   theme. Paper & Graphite's MindMap canvas / Inspector rail / nav frame need a
   register that's dark in *both* themes.
3. **Radius is already disciplined** (arbitrary `rounded-[6–10px]` values, never
   Tailwind's `rounded-lg`/`xl` defaults) but sits above the spec's 3px ceiling
   everywhere, and panels/cards use radius+shadow where the spec wants square
   containers.
4. **No shared type scale anywhere** — 495+ arbitrary `text-[Npx]` instances
   across 42 files, 23+ distinct pixel sizes with no scale relationship. This is
   the single biggest structural gap in the whole app, larger than color.
5. **A real, pre-existing correctness bug**, independent of any redesign:
   several inline styles reference CSS custom properties that are **never
   declared** (`var(--border)`, `var(--brand)`, `var(--surface-elevated)`,
   `var(--ok-bg)`, `var(--font-display)`) — 25+ call sites across 7+ files,
   including the StudyMap graph's root/section/selection node color. See
   `DESIGN_TOKEN_AUDIT.md` for the full list; **this must be fixed as a
   correctness fix, not treated as a Paper & Graphite violation to repaint over.**

Everything below is organized by the requested screen/component taxonomy.
Each entry: **Current implementation** → **Problems** → **Visual inconsistency**
→ **Accessibility concerns** → **Design debt** → **Violates Paper & Graphite**
→ **Difficulty** → **Risk**.

---

## 1. Main Layout (header shell)

- **Files**: `components/Layout/MainLayout.jsx`, `index.css`
- **Current implementation**: Fixed 58px `<header>`, `background: var(--bg-sidebar)`. Wordmark: a rotated (`-4deg`) bordered square "M" seal-stamp motif in `--accent` + serif name (MainLayout.jsx:182-193). Center: uppercase mono eyebrow or `StudyBreadcrumb` when a document is open. Right: `.pill-action` buttons, sun/moon `.theme-toggle`, `AccountMenu`.
- **Problems**: None functional.
- **Visual inconsistency**: None internally.
- **Accessibility concerns**: None found — `aria-label`s present, `aria-pressed` on theme toggle.
- **Design debt**: None notable.
- **Violates Paper & Graphite**: No graphite register anywhere (spec: nav frame should be permanently graphite). Wordmark uses seal-red, not forest/bronze. The "nav rail" concept from spec §08 doesn't exist here at all — this is one header bar, not a rail+content split.
- **Difficulty**: Small (isolated header block, token/color swap only).
- **Risk**: Low.

## 2. Sidebar Left (source library)

- **Files**: `components/Layout/SidebarLeft.jsx`
- **Current implementation**: Cards `rounded-[8px] border` on all 4 sides. Selected state = border-color change + `background: color-mix(...--accent 6%...)` + possibly `shadow-glow` (three simultaneous signals for one state). Status via mono `Badge` + `.progress-track`/`.progress-fill` (seal-red fill, `rounded-full`).
- **Problems**: Full 4-side border on every card is the "uniform card" shape even though the color isn't gray. Three signals (border + bg tint + shadow) for one selection state is more than the spec's "one unambiguous ring" rule asks for.
- **Visual inconsistency**: Selection recipe here doesn't match how selection is drawn in Study cards (different border+background recipe) or MindMap nodes (ring, no bg tint) — three different "selected" languages in one app.
- **Accessibility concerns**: Color is not the only signal (icon color also changes) — acceptable.
- **Design debt**: `shadow-glow` usage not confirmed defined in read files — verify it isn't dead/leftover before or during migration.
- **Violates Paper & Graphite**: 4-side border where spec wants "hairline on the trailing edge only, never all four sides"; radius 8px vs 3px ceiling.
- **Difficulty**: Small–medium (card pattern is reused consistently — one restyle propagates — but the 3-signal selection state needs an explicit decision, not a find/replace).
- **Risk**: Low.

## 3. Header search / command entry points

- **Files**: `index.css` (`.header-search`), `MainLayout.jsx`, `SidebarLeft.jsx`
- **Current implementation**: Boxed input, `rounded-[7px]`, focus = border-color change + `box-shadow: 0 0 0 3px rgba(178,58,46,0.10)`.
- **Violates Paper & Graphite**: Spec wants underline-style inputs (no box) in reading contexts, boxed only in instrument toolbars — whether search counts as "reading" or "instrument" context needs an explicit call in Phase 3, not a silent default.
- **Difficulty**: Trivial (one shared class). **Risk**: Low.

## 4. Workspace container & tabs

- **Files**: `components/Layout/WorkspaceContainer.jsx`, `WorkspaceTabs.jsx`
- **Current implementation**: `WorkspaceContainer` is pure mount/layout logic (all three panes stay mounted, toggled via `hidden`) — **do not touch, zero styling of its own**. `WorkspaceTabs`: no pill background, active tab = 2px bottom border in `--accent`, bold weight — **already matches the spec's tab rule almost exactly**.
- **Problems**: None structural.
- **Violates Paper & Graphite**: Color only (seal-red → bronze underline); the *original* spec additionally wanted the active label to shift into Fraunces italic — superseded by the Signature Contract (Spectral, no italic; use weight instead), not done today either way.
- **Difficulty**: **Trivial — single easiest, lowest-risk win in the whole app.**
- **Risk**: Low.

## 5. Panel Divider (splitter) & Panel Spine (collapsed column)

- **Files**: `components/Layout/PanelDivider.jsx`, `PanelSpine.jsx`, `index.css`
- **Current implementation**: Divider — 9px hit area, 1px visible grip, hover/active/focus → `--accent` + focus ring. **Full keyboard support**: arrow-key resize, Home/End, Enter reset, correct `role="separator"`/`aria-orientation`/`aria-valuenow/min/max`. Spine — literal "book spine": vertical `writing-mode` label + count badge, border on the collapsed side.
- **Problems**: None — some of the best-crafted, most accessible code in the app.
- **Accessibility concerns**: None — genuinely strong; keyboard-operable splitters are rare.
- **Design debt**: None.
- **Violates Paper & Graphite**: Grip visible at rest (spec: visible only on hover/focus). Spine sits on paper, not the spec's permanent graphite frame register. Recommend **keeping the "book spine" concept as-is** (it's already an on-brief signature), only re-skinning tokens (graphite bg, bronze count badge).
- **Difficulty**: Trivial (CSS-only: opacity at rest, 2 background/color token swaps).
- **Risk**: Low.

## 6. Modal (dialog frame)

- **Files**: `components/ui/Modal.jsx`
- **Current implementation**: Portal, `role="dialog" aria-modal="true"`, backdrop blur, full focus-trap (Tab/Shift+Tab), focus save/restore, Escape-to-close, `rounded-[10px]`, `animate-fadeUp` (450ms ease-out translateY 12px→0, no spring/bounce).
- **Problems**: None functional.
- **Accessibility concerns**: None — best a11y in the whole app (full focus management, correct ARIA).
- **Violates Paper & Graphite**: `rounded-[10px]` exceeds 3px ceiling; `box-shadow: var(--shadow-card-hover)` where spec wants hairline-edge, no shadow; 450ms exceeds the ~180ms panel-open guideline (a duration fix, not a physics fix — it's already ease-out, not a spring).
- **Difficulty**: Trivial — **one shared component; fixing it updates every dialog in the app at once** (ChangePasswordDialog, NksVerifyDialog, ProfileDrawer, CommandPalette, any future modal).
- **Risk**: Low, high leverage.

## 7. Toaster / Spinner

- **Files**: `components/ui/Toaster.jsx`, `components/ui/Spinner.jsx`
- **Current implementation**: Toaster — fixed bottom-right stack, `rounded-[8px] border`, soft shadow, **3px left color bar keyed to type** (info/success/error) — already close to the spec's "structure encodes information" instinct. Spinner — `currentColor` border-spin, no color/shape opinion of its own.
- **Accessibility concerns**: `role="alert"`/`"status"` correctly switched by type on Toaster — good.
- **Violates Paper & Graphite**: Shadow + 8px radius on Toaster; otherwise near-compliant in spirit (left-rule signal — keep it, retint it). Spinner: nothing to violate.
- **Cross-cutting gap**: **No skeleton-loader system exists in this layer** — loading states here are Spinner + text only. (Contrast: DocumentList and the MindMap Inspector *do* have real skeleton shimmers — see §12/§15. Presence is inconsistent app-wide.) Paper & Graphite itself has no skeleton-treatment section — recommend a short addendum before Phase 3 build so this has a real target.
- **Difficulty**: Trivial. **Risk**: Low.

## 8. Dialogs (ChangePasswordDialog, NksVerifyDialog, ProfileDrawer, AccountMenu)

- **Files**: `components/Layout/ChangePasswordDialog.jsx`, `NksVerifyDialog.jsx`, `ProfileDrawer.jsx`, `AccountMenu.jsx`
- **Current implementation**: Build on `Modal` + `.input-surface` (boxed, `rounded-[7px]`, seal-red focus ring) + mono uppercase tracked labels (10.5px, 0.14em) — already a small "instrument" typographic move consistent with the spec's own instinct.
- **Accessibility concerns**: `aria-invalid`, `aria-describedby`, `role="alert"` on field errors — solid.
- **Violates Paper & Graphite**: `rounded-[7px]` inputs (ceiling 3px); focus ring in seal-red not forest; error text uses `--err`, which is **chromatically identical to `--accent`** today (see §0.5/token audit) — Paper & Graphite's "rust must never double as decoration" rule directly fixes this ambiguity once mapped correctly.
- **Difficulty**: Small per dialog (all route through shared classes). **Risk**: Low.

## 9. Auth pages (Landing, Login, Register)

- **Files**: `pages/Landing.jsx` (read in depth), `pages/Login.jsx`, `pages/Register.jsx`, `pages/Workspace.jsx` (thin wrapper)
- **Current implementation**: Landing is a full marketing page on the same token system — sticky blurred nav, numbered `01–04` workflow steps (a genuine sequence, legitimate use of numbering), a hand-built decorative `Mockup()` sketch of the real workspace, live `.cite-chip` demo.
- **Design debt**: `Mockup()` is a hardcoded visual approximation — when the real workspace is restyled, this mock silently drifts out of sync. Flag as a "remember to touch" item.
- **Violates Paper & Graphite**: Same token-swap story as everywhere else.
- **Scope gap in the spec itself**: **Paper & Graphite's 10 sections never mention Landing/Login/Register.** Explicit in/out decision required — see Implementation Plan §Open Decisions.
- **Difficulty**: Medium if included (300+ lines, many one-off decorative blocks), zero if excluded. **Risk**: Low either way; the *scope ambiguity itself* is the risk if left implicit.

## 10. Dark mode / theme mechanism

- **Files**: `hooks/useTheme.js`, `index.css` (`html.dark` block)
- **Current implementation**: `localStorage`-persisted toggle, system-preference fallback, `.dark` class on `<html>`, a full **hand-tuned parallel dark palette** (not an auto-invert — e.g. accent shifts `#B23A2E → #D86A53`), matching the spec's own "dark mode is not an inversion" principle in spirit already.
- **Violates Paper & Graphite**: Only token *values* need to change; the *mechanism* is already correct and needs no rework. Note: spec's own CSS pattern is attribute-based (`[data-theme]` + media query guards); this app is class-based (`html.dark`) — equivalent, migration should map new tokens onto the **existing** mechanism, not introduce a second theming system.
- **Difficulty**: Trivial (token values only). **Risk**: Low.

## 11. MindMap — canvas / theme config

- **Files**: `components/mindmap/MindElixirView.jsx:31-64`, `theme.test.js`
- **Current implementation**: `THEME.cssVar` maps every mind-elixir CSS var to app tokens — root = solid ink-filled block (`--root-bgcolor: var(--text-primary)`), branch/leaf nodes on `--bg-card`/transparent, `--selected: var(--accent)` (seal red). A 6-value hardcoded hex `PALETTE` for branch colors (`#5C6B7A #3E6B57 #B5821F #B23A2E #4A5A8A #8A7A66`) — not tokens.
- **Problems**: `PALETTE` won't respond to a future accent-set change without editing this file directly.
- **Accessibility concerns**: Root/selection contrast not verified against WCAG — worth a check pass, not a redesign.
- **Design debt**: None notable — deliberate, well-commented.
- **Violates Paper & Graphite**: No graphite dark-canvas register — root/branch/leaf all live on the same paper register the spec explicitly wants permanently dark. Root styling (filled ink box) is the *opposite* of the target title treatment (per the Signature Contract: Spectral roman, bronze rule, no border box, no italic — the original spec's "Fraunces italic" version of this rule is superseded). Selection uses the single seal-red accent for selection+hover+provenance — a structural violation of the "three roles, never overlapping" rule, by design, not by accident.
- **Difficulty**: Medium — var-map swap is trivial; a real graphite canvas register threading through `mindmap.css`/`index.css` is a genuine visual change.
- **Risk**: Medium — isolated to one file (low technical risk), but "root = ink block" → "root = plain title" changes the map's visual anchor; needs real visual QA against actual generated graphs (already called out in the master migration plan's own isolation step).

## 12. MindMap — node states (root/branch/leaf, hover, selected, focus)

- **Files**: `MindElixirView.jsx`, `mindmap.css:36-75`
- **Current implementation**: Depth signaled by font-size/weight only (16/14/13px). No documented hover CSS for nodes (library default, unstyled). Focus: real, keyboard-visible (`outline: 2px solid var(--accent)`).
- **Problems**: Hover state is entirely unstyled — no bronze-edge-on-hover exists anywhere.
- **Visual inconsistency**: Depth via typography only, flatter than the spec's three-register system (filled branch / hairline-only leaf).
- **Accessibility concerns**: Focus ring real and correct. Hover has no visible non-mouse equivalent.
- **Violates Paper & Graphite**: No branch fill/leaf-hairline split; no bronze hover edge (violation, not variant); selection ring is seal-red, not forest (conflates all three accent roles into one).
- **Difficulty**: Small–medium (CSS-only, but genuinely needs a second accent — today's system is architecturally single-accent by design, so this is a real semantic split, not a repaint).
- **Risk**: Medium — touches `--accent`, which every other component in the app also keys off; a naive global rename ripples into buttons/badges/tabs everywhere. Sequence with the Layout/UI-primitives token work, not in isolation.

## 13. MindMap — connector styling

- **Files**: `mindElixirAdapter.js:26-31`, `mindmap.css:31-34`
- **Current implementation**: Relation arrows use a dedicated, well-themed `--mm-relation` var (indigo, dark-mode aware, explicitly documented "NOT seal red"). **Structural tree connectors are entirely un-themed** — pure mind-elixir library-default gray, the one real unstyled-default gap in this whole subsystem.
- **Violates Paper & Graphite**: **Direct, uncontested match** to spec §06 ("connector color: default library gray — spec wants forest-tinted curves with depth-based line weight"). Cleanest, lowest-risk, highest-visible-impact single fix in the entire MindMap area.
- **Difficulty**: **Trivial** — same theming mechanism already proven by `--mm-relation`; adding `--mm-connector` is a same-shape change.
- **Risk**: Low.

## 14. Knowledge Inspector — panel layout

- **Files**: `components/mindmap/KnowledgeInspector.jsx`, `mindmap.css:76-88`
- **Current implementation**: Already a 5-row CSS Grid — nav / recent-pinned / **sticky node header** / one scrolling content region / **sticky AI-actions footer**. Real, deliberate sticky-metadata architecture, already reads like a fixed-header document reader, not a settings panel. Sections separated by hairline only (no card-per-section). Evidence/enrichment items are individually bordered `.evidence-frame` cards — appropriate at that grain (one citation = one distinct source), not a violation.
- **Accessibility concerns**: `aria-expanded`/`aria-controls` on collapsible toggles, `role="complementary" aria-label"` on the aside — good.
- **Design debt**: None — unusually well-annotated about *why* each layout decision was made.
- **Violates Paper & Graphite**: Panel background is `--bg-sidebar` (paper), not the spec's mandated permanent graphite register for "the Inspector's evidence rail." This is the one real structural gap; rhythm (sticky metadata, hairline sections) is otherwise already aligned or trivially close. No drop-cap on first paragraph yet (spec §07 wants one).
- **Difficulty**: Small for the register swap alone; medium if the drop-cap detail is added too (new CSS, no component change).
- **Risk**: Low — purely additive/token-level, the existing grid contract is untouched.

## 15. Knowledge Inspector — Evidence Drawer, loading, empty states

- **Files**: `components/mindmap/EvidenceDrawer.jsx`, `knowledgeParts.jsx`, `mindmap.css:140-160`
- **Current implementation**: Drawer slides in `translateX(16px)→0`, **180ms ease-out**, reduced-motion guarded — **verbatim match to spec §09's own motion table.** Shares `MetaChip`/`EnrichmentCard`/`EvidenceCard` with the Inspector (no duplicated logic). `role="dialog" aria-modal="false"`, Escape-to-close, focus-to-close-button — solid a11y. Evidence skeleton is a real token-derived shimmer (`color-mix(...--text-muted...)`), disabled under `prefers-reduced-motion`. Empty states: centered icon + one-line copy, no gray-box placeholder.
- **Violates Paper & Graphite**: Same register issue as the Inspector (paper, not graphite) — **motion needs zero change.**
- **Difficulty**: Trivial (background token only). **Risk**: Low.

## 16. MindMap — responsive & dark mode

- **Files**: `mindmap.css:127-133`
- **Current implementation**: `.mm-legend` hides color swatches under 640px, keeps the drag hint (deliberate, documented). Dark mode: `--mm-relation` gets its own explicit dark value, not a filter-invert — genuine strength.
- **Violates Paper & Graphite**: None — preserve as-is.
- **Note**: Inspector's own narrow-width collapse behavior (drawer vs fixed sidebar) is governed by `WorkspaceContainer.jsx`/`panelLayout.js`, not resolved in this pass — verify during implementation, not assumed.

## 17. Summary Panel

- **Files**: `components/Layout/SummaryPane.jsx`
- **Current implementation**: Fully token-driven, `.surface-card`/`.font-reading`/`.cite-chip`/`.pill-tab`, sticky header, `max-w-[840px]` reading column.
- **Visual inconsistency**: Section cards use `.surface-card` — the same primitive as StudyMap info cards, DocumentList stat tiles, every "card" in the app. Good internal consistency, but means every card currently shares one visual weight — exactly what the spec's "cards shouldn't share background" rule wants to break up.
- **Violates Paper & Graphite**: All cards share `--bg-card` (no paper/graphite register split yet); radius 7-8px vs 3px ceiling.
- **Difficulty**: Small. **Risk**: Low.

## 18. Document List — cards, filters, empty states

- **Files**: `pages/study/DocumentList.jsx`
- **Current implementation**: `.surface-card` cards; real skeleton loaders (`bg-surface-elevated animate-pulse`); a filter popover using bare `shadow-lg` (Tailwind literal) **and a broken `var(--border)` reference** (line 482, see token audit); sort `<select>` also references the same broken var (line 468).
- **Problems**: Two real bugs (invalid CSS custom property, not cosmetic) — see `DESIGN_TOKEN_AUDIT.md`.
- **Visual inconsistency**: This popover is the only floating panel in the file using bare `shadow-lg`; everything else uses `.surface-card`'s token shadow — two elevation systems for "a thing that floats."
- **Accessibility concerns**: Outside-click-to-close pattern present; Escape/focus-trap on this specific popover not verified (same gap repeats in BulkBar/StudyCard's identical pattern — one shared fix, not three).
- **Design debt**: The same broken popover markup (`shadow-lg` + `var(--border)`) is duplicated verbatim in DocumentList, StudyCard, and BulkBar.
- **Violates Paper & Graphite**: `shadow-lg` is exactly the "huge shadow" utility the spec's NO list names.
- **Difficulty**: Medium (real fix is one shared `<Popover>` primitive, not three token swaps, since the pattern triplicates). **Risk**: Low visual risk; medium regression risk if popover keyboard/outside-click behavior isn't preserved exactly during extraction.

## 19. StudyMap View — graph nodes, connectors, toolbar

- **Files**: `pages/study/StudyMapView.jsx`
- **Current implementation**: `react-d3-tree` hand-rolled SVG renderer. Four depth "marks" (root/section/concept/example) with radius/stroke/text-size all shrinking with depth (`MARK` const) — a genuinely good depth-hierarchy implementation already, in spirit. **Root/section fill and stroke, and selection fill/stroke, reference `var(--brand)` — undeclared, a real rendering bug**, not a style choice (see token audit). Connector: `.study-map__link { stroke: var(--border-strong) }` — plain neutral gray line, no depth-based weight.
- **Accessibility concerns**: Node selection is click-only (SVG `<g onClick>`), no visible keyboard path to select a node other than via search-result jump. Zoom/layout/export button focus states rely on default browser outline, not verified against the spec's focus-ring rule.
- **Design debt**: `MARK` mixes visual constants and text metrics in one object — reasonable, and actually a **positive** for migration (single point of change for depth-hierarchy restyle).
- **Violates Paper & Graphite**: Connector has no forest tint or depth-weight; selection is a stroke color/width swap, not the spec's 3px/22%-opacity ring (close in spirit, different execution); node fill for concept/example uses paper tones with no graphite register consideration (StudyMap's own register — paper vs graphite — is an open decision, spec doesn't name it explicitly).
- **Difficulty**: Medium — this is hand-rolled JS render logic (`renderNode`/`markOf`), not CSS, so restyling means editing render functions directly — more invasive than a token swap, but still purely visual if scoped carefully.
- **Risk**: **Medium-high relative to the rest of the app** — styling lives inside the same functions as real interaction logic (`onPick`, `toggleNode`, search/focus state). Isolate for its own visual QA pass, same caution already given to Mind Elixir in the master migration plan.

## 20. Quiz flow (Setup/Taking/Result), Review Guide

- **Files**: `pages/study/QuizSetup.jsx`, `QuizTaking.jsx`, `QuizResult.jsx`, `ReviewGuide.jsx`
- **Current implementation**: Fully token-correct — zero phantom vars found. `.pill-tab`/`.answer-option`/`.progress-track`/`.badge-*` reused consistently. Answer states (`selected/correct/wrong`) change border + background + inset shadow together — color AND shape both change, a genuinely good a11y pattern.
- **Accessibility concerns**: `aria-live="polite"` on save-status/answered-count, `aria-label`/`aria-current` on progress buttons — some of the most accessibility-conscious code in the app.
- **Violates Paper & Graphite**: Only the app-wide generic ones (radius, shared card background). Nothing quiz-specific.
- **Difficulty**: Trivial–small (pure token/radius pass, no bugs to fix first). **Risk**: Low.

## 21. Study Shell, Breadcrumb, status primitives

- **Files**: `components/study/StudyShell.jsx`, `StudyBreadcrumb.jsx`
- **Current implementation**: Sticky header with back-link, mono eyebrow, breadcrumb below — already an editorial header pattern. `EmptyState`/`StatusTag` are shared primitives; status is always word + color, never color alone.
- **Violates Paper & Graphite**: Only the generic radius/card-background items. Most consistent file in the codebase, by its own documented intent ("same palette as the reading room — a different room in the same building").
- **Difficulty**: Trivial. **Risk**: Low.

## 22. Study Card, Knowledge Panel, Bulk Bar, Collection Sidebar, Learning Dashboard, AI Insight Card, Tutor Panel

- **Files**: `components/study/StudyCard.jsx`, `KnowledgePanel.jsx`, `BulkBar.jsx`, `CollectionSidebar.jsx`, `LearningDashboard.jsx`, `AiInsightCard.jsx`, `TutorPanel.jsx`
- **Current implementation**: Shared vocabulary (`.surface-card`, `.pill-action`, `.icon-btn`, mono uppercase-tracked labels). `StudyCard` has a deliberate, documented visual hierarchy (display name > filename > AI overview as the largest block > preview > chips > metadata > actions) — genuinely good information design, keep the hierarchy, restyle only.
- **Problems**: This is where **all** of the phantom-token bugs concentrate — 21 of 21 `var(--border)` sites, both `var(--ok-bg)` duplicates, the one `var(--surface-elevated)` site. See token audit; not repeated per-file here.
- **Visual inconsistency**: `LearningDashboard.jsx` embeds a raw `<style>` tag inline (lines 155-160) — the only component defining CSS outside `index.css`; a future global find/replace won't see it.
- **Accessibility concerns**: `StudyCard`'s roving-tabindex is deliberate and correct (positive). `KnowledgePanel`'s mastery pills are color-coded with no visible label beyond a hover `title` — closer to color-only than the app's own `StatusTag` pattern elsewhere; worth a second look.
- **Design debt**: `MAU_MASTERY`/`MAU_CHIP` duplicated verbatim in two files (KnowledgePanel, StudyCard) — same shape, same dead `--ok-bg` fallback.
- **Violates Paper & Graphite**: `CollectionSidebar`'s collection-color dots are **user-chosen data**, not decoration — should stay literal/customizable, explicitly **not** forced onto the 6-token palette (flag as a product decision, not a design fix).
- **Difficulty**: Small–medium in aggregate (many files, each individually trivial) — best done as one sweep across all seven files together, not per-file, since the token bug is shared.
- **Risk**: Low, once the phantom-var fix is visually verified (screenshot before/after on one card, one dashboard state) rather than trusted blind.

## 23. Icon system, Markdown rendering, Command Palette, Advanced Search, Avatar/Badge/Disclosure/ErrorBoundary

- **Files**: `components/ui/Icon.jsx`, `Markdown.jsx`, `Avatar.jsx`, `Badge.jsx`, `Disclosure.jsx`, `ErrorBoundary.jsx`, `components/palette/CommandPalette.jsx`, `AdvancedSearchPanel.jsx`
- **Current implementation**: `Icon.jsx` — explicit named-import registry over `lucide-react` (avoids bundling ~600 icons), one shared stroke width/size, deliberate and already superior to an "emoji as icon" anti-pattern the code itself references. `Avatar`/`Badge`/`Disclosure` are already token-driven, close to spec in spirit (Badge is already "mono instrument, not label" — matches §05 almost exactly; radius 4px, 1px over the 3px ceiling). `Markdown.jsx` has its **own independent, third type scale** (19/17/15px h1-h3) matching nothing else in the app. `CommandPalette` group headers already match the "mono + tracking" label convention almost verbatim; its one active-row highlight is hand-rolled inline style duplicating what `.pill-action`/`.badge-*` already do as classes. `AdvancedSearchPanel`'s `Chip`/`Disabled` are hand-rolled inline-style components duplicating the same badge/pill logic a third way — **the clearest case of one visual pattern implemented three different ways in three different files.**
- **Accessibility concerns**: `CommandPalette` — full keyboard nav, correct `role="combobox"/"listbox"/"option"`, `aria-activedescendant` — solid. `AvatarPicker` (real `<button>`, chosen deliberately over `<div onClick>`) — exemplary. `ErrorBoundary` fallback uses `.surface-card` + `--err` (== `--accent`) — this is the one screen users see when everything else has failed; must render correctly through every migration phase, verify after each phase, not just once.
- **Design debt**: Chip/badge/pill triplication (Badge class / `.pill-action` / `AdvancedSearchPanel`'s inline `Chip`) should consolidate into one family once the palette moves — opportunistic, not blocking.
- **Violates Paper & Graphite**: Markdown's independent type scale (fix as part of the type-scale rollout, not separately); no drop-cap on Markdown's long-form prose mode (spec §07 wants one, this is exactly where it'd go); radius 1-8px over ceiling app-wide in this group; `CommandPalette` row radius `rounded-[8px]` should shrink to ≤3px since a palette row *is* interactive (unlike static panels, which go to 0).
- **Difficulty**: Trivial–small across this whole group. **Risk**: Low, except ErrorBoundary (medium — verify every phase).

---

## Cross-cutting findings (apply across every area above)

1. **Single-accent architecture is the real color blocker**, not "too much gray." Every consumer of `--accent` (buttons, links, focus rings, selection, active tabs, MindMap/StudyMap node selection, AND error) needs an explicit per-consumer decision — forest, bronze, or (for error only) rust. This can't land as a token *rename*; it's a role audit, file by file. Sequence it as one deliberate pass, not scattered across every other task.
2. **No shared type scale exists anywhere** — 495+ arbitrary `text-[Npx]` instances, 23+ distinct sizes, three independent "scales" found (main app, Markdown, and ad hoc per-component). This is the highest-count, highest-leverage fix in the whole redesign — see `DESIGN_TOKEN_AUDIT.md`.
3. **Phantom/undeclared CSS variables are a real, pre-existing bug**, unrelated to Paper & Graphite: `var(--border)`, `var(--brand)`, `var(--surface-elevated)`, `var(--ok-bg)`, `var(--font-display)` — 25+ call sites, 7+ files, including the StudyMap graph's root/section/selection node color. **Must be fixed as its own correctness step**, verified visually per site (some may currently "look right by accident" via inherited defaults), before or during — never silently absorbed into — the token rename.
4. **Framer Motion is not in the stack.** All real motion is CSS. Several existing durations already comply with the spec's own motion table exactly (EvidenceDrawer's 180ms translate, WorkspaceTabs' plain color change); the one clear outlier is Modal's `fadeUp` at 450ms/12px translate.
5. **Accessibility is a strength across most of this app**, not a debt item — Modal, PanelDivider/Spine, form dialogs, CommandPalette, AvatarPicker, and the Quiz flow are all better than typical shadcn defaults. The redesign must not regress this while retinting: any removed box-shadow-based focus indicator needs an explicit forest/bronze focus-ring replacement, never just deleted.
6. **Radius is disciplined but not compliant** — never Tailwind defaults, always arbitrary 4–10px values, universally above the spec's 3px ceiling on interactive controls, and used on panels/cards where the spec wants square containers instead.
7. **Shadows are mostly legitimate** — only ~6-7 real `shadow-lg` literal usages exist app-wide, and each is a genuine floating popover/menu (not decorative card elevation). The bigger shadow issue is `.surface-card`'s soft token-shadow applied to nearly every card in the app, which the spec's "not everything is a card" rule wants reduced, not the literal-class usages.
8. **No permanent graphite register exists as a concept.** Needs one explicit decision (which surfaces are always-dark regardless of theme: MindMap canvas, Inspector + Evidence Drawer, nav frame/splitter/spine are the clear candidates from this audit; StudyMap and Study pages are less clear-cut and need a call in Phase 3).
9. **Landing/Login/Register sit entirely outside the Paper & Graphite spec's stated scope** — needs an explicit in/out decision, not a silent default.
10. **StudyMapView is the one file, alongside MindElixirView, where styling logic and interaction logic live in the same functions** — both need isolated visual QA passes, not a blind global find/replace.
