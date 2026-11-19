# V6 design specification

Status: **proposed**. V6 builds on [V5](../ui-ux-v5/02-design-foundation.md). It keeps V5's identity and tokens and changes how screens are composed.

## 1. Direction

V5 defined the materials: ink on paper, blue for action, the red seal for provenance. The live audit shows the weakness is not the palette. Screens **describe** instead of **show**, and they give every item the same weight.

V6 has one idea: **the product's own content is the design**. A screen earns its look from a real answer with its citation, a real map, a real question, set with enough room and a clear order. Decoration that carries no content is removed.

## 2. Kept from V5, unchanged

- Brand mark, wordmark, favicon rules.
- Colour roles: `--accent` is the only action colour; `--seal` is only for citations, evidence and the brand; `--forest` is only for success and progress.
- Type families: Spectral (display and reading), Inter (interface), IBM Plex Mono (figures only).
- Approved names: "Tải tài liệu lên", "Công cụ học", "Sơ đồ tư duy", "Bản đồ kiến thức", "Xem lại câu chưa đúng", "% điểm".
- 12px minimum interface text (provisional), 44px touch targets below 768px, font resilience, focus handoff at breakpoints, `inert` on hidden panels.
- Internal identifiers (`memvid-*` storage keys).

## 3. New in V6

### 3.1 Composition rules

1. **Show a specimen, not a placeholder.** Any illustration of the product uses plausible study content (a question, an answer, a cited passage, a map branch). Grey bars are not allowed. Sample content is labelled "Ví dụ minh hoạ".
2. **One weight per level.** A screen has one primary action, and at most one element at display size. Lists of equal items are lists (rows with hairlines or definition lists), not grids of identical cards.
3. **Cards mean "an object you can act on"** (a document, a quiz, a map). Explanatory text is never boxed.
4. **Structure must be true.** Numbering and step markers are used only for real sequences. A sequence is drawn as a route with stops, echoing the brand mark: outlined stops, a filled stop for the destination.
5. **Colour in a headline is not emphasis.** Headlines are one colour. Red appears where a source is cited.
6. **No interface text in capitals** for new surfaces, and no mono face for labels. Mono stays for figures.
7. **Motion answers an action.** One entrance on the hero is the only unprompted motion on a page.

### 3.2 Type scale for marketing and reading surfaces

| Role | Size | Face |
|---|---|---|
| Page headline | `clamp(2rem, 4.4vw, 3.4rem)`, line-height 1.12 | Spectral 600 |
| Section headline | `clamp(1.6rem, 3vw, 2.25rem)`, line-height 1.18 | Spectral 600 |
| Row headline | 1.5rem | Spectral 600 |
| Lede | 1.0625rem, line-height 1.65, max 34rem | Inter |
| Body | 0.9375–1rem, line-height 1.6 | Inter |
| Reading sample | 1.0625rem, line-height 1.7 | Spectral |
| Note | 0.75rem | Inter |

The app shell keeps the Tailwind scale in `tailwind.config.js`; this table applies to landing and long-reading surfaces.

### 3.3 Layout

- Content width 1120px, gutters 20px below 640px and 32px above.
- Two-column rows are 5fr / 6fr and collapse to one column below 900px (1024px for the hero). Text comes first in the DOM in every row; visual order may flip on wide screens.
- Vertical rhythm: 56px between sections on phones, 80px from 640px.
- Elevation has two levels only: flat with a hairline (panels), and raised (`--shadow-card-hover`) for the one object a section is about.

### 3.4 Copy

- Name things as the app names them. No version numbers, no architecture words (queue, job, RAG, grounded).
- A heading in the tools section is the learner's question ("Chương này gồm những gì?"), and the paragraph is the answer.
- No user counts, testimonials or performance claims.

## 4. Applied in this wave: Landing

| Before (V5) | After (V6) |
|---|---|
| Hero: grey wireframe of three panes | Hero: one answered question with the passage it cites, overlapping |
| Capabilities listed three times | One route (four stops), two tool rows with specimens, one short "also" list |
| Internal names ("Summary v2", "Background Queue") | App names ("Tải tài liệu lên", "Sơ đồ tư duy", "Thư viện học tập") |
| Quiz, review, knowledge map, library missing | All present |
| Water-filter chat sample | One subject throughout (introductory economics) |
| Centered closing block | Left-aligned closing line, same primary action |

Captures: `evidence/before/` and `evidence/after/` at 390 and 1440px, light and dark, plus 1024px light.

Guard: `FE/e2e-fixture/landing-v6.spec.js`. The matrix it actually runs:

| Check | Widths | Themes | Auth | Fonts |
|---|---|---|---|---|
| No overflow (viewport and clipped panels), one hero primary action, specimen visible | 320, 390, 768, 1024, 1440 | light, dark | signed out | loaded |
| 44px targets in header and hero | 320, 390 | light, dark | signed out | loaded |
| No overflow, 44px targets, header action inside the viewport | 320 | light, dark | signed out, signed in | blocked |
| Copy rules, figures readable and captioned, specimen type sizes, anchors, reduced motion, keyboard order | 1280 | light | signed out | loaded |

Not covered: dark theme and signed-in state for the 1280px semantic checks; widths above 1440px.

### Review notes (Codex, PR #159)

Eleven of twelve findings were fixed in the PR. One is recorded here instead:

- **Wordmark contrast.** "Map" in `--seal` measures 3.95:1 (light header) and 4.20:1 (dark header) at 17px semibold. WCAG 1.4.3 exempts text that is part of a logo or brand name, and the wordmark colours are a V5 brand rule, so V6 does not change them. If the owner wants the wordmark to pass 4.5:1 anyway, it needs a darker brand-text token; that is a brand decision, not a landing fix.
- Specimen map branches no longer borrow `--forest` or `--seal`; they use `--accent`, `--bronze`, `--slate` and `--text-secondary`, which keeps §2's colour roles true.

## 5. Still to design (not in this wave)

Component rules for the app shell (buttons, inputs, tabs, dialogs, toolbars, empty/loading/error states), the header and sidebar architecture, and each signed-in screen. These follow the action inventory and are tracked in `README.md`.
