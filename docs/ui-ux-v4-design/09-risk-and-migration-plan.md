# 09 — Risk & Migration Plan (Phase B, Claude — UX Lead)

This is a design-readiness risk assessment, not an implementation plan — `11-phase-c-implementation-plan.md` is the canonical execution sequencing (`docs/ui-ux-audit-v4/10-prioritized-backlog.md` is retained as historical Phase A audit context only). This document says what in Phase B's deliverables is low-risk to implement as-is, what needs a spike before implementation starts, and what must not be touched regardless of how good the mockup looks.

## 1. Guardrails that stayed intact (verified, not assumed)

All three agents were briefed on the Round 0 guardrails in `01-option-b-design-principles.md` and each one's deliverable explicitly confirms compliance, independently:

- **`WorkspaceContainer` simultaneous mounting** — Codex 1's workspace mockup README states explicitly it "preserves simultaneous Chat/MindMap/Summary mounting... does not imply route remounting."
- **`useStudyContext` dual identity (stem vs UUID)** — Codex 2's Alternative B ships an explicit state-transition contract against this constraint (`04-document-library-redesign/alternative-b-learning-action-matrix.md`), not an assumption that stem and UUID are interchangeable.
- **Exact-node Export V3 fidelity** — Agy's map visual grammar spec has a dedicated "Export-fidelity guardrail" section (§ in `05-shared-map-visual-grammar/`), and Codex 1's maps batch README restates it: the mockup "changes the proposed live node grammar only... does not propose changing node identity, connector topology, export selection markers, offscreen capture, or Exact-node Export V3 geometry."
- **Zero Framer Motion** — no prototype across any of the three agents' work introduces a motion library; all transitions are plain CSS.

## 2. Risk tiers by deliverable

### Low risk — token/color/typography pass
Applying the §06 canonical tokens to fix the known unfinished-migration seams (forest selection ring in `mindElixirTheme.js`, hardcoded seal-red in `AccountMenu.jsx`, undeclared `--font-display`/`--font-mono`) is a pure find-and-replace against values every prototype already converged on independently. No state logic touched. Matches Round 2 of the existing backlog.

### Low-to-medium risk — MindMap/StudyMap visual parity
Agy's visual grammar spec is additive CSS/rendering-constant changes to node fill, border, connector stroke, and selection treatment inside two already-isolated components. The explicit export-fidelity guardrail (§1) is the one thing to verify empirically before merging, exactly as Round 4 of the existing backlog already requires — this is not new risk, it is the same risk the backlog already scoped and gated behind the export parity test.

### Medium risk — Export Studio / Quiz / Account-profile surface refresh
Codex 1's surfaces and quiz batches are visual-only re-skins of existing, already-functional flows (export wizard steps, quiz taking/results/review, account/profile panels, shared dialogs). The interaction model (which step comes after which, what a given button does) is unchanged in every mockup — only the visual treatment, density, and responsive breakpoints change. Risk is almost entirely in CSS regression (breakpoints, z-index, focus order), not in logic.

### Medium-to-high risk — Document Library consolidation
This is the one Phase B deliverable that changes actual DOM structure and interaction surface area, not just visual treatment. Codex 2's own risk/rollout section (`04-document-library-redesign/alternative-b-learning-action-matrix.md`) is the authoritative source — summarized here:
- **Real win, independently measured, not estimated**: 1,755 → 227 desktop controls, 1,750 → 221 mobile controls, 174 duplicate card instances eliminated to 0, across 42 real documents from a live account.
- **What stays the same**: one-click Summary + MindMap actions, UUID-backed selection, roving-tabindex keyboard navigation, 44×44px mobile targets, an explicit state-transition contract against the `useStudyContext` stem/UUID split.
- **What actually changes**: row/card DOM structure, the primary CTA becomes adaptive to task-view intent instead of static, secondary actions move into a labelled "More" surface, mobile gets a modal bottom sheet (inert + focus-trapped) instead of inline secondary actions.
- **Rollout recommendation** (inherited from `10-prioritized-backlog.md` Round 5, still valid): land behind a feature flag if the team's tooling supports it; keep the current `DocumentList.jsx` render path available in version control for one release cycle before deleting it. This is the highest-leverage AND highest-risk item in the whole Option B scope — it should not be the first thing implemented, even though it has the most dramatic before/after numbers.

## 3. What needs a spike before implementation, not just a code review

- **StudyMapView's hardcoded serif font drop** (Agy §3): confirm no downstream consumer (PDF/image export of a StudyMap, if one exists) depends on the current font metrics before changing it.
- **Document Library's modal bottom sheet on mobile**: verify the inert/focus-trap behavior against the existing `ContextPanelCloseButton` dual-mode pattern so Phase B doesn't introduce a THIRD close-button behavior alongside Chat-mode and MindMap-mode.
- **Export Studio's "preview bench" mobile layout** (full-screen tool, sticky action row): verify it doesn't collide with the same mobile-drawer backdrop/z-index stack that Round 0's toolbar occlusion fix just hardened (`.mindmap-tools-overlay`, `.context-inspector-shell`, the z-30 backdrop) — same class of bug, different surface, worth a deliberate check rather than assuming independence.

## 4. Design decisions — resolved; implementation authorization — still open

Both design decisions flagged here were resolved by explicit user approval on 2026-10-25 (`10-design-approval-package.md` §4):

- **Export Studio: Preview Bench — APPROVED** over Guided Steps. Guided Steps remains documented as a possible future first-run mode, not an approved implementation target.
- **Document Library: Alternative B (Learning Action Matrix) — APPROVED** over Alternative A, with Codex 2's own written rationale.

What remains genuinely open is a separate question: **whether and when to authorize Phase C implementation itself.** Design approval is not implementation authorization — see `11-phase-c-implementation-plan.md`'s Status gate.

## 5. Phase A backlog superseded by the Phase C plan

`docs/ui-ux-audit-v4/10-prioritized-backlog.md`'s Round 2 (tokens), Round 4 (map parity), and Round 5 (library consolidation) descriptions predated Phase B's actual built proposals and were written as open scope. That bookkeeping pass is done: `11-phase-c-implementation-plan.md`'s Round 2/4/5/6 sections now point at the specific Phase B artifacts (§06 tokens, `05-shared-map-visual-grammar/`, `04-document-library-redesign/alternative-b-learning-action-matrix.md`) directly. The Phase A document is retained as historical audit context, not as the active plan.
