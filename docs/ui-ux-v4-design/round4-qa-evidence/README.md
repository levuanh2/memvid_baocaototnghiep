# Phase C Round 4 — QA Evidence

All screenshots captured from the REAL production components, not static
mockups, via same-origin scaled-iframe harnesses against the local dev
server (`npm run dev -- --port 5205`):

- **MindElixir** (`mindelixir-*`): the existing, pre-Round-4 dev-only
  `FE/fixture-harness.html?map=depth` harness (mounts `MindElixirView`
  against a named fixture, no backend). Reused as-is since the Round 4 CSS
  changes apply regardless of fixture data.
- **StudyMap** (`studymap-*`): a throwaway harness (`temp-round4-check.html`
  + `src/tempRound4Check.jsx`, deleted before commit) mounting the real
  `StudyMapView` inside `MemoryRouter` + a real `AuthContext.Provider` with a
  fake user + `StudyContextProvider`, with `window.fetch` intercepted for
  `/api/documents/<id>`, `/api/documents/<id>/study-maps`,
  `/api/study-maps/<id>`, `/api/documents/<id>/chunks`, serving
  `FE/src/test/fixtures/fourTierMapFixture.js`'s four-tier fixture (same
  fixture the automated test suite uses — "Hệ điều hành hiện đại").

True narrow viewports (390px/320px) were produced via an `<iframe>` with
`width`/`height` attributes set to the exact target size (the genuine
internal layout viewport), wrapped in a `transform: scale()` div purely for
on-screen visibility — this machine's real screen caps at 1280×800, so wide
desktop captures (1280px) are the practical ceiling for this method, not a
deliberate scope cut.

## Files

| File | What it shows |
|---|---|
| `mindelixir-desktop-light-four-tier.jpg` | Full four-tier hierarchy at desktop width, light theme: root (solid blue pill), section (bold bordered), concept (bordered card), detail (underlined, no border/fill). Dot-lattice background visible. |
| `mindelixir-desktop-dark-selection.jpg` | Dark theme, a section-tier node selected — accent outline + halo visible, root background resolves to `--accent-cta` (`#2563EB`) with white text. |
| `mindelixir-mobile-390-light.jpg` | 390px viewport, light theme — depth-one default expansion, 44px touch-target spacing around labels. |
| `studymap-desktop-light-long-label-wrap.png` | Desktop, light theme, the fixture's deliberately long Vietnamese concept title ("Cơ chế điều phối tiến trình hiện đại bảo đảm công bằng phản hồi nhanh và tránh bế tắc trong hệ thống nhiều lõi") wrapped into 3 `<tspan>` lines with a trailing ellipsis — not the old `slice(0, 46)` single-line truncation. |
| `studymap-desktop-dark.png` | Same view, dark theme. |
| `studymap-mobile-390-light-zoom65pct.jpg` | 390px viewport — zoom indicator reads **65%**, confirming `MOBILE_SCALE_MIN` actually applies at runtime (see the loading/ref-race fix in `.playbook/known-issues.md`). |
| `studymap-mobile-320-light-zoom-floor-clamped.jpg` | 320px viewport — zoom indicator still reads **65%** (the floor, not a further proportional drop), confirming the clamp. |

## What this set does NOT cover (disclosed, not fabricated)

- No 7-viewport full matrix; the above is a representative subset chosen for
  time, not the brief's exhaustive 7-viewport × 2-engine × 2-theme grid.
- No export-pipeline PNG/SVG artifacts were captured from the actual
  `exportImage`/`mindmapImageExport.js` pipeline — the confirmed
  branch/selection-scope export-fidelity defect (see "Round 4 four-tier
  grammar does not survive branch/selection-scoped exports" in
  `.playbook/known-issues.md`) was verified by direct source reading and
  Codex 2's independent review, not by generating and diffing actual export
  files, since reproducing it needs a real mind-elixir instance with branch
  selection wired up beyond what the lightweight fixture harnesses here
  support.
- Backend-side export smoke tests (`BE/tests/test_mindmap_export_*.py`, 21
  files) could not be run locally this session — Docker Desktop is down and
  the Python test dependencies (`pytest`, `fitz`) are not installed locally.
  Zero backend files are touched in this round's diff, so the risk from this
  gap is low; GitHub Actions CI is the authoritative check once pushed.
