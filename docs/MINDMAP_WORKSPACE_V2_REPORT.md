# Mind Map Workspace V2 — implementation report

## Implemented

- Mind Elixir remains the renderer (`mind-elixir` 5.13.0); no React Flow, D3,
  Dagre, or ELK migration.
- Added a pure `assignBranchDirections` layout contract: recursive subtree
  weights, descending-weight greedy side assignment, stable semantic order,
  stable branch colors, and `MindElixir.SIDE` direction values.
- Adapter topics are compacted to 100 characters. When compaction is needed,
  the original text is retained in the sidecar note rather than rendered as a
  paragraph-shaped topic.
- Mind Elixir is created once per mounted viewer. Map changes use the public
  `refresh()` and `clearHistory()` APIs; the lifecycle schedules exactly one
  `scaleFit()` for the new map once the canvas has a real size. Theme changes
  use `changeTheme()` only. Selection, drawer toggles, panel toggles, and
  expand/collapse do not fit, center, or recreate the instance.
- Added `compact: true`, a blue root, strong level-one cards, compact deeper
  nodes, one compact context row, a canvas-local closed-by-default Inspector
  drawer, and the existing source-sidebar behavior remains intact.
- Added the versioned generation contract fields to new backend records:
  `schema_version: 2`, `layout_version: side-balanced-v2`, and
  `generation_profile: learning-map-v2`. Long generated topics are compacted
  server-side with their full text retained in `note` when no note exists.
- Old records are never labeled upgraded merely because they are restyled.
  Missing schema v2, enrich, relations, or the corresponding generator flags
  render as `Sơ đồ cũ · Nâng cấp` and require regeneration.

## Implemented backend constraint layer

- Added `v2_constraints.py`, a deterministic persistence-boundary validator.
  It records stable `V2_*` issue codes for branch count, depth, child
  cardinality, rich-source size, and topic length. It never invents siblings
  or silently drops overflow nodes.
- Strengthened the outline prompt and bounded fallback ceilings to communicate
  the 5–8 / 2–5 learning-map profile.

## Local verification

- `npx vitest run src/utils/mindmapLayout.test.js src/utils/mindElixirAdapter.test.js src/utils/mindmapNormalize.test.js src/components/mindmap/MindElixirView.newControls.test.jsx`: **40/40 passed**.
- `npx vitest run src/components/mindmap/MindElixirView.newControls.test.jsx`: **5/5 passed**.
- `npm test -- --run`: **1072/1072 passed**, 93 files.
- `python -m pytest -q tests/test_mindmap_v2_constraints.py tests/test_mindmap_schema_v2.py`: **19 passed**.
- `python -m pytest -q tests/test_mindmap_v2_constraints.py tests/test_mindmap_schema_v2.py tests/test_mindmap_graph.py tests/test_mindmap_skeleton.py`: **31 passed, 2 warnings**.
- Full Mind Map regression (`tests/test_mindmap*.py`, 24 files): **131 passed, 6 warnings**.
- `npm run build`: passed, **2369 modules**.
- `npm run lint`: **66 findings (60 errors, 6 warnings), baseline unchanged**; no new finding attributable to the new layout utility/tests.
- `git diff --check`: exit code **0**. Git printed only normal LF/CRLF conversion notices; no whitespace error.

## Deployment and live verification boundary

Gate A candidate commits are now pushed to
`origin/release/p0-p0.5-verification`:

- `7f74d73` — FE Mind Elixir V2 layout/lifecycle/workspace/tests
- `cbeb475` — BE V2 contract/constraints/tests
- `335f196` — implementation report

The release branch is not deployed. The production workflow deploys only
`main` through the EC2 GitHub Actions path; no branch preview workflow exists
in this repository. Therefore production cannot be used as evidence for this
release branch yet.

Shell probes to `https://studymap.space/app` and the configured production API
were blocked by the local network proxy, and no browser surface was available
for Playwright/CUA. A local FE server was started with:

```text
npm run dev -- --host 127.0.0.1
```

It served `http://127.0.0.1:5173/app` with HTTP 200 (Vite session 52527); no
local BE was started and no authenticated data was available. Therefore no QA
account, source document, real map ID, generation status sequence, persisted V2
record, 15+ node structural proof, screenshot, console, network, or live UI
result is claimed. The visual verification map is: **none**.

## Dirty-tree boundary

The pre-existing BE worktree remains dirty and unstaged. Mind Map V2-related
files in this pass are the FE adapter/layout/normalizer/viewer/test files,
`BE/services/mindmap/pipeline/schema.py`, `outline.py`,
`BE/app/graphs/mindmap_graph.py`, new
`BE/services/mindmap/pipeline/v2_constraints.py`, its focused test, and the
existing schema test. No unrelated BE files were reset, restored, staged,
committed, or pushed.

## Gate A — code candidate

**NOT COMPLETE — scope hygiene correction required.** The exact V2 fixture
assertion now separates the legacy stage failures (`enrich`, `relations`) from
the required structural flags for the deliberately one-branch V2 fixture, and
all relevant tests are green. However, post-push diff audit found that
`cbeb475` also contains pre-existing dirty WIP hunks in
`mindmap_graph.py`, `outline.py`, `schema.py`, and `test_mindmap_graph.py`.
Those hunks were not isolated before staging. The candidate therefore does not
yet satisfy the required “no unrelated BE WIP” Gate A condition. No force-push
or destructive cleanup was performed; a surgical ownership decision is needed
before this can be called a clean release candidate.

## Gate B — deployed live acceptance

**BLOCKED.** The V2 candidate is not a clean isolated BE release yet and is
not deployed. No authenticated real
generation, persisted 15+ node map, screenshots, browser console/network
evidence, or live UI result is claimed. Gate A must be committed and pushed
before this gate can begin.

The exact target for the authorized deployment is:

- Frontend: `https://studymap.space/app`
- API: the configured production API used by that frontend
- Expected deployed candidate SHA: `335f196` (or a later main merge SHA that
  contains `7f74d73`, `cbeb475`, and `335f196`)
- QA data requirements: disposable account; document/map names beginning
  `QA-MINDMAP-V2-`; no real-user data and no fabricated records.

When Chromium is available, the live runner should be invoked as:

```text
BASE_URL=https://studymap.space/app QA_EMAIL=<disposable-account> QA_PASSWORD=<password> python tools/mindmap_v2_live_acceptance.py
```

The checked-in harness captures browser/network evidence and basic V2 chrome
invariants; the QA operator must extend the same run with the real upload and
generation steps before calling Gate B green. It must capture the generation
request/status sequence, returned map
ID, persisted hierarchy counts, light/dark screenshots at 1440x1024, 1024x768,
and 390x844, console errors, unhandled rejections, and failed requests. This
environment has no usable browser surface and Playwright Chromium cannot spawn
under the current sandbox, so that command has not been claimed as run.
