# Visual Baseline — Code-Informed Pre-Redesign Reference

Documentation only. No code modified. No commits made. This is the reference
every Paper & Graphite migration PR (see `UI_IMPLEMENTATION_PLAN.md`) should
be diffed against — capture this snapshot's judgment calls now, before
anything moves, so "did this PR actually change what it says it changed" has
a real answer later.

**Naming correction (post-Codex review)**: this is a **code-informed**
baseline, not a visual one in the strict sense — no screenshot exists yet,
so every score below is a reasoned estimate from reading component code
(structure, classes, tokens, ARIA attributes), not a measurement of a
rendered pixel. The scores are still useful (they're grounded in the same
evidence `UI_AUDIT_V2.md`/`DESIGN_TOKEN_AUDIT.md` cite, file:line, not
guessed), but they carry a **confidence level**, not measurement precision —
treat a "72" here as "moderate-to-good, on this evidence" not as "72% of
some measured maximum." Per-screen confidence is stated explicitly in each
section (High / Medium / Low), and the two prior audit docs remain the
primary source — this document's job is to organize their findings **by
screen** and add the scoring/ranking/heatmap views those two didn't produce,
not to introduce new claims of its own.

## Screenshot capture — honesty note

This environment has no browser/screenshot tool (no Playwright/Puppeteer/
Chromatic access). **No screenshots were captured for this baseline.**
Every "Current screenshots" field below names the expected capture location
instead — the convention to use when a real capture pass happens (manually,
or via whatever visual-regression tool the team adopts):

```
docs/screenshots/baseline/<screen-slug>--light.png
docs/screenshots/baseline/<screen-slug>--dark.png
docs/screenshots/baseline/<screen-slug>--mobile.png
```

**Re-score after a real screenshot pass exists** if these numbers are going
to gate a release — code-derived confidence is a starting point for
prioritization, not a substitute for looking at the rendered screen.

## Scope — the 15 screens audited

Grouped to match how a user actually encounters them, not file layout:
Landing, Login/Register, Workspace Shell, MindMap Canvas, Knowledge Inspector
+ Evidence Drawer, Summary Panel, Document List, StudyMap View, Quiz Setup,
Quiz Taking, Quiz Result, Review Guide, Study Home (Dashboard/Shell), Command
Palette + Advanced Search, Dialogs & Account.

This reuses and re-scores the file-level findings already recorded in
`UI_AUDIT_V2.md` and `DESIGN_TOKEN_AUDIT.md` — this document organizes them
**per screen** (what a user sees in one place) rather than per component, and
adds the scoring/ranking/heatmap views those two didn't produce.

## Confidence per screen

How thoroughly each screen was independently re-verified this pass, not how
good it is — read this alongside every score table below:

| Confidence | Screens | Basis |
|---|---|---|
| **High** | Workspace Shell, MindMap Canvas, Knowledge Inspector + Evidence Drawer, StudyMap View, Quiz Taking, Document List, Study Home/Dashboard, Command Palette + Advanced Search, Dialogs & Account | Every prior fork read these files in full, file:line evidence exists for nearly every claim |
| **Medium** | Landing, Login/Register, Summary Panel, Quiz Setup, Quiz Result | Read in depth once, or spot-checked via targeted grep with no contradicting evidence found — plausible, largely but not exhaustively re-verified |
| **Low** | Review Guide | Grep spot-check only, never read in full — score in that section is explicitly flagged and should not be trusted for a release gate without a real pass first |

---

## Scoring key

8 dimensions, 0–100 each, reasoned from the code-level evidence in the two
prior audit docs (not pixel-measured). **Density** is scored as "how well
interaction density matches this screen's purpose" (a dense instrument
screen scores well when its density is *earned*, not when it has less on
it). Higher is better on every axis.

---

## 1. Landing

- **Current screenshots**: `docs/screenshots/baseline/landing--{light,dark,mobile}.png` (not captured)
- **Visual hierarchy**: Deliberate — hero, numbered `01–04` workflow (a real sequence, legitimate numbering), live `.cite-chip` demo, hand-built `Mockup()` sketch of the real workspace.
- **Spacing rhythm**: Marketing-page generous, consistent with the rest of the app's token-driven spacing; no arbitrary-value spike found here specifically.
- **Typography hierarchy**: Uses the app's `display`/`reading` Spectral roles — readable, but shares the app-wide problem of no formal type scale (see Token Audit §1).
- **Interaction density**: Low, appropriately — this is a marketing page, not a tool.
- **Component inventory**: Sticky blurred nav, hero, `WORKFLOW` numbered steps, `Mockup()` (custom, one-off), `ChatBubble` mock, `.cite-chip` live demo, CTA buttons.
- **Color usage**: Full token set (paper/ink/seal-red), no gray, no gradient.
- **Border usage**: Hairlines on nav and mockup panels, consistent with rest of app.
- **Shadow usage**: `.surface-card`-family soft shadow on the mockup panel only.
- **Radius usage**: 6–10px arbitrary values, same app-wide pattern.
- **Motion usage**: Scroll/entrance effects not fully audited in this pass — flag for a closer look if Landing is scoped into the redesign (see Open Decision #2 in the implementation plan).
- **Loading state**: N/A (static page).
- **Empty state**: N/A.
- **Accessibility observations**: Not deeply audited (out of the original spec's stated scope) — no findings recorded either way; treat as unverified, not "clean."
- **Design debt note**: `Mockup()` is a hand-maintained visual approximation of the real workspace — will silently drift once the real workspace is restyled.

| Typography | Hierarchy | Consistency | Density | Accessibility | Readability | Navigation | Visual Balance |
|---|---|---|---|---|---|---|---|
| 58 | 74 | 68 | 70 | 55* | 76 | 72 | 74 |

*unverified, not confirmed poor.

---

## 2. Login / Register

- **Current screenshots**: `docs/screenshots/baseline/auth-login-register--{light,dark,mobile}.png` (not captured)
- **Visual hierarchy**: Simple, expected form hierarchy (title → fields → primary action → secondary link).
- **Spacing rhythm**: Standard form rhythm, token-driven.
- **Typography hierarchy**: Shares the app-wide no-scale issue; low complexity limits its visible impact here.
- **Interaction density**: Low — a form, correctly so.
- **Component inventory**: `.input-surface` fields, primary `.btn-seal` button, secondary link, error text.
- **Color usage**: Seal-red for primary action and focus ring, `--err` for validation (same hex as accent — see Token Audit §7 caveat, though not independently re-verified on this exact screen this pass).
- **Border usage**: Boxed inputs (`rounded-[7px]`), consistent with dialog inputs elsewhere.
- **Shadow usage**: Minimal.
- **Radius usage**: 6–7px, app-wide pattern.
- **Motion usage**: Not deeply audited this pass.
- **Loading state**: Submit-button spinner pattern presumed (consistent with the rest of the app's `Spinner` usage) — not independently re-verified this pass.
- **Empty state**: N/A (form, not a list).
- **Accessibility observations**: Not deeply audited this pass; the app's dialog-form pattern elsewhere (`aria-invalid`, `aria-describedby`, `role="alert"`) is strong, and Login/Register likely share that pattern via the same `.input-surface` primitive — plausible, not confirmed.
- **Design debt note**: None found; low complexity, low risk screen.

| Typography | Hierarchy | Consistency | Density | Accessibility | Readability | Navigation | Visual Balance |
|---|---|---|---|---|---|---|---|
| 58 | 78 | 72 | 80 | 65* | 76 | 78 | 76 |

*plausible-but-unverified, scored conservatively.

---

## 3. Workspace Shell (header, sidebars, chat, splitter, tabs)

- **Current screenshots**: `docs/screenshots/baseline/workspace-shell--{light,dark,mobile}.png` (not captured)
- **Visual hierarchy**: Header (wordmark, breadcrumb/eyebrow, actions) → left source library → center working pane (tabbed Chat/MindMap/Summary) → right Inspector, separated by real, keyboard-operable splitters. Clear structural hierarchy.
- **Spacing rhythm**: Token-driven throughout; the one deviation is Sidebar Left's cards carrying a full 4-side border (heavier visual weight than the rest of the shell's hairline-based separation).
- **Typography hierarchy**: Header wordmark (serif) vs. body UI (sans) vs. mono eyebrow/breadcrumb — already a real 3-role split, undermined by the same missing formal scale as everywhere else.
- **Interaction density**: High and appropriate — this is the app's primary instrument screen (source management, panel resize, tab switch, search).
- **Component inventory**: `MainLayout` header, `.pill-action` buttons, theme toggle, `AccountMenu`, `SidebarLeft` (source cards, filters, progress bars, badges), `WorkspaceTabs`, `PanelDivider` ×2, `PanelSpine` (collapsed state), `ChatArea`.
- **Color usage**: Single seal-red accent for everything (primary, links, focus, selection, active tab) — the app-wide single-accent finding is most visible here because so many of its consumers live on one screen at once.
- **Border usage**: Mixed — hairline splitters, but full 4-side bordered sidebar cards.
- **Shadow usage**: One literal `shadow-lg` (ChatArea.jsx:653, a dropdown menu) — otherwise token-driven.
- **Radius usage**: 6–10px, consistent with app-wide pattern.
- **Motion usage**: Splitter drag is instant/native; tab switch is a plain color/border change (already inside the eventual motion budget); theme toggle likely instant.
- **Loading state**: Sidebar source list uses `Spinner` + "Đang tải…" text; no skeleton loader here (contrast with Document List, which has one).
- **Empty state**: Not independently re-verified this pass for an empty source library specifically.
- **Accessibility observations**: **Genuine strength.** `PanelDivider`/`PanelSpine` have full keyboard support (arrow-key resize, Home/End, Enter reset, correct `role="separator"`/`aria-*`) — some of the best-crafted, most accessible code in the app. Header actions carry `aria-label`s; theme toggle has `aria-pressed`.
- **Design debt note**: `shadow-glow` class referenced on Sidebar Left selection state not confirmed defined — verify before or during migration.

| Typography | Hierarchy | Consistency | Density | Accessibility | Readability | Navigation | Visual Balance |
|---|---|---|---|---|---|---|---|
| 55 | 78 | 62 | 82 | 88 | 68 | 84 | 64 |

---

## 4. MindMap Canvas

- **Current screenshots**: `docs/screenshots/baseline/mindmap-canvas--{light,dark,mobile}.png` (not captured)
- **Visual hierarchy**: Depth signaled by font-size/weight only (root 16px → leaf 13px); no fill/border differentiation between branch and leaf — flatter than the structural hierarchy elsewhere in the app.
- **Spacing rhythm**: Governed by mind-elixir's own layout engine, not this app's spacing tokens — out of scope to change (interaction/architecture), in scope only to observe.
- **Typography hierarchy**: Root uses a serif treatment inside a solid ink-filled box (not a typographic title) — the one place typography is subordinated to a shape treatment rather than expressed directly.
- **Interaction density**: High and core to the product's purpose — drag, zoom, expand/collapse, select.
- **Component inventory**: `MindElixirView` canvas, `THEME.cssVar` map, 6-value `PALETTE` array for branch color, relation-arrow renderer, legend (responsive, hides swatches under 640px).
- **Color usage**: Root = solid ink block; branches from a 6-hex hardcoded palette; selection = single seal-red ring, the same color used for hover/provenance/error elsewhere — the app's single-accent conflation is architecturally most consequential here.
- **Border usage**: Branch/leaf nodes have no distinct border treatment from each other.
- **Shadow usage**: None found.
- **Radius usage**: Governed by mind-elixir defaults.
- **Motion usage**: Expand/collapse timing matches the library's own budget; no app-level override found (correctly left alone — do not fight the library, per the redesign spec's own guidance).
- **Loading state**: A real "generating…" banner with `Spinner` + progress % exists, token-styled, no hardcoded colors.
- **Empty state**: Not applicable in the traditional sense (a map always has at least a root).
- **Accessibility observations**: Focus ring is real and keyboard-visible (`outline: 2px solid var(--accent)`). **Hover has no visible non-mouse equivalent** — a real gap. Node depth communicated by size/weight alone, which is a legitimate technique but has no secondary (shape/fill) reinforcement.
- **Design debt note**: Structural tree connectors are the one clearly unstyled library default in this whole screen (relation arrows ARE themed) — see `UI_AUDIT_V2.md` §13.

| Typography | Hierarchy | Consistency | Density | Accessibility | Readability | Navigation | Visual Balance |
|---|---|---|---|---|---|---|---|
| 52 | 64 | 48 | 84 | 66 | 60 | 74 | 58 |

---

## 5. Knowledge Inspector + Evidence Drawer

- **Current screenshots**: `docs/screenshots/baseline/knowledge-inspector--{light,dark,mobile}.png` (not captured)
- **Visual hierarchy**: Genuinely strong — a real 5-row grid (nav / recent-pinned / **sticky node header** / one scrolling region / **sticky AI-actions footer**), already reads as a document reader, not a settings panel.
- **Spacing rhythm**: Hairline-only separation between sections (no card-per-section) — already matches the redesign's own "whitespace over borders" instinct.
- **Typography hierarchy**: Node title (serif) vs. section labels (mono uppercase, tracked) vs. body (sans) — a real, deliberate 3-role split already in place.
- **Interaction density**: Medium-high — collapsible sections, evidence expansion, pin/recent actions, AI-action footer.
- **Component inventory**: `KnowledgeInspector` grid, `CollapsibleSection` (`knowledgeParts.jsx`), `MetaChip`/`EnrichmentCard`/`EvidenceCard`, `EvidenceDrawer` (shares the same card primitives — no duplicated logic).
- **Color usage**: Same paper register as the rest of the app; the redesign wants this permanently graphite instead — currently indistinguishable in tone from a plain content panel.
- **Border usage**: Hairline section dividers; individually-bordered `.evidence-frame` cards at the citation grain (appropriate — one citation is one distinct source).
- **Shadow usage**: Minimal, confined to the frame cards.
- **Radius usage**: `.evidence-frame` ≈ 7px, consistent with app-wide pattern.
- **Motion usage**: Evidence Drawer slide-in is **180ms, ease-out, translateX-only, reduced-motion guarded** — an exact match to the redesign spec's own motion ceiling, needing zero change.
- **Loading state**: Real, token-derived shimmer skeleton for evidence items (`color-mix` based, not a flat gray block), disabled under `prefers-reduced-motion`.
- **Empty state**: Centered icon + one-line Vietnamese copy ("Chọn một nhánh trên sơ đồ để xem chi tiết") — minimal, on-voice, no gray-box placeholder.
- **Accessibility observations**: **Strong.** `aria-expanded`/`aria-controls` on collapsible toggles, `role="complementary" aria-label"` on the panel, `role="dialog" aria-modal="false"` + Escape + focus-restore on the Drawer.
- **Design debt note**: No drop-cap on the opening paragraph of a long excerpt yet (the one editorial flourish the redesign spec asks for here that isn't already present).

| Typography | Hierarchy | Consistency | Density | Accessibility | Readability | Navigation | Visual Balance |
|---|---|---|---|---|---|---|---|
| 68 | 84 | 76 | 78 | 86 | 78 | 80 | 66 |

---

## 6. Summary Panel

- **Current screenshots**: `docs/screenshots/baseline/summary-panel--{light,dark,mobile}.png` (not captured)
- **Visual hierarchy**: Sticky header, `max-w-[840px]` reading column, section cards in document order — a real reading-first layout.
- **Spacing rhythm**: Token-driven, consistent with Inspector's rhythm.
- **Typography hierarchy**: `.font-reading` (Spectral) for prose; shares the Markdown component's own independent third type scale where prose is rendered via `Markdown.jsx` — a real inconsistency (see Token Audit §1).
- **Interaction density**: Low-medium — mostly a reading surface with citation chips as the main interactive element.
- **Component inventory**: `SummaryPane`, `.surface-card` section blocks, `.cite-chip`, `.pill-tab`, `CHIP_CAP` (citation chip overflow cap, magic number = 6, unexplained).
- **Color usage**: Same shared paper `--bg-card` register as every other card in the app — no register differentiation.
- **Border usage**: `.surface-card`'s default hairline/border.
- **Shadow usage**: `.surface-card`'s soft default shadow — the "everything is a card" pattern the redesign wants to break up is most visible here, since Summary is *conceptually* a document, not a dashboard of cards.
- **Radius usage**: 7-8px, app-wide pattern.
- **Motion usage**: Not independently re-verified this pass; no red flags found.
- **Loading state**: Not independently re-verified this pass.
- **Empty state**: Not independently re-verified this pass.
- **Accessibility observations**: No findings recorded either way this pass — treat as unverified.
- **Design debt note**: `CHIP_CAP = 6` magic number with no comment explaining the choice.

| Typography | Hierarchy | Consistency | Density | Accessibility | Readability | Navigation | Visual Balance |
|---|---|---|---|---|---|---|---|
| 54 | 70 | 66 | 74 | 65* | 78 | 70 | 58 |

*unverified.

---

## 7. Document List

- **Current screenshots**: `docs/screenshots/baseline/document-list--{light,dark,mobile}.png` (not captured)
- **Visual hierarchy**: Stat-tile overview → filter/sort controls → card grid — a conventional, legible list-page hierarchy.
- **Spacing rhythm**: Token-driven `.surface-card` grid, consistent.
- **Typography hierarchy**: Shares the app-wide no-scale issue.
- **Interaction density**: Medium-high — filter, sort, select, bulk actions, per-card actions.
- **Component inventory**: Stat tiles, filter dropdown (popover), sort `<select>`, document cards, checkboxes, skeleton loaders, empty-state component.
- **Color usage**: Token-driven, but the filter popover and sort `<select>` both reference **`var(--border)`, an undeclared CSS custom property** — a real rendering bug, not a style choice (see Token Audit §7).
- **Border usage**: Same broken-var issue on the popover/select borders specifically.
- **Shadow usage**: The filter popover uses a bare literal `shadow-lg` — the one place in this screen that bypasses the app's own `--shadow-card` token, and one of only 6 such literal instances app-wide.
- **Radius usage**: 8px cards, app-wide pattern.
- **Motion usage**: Not independently re-verified this pass.
- **Loading state**: **Real skeleton loaders** (`bg-surface-elevated animate-pulse`) — one of the few screens with a proper skeleton, not just a spinner.
- **Empty state**: Well-factored into a shared util (`trangThaiRong`) — no debt found.
- **Accessibility observations**: Outside-click-to-close exists on the filter popover; Escape/focus-trap behavior not independently verified (the *same* gap repeats identically in BulkBar and StudyCard's copy of this same popover pattern — one shared root cause, not three).
- **Design debt note**: The filter-popover markup (broken border var + bare `shadow-lg`) is duplicated verbatim in DocumentList, StudyCard, and BulkBar — three copies of the same bug.

| Typography | Hierarchy | Consistency | Density | Accessibility | Readability | Navigation | Visual Balance |
|---|---|---|---|---|---|---|---|
| 56 | 76 | 52 | 80 | 68 | 72 | 76 | 66 |

---

## 8. StudyMap View

- **Current screenshots**: `docs/screenshots/baseline/studymap-view--{light,dark,mobile}.png` (not captured)
- **Visual hierarchy**: Genuinely well-designed depth encoding — four node "marks" (root/section/concept/example) with radius, stroke weight, and text size all shrinking together with depth, in one shared `MARK` constant.
- **Spacing rhythm**: Governed by the `react-d3-tree` layout engine, node spacing tuned per the same `MARK`/layout logic.
- **Typography hierarchy**: Node label font references `var(--font-display)` — **an undeclared variable**, currently masked by a working CSS fallback to Spectral (harmless in effect, but a fourth instance of the phantom-token pattern).
- **Interaction density**: High — zoom, pan, search, layout switch, node select, collapse/expand, PNG/SVG export, presentation mode.
- **Component inventory**: SVG tree renderer, zoom/pan controls, layout switcher, search box, export buttons, presentation-mode toggle.
- **Color usage**: **Root/section node fill+stroke and the selection ring both reference `var(--brand)` — an undeclared CSS custom property.** This is the single highest-visibility instance of the app-wide phantom-var bug: the primary data visualization's most important nodes may be rendering with an unintended fallback color today, not a deliberate style.
- **Border usage**: Connector lines use `var(--border-strong)` — a plain neutral line, no depth-based weight (contrast with the node marks themselves, which DO encode depth).
- **Shadow usage**: None found on nodes; the app's `shadow-lg` literal appears elsewhere in this same file's UI chrome (grep-confirmed, not node-specific).
- **Radius usage**: Node circle radius shrinks with depth — an intentional, on-brief technique, distinct from the app-wide "arbitrary Tailwind radius" issue (this is SVG geometry, not a CSS class).
- **Motion usage**: Zoom/pan transitions not independently re-verified for duration/easing this pass.
- **Loading state**: Not independently re-verified this pass.
- **Empty state**: Not independently re-verified this pass.
- **Accessibility observations**: **Node selection is click-only** (SVG `<g onClick>`) — no visible keyboard path to select a node other than via the search-result jump behavior. Zoom/layout/export button focus states rely on default browser outline, not verified against a deliberate focus-ring treatment.
- **Design debt note**: Styling constants (`MARK`) and real interaction logic (`onPick`, `toggleNode`, search/focus state) live in the same render functions — any visual change here carries more behavioral risk than a CSS-only file (flagged as this screen's own isolated risk item in the implementation plan).

| Typography | Hierarchy | Consistency | Density | Accessibility | Readability | Navigation | Visual Balance |
|---|---|---|---|---|---|---|---|
| 50 | 82 | 44 | 78 | 58 | 66 | 74 | 68 |

---

## 9. Quiz Setup

- **Current screenshots**: `docs/screenshots/baseline/quiz-setup--{light,dark,mobile}.png` (not captured)
- **Visual hierarchy**: Clear form-to-action flow (source/scope selection → question-type/count controls → start action).
- **Spacing rhythm**: Token-driven, consistent with the rest of the Study section.
- **Typography hierarchy**: Shares the app-wide no-scale issue; low visual complexity limits impact.
- **Interaction density**: Medium — selection controls, count/type pickers, one primary action.
- **Component inventory**: `.pill-tab` selectors, form controls, primary action button.
- **Color usage**: Fully token-correct — **zero phantom-var bugs found in this file** (grep-confirmed).
- **Border usage**: Standard hairline/box pattern, consistent with the rest of the app.
- **Shadow usage**: Minimal.
- **Radius usage**: App-wide 6-7px pattern.
- **Motion usage**: Not independently re-verified this pass; no red flags found.
- **Loading state**: Not independently re-verified this pass.
- **Empty state**: Not applicable (a setup form, not a list).
- **Accessibility observations**: Shares the Quiz flow's generally strong pattern (see Quiz Taking below) — not independently re-verified field-by-field on this exact screen.
- **Design debt note**: None found.

| Typography | Hierarchy | Consistency | Density | Accessibility | Readability | Navigation | Visual Balance |
|---|---|---|---|---|---|---|---|
| 58 | 76 | 80 | 78 | 78* | 74 | 78 | 72 |

*inferred from the Quiz flow's confirmed pattern, not re-verified on this exact file this pass.

---

## 10. Quiz Taking

- **Current screenshots**: `docs/screenshots/baseline/quiz-taking--{light,dark,mobile}.png` (not captured)
- **Visual hierarchy**: Question → answer options → sticky bottom action bar → progress strip — a distinct, purpose-built navigation pattern (the only sticky-bottom-bar layout found in the whole app).
- **Spacing rhythm**: Token-driven, consistent.
- **Typography hierarchy**: Shares the app-wide no-scale issue.
- **Interaction density**: High — answer selection, save-status, progress navigation, question-to-question flow.
- **Component inventory**: `.answer-option` (selected/correct/wrong states), `.progress-track`, `ProgressStrip` buttons, sticky action bar.
- **Color usage**: **Fully token-correct — zero phantom vars found.** Answer states change border + background + inset shadow together (color AND shape both shift) — a genuinely good accessible pattern, not color-only.
- **Border usage**: Consistent hairline/box pattern.
- **Shadow usage**: `box-shadow: inset` on answer-state feedback only — purposeful, not decorative.
- **Radius usage**: App-wide pattern.
- **Motion usage**: Not independently re-verified this pass.
- **Loading state**: Save-status uses `aria-live="polite"` — a live-region pattern, not a spinner-blocking one.
- **Empty state**: Not applicable.
- **Accessibility observations**: **One of the most accessibility-conscious screens in the app.** `aria-live="polite"` on save-status and answered-count, `aria-label`/`aria-current` on progress-strip buttons, color+shape dual-signal on answer states.
- **Design debt note**: None found.

| Typography | Hierarchy | Consistency | Density | Accessibility | Readability | Navigation | Visual Balance |
|---|---|---|---|---|---|---|---|
| 58 | 82 | 84 | 84 | 88 | 76 | 84 | 76 |

---

## 11. Quiz Result

- **Current screenshots**: `docs/screenshots/baseline/quiz-result--{light,dark,mobile}.png` (not captured)
- **Visual hierarchy**: Score summary → per-question breakdown — a conventional, legible results hierarchy.
- **Spacing rhythm**: Token-driven, consistent with Quiz Taking.
- **Typography hierarchy**: Shares the app-wide no-scale issue; score display is a strong candidate for the "numbers as visual anchors" treatment the redesign spec wants.
- **Interaction density**: Low-medium — mostly a read-only summary with a retry/continue action.
- **Component inventory**: Score summary block, per-question result rows, `StatusTag`-style correct/incorrect indicators.
- **Color usage**: **Zero phantom vars found** (grep-confirmed, shared file group with Quiz Taking).
- **Border usage**: Standard pattern.
- **Shadow usage**: Minimal.
- **Radius usage**: App-wide pattern.
- **Motion usage**: Not independently re-verified this pass.
- **Loading state**: Not applicable (result is computed, not polled, in this view).
- **Empty state**: Not applicable.
- **Accessibility observations**: Inherits the Quiz flow's generally strong pattern; not independently re-verified field-by-field.
- **Design debt note**: None found.

| Typography | Hierarchy | Consistency | Density | Accessibility | Readability | Navigation | Visual Balance |
|---|---|---|---|---|---|---|---|
| 58 | 78 | 80 | 76 | 78* | 78 | 74 | 74 |

*inferred, not independently re-verified this pass.

---

## 12. Review Guide

- **Current screenshots**: `docs/screenshots/baseline/review-guide--{light,dark,mobile}.png` (not captured)
- **Visual hierarchy**: Reading-first, similar rhythm to Summary Panel.
- **Spacing rhythm**: Token-driven, consistent.
- **Typography hierarchy**: Shares the app-wide no-scale issue.
- **Interaction density**: Low — primarily a reading surface.
- **Component inventory**: Not read in full this pass — spot-checked via grep only; **zero phantom vars found** in that check.
- **Color usage**: Token-correct per the spot-check.
- **Border usage**: Not independently re-verified.
- **Shadow usage**: Not independently re-verified.
- **Radius usage**: App-wide pattern presumed.
- **Motion usage**: Not independently re-verified.
- **Loading state**: Not independently re-verified.
- **Empty state**: Not independently re-verified.
- **Accessibility observations**: Not independently re-verified — no findings either way.
- **Design debt note**: None found in the spot-check; this screen was not read in full and deserves a proper pass before its own implementation task starts.

| Typography | Hierarchy | Consistency | Density | Accessibility | Readability | Navigation | Visual Balance |
|---|---|---|---|---|---|---|---|
| 56 | 68 | 72 | 74 | 60* | 74 | 70 | 66 |

*low-confidence estimate — this screen needs a full read before its score should be trusted for a release gate.

---

## 13. Study Home (Dashboard / Shell)

- **Current screenshots**: `docs/screenshots/baseline/study-home-dashboard--{light,dark,mobile}.png` (not captured)
- **Visual hierarchy**: Sticky header (back-link, mono eyebrow, `h1`, breadcrumb) → dashboard widgets (Learning Dashboard, Knowledge Panel, Study Cards, Collection Sidebar, Bulk Bar, Seal Meter, Tutor Panel, AI Insight cards) — the single most component-dense screen in the app.
- **Spacing rhythm**: Token-driven `.surface-card` grid throughout.
- **Typography hierarchy**: `StudyCard`'s hierarchy is genuinely well-documented and deliberate (display name > filename > AI overview as the largest block > preview > chips > metadata > actions) — one of the best-designed information hierarchies in the app, undermined only by the missing formal type scale.
- **Interaction density**: Very high — this screen aggregates almost every shared primitive in the app (badges, pills, progress meters, bulk actions, collection colors, mastery indicators).
- **Component inventory**: `StudyShell`, `StudyBreadcrumb`, `EmptyState`/`StatusTag`, `LearningDashboard`, `KnowledgePanel`, `StudyCard`, `SealMeter`, `BulkBar`, `CollectionSidebar`, `TutorPanel`, `AiInsightCard`.
- **Color usage**: **This is where nearly all of the app's phantom-var bugs concentrate** — all 21 `var(--border)` sites, both `var(--ok-bg)` fallback-only sites, the one `var(--surface-elevated)` site. `CollectionSidebar`'s collection-color dots are legitimate user-chosen data, not decoration — a deliberate exception, not a bug.
- **Border usage**: Same broken-var issue as above, concentrated in this screen's files.
- **Shadow usage**: `StudyCard.jsx:254`/`BulkBar.jsx:70,105` carry two more of the app's only 6 literal `shadow-lg` instances (the popover pattern, same root cause as Document List's).
- **Radius usage**: App-wide 6-8px pattern.
- **Motion usage**: Not independently re-verified this pass.
- **Loading state**: Not independently re-verified this pass.
- **Empty state**: `EmptyState`/`StatusTag` shared primitive — status is always word + color, never color alone; a genuinely good pattern used consistently here.
- **Accessibility observations**: `StudyCard`'s roving-tabindex is deliberate and correct — a positive. `KnowledgePanel`'s mastery pills are color-coded with **no visible label beyond a hover `title`** — closer to color-only signaling than the `StatusTag` pattern used elsewhere on this same screen, an internal inconsistency worth a second look.
- **Design debt note**: `LearningDashboard.jsx` embeds a raw `<style>` tag inline (lines 155-160) — the only component in the app defining CSS outside `index.css`, invisible to any global find/replace. `MAU_MASTERY`/`MAU_CHIP` constants duplicated verbatim across two files.

| Typography | Hierarchy | Consistency | Density | Accessibility | Readability | Navigation | Visual Balance |
|---|---|---|---|---|---|---|---|
| 54 | 80 | 46 | 74 | 62 | 66 | 76 | 58 |

---

## 14. Command Palette + Advanced Search

- **Current screenshots**: `docs/screenshots/baseline/command-palette--{light,dark,mobile}.png` (not captured)
- **Visual hierarchy**: Group headers (mono, uppercase, tracked) → result rows → footer keyboard hints — clear, instrument-like hierarchy.
- **Spacing rhythm**: Token-driven, consistent.
- **Typography hierarchy**: Group headers already match the redesign's own "mono + tracking for labels" convention almost verbatim — one of the more forward-compatible screens in the app already.
- **Interaction density**: High — full keyboard-driven search/filter/select flow.
- **Component inventory**: `CommandPalette` (opens via shared `Modal`), `AdvancedSearchPanel` (`Chip`/`Disabled` sub-components).
- **Color usage**: Active-row highlight is a **one-off inline style** (`color-mix(in srgb, var(--accent) 10%, transparent)`) duplicating what `.pill-action-active`/`.badge-*` already do as reusable classes elsewhere — the clearest single instance of "the same visual pattern implemented three different ways in three different files" (Badge class / `.pill-action` / this inline style / `AdvancedSearchPanel`'s own hand-rolled `Chip`).
- **Border usage**: Standard.
- **Shadow usage**: Inherits `Modal`'s shadow.
- **Radius usage**: Active row `rounded-[8px]` — notably, this is one of the few places the redesign's radius ceiling (3px) should apply strictly, since a palette row *is* interactive, not a static panel.
- **Motion usage**: Inherits `Modal`'s open animation (450ms fadeUp — over the redesign's ~180ms budget, but not a spring).
- **Loading state**: Not independently re-verified this pass.
- **Empty state**: Not independently re-verified this pass (a "no results" state presumably exists but wasn't confirmed).
- **Accessibility observations**: **Excellent.** Full keyboard navigation, correct `role="combobox"`/`"listbox"`/`"option"`, `aria-expanded`, `aria-activedescendant`. `AdvancedSearchPanel`'s `Disabled` pattern (showing not-yet-supported filters, disabled but visible, rather than hiding them) is a genuinely good UX choice worth preserving exactly.
- **Design debt note**: Three independent implementations of "a small bordered token of state" (see Color usage above) should consolidate during migration, opportunistically.

| Typography | Hierarchy | Consistency | Density | Accessibility | Readability | Navigation | Visual Balance |
|---|---|---|---|---|---|---|---|
| 62 | 80 | 58 | 82 | 90 | 72 | 84 | 72 |

---

## 15. Dialogs & Account (Modal, ChangePasswordDialog, NksVerifyDialog, ProfileDrawer/Edit/View, AvatarPicker, AccountMenu, Toaster)

- **Current screenshots**: `docs/screenshots/baseline/dialogs-account--{light,dark,mobile}.png` (not captured)
- **Visual hierarchy**: Title → fields/content → primary/secondary actions — a single shared `Modal` frame gives every dialog in the app the same hierarchy for free.
- **Spacing rhythm**: Token-driven, consistent across all dialogs (shared frame component).
- **Typography hierarchy**: Mono uppercase tracked labels (10.5px, 0.14em) used consistently across every form field in this group — already close to the redesign's own instrument-label convention.
- **Interaction density**: Medium — forms, confirmations, profile editing, toasts.
- **Component inventory**: `Modal` (shared frame — portal, focus trap, Escape, focus restore), `ChangePasswordDialog`, `NksVerifyDialog`, `ProfileDrawer`, `ProfileEditForm`, `ProfileView` (correctly uses `<dl>` for read-only key/value pairs), `AvatarPicker` (real `<button>`, deliberately chosen over `<div onClick>`), `AccountMenu`, `Toaster` (left color-bar-as-signal pattern).
- **Color usage**: Seal-red focus rings throughout; `--err` for validation text is **chromatically identical to `--accent`** in light mode — a real pre-existing ambiguity (error and "the brand color" are indistinguishable by hue alone here).
- **Border usage**: Boxed inputs (7px), consistent hairline dialog frame.
- **Shadow usage**: `Modal`'s shared `box-shadow: var(--shadow-card-hover)` — updating one file changes every dialog in the app at once.
- **Radius usage**: `Modal` = 10px, inputs = 7px — both above the redesign's 3px ceiling, both fixable in one shared place each.
- **Motion usage**: `Modal`'s `animate-fadeUp` — 450ms ease-out, translateY 12px→0, no spring/bounce (a duration fix, not a physics fix).
- **Loading state**: Not independently re-verified this pass for in-dialog submit states.
- **Empty state**: Not applicable (dialogs are always populated with their form/content).
- **Accessibility observations**: **The best accessibility in the app.** Full focus-trap (Tab/Shift+Tab), focus save/restore on open/close, Escape-to-close, correct `role="dialog" aria-modal="true"`, `aria-invalid`/`aria-describedby`/`role="alert"` on every form error. `AvatarPicker`'s hover/focus overlay logic (`group-hover` + `group-focus-visible`, not hover-only) is exemplary.
- **Design debt note**: `AvatarPicker`'s scrim uses a hardcoded `rgba(0,0,0,0.45)` instead of a token — the one inline-style value in this group that isn't deliberate dynamic theming.

| Typography | Hierarchy | Consistency | Density | Accessibility | Readability | Navigation | Visual Balance |
|---|---|---|---|---|---|---|---|
| 60 | 82 | 78 | 78 | 92 | 76 | 82 | 74 |

---

## Overall averages across all 15 screens

| Typography | Hierarchy | Consistency | Density | Accessibility | Readability | Navigation | Visual Balance |
|---|---|---|---|---|---|---|---|
| 57.1 | 77.5 | 65.7 | 78.1 | 74.5 | 72.7 | 77.3 | 68.4 |

**Reading this**: Hierarchy, Density, and Navigation are already the app's strongest dimensions — the underlying information architecture is sound. **Typography is the weakest dimension app-wide** (no shared scale anywhere), followed by **Consistency** (phantom-var bugs + triplicated patterns) and **Visual Balance** (the "everything is a `.surface-card`" flatness the redesign exists to fix). This matches `DESIGN_TOKEN_AUDIT.md`'s own headline finding almost exactly — the type-scale gap is the single largest lever in this whole redesign.

---

## Top 20 visual inconsistencies

1. Selection state is drawn three different ways across the app: border+bg-tint+shadow (Sidebar Left cards), stroke color/width swap (StudyMap nodes), ring-only (MindMap nodes) — no single "this is selected" language.
2. `--accent` (seal-red) is used for primary action, links, focus ring, selection, active tab, hover, *and* error — `--err` and `--accent` are the literal same hex in light mode.
3. Three independent implementations of "a small bordered token of state": `Badge` class, `.pill-action`, `AdvancedSearchPanel`'s inline-styled `Chip`, and Command Palette's inline active-row highlight.
4. Three independent type scales exist: the app-wide arbitrary-`text-[Npx]` set, `Markdown.jsx`'s own `PROSE` map (19/17/15px), and no scale at all in most components.
5. The same broken popover pattern (`shadow-lg` + undeclared `var(--border)`) is duplicated verbatim in Document List, StudyCard, and BulkBar.
6. `MAU_MASTERY`/`MAU_CHIP` constants duplicated verbatim in `KnowledgePanel.jsx` and `StudyCard.jsx`.
7. Every "card" in the app (Summary sections, Document List tiles, StudyMap info cards, StudyCard) shares one `.surface-card` background/radius/shadow — no register or weight differentiation between a reading panel and an instrument panel.
8. MindMap's relation arrows are carefully themed (indigo, dark-mode aware); its structural tree connectors are entirely unstyled library default — two different levels of polish on the same canvas.
9. StudyMap's node marks (`MARK` const) encode depth via radius+stroke+text-size; its connectors (`.study-map__link`) encode nothing — depth-encoding is inconsistent within one screen.
10. `KnowledgePanel`'s mastery pills are color-only (plus a hover `title`); the app's own `StatusTag` pattern used elsewhere always pairs color with a visible word — an internal a11y-pattern inconsistency.
11. `LearningDashboard.jsx` defines CSS in an inline `<style>` tag; every other component in the app routes through `index.css` — invisible to any future global change.
12. Radius values are inconsistent in degree though not in kind: Badge 4px, inputs 6-7px, Modal/palette-row/cards 8-10px — never Tailwind's own `rounded-lg`/`xl` defaults, but no shared ceiling either.
13. The app has at least two independent empty-state implementations for the same UI moment: a shared `EmptyState` component (Study section) and a bespoke inline centered-icon-plus-copy pattern (Knowledge Inspector) — same intent, two different code paths.
14. Command Palette's active-row radius (`rounded-[8px]`) exceeds even the app's own typical control radius elsewhere (6-7px) for what is functionally the same kind of control (a selectable row).
15. Loading-state treatment is inconsistent app-wide: real skeleton shimmers exist in Document List and the MindMap Inspector, but Toaster/Spinner-consuming areas (dialogs, Sidebar Left source list) use Spinner + text only, with no skeleton equivalent.
16. `StudyMapView`'s node label font references `var(--font-display)` (undeclared, masked by a working fallback) while every other component correctly references the real `font-display`/`font-reading`/`font-body`/`font-mono` Tailwind roles.
17. Error styling (`--err`) reads identically to the brand accent color in light mode but has its own distinct value in dark mode (`useTheme.js`'s dark palette) — error is visually distinguishable from brand in dark mode but not in light mode, an inconsistency between the two themes' own internal logic.
18. Keyboard-operable selection is inconsistent across the app's own instrument screens: PanelDivider/Spine and Command Palette are fully keyboard-operable, but StudyMap node selection and MindMap node hover have no non-mouse equivalent — the app doesn't apply its own best accessibility pattern uniformly.
19. AvatarPicker's overlay scrim is a hardcoded `rgba(0,0,0,0.45)` while every sibling dialog/overlay in the app uses a token-driven backdrop — one literal value in an otherwise fully tokenized overlay system.
20. Sidebar Left's card border is 4-sided; Toaster's card border uses a 3px accent-colored *left* rule only — two different "how much border does a card get" philosophies coexisting in the same app.

## Systemic debt (root causes — not per-instance defects)

Separated per Codex's review: the 20 items above are individual, fixable
instances. These are the smaller number of *underlying* gaps that generate
most of them — fixing a root cause here closes several Top-20 items at
once, whereas fixing a Top-20 item one at a time doesn't touch its root
cause.

1. **No shared type scale** (Token Audit §1) — generates inconsistencies 4, 16, and most of the per-screen "shares the app-wide no-scale issue" notes.
2. **Single-accent architecture** (`--accent` = action+selection+hover+error) — generates inconsistencies 1, 2, 17, and the MindMap/Workspace Shell consistency scores being the lowest in the app.
3. **No permanent graphite/instrument register concept** — generates the "every card shares one background" flatness (item 7) and the Visual Balance score ceiling across most screens.
4. **No linting/type-checking on inline `style={{}}` custom-property names** — generates the entire phantom-var bug (Token Audit §7), a Critical-severity item independent of any redesign decision.
5. **Three small-token patterns coexisting** (`Badge` class / `.pill-action` / hand-rolled `Chip`) — generates inconsistency 3 and the Command Palette/Advanced Search consistency score.

## Signatures worth amplifying

Separated per Codex's review: the redesign's own "Hallmark rules" ask for a
memorable identity, and MemVid already has real, working signature motifs —
the risk of a pure token/radius pass is flattening these by accident while
fixing unrelated defects. Preserve and extend these deliberately (see
`UI_IMPLEMENTATION_PLAN.md`'s Signature Contract):

1. **The seal-stamp wordmark** (`MainLayout.jsx` — rotated bordered square "M") — the one motif every screen family may reference, per Signature Contract §7.
2. **`.cite-chip`** — superscript citation chips already treat evidence as first-class typography, not a footnote; exactly the "Perplexity DNA" the original redesign brief asked to extract.
3. **`.seal-meter`** — a circular "ink fills to your mastery score" progress visualization; a genuinely distinctive numbers-as-anchor treatment, not a generic progress bar.
4. **`.panel-spine`** — the collapsed-column "book spine" (vertical label + count badge) is a real, on-brief signature already; the redesign should re-skin its tokens, not replace the concept.
5. **Toaster's left-color-bar-as-signal pattern** — structure encoding information instead of decorating it, currently isolated to one component; extend it to Badge/StatusTag/validation errors rather than inventing a new signal language for those.
6. **`AdvancedSearchPanel`'s "disabled but visible" pattern** for not-yet-supported filters — a genuinely good UX choice (show the ceiling, don't hide it) worth preserving exactly through any restyle.
7. **`StudyCard`'s documented information hierarchy** (display name > filename > AI overview > preview > chips > metadata > actions) — one of the best-designed hierarchies in the app; the redesign should express it more clearly with a real type scale, not flatten it into uniform card text.
8. **Knowledge Inspector's sticky 5-row grid** (nav / recent-pinned / sticky header / one scroll region / sticky footer) — already reads like a document reader; needs a register change, not a structural one.
9. **Evidence Drawer's motion** (180ms ease-out translate, reduced-motion guarded) — already an exact match to the redesign's own motion ceiling; the reference implementation every other panel-open animation should be matched to, not the other way around.

## Top 20 easiest wins

1. WorkspaceTabs — bronze underline color + weight change on active label, no italic (already matches spec's tab rule structurally, color-only change).
2. MindMap structural connector color/weight (`--mm-connector`) — same proven mechanism as the existing `--mm-relation` var.
3. Modal.jsx radius/shadow/duration fix — one file, cascades to every dialog app-wide.
4. PanelDivider grip visibility (hide at rest, show on hover/focus) — one CSS rule.
5. Toaster radius + shadow retint — one file, keep the left-color-bar pattern as-is.
6. Badge radius 4px → 3px — one class, one-line change.
7. Fix the 3 `var(--border)`-in-select/popover sites in Document List — mechanical rename, immediately fixes a real (if minor) rendering bug.
8. Fix the `var(--brand)` sites in StudyMapView — mechanical rename, fixes the app's most visible node-color bug.
9. Fix `var(--surface-elevated)` (1 site) and `var(--font-display)` (1 site) — trivial, isolated.
10. Repoint the 7 core color tokens in `index.css` `:root`/`html.dark` — ~15 lines, recolors the whole app in one pass.
11. Collapse `fontFamily.display`/`reading` alias to one role in `tailwind.config.js` — keep Spectral, no new font load (Signature Contract §3).
12. AvatarPicker scrim — replace hardcoded `rgba(0,0,0,0.45)` with a token.
13. ProfileView's inline `borderColor: "var(--border-color)"` — replace with the already-existing `border-hairline`-equivalent Tailwind class once declared.
14. Consolidate `MAU_MASTERY`/`MAU_CHIP` into one shared constant (pre-existing debt, unrelated to visual redesign, but a one-file fix once you're already touching both consumers).
15. Command Palette active-row highlight — swap the one-off inline style for the existing `.pill-action-active`/`.badge-*` class.
16. Quiz Setup / Taking / Result / Review Guide — pure radius/token pass, zero bugs to fix first, lowest-effort screens in the whole app.
17. Study Shell / Breadcrumb — same, lowest-effort, most-consistent file group already.
18. Evidence Drawer — background-token-only swap to graphite (motion needs zero change, already spec-compliant).
19. Add `borderRadius`/`fontSize`/`spacing` scale keys to `tailwind.config.js` — pure addition, zero consumers touched yet, unblocks everything else.
20. `LearningDashboard.jsx`'s inline `<style>` tag — move its ~5 rules into `index.css` (pure organization, no visual change, removes a blind spot for every future global change).

## Top 10 highest-risk screens

1. **MindMap Canvas** — single-accent conflation is architecturally deepest here; root-node treatment change alters the app's primary visual anchor; needs real generated-graph QA, not a storybook check.
2. **StudyMap View** — styling constants and interaction logic (`onPick`, search, zoom, collapse) share the same render functions; the `--brand` bug means today's baseline itself is already wrong in a way that must be fixed before, not during, a restyle.
3. **Study Home (Dashboard/Shell)** — highest concentration of phantom-var bugs (21+ sites) across 7 files; any token rename here needs per-file visual verification, not a blind sweep.
4. **Document List** — the 3x-duplicated broken-popover pattern; any structural consolidation (vs. in-place fix) changes shared behavior across three screens at once.
5. **Command Palette + Advanced Search** — global overlay used from every screen; a radius/motion regression here is visible everywhere, not just locally.
6. **Dialogs & Account** — `Modal` is the single highest-leverage shared file in the app; a mistake here breaks every dialog simultaneously (high leverage cuts both ways).
7. **Knowledge Inspector + Evidence Drawer** — the graphite-register decision here is a genuine structural/visual change (not just a value swap) layered onto an already-correct, delicate sticky-grid contract that must not regress.
8. **Workspace Shell** — the screen where the most `--accent` consumers coexist simultaneously; the single-accent-to-three-roles split has the largest single-screen blast radius.
9. **Summary Panel** — shares Markdown's independent type scale; any type-scale codemod touching this screen also touches Evidence Drawer (a second consumer) and must verify both.
10. **Landing** — largest single file (300+ lines), many one-off decorative blocks, and the only screen whose in/out-of-scope status is still an open decision — risk is more about scope ambiguity than code fragility.

## Top 10 safest screens

1. **Quiz Taking** — zero phantom vars, best-in-class accessibility, dual color+shape state signaling, no structural risk.
2. **Quiz Result** — zero phantom vars, shares Quiz Taking's confirmed-clean file group.
3. **Quiz Setup** — zero phantom vars, low complexity, no debt found.
4. **Study Shell / Breadcrumb** — most internally consistent file group in the app by its own documented design intent.
5. **PanelDivider / Panel Spine** — best-crafted accessibility in the app; changes here are purely additive tokens on top of an untouched, already-correct keyboard contract.
6. **Toaster** — small, isolated, already close to spec in spirit (left-rule-as-signal).
7. **Evidence Drawer** — motion already an exact match to the redesign spec; only a background-token swap remains.
8. **WorkspaceTabs** — trivial, isolated, highest-leverage-to-effort ratio in the app.
9. **Avatar / Badge / Disclosure** — small, already token-driven, no debt found.
10. **Login / Register** — low complexity, standard form pattern, no debt found (though also the least deeply re-verified this pass — safe by simplicity, not by exhaustive audit).

---

## Design Debt Heatmap

Severity defined as: **Critical** = a real bug today, independent of any redesign; **High** = a structural gap the redesign must resolve deliberately (not a token value swap); **Medium** = a token-value/class-level fix, systemic but mechanical; **Low** = isolated, cosmetic, or an accepted/deliberate exception.

| Category | Critical | High | Medium | Low |
|---|---|---|---|---|
| **Color / tokens** | Phantom CSS vars (`--border`, `--brand`, `--surface-elevated`, `--ok-bg`, `--font-display`) — 25+ sites, 7+ files, incl. StudyMap's root/section/selection node color | Single-accent conflation (`--accent` = action + selection + hover + error) across MindMap, Workspace Shell, Study Home, Dialogs — resolved by narrowing seal-red to a kept, provenance-only `--seal` role rather than deleting it (Signature Contract §1) | Repoint color values in `index.css` (mechanical once the role split above is decided) | Collection-color dots (`CollectionSidebar`) — deliberate exception, not debt |
| **Typography** | — | No shared type scale anywhere: 495+ arbitrary `text-[Npx]` instances, 23+ distinct sizes, 3 independent scales (app-wide, Markdown, ad hoc) — fix by semantic role, not nearest-value rounding (see Implementation Plan Task 20) | `fontFamily.display`/`reading` alias collapse to one role, **keeping Spectral** (Signature Contract §3); drop-cap addition to Inspector/Markdown prose | `Mockup()` on Landing will drift once real workspace type changes |
| **Spacing / layout** | — | — | 606 total arbitrary bracket values (spacing/sizing, overlapping with the type-scale count) | Sidebar Left's 4-side card border vs. hairline-elsewhere philosophy mismatch |
| **Radius** | — | — | 4–10px arbitrary values app-wide, above the 3px interactive-control ceiling; panels/cards should go to 0 (square) | Command Palette row radius slightly higher than sibling controls |
| **Shadow** | — | — | `.surface-card`'s default soft shadow applied to nearly every card (the "not everything is a card" fix) | 6 literal `shadow-lg` popover instances — legitimate elevation use, only needs a token swap |
| **Motion** | — | — | Modal's `fadeUp` 450ms → trim to ~180ms (duration only, already ease-out, no spring exists anywhere in the stack) | Ambient loops (`pulse`, `scanPulse`) are out of the interaction-response budget's scope entirely |
| **Register (dark/graphite)** | — | No permanent graphite register concept exists — dark mode is a whole-app toggle only, not a fixed material for instrument surfaces | MindMap canvas / Inspector / Evidence Drawer / nav frame register swap, once the "which surfaces" decision is made | — |
| **Structural duplication** | — | — | 3x-duplicated broken popover (Document List / StudyCard / BulkBar); 3x-duplicated "small bordered token" pattern (Badge/pill/Chip/palette-highlight) | `MAU_MASTERY`/`MAU_CHIP` duplicated constants; `LearningDashboard`'s inline `<style>` escape |
| **Accessibility** | — | StudyMap node selection has no keyboard path outside search-jump | `KnowledgePanel` mastery pills are color-only vs. the app's own `StatusTag` word+color convention elsewhere | Hover states on MindMap nodes have no visible non-mouse equivalent (a gap, not a regression risk) |
| **Scope ambiguity** | — | Landing/Login/Register sit outside the redesign spec's stated scope entirely | — | — |

**Reading the heatmap**: there is exactly **one Critical row** — the phantom-var bug — and it is the only item in this entire baseline that must be treated as a correctness fix rather than a design decision. Everything in **High** requires an explicit decision recorded in `UI_IMPLEMENTATION_PLAN.md`'s "Open decisions" section before Wave 1 starts. Nothing in **Medium** or **Low** blocks anything else — they're mechanical or cosmetic, safe to parallelize across many small PRs.

---

**STOP. Documentation only — no code changed, no commits made. Awaiting approval before any implementation begins.**
