# 10 — Design Approval Package (Phase B, Claude — UX Lead)

**Status: ready for user review and direction approval. Nothing proposed here has been implemented, merged, or deployed.**

Baseline: `main` @ `fb0c2f4` (Round 0 merged and live in production: nav link, toolbar/Inspector occlusion fix). This package consolidates Phase B's design-only work across three independently-coordinated agents into one approval-ready set.

## For the user — plain summary

Round 0 (the two most urgent bugs) already shipped and is live. This package is the next layer: real, inspectable mockups — not descriptions — for every major screen, a resolved design for the 823-control document library clutter, and a shared visual language so Mind Map and Study Map stop looking like two different apps. An independent reviewer (Agy) challenged every proposal, found real problems, and tracked each one to a fix before signing off. Nothing here has been built into the real app yet — these are prototypes you can open in a browser and click through, waiting on your go-ahead.

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

**Correction (post-review, self-flagged):** the "Primary CTA text mismatched the active filter's intent" fix above was verified for *label text* (confirmed 100% of rows relabel correctly) but not for *result-set membership* — a direct code read after this review found `visibleDocs()` never actually filtered the `needs_summary`/`needs_quiz` task views; they showed all 42 documents regardless of eligibility, only the button label changed. This is the exact mistake the brief warns against: an independent review passing doesn't make every prototype behavior correct. Fix in progress, tracked in a later commit on this branch — see the updated `10-design-approval-package.md` revision history or `04-document-library-redesign/alternative-b-learning-action-matrix.md` for the corrected state model once it lands.

This full round-trip (built → independently challenged with evidence → fixed → re-verified) happened entirely inside this Phase B session, on real prototypes, before reaching this approval package.

## 4. Two decisions awaiting your explicit sign-off — recommended defaults, NOT approved by anyone on this team

Agy's and Codex's recommendations below are the team's best judgment, not a stand-in for the user's own decision. Nothing in this package should be read as these having already been approved.

- **Document Library — recommended: Alternative B (Learning Action Matrix)** over Alternative A (Canonical Learning Queue). B has 83 more visible controls (227 vs 144) but Agy's analysis (§5.2 of `08-independent-agy-review.md`) argues this is the right trade — A's lower count came from burying the app's core multi-modal actions (Mind Map, Summary) in a menu, creating real click penalty; B's density (5.4 controls/document) matches established patterns (Linear, Notion, GitHub PR lists) while still cutting production's 1,755 controls by 87%. **Not yet chosen by the user.**
- **Export Studio — recommended: Preview Bench** (persistent live paper preview alongside settings) over Guided Steps (one decision per screen). Guided Steps is retained as a possible future first-run mode, not discarded — worth an explicit decision on whether to keep it documented or drop it. **Not yet chosen by the user.**

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
- The Export Studio live preview's modern CSS (`color-mix()`, SVG filter drop-shadows) must stay strictly decoupled from the headless export rendering sandbox. **Correction:** an earlier version of this note and `08-independent-agy-review.md` incorrectly named `html2canvas` as the rendering library — the real pipeline (`FE/src/utils/mindmapImageExport.js`) uses `@zumer/snapdom`, confirmed by direct code read (zero `html2canvas` references exist anywhere in the codebase). Agy's Task 2 audit is verifying snapdom's actual feature support against the preview CSS and will replace this with a verified capability list rather than an assumption carried over from a different library.
- Document Library bulk-selection must be pruned against visible documents on every filter/search change, not left to silently act on hidden selections.
- Document Library return-navigation (task view, filter, scroll position) must survive a browser Back from `/app` or `/app/study`.
- All three of Document Library's action tiers (primary CTA, quick actions, More menu) must route through the existing single navigation helper — no component may construct its own URL.

## 9. Round 1-7 execution order

Unchanged in sequence from `docs/ui-ux-audit-v4/10-prioritized-backlog.md`; its Round 2/4/5 scope descriptions should be updated to cite this Phase B's specific artifacts once a direction is approved (see `09-risk-and-migration-plan.md` §5 for exactly which fields to update).

## 10. What happens next

Per the brief's stop condition: this package, the prototypes, and all supporting documents are pushed to the `docs/ui-ux-v4-design` branch. No merge, no deploy, no Round 1-7 implementation has begun. The user reviews the prototypes directly (§1), decides on the two open alternatives (§4), and gives explicit approval of a direction before any production code changes.
