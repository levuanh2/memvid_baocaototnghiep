# 06 — Design Tokens & Component Specification (Phase B, Claude — UX Lead)

This consolidates the token and component language that emerged independently across all three agents' real prototypes — Codex 1 (`03-visual-mockups/workspace.css`, `surfaces.css`, `quiz.css`, `library-integration.css`), Codex 2 (`04-document-library-redesign/prototype-alternative-b.html`), and Agy (`05-shared-map-visual-grammar/visual-grammar-spec.md`). It is not a new invention: the same hex values and radii turned up independently in all three bodies of work because all three were explicitly briefed (`01-option-b-design-principles.md`) to build on the shipped blue identity rather than invent one. This document names that convergence as the canonical spec.

## 1. Canonical color tokens

Agy's table (`05-shared-map-visual-grammar/visual-grammar-spec.md` §1) is adopted as the source of truth — it is the most complete (adds `--bg-hover`, `--accent-subtle`, `--text-secondary`, `--border-strong`, `--seal`) and the only one with measured contrast ratios. Codex 1's independently-built token tables in the workspace/surfaces/quiz batches use the same hex values for every overlapping role, confirmed by direct diff, not just by eye:

| Token | Light | Dark | Role |
|---|---|---|---|
| `--bg-base` | `#F4F8FC` | `#15233B` | Canvas / page background |
| `--bg-card` | `#FFFFFF` | `#1B2C49` | Elevated surface (cards, dialogs, dropdowns) |
| `--bg-hover` | `#EBF2FA` | `#23385D` | Interactive hover feedback |
| `--accent` | `#126CF2` | `#6EA8FF` | Primary action color, 4.8:1 / 7.1:1 vs canvas |
| `--accent-hover` | `#0059D6` | `#8CB9FF` | Primary button hover/active |
| `--accent-subtle` | `#EAF3FF` | `#1C3259` | Selection halo, chip fill, badge background |
| `--text-primary` | `#102A5D` | `#ECE7DB` | Headings, primary labels — 11.5:1 / 12.2:1 |
| `--text-secondary` | `#334E68` | `#C4D1E5` | Body copy, secondary labels — 7.2:1 / 8.6:1 |
| `--text-muted` | `#587095` | `#AFC1DD` | Metadata, captions — 4.6:1 / 6.2:1 |
| `--border-color` | `#D2DFED` | `#2D3E5D` | Default card/input border |
| `--border-strong` | `#9BB5D1` | `#41577D` | Emphasized border, dialog frame |
| `--err` | `#F1333A` | `#D86A53` | Errors, destructive actions — already distinct from accent |
| `--seal` | `#B23A2E` | `#E06D53` | Reserved for citation/provenance marks only — never reused as a generic accent |

Branch/section color cycling (mind-map section colors, StudyMap cluster colors) uses Agy's 8-stem palette (`05-shared-map-visual-grammar/visual-grammar-spec.md` §1), calibrated to stay distinct from `--err` and `--seal`.

**Two unfinished-migration items any implementation must close** (carried from `01-option-b-design-principles.md`, confirmed still present): `mindElixirTheme.js`'s selection ring pointing at `--forest` instead of `--accent`, and a hardcoded seal-red hex surviving in `AccountMenu.jsx`. Both are explicitly named `DEPRECATED` in Agy's spec (§5.3).

## 2. Typography

- **UI sans stack** (controls, nav, labels, graph nodes): `Aptos, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`.
- **Reading serif** (Chat answer body, Summary pane, account headings): `Georgia, serif` (Codex 1) / `Spectral, Georgia, serif` (Agy's spec for any long-form reuse) — reserved for long-form reading only. `StudyMapView.jsx`'s current hardcoded serif on graph node labels is a defect per Agy's spec (§3) and must move to the sans stack for parity with MindMap.
- **Mono** (IDs, stems, technical metadata): existing `"IBM Plex Mono"` usage is unchanged by Phase B.
- Scale actually used across the real prototypes: 22px (dialog/page h2) → 17-18px (section h1/h2) → 13-14px (card titles, primary labels) → 11px (secondary labels, legends) → 9-10px (captions, metadata, help text). No prototype introduces a size outside this range.

## 3. Radius scale

Measured directly from the shipped CSS across all batches (`surfaces.css`, `workspace.css`, `library-integration.css`, `visual-grammar-spec.md` node table) — this is a real convention already in consistent use, not a proposal:

| Radius | Used for |
|---|---|
| `50%` | Avatars, circular icon buttons, map node anchors |
| `14px` | Dialog/modal outer frame (`.export-dialog`, `.guided-dialog`, `.shared-dialog`) |
| `12px` | Panel-level cards (`.account-menu`, `.profile-form`) |
| `8-9px` | Standard buttons, inputs, choice cards, format-grid tiles, root/section map nodes |
| `6-7px` | Compact pills, segmented-control items, badges |
| `4-5px` | Small chips, concept-level map nodes |

One deliberate asymmetric exception, reused across the brand mark and the account "welcome" mark: `10px 10px 10px 3px` (or `14px 14px 14px 4px` at larger size) — a rotated, stamp-like corner that is part of the existing brand identity (`--seal`-adjacent), not an error.

## 4. Spacing

No new spacing scale is introduced. Observed spacing across all real prototypes clusters on a loose 4px rhythm: `4, 6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 22, 24, 28px`, with component padding typically `8-18px` and gaps between siblings typically `6-14px`. This matches the existing product's spacing (no `--space-*` token scale exists in the shipped app today, and Phase B does not propose adding one — it would be a larger token-system change outside Option B's scope).

## 5. Core component specs (as built, not proposed)

Each spec below cites the real file it was measured from — implementation should treat these as the contract, not re-derive them.

**Button** (`surfaces.css` `.export-foot button`, `.primary-action`): height 40-42px, padding `0 14-16px`, radius 8px, border `1px solid var(--border-strong)` (secondary) or none with `background: var(--accent)` + white text (primary). Disabled state: `opacity: .45`.

**Icon button** (`workspace.css` `.icon-button`): 40×40px (desktop) / ≥44×44px (mobile, per Agy's touch-target floor), radius 9px, transparent background, `color: var(--text-muted)`, hover → `var(--bg-hover)`.

**Card / dialog frame**: radius 12-14px, `border: 1px solid var(--border-strong)`, `background: var(--bg-card)`, `box-shadow: 0 25-28px 70px rgba(6,17,34,.35)` for floating dialogs; no shadow for in-flow cards (border does the separation).

**Input**: height 42-43px, radius 8px, `border: 1px solid var(--border-color)`, `background: var(--bg-base)` (sits on card, not on canvas), `color: var(--text-primary)`; disabled → `color: var(--text-muted)`.

**Choice/selection card** (`.choice-card`, `.format-grid button`, `.theme-choice`): unselected → `1px solid var(--border-color)`; selected → `2px solid var(--accent)` + `background: var(--accent-subtle)`. This exact pattern is the canonical "selected" treatment — reused identically for export format pickers, theme choice, and (per Agy's spec) map node selection halos. One selection language across the whole product.

**Segmented control** (`.segmented`): track `background: var(--bg-base)`, `border: 1px solid var(--border-color)`, radius 8px; active segment `background: var(--bg-card)` + `color: var(--accent)` + subtle shadow — not a filled-accent tab, to stay legible against both themes without a second accent weight.

**Danger/destructive** (`.danger-zone`, `.confirm-check`, `.danger-action`): uses `color-mix(in srgb, var(--err), transparent 90-94%)` for the tinted background rather than a separate "light red" token — keeps the error palette to the one `--err` variable at different opacities instead of proliferating red shades.

**Avatar**: 40-56px depending on context, `border-radius: 50%`, `background: var(--accent-subtle)`, `color: var(--accent)`, bold initials.

## 6. Map-specific tokens and component rules

Not duplicated here — see `05-shared-map-visual-grammar/visual-grammar-spec.md` in full for the 4-tier node hierarchy, connector geometry table, interaction state machine, canvas dot-lattice background, and mobile legibility floors. That document is itself part of this canonical spec, scoped to the two map engines.

## 7. What is explicitly NOT part of this token set

- No new spacing-scale tokens (§4).
- No new color outside the 13 tokens in §1 plus the 8-stem branch palette — any component needing a color not listed here should be flagged in review, not invented inline.
- `--seal` stays reserved for citation/provenance marks; it is not a second accent.
