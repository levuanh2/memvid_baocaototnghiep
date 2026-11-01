# P2 disposition — R8-004 … R8-007 and the compact Account target

| ID | Original finding | Root cause | Fix commits | Proof | Reviewer | Status |
|---|---|---|---|---|---|---|
| R8-004 | Library More menu bypasses index readiness | Readiness applied only to primary/quick actions; complete tools dispatched every learning surface | `f316c01`, `ef1b3de` tests | `learningActionReadiness()` matrix covers index `ready`, `processing`, `error`, `not_generated`, unknown value, missing index, and no `ai` payload; existing artifacts stay reachable; Details always ready. `LibraryActionMatrix.test.jsx` checks the menu wiring. 44/44 | Codex2 | FIXED |
| R8-005 | Tablet popover lacks viewport positioning and 44px targets | Tablet inherited 40px desktop rows and a fixed below-trigger placement | `f316c01`, `ab6e90c` | Agy Chromium @ `ab6e90c`: 20/20 viewport/theme, 10/10 tablet boundaries, 6/6 near-bottom flips; rows 222×44, mobile sheet 44×44 | Agy | FIXED |
| R8-006 | Obsolete Export Studio fixtures no longer exercise the Preview Bench (`export-studio.spec.js` and `responsive.spec.js`) | Specs still drove the retired wizard with ambiguous global selectors | `6b4e8e2` (export-studio), `e009d38` (responsive) | `export-studio.spec.js` 25/25; `responsive.spec.js` states 7–15 migrated to Presentation, per-format appearance panels, persistent preview/footer summary and exact `Tạo PDF` job flow, 133/133. No assertion removed or skipped; several tightened. | Agy (run), Codex2 (`e009d38`), Claude (review) | FIXED |
| R8-007 | Multi-branch raster fixture uses a missing MindElixir constant | Optimised browser module exposes `SIDE` as a named export the fixture constructor never received | `6b4e8e2` | `multi-branch-export-raster-connectors.spec.js` validates and copies `SIDE` before the real constructor/offscreen path; production export code unchanged | Agy (run) | FIXED |

## Compact Account trigger (R8-001 follow-up)

Measured by Agy at `ab6e90c` (`agy/account-target-ab6e90c.json`), light theme:

| Width | Button rect | Effective hit area | Neighbour gap | Right margin | 44px met |
|---|---|---|---|---|---|
| 320 | 40×40 | 39–40×40 | 0 | 0 | No |
| 375 | 40×40 | 40×40 | 4 | 8 | No |
| 390 | 40×40 | 40×40 | 4 | 8 | No |
| 768 | 40×40 | 40×40 | 4 | 8 | No |
| 1024 | 40×40 | 40×40 | 4 | 8 | No |

No surrounding interactive region extends the target: 0/176 points on the 44×44
perimeter resolve to the Account button.

Disposition: **open P2, accepted residual for Round 8.1, not fixed.**

- The project's 44px mobile convention does apply. The V4 audit already
  classified 40×40 header controls as a P2 defect (UX-028 / UX-011).
- 40×40 passes WCAG 2.2 SC 2.5.8 (AA, 24px minimum). 44×44 is SC 2.5.5 (AAA).
- At 320px there is no horizontal space. The button touches both the viewport
  edge and the usage chip, so widening it would overlap the neighbour's hit
  area or undo the R8-001 overflow fix.
- A vertical-only extension to 44px is possible (the header is 56px) but would
  not reach 44×44, so it is left for a Round 8.2 decision.

The reachability result stays PASS: the centre point hit-test passed in all 22
of Agy's header configurations. This measurement does not change it.
