# 01 — Option B Design Principles (Phase B, Claude — UX Lead)

Baseline: `main` @ `fb0c2f4dec90b6bb8aea62e71e1aa9a63db2a1c3` (Round 0 merged: PR #87 nav link, PR #88 toolbar/Inspector occlusion). Source audit: `docs/ui-ux-audit-v4/09-redesign-options.md` §Option B, `08-independent-agy-review.md` §5 (UX-ADJ-001–020), `05-duplication-matrix.md`.

This is the shared brief every Phase B agent designs against. It is **design-only** — nothing here authorizes touching `FE/src/**` production code.

## What Option B actually is

Everything already shipped in Round 0 (nav link, toolbar occlusion), plus two structural moves that haven't started:

1. **Document Library consolidation** (UX-ADJ-007, the 823-control problem) — one canonical card per document, not the same record repeated across multiple progress sections.
2. **Map visual parity** — a shared visual grammar applied to both `MindElixirView.jsx` (mind-elixir engine) and `StudyMapView.jsx` (react-d3-tree engine), so a mind map and a study map read as dialects of the same visual language, **without unifying the two engines** (that's Option C, explicitly out of scope here).

Everything else audited and marked "keep as contextual shortcut" in `05-duplication-matrix.md` (Chat/MindMap/Summary multi-entry, Appearance/Export Studio dual controls, source search scoping, etc.) stays exactly as-is. Phase B is not a blank-slate redesign — it is closing two specific, evidenced gaps.

## Hard constraints (do not design around these)

Carried forward from `08-independent-agy-review.md` §6 and already proven load-bearing in Round 0:

- **`WorkspaceContainer`** mounts Chat/MindMap/Summary simultaneously and toggles via a `hidden` class — never propose separate route mounts; this is what preserves live canvas/LLM-stream state across tab switches.
- **`useStudyContext`** has a dual identity: it stores the document STEM string in `/app`, the UUID `document_id` in `/app/study`. A redesign that touches document identity across these two trees needs an explicit state-transition contract (Codex 2's §6 deliverable), not an assumption they're interchangeable.
- **`ContextPanelCloseButton`** has dual-mode behavior (Chat mode vs MindMap mode close differs) — any Inspector/sidebar redesign must specify both modes.
- **Zero Framer Motion.** The existing hand-tuned CSS transitions are a deliberate choice, not a gap.
- **Exact-node export V3** (MindMap export pixel/geometry fidelity, hardened across several prior rounds including this session's connector-opacity fix) must not regress. Any visual change to `MindElixirView.jsx`'s node/connector rendering needs an explicit note on export-fidelity risk.

## Visual foundation

Use the current shipped identity as the starting point — do not introduce a fourth palette on top of the three the product has already cycled through (seal-red "Phòng Đọc" → forest "Paper & Graphite" → the current blue):

- `--accent: #126CF2` / `--accent-hover: #0059D6` / `--accent-subtle: #EAF3FF` (light)
- `--bg-base: #F4F8FC` (light) / `#15233B` (dark)
- `--text-primary: #102A5D` (light) / `#ECE7DB` (dark)
- `--err: #F1333A` (light) / `#D86A53` (dark) — already distinct from accent, do not collapse them back together
- Known unfinished-migration seams to close as part of any component the mockups touch: `mindElixirTheme.js`'s selection ring still points at `--forest` instead of `--accent`; a hardcoded seal-red hex survives in `AccountMenu.jsx`; `--font-display`/`--font-mono` are referenced but never declared as tokens.

## What "done" looks like for each agent

- **Codex 1** — real, inspectable visual mockups (prototype HTML/CSS or a design tool export, not prose) for the 8 required screen groups, light+dark, desktop/tablet/mobile, with a chosen candidate and written reasoning for the areas with multiple viable layouts.
- **Codex 2** — ≥2 real layout alternatives for Document Library with BEFORE evidence, AFTER desktop+mobile mockups, a wireflow, a component-ownership map, a state-transition contract against the `useStudyContext` dual-identity constraint above, and a **measured** (not estimated) control count — built or prototyped, then counted, not guessed.
- **Agy** — a shared visual spec for node hierarchy/connectors/color/typography/selection that both `MindElixirView.jsx` and `StudyMapView.jsx` can adopt as-is (no engine change), with explicit call-outs for what must stay engine-specific and what risks MindMap export fidelity; then an independent, evidence-based critique of Codex 1 and Codex 2's proposals once they land.

## What Claude (this doc's author) owns

Route/screen/state matrix (already exists, §02 above), final design-token spec (`06`), responsive/interaction spec synthesizing the other three agents' work (`07`), risk/migration plan (`09`), and the final approval package (`10`) — produced only after the other three deliverables exist, not in parallel guesswork.

## Non-negotiables restated from the user's authorization

Design-only. No `FE/src/**` changes, no UI refactor, no merge, no deploy, no Round 1–7 implementation. Everything lands on `docs/ui-ux-v4-design` branch in an isolated worktree. A draft PR may be opened for review; it does not get merged without explicit user approval of a direction.
