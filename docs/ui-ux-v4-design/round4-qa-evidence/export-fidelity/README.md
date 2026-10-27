# Round 4.1 — Export Fidelity Closure Evidence

All captures are REAL exported output from the REAL production pipeline
(`exportMindmapImage`, real `mind-elixir`, real `@zumer/snapdom`, real
`mindmap.css`/`mindElixirTheme.js` loaded via the actual Vite dev bundle),
not a static mockup or a jsdom simulation. Captured via a throwaway harness
(`temp-round41-export-check.html` + `src/tempRound41ExportCheck.jsx`,
deleted before commit) that calls `exportMindmapImage` directly with
`outputMode: "base64"` (no browser download dialog) and a large `settleMs`
so the real offscreen `.mm-export-offscreen` scene stays in the DOM long
enough to measure with `getComputedStyle` before it's removed.

## Fixture

Deterministic record, same four-tier shape as the rest of Round 4's fixtures:

```
R (root, "Hệ điều hành hiện đại")
├─ A (section, "Quản lý tiến trình")
│  ├─ A1 (concept, long Vietnamese title — tests word-wrap too)
│  │  └─ A1a (detail)
│  └─ A2 (concept)
│     └─ A2a (detail)
└─ B (section, "Quản lý bộ nhớ") — the unselected sibling; must be
   absent from every scope export rooted at A or below
```

## Scope fidelity matrix (measured, not asserted)

| Scope | Node membership | Original role preserved | Rendered parity | Evidence file |
|---|---|---|---|---|
| `full` | All 7 nodes | n/a — no projection exists for this scope | Real depth-based CSS applies directly, untouched by this fix | `full-scope-all-nodes-unaffected.jpg` |
| `current_branch` (A1, concept) | R(context), A(context), A1, A1a | **A1=concept, A1a=detail — distinct** (was both "leaf" pre-fix) | PASS | `current-branch-A1-concept-export-real-png.jpg` |
| `current_branch` (A, section) | R(context), A, A1, A1a, A2, A2a; **B absent** | A=section, A1/A2=concept, A1a/A2a=detail — all 3 tiers distinct | PASS | `current-branch-A-all-tiers-plus-negative-membership.jpg` |
| `selected_branches` exact (A1+A2) | A(context, promoted to structural root), A1, A2; A1a/A2a correctly absent (exact mode excludes descendants) | A=section (NOT the blue root pill, despite sitting at the DOM root slot), A1/A2=concept | PASS (after a real second bug found+fixed — see below) | `selected-branches-exact-promoted-root-fixed.jpg` |
| `selected_branches` exact (A1 alone) | A1 only, promoted to structural root | A1=concept (not root-styled) | PASS | measured via `getComputedStyle`, not separately screenshotted |
| `visible` | Whatever's live on canvas | n/a — captures the live DOM directly; no projection, no `data-export-source-role` ever set | Was never affected by this bug | confirmed via `mindmapImageExport.visualRoleFidelity.test.js`, not separately screenshotted (no live canvas in this harness) |

## Format verification

| Scope | PNG | SVG | PDF | Evidence |
|---|---|---|---|---|
| `current_branch` (A1) | PASS — real screenshot | PASS — real SVG, decoded and confirmed to contain `font-size: 16/14/13/12px` (all four tiers present as real embedded styles) | **NOT VERIFIED** — Docker Desktop down, backend Python deps (`pytest`, `fitz`) not installed locally this session; the FE geometry-manifest extraction (`extractGeometryManifest`) is unrelated to this fix's code path (reads `me-tpc` computed font-size directly, not the role attribute) and is covered by `ExportStudioDialog.geometryManifest.test.jsx`, which passes | `current-branch-A1-concept-export-real-png.jpg`, SVG decoded inline via `javascript_tool`, not saved as a file |

## Theme and appearance

- **Dark theme**: `current-branch-A1-dark-theme.jpg` — all four tiers remain visually distinct; the export's own `backgroundColor` param is independent of page theme (explicit white here, as the real export pipeline always takes an explicit background, never inherits page theme).
- **Non-default appearance preset ("pastel")**: `current-branch-A1-pastel-appearance-preset.jpg` — confirms the pre-existing, deliberately-3-tier appearance-preset system (`sourceRoles`/`exportSourceRole`, unchanged by this fix) still colors concept and detail nodes the SAME ("leaf" preset color) while Round 4's four-tier GEOMETRY (size/weight/border-radius/shape) correctly keeps them visually distinct — the two systems compose correctly, exactly as designed.

## A second, real defect found during this verification (not from static review)

The first version of the "section" role CSS override set font-size/weight/
padding/border/radius correctly but not `background`/`color`. This measured
correctly everywhere EXCEPT when a section was genuinely promoted to the
`me-root` DOM slot (`selected_branches` exact mode, A1+A2 selected): a real
`getComputedStyle` read showed `rgb(18, 108, 242)` (the root's own blue) on
the promoted section, because mind-elixir's own library-level base CSS
unconditionally backgrounds `me-root me-tpc` and nothing in the new rule
contested it off that specific selector. Fixed by adding explicit
`background`/`color` to the section-role rule, matching what the concept/
detail roles already had for the same reason. See `.playbook/known-issues.md`
for the full writeup — this is exactly why real-browser verification
(not just the jsdom-based `FakeOffscreenMind` unit tests, which don't load
any real stylesheet) was required before calling this fix complete.

## Limitations (disclosed, not silently skipped)

- No full 4-scope × PNG/SVG/PDF × light/dark × preset matrix — a
  representative, deliberately-chosen subset covering every CODE PATH the
  fix touches (full/current_branch/selected_branches/visible, promotion and
  non-promotion cases, both formats, both themes, one non-default preset).
- PDF not verified locally (see table above) — same Docker/dependency gap
  as Round 4's own report; zero backend files touched by this fix.
- `visible` scope has no screenshot since this harness has no live canvas to
  capture "whatever's on screen" from — its unaffected status is confirmed
  structurally (code trace: it never reaches the projection code at all) and
  by a dedicated unit test asserting zero offscreen instances are
  constructed for that scope.
