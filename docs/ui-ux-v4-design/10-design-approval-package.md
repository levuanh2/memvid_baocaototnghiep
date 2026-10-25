# 10 — Design Approval Package (Phase B, Claude — UX Lead)

**Status: DESIGN APPROVED, IMPLEMENTATION NOT YET AUTHORIZED.** PR #89 (this documentation package itself) merged to `main` at `8a56db7` on 2026-10-25 — that merge landed design documents and prototypes only (`docs/ui-ux-v4-design/**`), not a single line of `FE/src` or `BE` application code. No Phase C implementation round has started, no production UI has changed, nothing has been deployed. See §4 for the two decisions the user approved and §9 for what approval does and does not authorize.

Baseline: `main` @ `fb0c2f4` (Round 0 merged and live in production: nav link, toolbar/Inspector occlusion fix). This package consolidates Phase B's design-only work across three independently-coordinated agents into one approval-ready set.

## For the user — plain summary

Round 0 (the two most urgent bugs) already shipped and is live. This package is the next layer: real, inspectable mockups — not descriptions — for every major screen, a resolved design for the 823-control document library clutter, and a shared visual language so Mind Map and Study Map stop looking like two different apps. An independent reviewer (Agy) challenged every proposal, found real problems, and tracked each one to a fix before signing off. You've since approved both open design decisions (§4) and this documentation package itself has merged — but that merge only landed documents and prototypes, nothing in the real app. These are still prototypes you can open in a browser and click through; implementation (Phase C, `11-phase-c-implementation-plan.md`) hasn't started and needs its own separate go-ahead.

## 1. What to actually look at

| What | Where | How to view it |
|---|---|---|
| Global nav + Workspace (Chat/sidebar/Inspector) | `03-visual-mockups/workspace.html` | Open in a browser; `?theme=light\|dark&layout=desk\|focus` |
| MindMap + StudyMap shared visual language | `03-visual-mockups/maps.html` | `?screen=mindmap\|studymap&theme=light\|dark` |
| Export Studio, Account, Profile, shared dialogs | `03-visual-mockups/surfaces.html` | `?screen=export\|export-guided\|account\|profile\|dialog-generate\|dialog-delete` |
| Quiz taking/results/review | `03-visual-mockups/quiz.html` | `?screen=taking\|results\|review` |
| Document Library — Alternative A | `04-document-library-redesign/prototype-alternative-a.html` | Open directly |
| Document Library — Alternative B (**selected**) | `04-document-library-redesign/prototype-alternative-b.html` | Open directly |
| Rendered screenshots (no browser needed) | `03-visual-mockups/screenshots/`, `04-document-library-redesign/evidence/` | View as images |

Every prototype is self-contained inspectable HTML/CSS — not a markdown description, not the existing UI with a new label (per the brief's own quality gate).

## 2. Executive assessment

Three independent workstreams, each with real measured evidence, converged on one coherent visual and architectural system without being told to match each other:

- **Codex 1** (visual mockups, all 8 required screen groups): Learning Desk workspace layout, shared map grammar applied to both engines, Export Studio preview-bench, populated Quiz journey, library visual-language integration. Full responsive coverage (1440/820/390/320px) in both themes.
- **Codex 2** (Document Library): two real alternatives, Alternative B (Learning Action Matrix) selected with written rationale — 1,755 → 227 desktop controls (−87.1%), 174 → 0 duplicate card instances, 210/210 mobile touch targets meeting the 44×44px floor, all measured against a real prototype, not estimated.
- **Agy** (shared map visual grammar + independent review): a full token/hierarchy/connector/state spec both map engines can adopt without an engine change, plus an adversarial review of Codex 1 and Codex 2's work that found and tracked 10 real defects to resolution across both agents' checkpoints — not a rubber stamp.

**Agy's final verdict** (full detail in `08-independent-agy-review.md` §6.2): *"APPROVED WITHOUT BLOCKERS for Phase C implementation planning."*

## 3. What changed because of independent review (proof this wasn't a rubber stamp)

| Found by Agy | In | Fix | Verified in |
|---|---|---|---|
| Tablet right panel hardcoded to 292px, violating the 320px Inspector floor | Codex 1 workspace checkpoint 1 | Grid updated to reserve 320px | `61056bb` |
| Fixed mobile bottom dock collides with the software keyboard | Codex 1 workspace checkpoint 1 | Dock removed, context moved to header | `61056bb` |
| Arbitrary token names (`--canvas`, `--ink`, `--accent-soft`) | Codex 1 workspace checkpoint 1 | Normalized to canonical `--bg-*`/`--text-*`/`--accent-*` | `61056bb` |
| Routine Mind Map/Summary access buried in a dropdown, 100% click-penalty | Codex 2 Alternative A | Direct 1-click Quick Action Cluster added in Alternative B | `5d9876a` |
| Primary CTA text mismatched the active filter's intent | Codex 2 Alternative A | Adaptive `primaryActionFor(view, doc)` | `5d9876a` |
| Focusable row `<div>` wrapping native interactive children (WAI-ARIA violation) | Codex 2 Alternative A | Row unfocusable; roving tabindex moved to primary buttons only | `5d9876a` |
| Single-line title truncation unreadable for long academic titles | Codex 2 Alternative A | 2-line clamp with accessible tooltip | `5d9876a` |
| Mobile popover menu collided with adjacent cards | Codex 2 Alternative A | Portalled modal bottom sheet, inert background, focus trap | `5d9876a` |

**Correction (self-flagged, now fixed and independently re-verified):** the "Primary CTA text mismatched the active filter's intent" fix above was originally verified for *label text* only (100% of rows relabeled correctly) but not for *result-set membership* — a direct code read found `visibleDocs()` never actually filtered the `needs_summary`/`needs_quiz` task views; they showed all 42 documents regardless of eligibility, only the button label changed. Fixed in `f63a385`: `doc.quizState`/`doc.summaryState` are now real per-document state fields, `matchesView()` filters by them, tab counts are computed from the same predicate the list uses (so they can't drift apart), and `pruneSelection()` strips hidden document ids from the selection set on every render (closing Hazard 1 for real, not just on paper). Independently re-verified by Agy (`79eaf93`, `08-independent-agy-review.md` §5.4) with concrete counts: Needs Summary → 36/42 (doc-1 correctly excluded, already has a summary), Needs Quiz → 35/42, Continue → 1/42, selection pruning and empty-state/roving-focus behavior all confirmed. This is exactly the mistake the brief warned against — an independent review passing doesn't make every prototype behavior correct — caught by a direct code read, not by trusting the prior "RESOLVED" status.

This full round-trip (built → independently challenged with evidence → fixed → re-verified) happened entirely inside this Phase B session, on real prototypes, before reaching this approval package.

## 4. Design decision log — both decisions APPROVED by the user on 2026-10-25

- **Document Library: Alternative B (Learning Action Matrix) — APPROVED**, over Alternative A (Canonical Learning Queue). B has 83 more visible controls (227 vs 144) but Agy's analysis (§5.2 of `08-independent-agy-review.md`) argued this is the right trade — A's lower count came from burying the app's core multi-modal actions (Mind Map, Summary) in a menu, creating real click penalty; B's density (5.4 controls/document) matches established patterns (Linear, Notion, GitHub PR lists) while still cutting production's 1,755 controls by 87%. **Design approved. Implementation not yet authorized** — see Round 6 in `11-phase-c-implementation-plan.md`, which remains blocked on its own pre-implementation gates (feature-flag/rollback plan, shared-file sequencing with `BulkBar.jsx`/`CollectionSidebar.jsx`) independent of this design sign-off.
- **Export Studio: Preview Bench — APPROVED**, over Guided Steps (one decision per screen). **Guided Steps remains a documented alternative, not an approved implementation target** — retained in `03-visual-mockups/surfaces.html` as a possible future first-run mode, not scheduled for any round. **Design approved. Implementation not yet authorized** — see Round 5 in `11-phase-c-implementation-plan.md`, which remains blocked on its own pre-implementation gates (shared `Modal.jsx` sequencing with Round 7) independent of this design sign-off.

Option B (Balanced Workspace Redesign) remains the selected overall direction; this decision log only closes the two specific open choices under it, not a general go-ahead to start building.

## 5. Accessibility, carried forward not re-derived

Every surface inherits the accessibility floor already established and newly verified in this phase: WAI-ARIA-correct keyboard navigation (roving tabindex, radio groups, dialog focus traps with Escape-to-restore), 44×44px minimum touch targets (measured, not assumed), 320px Inspector floor preserved everywhere the Inspector appears, and the documented 768-800px breakpoint danger zone (see `07-responsive-interaction-spec.md` §2) explicitly checked rather than assumed safe.

## 6. Exact changes proposed, by component

See `06-design-tokens-and-components.md` for the full canonical token/radius/component spec (grounded in what all three agents independently converged on, not invented) and each individual deliverable folder for per-surface detail.

## 7. Risks to existing behavior

Full tiered breakdown in `09-risk-and-migration-plan.md`. Summary: token/color pass is low risk; map visual parity is low-medium (export-fidelity guardrail already explicit in every relevant deliverable); Export/Quiz/Account re-skins are medium risk (visual-only, no logic changes); Document Library consolidation is medium-high risk and the highest-leverage item — recommend feature-flagged rollout with the old `DocumentList.jsx` path kept available for one release cycle, per the existing `10-prioritized-backlog.md` Round 5 recommendation.

## 8. Unresolved design decisions and remaining implementation hazards

Not blockers — explicitly scoped for Phase C implementation planning, from Agy's independent review (§4.4, §5.3 of `08-independent-agy-review.md`):

- Mobile MindMap/StudyMap Inspector needs a "minimized peek" affordance when dismissed, rather than fully closing (avoids accidental re-pan/zoom on re-open).
- StudyMap SVG labels need multi-line wrapping or a defined truncation length for long (15-25 word) LLM-generated concept titles.
- The Export Studio live preview's modern CSS (`color-mix()`, SVG filter drop-shadows) must stay strictly decoupled from the headless export rendering sandbox. **Verified** (Agy's Task 2 audit, `08-independent-agy-review.md` §4.4 Risk 3, replacing an earlier incorrect `html2canvas` reference): the real pipeline (`FE/src/utils/mindmapImageExport.js`) uses `@zumer/snapdom`, which inlines computed styles, wraps the cloned DOM in an SVG `<foreignObject>`, and rasterizes via `<canvas>`. `color-mix()` resolves fine (browsers flatten it to `rgb()` during `getComputedStyle()`), but the pipeline has its own real constraints: a 16,384px browser canvas ceiling guarded client+backend at `MAX_CAPTURE_DIMENSION_PX = 12000` / `MAX_CAPTURE_PIXELS = 40_000_000` (confirmed present in `mindmapImageExport.js`), no external network resource loading inside the SVG image (fonts must be base64-inlined via `embedFonts: true` and pre-warmed), and detached custom CSS properties not inheriting from `:root` once cloned — appearance must inject resolved static values (`resolveExportAppearance()`). The offscreen export container must keep consuming resolved static values, not live CSS variables.
- Document Library bulk-selection must be pruned against visible documents on every filter/search change, not left to silently act on hidden selections.
- Document Library return-navigation (task view, filter, scroll position) must survive a browser Back from `/app` or `/app/study`.
- All three of Document Library's action tiers (primary CTA, quick actions, More menu) must route through the existing single navigation helper — no component may construct its own URL.

## 9. Round-by-round execution order

**`docs/ui-ux-v4-design/11-phase-c-implementation-plan.md` is now the canonical Phase C plan**, superseding `docs/ui-ux-audit-v4/10-prioritized-backlog.md`'s Round 2/4/5 scope descriptions (which predated Phase B's actual built proposals and are kept only as historical Phase A audit context, not as the active plan). `11-phase-c-implementation-plan.md` sequences Rounds 2-8 with exact source components, agent owners, isolated worktrees, test/screenshot/accessibility gates, regression blast radius, and rollback strategy per round — reviewed twice (Codex 1 for visual feasibility, Agy for architectural/export-pipeline correctness) with real file-path verification, not assumption.

## 10. What happens next

The two open decisions in §4 are now resolved (Alternative B, Preview Bench) and this documentation package (PR #89) has merged to `main` — but that merge is design-only: documents and prototypes under `docs/ui-ux-v4-design/**`, zero `FE/src` or `BE` changes. **Implementation approval is a separate, still-pending gate.** Starting any Phase C round requires: (1) the user's explicit go-ahead to begin implementation (not implied by the design approval above), and (2) the shared-file sequencing in `11-phase-c-implementation-plan.md`'s cross-cutting rule #1 being reconciled before any round touches `Modal.jsx`, `StudyShell.jsx`, `BulkBar.jsx`, or `CollectionSidebar.jsx` — several rounds consume these and must not edit them concurrently. No merge, no deploy, no Round 2-8 implementation has begun.
