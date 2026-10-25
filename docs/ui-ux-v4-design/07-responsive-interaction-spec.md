# 07 — Responsive & Interaction Spec (Phase B, Claude — UX Lead)

Synthesizes the responsive and keyboard/focus behavior documented across all three agents' deliverables into one cross-surface reference. Each rule below is sourced from a real deliverable, not newly invented here.

## 1. Viewport coverage actually built

Every Phase B surface was mocked and verified at the brief's required sizes — this is a coverage confirmation, not a new matrix (see `docs/ui-ux-audit-v4/02-route-screen-state-matrix.md` for the underlying Phase A route inventory):

| Surface | Desktop | Tablet | Mobile | Stress | Source |
|---|---|---|---|---|---|
| Global nav + Workspace | 1440×900 | 820×1180 | 390×844 | 320px | `03-visual-mockups/workspace.html`, `verify-mockups.mjs` |
| MindMap + StudyMap | 1440×900 | 820×1180 | 390×844 | 320px | `03-visual-mockups/maps.html`, `verify-maps.mjs` (14 states) |
| Export Studio + Account/Profile + dialogs | 1440×900 | 820×1180 (layout-critical only) | 390×844 | 320px | `03-visual-mockups/surfaces.html`, `verify-surfaces.mjs` (30 states) |
| Quiz taking/results/review | 1440×900 | 820×1180 | 390×844 | 320px | `03-visual-mockups/quiz.html`, `verify-quiz.mjs` (24 states) |
| Document Library | 1440×900 | — | 390×844 | — | `04-document-library-redesign/prototype-alternative-b.html`, `capture_prototype_b.py` |
| MindMap toolbar + Inspector (Round 0, already shipped) | 1440×900 | 1024×768, 768×1024, **768-800px shrink band** | 390×844 | — | `FE/e2e/mindmap-toolbar-occlusion.spec.js` (production) |

## 2. The 768-800px danger zone (already real, not hypothetical)

Round 0's own toolbar fix (merged, deployed, verified live in production) needed **three iterations** to get right specifically because the 768px breakpoint — where MainLayout's left rail is present but the Inspector hasn't yet become a mobile bottom sheet — has measurably less room than any of the named "tablet" or "desktop" viewports account for. Any Phase B surface that adds its own fixed-width side panel (Document Library's filters, if any; Export Studio's settings column) should be checked against this same breakpoint explicitly, not assumed safe because it passed at 1024px or 390px. This is the single most concrete lesson this whole Phase B effort should carry forward, and it is why Agy's visual grammar spec and Codex 1's library integration batch both explicitly re-state the Round 0 320px Inspector floor rather than treating it as settled.

## 3. Keyboard and focus behavior

- **Document Library** (Codex 2, Alternative B): roving-tabindex `ArrowDown`/`ArrowUp` navigation across rows, verified against the real prototype (not asserted). Mobile tool sheet is `inert` when closed and focus-trapped when open, with `Escape` restoring focus to the triggering control — matching the existing `Modal.jsx` focus-trap pattern already audited as a strength in Phase A, not a new pattern.
- **MindMap/StudyMap** (Agy): search-match and selection states both have a defined focus-visible treatment (dashed/solid accent ring per §5 of the visual grammar spec); mobile touch targets wrap node hit areas in an explicit 44px invisible tap zone rather than relying on the visual node size.
- **Export Studio / shared dialogs** (Codex 1): dialog frame follows the existing header/body/footer contract with one header close button; destructive confirmation (`delete-dialog`) requires an explicit checkbox acknowledgment before the red action enables — unchanged from current product behavior, only the visual density changes.

## 4. Theme behavior

Light/dark was built and captured for every surface except a handful of Export Studio/Account states explicitly marked as "layout-critical desktop only" in Codex 1's own coverage table (`03-visual-mockups/README.md` §Coverage index) — those are static forms where theme risk is negligible and tablet capture was judged not to add signal. No surface was left untested in dark mode entirely.

## 5. What this spec does not cover

Backend-dependent populated states (Quiz/Result/Review/Practice with real data) remain the one coverage gap already known from Phase A (`docs/ui-ux-audit-v4/02-route-screen-state-matrix.md`, scoped to backlog Round 7's seeded fixture). Codex 1's quiz batch mocks the populated journey visually using representative sample data — a reasonable design-phase substitute — but real-data verification still depends on that Round 7 fixture landing first.
