# 11 — Phase C Implementation Plan (Claude — UX Lead / Integration)

**No FE/src has been modified by this plan. No merge, no deploy, no round has started.** This sequences Phase B's approved-design-pending-sign-off artifacts (`01-10`) into executable PRs. It supersedes `docs/ui-ux-audit-v4/10-prioritized-backlog.md`'s Round 2/4/5 scope descriptions, which predate Phase B's actual built proposals — Round numbering below intentionally reuses that document's Round 0/1 (already shipped) framing so the two documents read as one continuous plan, not a competing one.

## Status gate

Round 0 (toolbar/Inspector occlusion, nav link) is merged and live. **Nothing below may start until the user has made the two open decisions in `10-design-approval-package.md` §4** (Document Library A vs B, Export Studio Preview Bench vs Guided Steps) **and explicitly approved an implementation direction.** This document assumes Alternative B and Preview Bench — the team's stated recommendations — purely so the plan has concrete shape; if the user picks differently, only Rounds 5 and 4 need re-scoping, nothing else.

## Architecture invariants every round must preserve (verified present in Phase B's own deliverables, not re-asserted blindly)

- **`WorkspaceContainer` simultaneous mounting** — Chat/MindMap/Summary stay mounted together; no round introduces route-level remounting.
- **`useStudyContext` stem/UUID dual identity** — stem in `/app`, UUID in `/app/study`; Codex 2's Alternative B already ships an explicit transition contract against this, not an assumption.
- **`ContextPanelCloseButton` dual-mode lifecycle** — Chat-mode vs MindMap-mode close behavior stays distinct; Document Library's new mobile tool sheet must not introduce a third, different close pattern (flagged in `09-risk-and-migration-plan.md` §3).
- **Zero Framer Motion.**
- **Exact-node Export V3 fidelity** — verified against the real pipeline (`FE/src/utils/mindmapImageExport.js`, `@zumer/snapdom`, `pdf_serializer.py`) in Agy's Task 2 audit, not assumed from a different library's behavior.
- **320px `ContextInspector` floor & toolbar clearance** — established across `PANELS.right`, `hooks/panelLayout.js`, and `SidebarRight.jsx`. The inspector must never shrink below 320px in any breakpoint; toolbar row reservations and container-query compaction must maintain a positive hit-test margin (>0px) at the 768-800px drawer boundary without occluding interactive targets.
- **Unified navigation dispatcher (`useOpenSurface` / `duongDi`)** — all surface transitions across Global Nav, Document Library (primary CTA, quick actions, More sheet), MindMap, and StudyMap must route through `useOpenSurface(doc, surface)` and `duongDi()`; no component may hardcode route URLs or hand-assemble STEM vs UUID paths.
- **Synchronous bulk-selection pruning** — bulk selection (`Set<document_id>`) must synchronously intersect with visible documents on every search query, collection filter, or task-view transition before BulkBar reads it, preventing accidental mutations on hidden items.
- **Export offscreen sandbox isolation** — the offscreen export container (`.mm-export-offscreen`) rasterized via `@zumer/snapdom` must consume only resolved static hex tokens, explicit stroke widths, and pre-warmed webfonts (`Inter`, `Spectral`, `DejaVuSans`); live presentation CSS (`color-mix()`, radial-gradient dot lattice, dynamic pan/zoom transforms, detached custom property cascades) must remain strictly presentation-only and never leak into the export DOM.

## Round-by-round plan

### Round 2 — Design tokens and accessibility foundations

- **User-visible before/after**: forest-green MindMap selection ring → blue; hardcoded seal-red in account menu → token; dark-mode CTA/muted-text contrast failures fixed; undeclared `--font-display`/`--font-mono` become real tokens.
- **Exact source components**: `FE/src/components/mindmap/mindElixirTheme.js` (selection color), `FE/src/components/Layout/AccountMenu.jsx` (hardcoded hex), `FE/src/index.css` (token declarations, contrast-failing values).
- **Agent owner**: single agent, Codex 1 (owns the canonical token spec it helped converge on, `06-design-tokens-and-components.md`).
- **Worktree**: `.worktrees/phase-c-round2-tokens`, new branch off `main`, isolated from all other rounds.
- **State/data contracts**: none — pure CSS variable/value changes, zero state logic touched.
- **Test plan**: existing visual regression suite (if any) plus manual contrast measurement re-run matching `06-design-tokens-and-components.md` §1's cited ratios.
- **Screenshot parity gates**: before/after at the 4 standard viewports (1440/820/390/320), both themes, for MindMap node selection and the account menu.
- **Accessibility gates**: re-measure the two contrast failures named in the Phase A audit (`docs/ui-ux-audit-v4/03-visual-design-audit.md`) and confirm they now pass WCAG AA.
- **Responsive breakpoints**: all 4; this round touches shared tokens so every breakpoint is in scope for a quick pass, not just the ones token values visually change.
- **Regression blast radius**: low — token-only, but tokens are globally consumed, so a broad quick visual check (not deep testing) across every surface is warranted before merge.
- **Rollback**: trivial, revert the CSS variable values.
- **PR dependencies**: none — this is the foundation round, should land first.

### Round 3 — Shared shell / Workspace visual integration

- **User-visible before/after**: Learning Desk layout — 56px tablet source rail (reclaims ~196px at 820px), mobile bottom dock removed (eliminates the keyboard-collision risk Agy's review caught), header context chips on mobile.
- **Exact source components**: `FE/src/components/Layout/MainLayout.jsx`, `SidebarLeft.jsx`, `SidebarRight.jsx`/`ContextInspector`, relevant CSS in `FE/src/index.css`.
- **Agent owner**: Codex 1 (built and iterated this exact mockup, `03-visual-mockups/workspace.html`, through 3 Agy-driven correction cycles already).
- **Worktree**: `.worktrees/phase-c-round3-workspace`.
- **State/data contracts**: none new — layout-only; must not touch `WorkspaceContainer`'s mount behavior or `useStudyContext`.
- **Test plan**: existing MainLayout/WorkspaceContainer test suites (several `.test.jsx` files already exist per earlier session context — e.g. `MainLayout.modeTabs.test.jsx`, `MainLayout.sidebarRightMount.test.jsx`) must stay green; add coverage for the new tablet rail width and the removed mobile dock.
- **Screenshot parity gates**: 1440/820/390/320, light+dark, matching `03-visual-mockups/workspace.html`'s already-rendered evidence set 1:1.
- **Accessibility gates**: re-verify the 320px Inspector floor holds at every width that shows the Inspector; keyboard focus order through the new header context chips on mobile.
- **Responsive breakpoints**: all 4, with explicit extra attention at 768-800px per the Round 0 lesson (`07-responsive-interaction-spec.md` §2).
- **Regression blast radius**: medium — `MainLayout.jsx` is a high-consumer-count file; depends on Round 2's tokens landing first so colors are correct, not a second pass.
- **Rollback**: keep the current MainLayout render path behind a flag for one release cycle if the team's tooling supports it; otherwise straightforward revert since no data model changes.
- **PR dependencies**: Round 2 (tokens) must merge first.

### Round 4 — MindMap and StudyMap visual parity

- **User-visible before/after**: both engines adopt the shared 4-tier node hierarchy, connector geometry, dot-lattice canvas, and blue selection halo from `05-shared-map-visual-grammar/visual-grammar-spec.md` — without becoming the same engine.
- **Exact source components**: `FE/src/components/mindmap/MindElixirView.jsx`, `mindElixirTheme.js`, `FE/src/components/StudyMapView.jsx` (react-d3-tree usage).
- **Agent owner**: Agy leads (authored the visual grammar spec and the export-fidelity guardrail it must respect), Codex 1 as feasibility reviewer (already validated the spec against a real mockup, `03-visual-mockups/maps.html`).
- **Worktree**: `.worktrees/phase-c-round4-maps`, strictly isolated from Round 5's Export Studio work even though both touch MindMap-adjacent code — no file overlap (this round touches node/connector rendering; Export Studio touches the dialog and offscreen capture container only).
- **State/data contracts**: zero change to node data, selection state, or export selection markers — presentation-only, per the guardrail. Style isolation invariant: canvas dot lattice (`radial-gradient`) and dynamic transforms must apply to the live canvas only, never leaking into `.mm-export-offscreen`. `StudyMapView`'s font-family change (dropping its hardcoded serif) and SVG label wrapping are the two implementation-time items Agy flagged (`08-independent-agy-review.md` §4.4 Risk 2).
- **Test plan**: `npm test -- src/utils/mindmapImageExport.test.js` (25/25 must pass, verifying SnapDOM capture parameters and connector endpoint geometry), existing MindMap selection/lifecycle tests, plus `python -m pytest BE/tests/test_mindmap_export_*.py` (backend smoke check verifying DejaVu font metrics and PyMuPDF connector bounds).
- **Screenshot parity gates**: both engines at 1440/820/390/320, light+dark, same conceptual sample data side by side (as already demonstrated in `03-visual-mockups/maps.html`).
- **Accessibility gates**: StudyMap's upgraded keyboard path (currently click-only per Phase A audit) is explicitly NOT in this round's scope — stays a known limitation per `docs/ui-ux-audit-v4/10-prioritized-backlog.md`'s original Round 4 note, flagged again here so it isn't silently dropped.
- **Responsive breakpoints**: all 4; mobile depth-1 tree collapse and the 320px legibility floor (`visual-grammar-spec.md` §7) need explicit verification.
- **Regression blast radius**: low-medium — isolated to two already-separate components, but the export-fidelity guardrail makes any connector/node-geometry change high-stakes even though the blast radius (who else imports these files) is small.
- **Rollback**: straightforward, presentation-only revert.
- **PR dependencies**: Round 2 (tokens) must merge first. Independent of Round 3.

### Round 5 — Export Studio visual redesign (Preview Bench, pending sign-off)

- **User-visible before/after**: persistent live paper preview alongside scope/format/appearance settings (desktop); full-screen tool with sticky action row (mobile) — replacing the current step-by-step flow's density issues named in Phase A.
- **Exact source components**: `FE/src/components/mindmap/ExportStudioDialog.jsx`. **Explicitly NOT touched**: `FE/src/utils/mindmapImageExport.js`'s capture/rasterization logic, `pdf_serializer.py` — this round is UI-only around an unchanged export pipeline.
- **Agent owner**: Codex 1 (built and selected this alternative with written rationale), Agy reviews specifically for the live-preview/export-sandbox isolation boundary it audited in Task 2 (`08-independent-agy-review.md` §4.4 Risk 3) — this is the one round where a design mistake could silently corrupt real exported files, so it gets the most scrutiny.
- **Worktree**: `.worktrees/phase-c-round5-export`, no file overlap with Round 4.
- **State/data contracts**: zero change to export scope selection, format gating, or appearance persistence logic — this round only restyles the dialog shell and preview presentation around existing state.
- **Test plan**: `npm test -- src/components/mindmap/ExportStudioDialog.*` must stay green unmodified (proves the restyle didn't touch logic); `python -m pytest BE/tests/test_mindmap_export_*.py` as a smoke check even though this round shouldn't touch the backend at all — if it fails, scope crept.
- **Screenshot parity gates**: all format/scope/appearance states Codex 1 already mocked in `03-visual-mockups/surfaces.html`, both the Preview Bench default and the retained Guided Steps alternative if the user asks to keep it documented.
- **Accessibility gates**: destructive-action confirmation gate behavior (explicit checkbox before delete) and dialog focus trap must be re-verified unchanged, not just visually similar.
- **Responsive breakpoints**: 1440/390/320 (820 is explicitly lower-priority for this surface per Phase B's own coverage table, `07-responsive-interaction-spec.md` §1).
- **Regression blast radius**: medium — real user data (exported files) is the actual product of this dialog; a presentation bug here is higher-stakes than elsewhere even at "visual-only" scope.
- **Rollback**: revert the dialog shell; since export logic is untouched, this is safe at any point.
- **PR dependencies**: Round 2 (tokens). Independent of Rounds 3/4. **Blocked on user's Preview Bench vs Guided Steps decision.**

### Round 6 — Document Library consolidation (Alternative B, pending sign-off, behind controlled rollout)

- **User-visible before/after**: 1,755 → ~227 desktop controls, 174 → 0 duplicate card instances, one canonical row per document with adaptive primary CTA, quick actions, and a More sheet — the single highest-leverage AND highest-risk round.
- **Exact source components**: `FE/src/components/Layout/DocumentList.jsx`, `StudyCard.jsx`, `CollectionSidebar.jsx`, `StudyBreadcrumb.jsx`.
- **Agent owner**: Codex 2 (built and corrected this twice already, including the Task 1 filtering-semantics fix this session) as primary, Claude reviewing for regression against every "keep as contextual shortcut" verdict in `docs/ui-ux-audit-v4/05-duplication-matrix.md` (this round must not accidentally remove a legitimate shortcut while consolidating cards).
- **Worktree**: `.worktrees/phase-c-round6-library`, isolated from all map/export rounds.
- **State/data contracts**: the explicit source-of-truth state model now defined in `04-document-library-redesign/alternative-b-learning-action-matrix.md` (post-`f63a385`) — `doc.quizState`/`doc.summaryState`-equivalent real fields in production (`missing`, `ready`, `unknown`), where `needs_summary` and `needs_quiz` include only `missing` (excluding `ready` and `unknown`). Deterministic 4-step projection pipeline: search query → collection filter → task-view eligibility predicate → stable sort. Shared tab counts base: tab badge counts must derive from the search+collection base prior to task-view filtering, guaranteeing count parity with rendered rows. The `useStudyContext` stem/UUID transition contract from the same document. Synchronous bulk-selection pruning on every filter/search/view change (`pruneSelection(visible)` closing Hazard 1). Unified dispatcher invariant (Hazard 3): all three action tiers (primary CTA, quick actions `Tóm tắt`/`Sơ đồ`, More sheet) must dispatch strictly through `useOpenSurface(doc, surface)` and `duongDi()`; no component may hand-craft URLs. Return-navigation state preservation (Hazard 2): task view, filter, query, and scroll offset retained in URL query parameters or sessionStorage across browser Back.
- **Test plan**: new unit tests for the task-view filter predicates (mirroring the prototype's now-corrected `matchesView()` logic), tab count badge derivation tests, roving-tabindex keyboard navigation tests, bulk-selection pruning tests, and navigation dispatcher routing tests — all five demonstrated in the prototype's Playwright verification suite.
- **Screenshot parity gates**: desktop/mobile at all 4 task views (all/continue/needs_quiz/needs_summary) plus the empty state, matching `04-document-library-redesign/evidence/`.
- **Accessibility gates**: 44×44px mobile touch targets (measured, not assumed — matching the prototype's own verification method), WAI-ARIA roving tabindex on primary buttons only (not the row container), modal bottom sheet `inert`+focus-trap+Escape-restore.
- **Responsive breakpoints**: desktop 1440, mobile 390 — this surface's own coverage table (`07-responsive-interaction-spec.md` §1) doesn't include 820/320 for the library specifically; add them if the rollout reveals a gap.
- **Regression blast radius**: HIGH — changes real DOM structure, selection state, and bulk-action semantics on the one surface most users touch most often.
- **Rollback strategy** (unchanged from the original audit's Round 5 recommendation, still the right call): land behind a feature flag if tooling supports it; keep the current `DocumentList.jsx` render path available in version control for one full release cycle before deleting it.
- **PR dependencies**: Round 2 (tokens). Independent of Rounds 3/4/5 at the code level, but should land after them in practice so reviewer attention isn't split across the highest-risk round and everything else simultaneously. **Blocked on user's Alternative A vs B decision**, and should be the LAST visual round implemented, not the first, despite having the most dramatic numbers — exactly per `09-risk-and-migration-plan.md` §2's existing recommendation.

### Round 7 — Quiz, Results, Review, and remaining shared surfaces

- **User-visible before/after**: populated Quiz taking/results/review states (currently only error states exist in the Phase A audit evidence), Account/Profile/shared-dialog visual refresh.
- **Exact source components**: Quiz taking/results/review components (paths not yet enumerated in this session — need a fresh `Explore` pass at implementation time since Phase B's mockup worked from representative sample data, not a live component audit), `AccountMenu.jsx`, profile page, `Modal.jsx`-based shared dialogs.
- **Agent owner**: Codex 1 (built the quiz/surfaces mockups).
- **Worktree**: `.worktrees/phase-c-round7-quiz-surfaces`.
- **State/data contracts**: none new for Account/Profile/dialogs (visual-only). Quiz populated-state verification depends on the Round 7 seeded-fixture gap already named in `docs/ui-ux-audit-v4/02-route-screen-state-matrix.md` and `07-responsive-interaction-spec.md` §5 — this implementation round cannot be fully screenshot-verified against real data until that fixture exists; mocked sample data is an acceptable substitute for the visual work itself, not for final sign-off.
- **Test plan**: existing Quiz/Account/Profile test suites must stay green; the seeded-fixture work (if prioritized) unblocks real-data verification.
- **Screenshot parity gates**: matching `03-visual-mockups/quiz.html` and `surfaces.html`'s already-rendered evidence.
- **Accessibility gates**: WAI-ARIA radio group semantics (Quiz taking, already correct in the mockup per Agy's review), destructive confirmation gate (shared dialogs).
- **Responsive breakpoints**: all 4 for Quiz; 1440/820-where-layout-critical/390/320 for Account/Profile per the existing coverage table.
- **Regression blast radius**: low-medium, mostly isolated visual surfaces.
- **Rollback**: straightforward revert, no data model changes.
- **PR dependencies**: Round 2 (tokens). Fully independent of Rounds 3-6; can run in parallel with any of them.

### Round 8 (renumbered from the original backlog's Round 6) — Full responsive and accessibility regression audit

- **Scope**: re-verify every fix from Rounds 2-7 at all 10 brief-specified viewports (1920×1080 down to 320×568) in both themes, with specific re-confirmation of the 768-800px danger zone across every surface that gained a fixed-width side element in this phase (Document Library filter drawer, Export Studio settings column, ContextInspector) — not just the MindMap toolbar that already proved this breakpoint needs explicit checking, not assumption.
- **Audit methodology & automated harness**: automated headless Playwright test scripts executing:
  1. `document.elementFromPoint` hit-testing for zero pointer occlusion and positive clearance (>0px) at the 768-800px boundary.
  2. Bounding geometry checks (`scrollWidth <= clientWidth`) verifying zero horizontal clipping down to 320px across all surfaces.
  3. Automated WCAG AA contrast verification across light and dark modes.
  4. WAI-ARIA keyboard focus traps, roving tabindex on button targets, and Escape key restoration.
  5. Regression test suite execution: `npm test -- src/utils/mindmapImageExport.test.js`, `npm test -- src/components/mindmap/ExportStudioDialog.*`, `python -m pytest BE/tests/test_mindmap_export_*.py`, and `playwright test e2e-fixture/mindmap-toolbar-occlusion.spec.js`.
- **Agent owner**: Agy leads (independent reviewer role carries through to this final gate). Agy delivers an evidence-backed audit verdict report with RED/GREEN proof dumps; if a regression is found, Agy isolates exact DOM coordinates and files an actionable report for the respective round owner, preserving file ownership boundaries.
- **Worktree**: `.worktrees/phase-c-round8-regression-audit`, read/test-only — should not need its own source changes unless the audit finds something.
- **PR dependencies**: all of Rounds 2-7 merged.

## Cross-cutting rules (apply to every round)

1. **Non-overlapping worktrees, enforced by file ownership, not just branch names** — the table above lists exact source components per round specifically so two rounds never touch the same file simultaneously.
2. **Guarded invariants are out of scope for every round above** (see top of this document) — only a future, separately-scoped Option C initiative would touch the `useStudyContext` engine-unification question, and that is not what any round here does.
3. **Small, reviewable PRs** — each round is itself further splittable if its own diff grows large (e.g., Round 6's task-view filtering could be its own PR ahead of the row-layout change).
4. **Every round's PR description must link back to the specific Phase B artifact it implements** (mockup file, design-token entry, prototype commit) so a reviewer can diff the implementation against the already-approved-pending-signoff design, not re-litigate the design in code review.
5. **No round merges or deploys without the explicit per-round and overall gates in this document being green** — matching the existing project's standing practice (confirmed throughout this session: Round 0's own three-iteration toolbar fix only shipped once real CI was green, not once a mockup looked right).

## What this plan does not decide

The two items in `10-design-approval-package.md` §4 remain the user's decision, not pre-committed by this plan's Round 5/6 framing. If the user picks Alternative A over B, or Guided Steps over Preview Bench, only those two rounds' "exact source components" and "screenshot parity gates" sections need updating — the rest of this plan, the ordering, and the cross-cutting rules are unaffected.
