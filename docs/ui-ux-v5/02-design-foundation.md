# StudyMap V5 — design foundation (V5-A)

Status: **proposed** for the V5-A Draft PR. This document records the visual rules every later V5 workstream (B to F) builds on. Where a rule only restates something already on main, it says so: V5 keeps working decisions and does not re-litigate them.

## 1. Direction

StudyMap is a **calm academic reading room for working with your own documents**. The interface:
- gets out of the way of long reading and answering sessions;
- gives every context one obvious next step;
- proves its answers through citations.

Two material references carry the identity:
- the **ink and paper of a study notebook**: navy text on light paper, and the reverse in dark mode;
- the **seal** of a source stamp, used only for provenance (citations) and for the brand.

That is a deliberate restriction. Red never means "click me": blue does (`--accent`). Red means "this came from your source" or "StudyMap".

## 2. Brand mark

| Property | Rule |
|---|---|
| Artwork | `FE/public/studymap-mark.svg`, the same geometry as the `BrandMark` component and `favicon.svg`. The in-app `BrandMark` tile follows the theme (`--seal`: `#F1333A` light, `#D86A53` dark). The static files cannot read CSS variables, so they are fixed to the light value `#F1333A` (a test keeps it equal to the light `--seal`). A seal-red tile carrying a three-stop knowledge route: two ivory stops are concepts already read, and the ink stop is where the learner goes next. |
| Meaning | Upload → understand → explore, i.e. the learning journey drawn as a path on a map. It replaces the retired MemVidX "M" seal and the "M" + "X" favicon. |
| Sizes | Designed for 16, 32 and 48px. Below 16px, do not use the mark; show the wordmark text instead. |
| Clear space | At least 25% of the mark's size on every side. Exception: the compact app header (40px home link, 30px mark) keeps 5px, about 17%. Never place it on a red or busy surface. |
| Accessibility | Always decorative (`aria-hidden`, `focusable="false"`). The link or heading around it carries the name, e.g. "StudyMap — trang chủ". |
| Wordmark | "Study" in `--text-primary` and "Map" in `--seal`, set in Spectral semibold. Show the full wordmark wherever the layout allows; the mark alone is allowed only where the wordmark cannot fit (the app header below `lg`). |
| Favicon caching | The tab icon is served from `/studymap-mark.svg` (a new URL). Any future artwork change must use a new file name or a `?v=` query: browsers cache favicons per URL for a long time. |
| Don't | Rotate the mark, outline it, recolour the tile, put a letter in it, or add the MemVidX "X". |

## 3. Tokens: already on main, adopted unchanged

Defined in `FE/src/index.css` and `FE/tailwind.config.js`. V5 uses these names and does not introduce parallel ones.

**Roles:**

| Role | Token | Notes |
|---|---|---|
| Action, selection, focus | `--accent` (`#126CF2`), `--accent-hover`, `--accent-subtle` | The only colour for buttons, links, tabs, checkboxes and focus rings |
| Solid fill behind white text | `--accent-cta` (used by `.btn-primary` / `.btn-seal`) | Keeps white-text contrast ≥4.5:1 in both themes |
| Provenance and brand | `--seal` | Citations, evidence frames, the seal meter and the brand mark only |
| Success, ready, progress | `--forest` | Never interactive |
| Text | `--text-primary`, `--text-secondary`, `--text-muted` | |
| Surfaces | `--bg-*`, `--border-color`, `--border-strong` | |

**Type:**

| Role | Family | Use |
|---|---|---|
| Display | Spectral, with Georgia and serif fallbacks | Headings and the wordmark |
| Body | Inter, with `system-ui` and sans-serif fallbacks | All UI text |
| Mono | IBM Plex Mono | Counts, IDs, eyebrows and data |

**Sizes:**
- body is 16px;
- **the minimum readable UI text is 12px**, the provisional floor for compact headers (owner direction for the #142/#144 Option A decision; use larger text where it fits);
- touch targets are ≥44×44px below 768px.

## 4. Rules for every V5 workstream

1. **One primary action per context.** Use `.btn-primary` for that action only; secondary actions are `.btn-secondary` or plain links.
2. **One name per action, everywhere.** The approved terms are:
   - "Tải tài liệu lên";
   - "Công cụ học";
   - "Sơ đồ tư duy" / "Bản đồ kiến thức";
   - "Xem lại câu chưa đúng";
   - "% điểm".

   Renaming a control requires grepping every Vitest, e2e and e2e-fixture spec. The full Fixture Audit is not part of Fixture Smoke, so CI does not catch a missed rename.
3. **Font resilience.** Layout must not depend on Inter being loaded. Every fixed-width control is tested with the webfont and with Google Fonts blocked (the Linux fallback is DejaVu Sans, which is wide), measuring the content box rather than `scrollWidth` (#150).
4. **Responsive boundaries keep focus.** A control that a breakpoint unmounts hands focus to its counterpart in the new layout (see `utils/uploadFocusHandoff.js`); it never drops focus to `<body>`.
5. **Light and dark are one design.** Every new surface uses role tokens and is checked in both themes.
6. **Preserve the merged fixes:** the #148 QuizResult counters and verdict validation, the #149 `CI / required` gate model, and the #150 Library primary column / arrow / ≤359px rules.

## 5. Out of scope for V5-A

- **Internal identifiers:** `memvid-token`, `memvid-theme`, `memvid.*` and `memvidx.*` storage keys and event names. Renaming them would sign users out and reset their preferences; that needs a compatibility plan and owner approval.
- **Navigation, layout and screen redesigns:** these belong to V5-B to V5-F; see `README.md` for the roadmap.
