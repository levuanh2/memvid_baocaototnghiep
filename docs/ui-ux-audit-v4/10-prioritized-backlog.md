# 10 — Prioritized Implementation Roadmap (Phase 11, Claude — Audit Lead)

Implements **Option B (Balanced Workspace Redesign)** from `09-redesign-options.md`. Nothing in this document is built yet — it is a plan awaiting the user's approval of a direction per the brief's Phase A gate. All IDs reference the adjudicated master matrix in `08-independent-agy-review.md` §5.

## Round 0 — Critical UX defects (P0)

- **Scope**: UX-ADJ-001 (render the real `<Link to="/app/study">` in `MainLayout.jsx:503-520` the existing comment already claims exists), UX-ADJ-002 (re-anchor the MindMap toolbar or the `mindmap-tools-overlay` so Export/Appearance/Overflow are never physically covered when a node is selected).
- **Affected components**: `MainLayout.jsx`, `MindElixirView.jsx` (toolbar/overlay z-index and anchoring only — no interaction logic change).
- **Owner**: Claude (integration/IA) for the nav link; Codex 1 (shared visual components) for the toolbar/overlay re-anchor, since it's a layout/z-index problem adjacent to the design-system work they already audited.
- **Dependencies**: None. Both are isolated, file-local fixes.
- **Before/after acceptance**: (a) A visible, clickable link/button in the `/app` header reaches `/app/study` without using Alt+S or the command palette. (b) With a node selected on the MindMap canvas at 1440x900, `document.elementFromPoint()` on the Export/Appearance/Overflow button centers resolves to the button itself, not `.mindmap-tools-overlay`.
- **Screenshot gates**: Before/after screenshot of the `/app` header showing the new link; before/after screenshot of a selected-node MindMap state showing the toolbar fully clickable.
- **Playwright gates**: A real click (not just a visibility check) on the new study-library link actually navigates to `/app/study`. A real click on Export/Appearance/Overflow with a node selected actually opens the respective dialog/menu (not intercepted).
- **Accessibility checks**: The new nav link has an accessible name and is reachable by Tab in header order.
- **Performance risk**: None — no new network calls, no new renders.
- **Rollback strategy**: Each fix is a single-file diff; revert is a one-commit `git revert`.

## Round 1 — Navigation and duplicate removal

- **Scope**: UX-ADJ-019 (relabel ambiguous "StudyMap" header dropdown to "Công cụ học"), UX-ADJ-018 (normalize "Phòng đọc" / "MemVidX" / "StudyMap" user-facing terminology in `Register.jsx:47`, `DocumentList.jsx:406`). Confirm and preserve every "keep as contextual shortcut" verdict from `05-duplication-matrix.md` (Chat/MindMap/Summary multi-entry, Appearance/Export Studio dual appearance controls, source search scoping) — this round removes zero legitimate shortcuts.
- **Affected components**: `MainLayout.jsx`, `StudyToolsMenu.jsx`, `Register.jsx`, `DocumentList.jsx`.
- **Owner**: Codex 2 (flow/labeling, since they produced the duplication matrix and already have the full entry-point inventory).
- **Dependencies**: Should land after Round 0's nav link exists, so the relabeled "Công cụ học" trigger and the new "Thư viện học tập" link are never shown together in a half-fixed state.
- **Before/after acceptance**: No screen shows "Phòng đọc" to an end user; the "Công cụ học" trigger opens only Tutor/Timeline/Knowledge (matches its label); every duplication-matrix "keep" entry point still reaches its documented destination with correct context handoff.
- **Screenshot gates**: Register page, DocumentList back-link, header dropdown — before/after string diff screenshots.
- **Playwright gates**: Regression test confirming every "keep" entry point in `05-duplication-matrix.md`'s table still functions (one assertion per row).
- **Accessibility checks**: Updated labels still pass `aria-label`/accessible-name checks already in place.
- **Performance risk**: None (string/label changes only).
- **Rollback strategy**: Single-commit revert per string change.

## Round 2 — Design tokens and shared components

- **Scope**: UX-ADJ-005 (dark-mode primary CTA contrast 2.77:1 → ≥4.5:1), UX-ADJ-006 (muted copy contrast 2.89–3.43:1 → ≥4.5:1), UX-ADJ-009 (MindMap selection ring `var(--forest)` → `var(--accent)`), UX-ADJ-010 (`AccountMenu.jsx` hardcoded seal-red hex → token), UX-ADJ-012 (declare missing `--font-display`/`--font-mono` in `index.css:1029-1030`), UX-ADJ-017 (consolidate the 3px/6-10px/full radius fragmentation to a semantic scale).
- **Affected components**: `index.css`, `mindElixirTheme.js`, `AccountMenu.jsx`, `tailwind.config.js`.
- **Owner**: Codex 1 (design system/shared visual components — this is exactly their audited inventory).
- **Dependencies**: None technically, but should land before Round 3/4 so downstream screens inherit corrected tokens rather than needing a second pass.
- **Before/after acceptance**: Every contrast pair measured in `03-visual-design-audit.md`'s contrast matrix passes WCAG AA (≥4.5:1 for text); zero `var(--forest)`/hardcoded-hex/undeclared-var references remain in the files above; the radius scale has a documented, finite set of semantic values.
- **Screenshot gates**: Dark-mode CTA before/after, muted-copy before/after (light+dark), MindMap node-selection before/after, AccountMenu hover before/after.
- **Playwright gates**: Automated contrast-ratio assertion (reuse the measurement method already in `03-visual-design-audit.md`) for the two fixed pairs, across light and dark.
- **Accessibility checks**: WCAG AA contrast pass is itself the accessibility check for this round.
- **Performance risk**: None.
- **Rollback strategy**: Token-value-only changes; revert restores prior values exactly.

## Round 3 — Main Workspace and Chat

- **Scope**: UX-ADJ-003 (Command Palette focus hijacked by Modal's close button on `Ctrl+K`), UX-ADJ-004 (Command Palette renders a blank container on empty query despite `dsPhang` being non-empty), UX-ADJ-014 (desktop Escape key ignored by the MindMap-overlay listener's `!panel.drawer` guard).
- **Affected components**: `CommandPalette.jsx`, `Modal.jsx` (focus-order only, not its header/children structure), `MainLayout.jsx`'s Escape listener.
- **Owner**: Codex 2 (accessibility/interaction findings — these are their exact blind-spot-caught-by-Agy items, closing the loop with the people best positioned to verify the fix against the rest of the Quiz-flow-quality a11y baseline).
- **Dependencies**: None, but touches `Modal.jsx` which has 10 consumers (`08` §2 blast-radius map) — any fix must be verified against all 10, not just CommandPalette.
- **Before/after acceptance**: `Ctrl+K` focuses the search input, not the close button, on every `Modal`-based dialog. Opening Command Palette with no query shows the existing `DANH_SACH_LENH` command list, not a blank box. Pressing Escape on the desktop MindMap Knowledge Inspector overlay closes it.
- **Screenshot gates**: Command Palette empty-state before/after; focus-ring-on-input evidence (not just a claim).
- **Playwright gates**: `document.activeElement` assertion immediately after `Ctrl+K` equals the search input, across all 10 Modal consumers listed in `08` §2. Escape-key assertion on the MindMap overlay at desktop width.
- **Accessibility checks**: Full keyboard-only walkthrough of Command Palette open → type → select → close, since this round is explicitly about keyboard correctness.
- **Performance risk**: None.
- **Rollback strategy**: Isolated to `CommandPalette.jsx` and one `useEffect` in `MainLayout.jsx`; single-commit revert.

## Round 4 — Mind Map and Export Studio

- **Scope**: UX-ADJ-015 (mobile Export Studio quick-format row clipped with no scroll affordance), UX-ADJ-016 (mobile StudyMapView canvas crops the graph on initial load), UX-ADJ-020 (Export Studio's 7-step flow for a quick SVG export — add a "repeat last export" shortcut, evidence-gated). Begin the map visual-parity slice of UX-ADJ-008 from Option B: align `StudyMapView.jsx`'s `MARK` node/connector treatment with MindMap's visual grammar (color roles, stroke weights) — **without** changing either engine's underlying library or `useStudyContext`'s dual-identity contract.
- **Affected components**: `ExportStudioDialog.jsx`, `StudyMapView.jsx` (`MARK` constant + viewport auto-fit only).
- **Owner**: Claude (integration owner for the cross-engine visual-parity work, since it touches both `/app` and `/app/study`) with Codex 1 reviewing the visual-grammar alignment against the design-system inventory in `07`.
- **Dependencies**: Round 2's token fixes should land first so the parity work references corrected tokens, not the pre-fix forest-green/contrast-failing values.
- **Before/after acceptance**: Export Studio's quick-format row is fully reachable on mobile (scroll affordance or wrap, user's choice confirmed by evidence, not assumed). `StudyMapView` auto-fits its viewport bounds on mobile initial load (no cropped graph). `StudyMapView`'s four node tiers (`root`/`section`/`concept`/`example`) visually read as the same family as MindMap's node/connector treatment.
- **Screenshot gates**: Mobile Export Studio before/after (375x667, 390x844); mobile StudyMapView initial-load before/after; side-by-side MindMap vs. StudyMapView visual-parity comparison.
- **Playwright gates**: Export Studio quick-format row — every control reachable via scroll or visible without horizontal overflow. StudyMapView viewport bounding box contains all rendered nodes on load at 375-414px widths.
- **Accessibility checks**: StudyMapView's existing click-only node selection a11y gap (no keyboard path beyond search-result jump) is noted as a known limitation, not silently carried forward — flag for a follow-up round if Option C is ever approved, since fixing it properly means inheriting mind-elixir's keyboard model rather than patching the SVG renderer.
- **Performance risk**: Low — visual-only token/style changes to an existing render path, no new data fetching.
- **Rollback strategy**: Each sub-item (mobile clip fix, viewport auto-fit, visual parity) is independently revertible.

## Round 5 — Study / Quiz / Review pages

- **Scope**: UX-ADJ-007 — the single highest-leverage item in this roadmap: consolidate `DocumentList.jsx`'s repeated full-card sections (823 interactive controls measured) into one canonical result list with compact "Continue," "Needs quiz," etc. modules, per `05-duplication-matrix.md`'s explicit recommendation. UX-ADJ-013 (convert `StudyBreadcrumb` spans to real `<Link>`s).
- **Affected components**: `DocumentList.jsx`, `StudyCard.jsx`, `StudyBreadcrumb.jsx`.
- **Owner**: Codex 2 (flow/duplication — they own the matrix this implements) with Claude reviewing for regression against the "keep" verdicts elsewhere in the same matrix (this round must not accidentally remove a legitimate shortcut while consolidating cards).
- **Dependencies**: Should land after Round 1 (terminology) and Round 2 (tokens) so the consolidated card list is built on corrected labels and colors, not a second redo.
- **Before/after acceptance**: One document appears in exactly one primary result-list row (not repeated across sections); `StudyCard.jsx`'s existing roving-tabindex keyboard pattern survives consolidation unchanged; breadcrumb parent segments navigate on click.
- **Screenshot gates**: Full before/after of the library at desktop and mobile widths, with interactive-control count annotated (target: a small fraction of the measured 823).
- **Playwright gates**: Count of rendered `StudyCard`-equivalent elements for a fixed seeded document set; keyboard Tab-order walkthrough confirms no duplicate stops for the same document; breadcrumb click-to-navigate assertion.
- **Accessibility checks**: Screen-reader tree for the consolidated list must not repeat the same document name multiple times (the specific defect `08`/`06` both measured).
- **Performance risk**: Positive — fewer DOM nodes, shorter page height (currently measured at 50,000+ px tall).
- **Rollback strategy**: Highest-risk round in this roadmap (Medium-High per the duplication matrix — sections, selection, analytics, and scroll anchors currently assume repeated cards). Land behind a feature flag if the team's tooling supports it; otherwise, keep the old `DocumentList.jsx` render path available in version control for one release cycle before deleting it.

## Round 6 — Mobile/tablet refinement

- **Scope**: UX-ADJ-011 (mobile mode-tab/kebab touch targets below 44x44px), the mobile drawer tab-order leak (closed off-canvas source drawer remains in sequential Tab order), and a full responsive re-verification pass of every fix from Rounds 0-5 at the brief's required breakpoints (1920x1080 down to 320x568).
- **Affected components**: `MainLayout.jsx` (touch targets), `SidebarLeft.jsx` (drawer `inert`/unmount).
- **Owner**: Codex 2 (responsive implementation — matches their accessibility/responsive audit scope).
- **Dependencies**: Runs last among the fix rounds since it re-verifies everything above at every breakpoint.
- **Before/after acceptance**: All interactive controls measured ≥44x44px on mobile; a closed source drawer is unreachable by Tab (confirmed via accessibility tree, not just visual hiding); every fix from Rounds 0-5 re-verified clean at all 10 brief-specified viewports in both themes.
- **Screenshot gates**: Full breakpoint matrix (10 viewports × 2 themes) for every screen touched in Rounds 0-5.
- **Playwright gates**: Automated touch-target-size assertion across the fixed controls; Tab-order assertion confirming the closed drawer contributes zero stops.
- **Accessibility checks**: This round's own acceptance criteria are the accessibility checks.
- **Performance risk**: None.
- **Rollback strategy**: Per-component, same as the rounds that introduced each underlying fix.

## Round 7 — Accessibility and visual regression closure

- **Scope**: Final WCAG 2.2 AA sweep across every screen in the brief's Phase 2 inventory (not just the items already found — a fresh pass to catch anything Rounds 0-6 didn't touch), plus closing out the two "likely issue needing validation" items from `08` §3 Challenge 4 (quiz-generation/chat-citation failures attributed to the offline mock's un-indexed test documents, not a frontend defect) by adding a rich seeded Postgres test fixture so those flows can finally be audited end-to-end with real populated states.
- **Affected components**: Test infrastructure (`BE/scripts/run_e2e_server.py` or a new seed script), plus whatever screens the fresh WCAG sweep surfaces.
- **Owner**: Claude (integration owner, test infra) with Agy as independent reviewer (read-only, per the brief's Phase 11 team structure) sanity-checking the final sweep's findings before sign-off.
- **Dependencies**: Runs last — needs every visual/structural change from Rounds 0-6 in place to sweep against final state.
- **Before/after acceptance**: Zero new WCAG AA violations found in the fresh sweep; a seeded test account with fully-indexed documents can complete the full Quiz → Result → Review → Practice journey in the audit environment, closing the one real coverage gap this whole audit carried (Codex 1's documented limitation: "all audit DB docs reported processing/no indexed chunks, so populated Quiz/Result/Review/Practice could not be honestly captured").
- **Screenshot gates**: Full populated-state screenshots of Quiz/Result/Review/Practice — the one screen family this audit could not honestly capture, now closed.
- **Playwright gates**: End-to-end journey test, Documents → Quiz → Result → Review → Practice, against the new seeded fixture.
- **Accessibility checks**: This round's own WCAG sweep.
- **Performance risk**: None (test infra only).
- **Rollback strategy**: Test-infra-only changes; no production code risk.

## Cross-cutting rules for every round

1. **No concurrent writes to the same component without explicit coordination** — `Modal.jsx` (10 consumers), `useStudyContext.js`/`StudyContextProvider.jsx` (18 consumers), and `WorkspaceContainer.jsx` are shared-blast-radius files per `08` §2; any round touching them must post the exact diff for review before merge, not just the final screenshot.
2. **Guarded invariants are not in scope for any round above**: `WorkspaceContainer`'s simultaneous pane mounting, `useStudyContext`'s stem-vs-UUID dual identity, `ContextPanelCloseButton`'s dual-mode lifecycle, and the zero-Framer-Motion rule (`08` §6) are explicitly out of scope through Round 7. Only Option C (not scheduled here) would touch the second of these, and only with its own dedicated plan.
3. **Small, independently reviewable PRs** — one PR per round minimum, split further if a round's scope crosses more than ~3 files.
4. **Isolated worktrees, non-overlapping file ownership** — reuse the `.worktrees/` pattern already used for this audit; Claude/Codex 1/Codex 2 each work in their own worktree per round and merge sequentially, not in parallel on the same files.
5. **No merge or deploy without the user's explicit approval** — this backlog is a plan; execution of any round requires separate, explicit go-ahead per the brief's Phase A gate.
