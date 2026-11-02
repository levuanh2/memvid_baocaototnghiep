# Round 8.2 fixture-failure triage — codex2

## Run metadata

- Git SHA: `c02e2b91ae2207d472756cd34003b5cb6fee1620` (`origin/main`, PR #98 merge).
- Environment: Windows, local Chromium through `FE/playwright.fixture.config.js`, Vite fixture server on `http://localhost:5301`, one worker.
- Data boundary: mocked/local fixture data only; no real API, database, credentials, or production host.
- Timestamp: 2026-11-01T23:20:59+07:00 through 2026-11-01T23:35:10+07:00 (`2026-11-01T16:20:59.125Z` start in reporter JSON).
- Method: the four named specs were executed together with `--repeat-each=3 --reporter=json`. Expected: each of the 12 previously reported identities is exercised three times. Observed: 105 executions, 69 passed, 36 failed, 0 skipped/flaky; the same 12 identities failed in all three repetitions. Status: **FAIL** as an untriaged suite, with six product defects and six stale contracts below.
- Raw reporter evidence: `fixture-rerun-repeat3.raw.json`. The prior Round 8.1 JSON listed only 11 identities despite its prose saying 12; the current run confirms the omitted twelfth identity is the depth≤2/full-scope Preview Bench navigation test at line 364.

## 1. `branch-export-visual.spec.js` — `visual 390x844-light`

- Reproduction: **3/3 FAIL**, deterministic. Assertion `:106`: expected selection bar substring `2 node đã tick`; actual `1 node đã tickXóa chọnTiếp tụcBỏ chọn và quay lại` after two coordinates captured before the first click.
- Production path: `FE/src/utils/mindmapBranchSelectionMode.js:67-73,163-185` reclassifies and dispatches marker clicks. After click one, auto-parent V3 can turn the pre-captured second marker into auto-context; clicking it suppresses context instead of adding an explicit tick.
- Divergence: test introduced by `8e56ead`; contract intentionally changed in `302548d` (merged by PR #84) for the explicit/auto-context/suppressed three-set model. Approved design proof: `docs/ui-ux-v4-design/05-shared-map-visual-grammar/engine-boundaries-and-export-guardrails.md`, §3.2 invariant 2.
- Classification: **STALE_TEST_CONTRACT**, P3, owner: FE MindMap QA. User impact: none demonstrated; current behavior matches the approved context semantics. Minimal fix: choose two stable non-ancestor explicit node IDs (or recompute marker roles after click one), then retain the two-tick, geometry, pan, and screenshot assertions.

## 2. `branch-export-visual.spec.js` — `visual 390x844-dark`

- Reproduction: **3/3 FAIL**, deterministic. Expected `2 node đã tick`; actual `1 node đã tickXóa chọnTiếp tụcBỏ chọn và quay lại` at `:106`.
- Production path/divergence: same `mindmapBranchSelectionMode.js:67-73,163-185`, `302548d` / PR #84, and approved invariant as test 1. Theme does not change the result.
- Classification: **STALE_TEST_CONTRACT**, P3, owner: FE MindMap QA. User impact: none demonstrated. Minimal fix: the dark case must use the same stable explicit-node selection path as the light case and keep all existing visual/geometry assertions.

## 3. `exact-node-export-v3.spec.js` — `manual suppression survives review navigation and selection changes in the same map session`

- Reproduction: **3/3 FAIL**, deterministic timeout. Expected a `Quay lại` button after advancing; actual: no such button, locator waits until the 45,000 ms test timeout at `:217`.
- Production path: `FE/src/components/mindmap/ExportStudioDialog.jsx:368,371,392` implements the concurrently mounted Preview Bench with section rail and no wizard Back button.
- Divergence: test came from `02f0e4d`; wizard was intentionally replaced in `90a959f`, merged in PR #95 (`8621ce7`). Approved proof: `docs/ui-ux-v4-design/03-visual-mockups/surfaces.html?screen=export`, commit `90a959f`, and `docs/ui-ux-v4-design/round5-qa-evidence/README.md`.
- Classification: **STALE_TEST_CONTRACT**, P3, owner: Export Studio QA. User impact: none; navigation is available through the rail and settings remain mounted. Minimal fix: navigate to the Content rail section (or operate its still-mounted controls) and retain every suppression/same-session/map-switch assertion.

## 4. `mindmap-depth-presets.spec.js` — `1440x1024-light: all 5 depth presets…`

- Reproduction: **3/3 FAIL**, deterministic. Expected horizontal root-center delta `<= 1 px`; actual `1.7220458984375 px` at `:158`.
- Production path: `FE/src/components/mindmap/MindElixirView.jsx:974-999` applies presets via `setRootOnly`/`expandNodeAll`; the root metrics consumed by that preservation logic changed in `FE/src/components/mindmap/mindmap.css:97-127`.
- Divergence: preservation contract/test was added in `91a4a04`; `a3aabed` (PR #93) later changed root font, border, padding, line-height, and max-width without updating anchor compensation.
- Classification: **PRODUCT_DEFECT**, P3, owner: FE MindMap rendering. User impact: a small but measurable horizontal canvas jump when changing depth. Minimal fix: preserve the pre-change root screen center after the final refresh/style application, accounting for the new root box metrics; keep the 1 px bound.

## 5. `mindmap-depth-presets.spec.js` — `1440x1024-dark: all 5 depth presets…`

- Reproduction: **3/3 FAIL**. Expected `<= 1 px`; actual `1.7220458984375 px` at `:158`.
- Production path/divergence: `MindElixirView.jsx:974-999` plus `mindmap.css:97-127`; `91a4a04` contract, diverged in `a3aabed` / PR #93.
- Classification: **PRODUCT_DEFECT**, P3, owner: FE MindMap rendering. Impact/fix: same as test 4; dark theme proves the drift is layout rather than palette-specific.

## 6. `mindmap-depth-presets.spec.js` — `1024x768-light: all 5 depth presets…`

- Reproduction: **3/3 FAIL**. Expected `<= 1 px`; actual `1.7220458984375 px` at `:158`.
- Production path/divergence: `MindElixirView.jsx:974-999`, `mindmap.css:97-127`; `a3aabed` / PR #93 after `91a4a04`.
- Classification: **PRODUCT_DEFECT**, P3, owner: FE MindMap rendering. Impact/fix: same root-anchor correction as test 4, verified at tablet width without weakening the bound.

## 7. `mindmap-depth-presets.spec.js` — `1024x768-dark: all 5 depth presets…`

- Reproduction: **3/3 FAIL**. Expected `<= 1 px`; actual `1.7220458984375 px` at `:158`.
- Production path/divergence: `MindElixirView.jsx:974-999`, `mindmap.css:97-127`; `a3aabed` / PR #93 after `91a4a04`.
- Classification: **PRODUCT_DEFECT**, P3, owner: FE MindMap rendering. Impact/fix: same as test 6.

## 8. `mindmap-depth-presets.spec.js` — `390x844-light: all 5 depth presets…`

- Reproduction: **3/3 FAIL**. Expected `<= 1 px`; actual `1.291534423828125 px` at `:158`.
- Production path/divergence: `MindElixirView.jsx:974-999`, responsive/root rules in `mindmap.css:97-127`; `a3aabed` / PR #93 after `91a4a04`.
- Classification: **PRODUCT_DEFECT**, P3, owner: FE MindMap rendering. User impact: small horizontal depth-change jump on mobile. Minimal fix: same final root-anchor compensation, validated against the mobile metric.

## 9. `mindmap-depth-presets.spec.js` — `390x844-dark: all 5 depth presets…`

- Reproduction: **3/3 FAIL**. Expected `<= 1 px`; actual `1.291534423828125 px` at `:158`.
- Production path/divergence: same as test 8.
- Classification: **PRODUCT_DEFECT**, P3, owner: FE MindMap rendering. Impact/fix: same as test 8.

## 10. `mindmap-depth-presets.spec.js` — `depth<=2 + visible scope resolves to exactly 6 nodes; full scope always resolves to all 8…`

- Reproduction: **3/3 FAIL**, deterministic timeout. The first expected/observed scope value is `6 node` and passes; the failure expects three `Quay lại` clicks, but the Preview Bench has no Back button, timing out at `:376` before the expected full-scope value `8 node` is checked.
- Production path: `ExportStudioDialog.jsx:368,371,390,392`; scope controls and persistent preview are concurrently mounted.
- Divergence: depth test `91a4a04`; intentional Preview Bench replacement `90a959f`, PR #95. Approved proof: the Round 5 Preview Bench mockup/evidence cited in test 3.
- Classification: **STALE_TEST_CONTRACT**, P3, owner: Export Studio QA. User impact: none demonstrated; depth≤2 value is correct, but the stale navigation prevents checking full scope. Minimal fix: directly check the concurrently mounted `full` radio (or select Content rail), then retain the exact `8 node` assertion.

## 11. `post-pr77-exact-selection.spec.js` — `all six two-child pairs stay exact at 69% across mouse, Space, presets, reopen and cache reload`

- Reproduction: **3/3 FAIL** at the first pair. Expected old review text `2 node đã tick · 3 node thực tế`; actual accessible preview summary `Phạm viCác node được chọnĐịnh dạngSVGSố node/nhánh3 nodeGiao diệnGiống canvasTên fileAn_ninh_mạng_và_quyền_riêng_tư.svg` at `:48`. The preceding current footer assertion `2 node đã chọn · 1 node cha tự thêm · 3 node được xuất` passes.
- Production path: `ExportStudioDialog.jsx:360-363,390`; Preview Bench deliberately separates the footer’s explicit/context counts from the persistent preview’s `3 node` accessible definition list.
- Divergence: test `792893e`/`cb8fbc2`; summary contract changed in `90a959f`, PR #95. Approved proof: Round 5 Preview Bench mockup/evidence cited in test 3.
- Classification: **STALE_TEST_CONTRACT**, P3, owner: Export Studio QA. User impact: none demonstrated; current resolved membership is three and the current footer distinguishes 2 explicit + 1 context. Minimal fix: assert those two current surfaces separately, then continue to the unchanged downloaded-SVG membership assertion for all six pairs.

## 12. `post-pr77-exact-selection.spec.js` — `real Chromium offscreen Mind Elixir topics expose complete identity`

- Reproduction: **3/3 FAIL**. Expected old combined text `2 node đã tick · 3 node thực tế`; actual current accessible summary reports `3 node` with selected scope/SVG/canvas metadata at `:48`; the failure occurs before export and before the offscreen identity sampling assertion.
- Production path/divergence: `ExportStudioDialog.jsx:360-363,390`; `90a959f`, PR #95, approved Preview Bench evidence.
- Classification: **STALE_TEST_CONTRACT**, P3, owner: Export Studio QA. User impact: no identity defect observed; this stale precondition masks the existing identity assertion. Minimal fix: use the current footer + preview count assertions, then preserve all offscreen `nodeObj.id`/`data-nodeid` checks unchanged.

## Release assessment

- **Six PRODUCT_DEFECT executions identities** (the six viewport/theme root-anchor cases) represent one P3 rendering defect introduced by PR #93. Counts, connectors, depth membership, instance identity, scale, and all later depth tests pass; measured drift is 1.29–1.72 px. It is not a wrong-membership/artifact-output blocker.
- **Six STALE_TEST_CONTRACT identities** are explained by approved PR #84 auto-context semantics and PR #95 Preview Bench design. They should be migrated without deleting or weakening their meaningful assertions.
- Fixture triage verdict: **PASS WITH OPEN P3 PRODUCT DEFECT**; no P0/P1/P2 or wrong export membership/artifact defect was reproduced.
