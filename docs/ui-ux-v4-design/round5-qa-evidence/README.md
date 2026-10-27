# Phase C Round 5 — QA Evidence

All screenshots are the REAL production `ExportStudioDialog` component, mounted
in a throwaway harness (`temp-round5-export-check.html` +
`src/tempRound5ExportCheck.jsx`, deleted before commit) against a deterministic
fixture, not a static mockup. True narrow/exact viewports were produced via a
same-origin scaled `<iframe>` harness (`temp-round5-viewport.html`, also
deleted before commit) — this machine's real screen caps at 1280×800, so the
desktop capture is the practical ceiling for that method, not a deliberate
scope cut.

## Fixture

Same four-tier record used across Round 4/4.1 QA (`fourTierMapFixture`-shaped):
root → 2 sections → 2 concepts (one with a long Vietnamese title) → 2 details.
`mind.nodeData` (nested, for the live-tree-based preview/scope resolution) and
`record` (flat, for the real export pipeline) both carry matching node ids, so
a real PNG export through the actual UI button produces verifiable output.

## Files

| File | What it shows |
|---|---|
| `desktop-1440-light.jpg` / `desktop-1440-dark.jpg` | Full 3-zone layout: scope rail, persistent schematic preview, settings panel. No horizontal overflow; export CTA correctly hit-tested via `elementFromPoint` (confirmed in-session, not just visually). |
| `tablet-820-light.jpg` / `tablet-820-dark.jpg` | Collapsed icon-only rail (62px), preview and settings both remain usable, no squeeze. |
| `mobile-390-light.jpg` / `mobile-390-dark-scrolled.jpg` | Full-screen layout: compact header, horizontal rail, compact preview, scrollable settings (dark capture shown mid-scroll to confirm the sticky footer and sticky rail stay correctly positioned). |
| `mobile-320-light.jpg` / `mobile-320-dark.jpg` | Minimum-width stress case, both themes (320px dark is new evidence, not a Phase B reference — none existed to compare against). Confirmed `document.body.scrollWidth === clientWidth` (no overflow) via direct measurement. |
| `export-completed-real-png.jpg` | A REAL PNG export completed through the actual "Xuất PNG" button (not a direct function call): success state ("Đã xuất: Hệ_điều_hành_hiện_đại-20261027.png") rendered in the persistent preview zone, settings panel remains visible and interactive alongside it. |

## Real interactions verified in-session (not just screenshotted)

- Scope change (full ↔ selected_branches) and format change (PNG → JPEG →
  WebP) both reactively update the persistent preview's caption/count/format
  text — confirmed via live DOM text assertions, not visual inspection alone.
- A real PNG export was triggered via the actual button click; the real
  `.mm-export-offscreen` scene was observed present during capture, and the
  completion state (filename, "File đã tải xuống trình duyệt") rendered
  correctly afterward.
- Export action hit-testing confirmed via `document.elementFromPoint` at the
  button's visual center at 1440px — the click target is real, not occluded.
- No horizontal overflow confirmed via `scrollWidth`/`clientWidth` comparison
  at 1440/820/390/320.
- Sticky footer confirmed to track the viewport bottom after scrolling the
  settings panel at 390px (`footer.getBoundingClientRect().bottom ===
  viewport height`).

## A real defect found and fixed during this review

The "Các node được chọn" (selected-branches) scope row's description text
wrapped one word per line at the settings panel's ~320px width (present at
every width that reaches this column, not just tablet — the settings column
is the same width at desktop and tablet) because `.export-count` and
`.export-inline-action` competed for horizontal space on the same flex line
as `.export-choice-list__copy` (which has `min-width:0`, so it was squeezed
rather than wrapping normally). Fixed with `flex-basis:100%` on
`.export-count`, a standard flexbox technique to force it (and the button
after it) onto their own line. Verified fixed at 820px and still correct at
1440px/390px after the fix — see `tablet-820-*.jpg` (post-fix) for the
corrected row.

## What this set does not cover (disclosed, not fabricated)

- No dedicated "invalid scope" screenshot — the harness's fixed props make
  that state awkward to trigger via pure UI interaction without a "Chọn trên
  canvas" callback wired to a real canvas selection flow. The error-state
  styling and gating logic (`scopeResult?.ok`) are unchanged from the
  pre-Round-5 component (confirmed via diff review) and are covered by the
  existing, still-passing `ExportStudioDialog.scopeFreshness.test.jsx` /
  `.openingScope.test.jsx` suites.
- No PDF/document-format real-export capture in this screenshot set (PNG was
  used for the end-to-end real-export proof); PDF/document behavior is
  covered by the full, still-passing `MindElixirView.exportStudioDocument.test.jsx`
  suite (16 test cases, independently diff-reviewed line-by-line against the
  pre-Round-5 version to confirm zero assertions were removed — only obsolete
  wizard-navigation clicks).
- `.mindmap-tools-overlay` / `.context-inspector-shell` collision was not
  tested against a real mounted MindMap workspace (this harness mounts the
  dialog standalone) — `Modal.jsx` itself is unchanged this round, and no new
  `position: fixed`/high-`z-index` rule was added outside the modal's own
  stacking context in the CSS diff, but this is a code-review-level
  conclusion, not an empirical collision test against the real toolbar.
