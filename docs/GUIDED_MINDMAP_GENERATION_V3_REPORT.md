# Guided Mind Map Generation V3 — implementation report

## Scope and provenance

- Worktree: `E:\memvid_NCKH\guided-mindmap-v3`
- Branch: `feature/guided-mindmap-generation-v3`
- Base: `origin/main` at `eff9f62904efb0e72279d495d26ebb8ef48e8041`
- `168541b` is an ancestor of `origin/main`; `cbeb475` is not.
- The original worktree's dirty BE WIP was not modified, staged, copied, stashed,
  or reset. The only reused UI source was the already-committed shared-inspector
  change `f6cd46f` from `feature/studymap-workspace-v3`; it was ported as FE
  source, not as a dirty diff.

## Delivered architecture

The clean branch now has one `ContextInspector` owner in `MainLayout` for Chat,
Summary, and Mind Map. The canvas no longer mounts a parallel Mind Map drawer.
Summary section selection updates the shared inspector context. Mind Map node
selection fetches persisted context through:

`GET /mindmaps/{map_id}/nodes/{node_id}/context`

The BE mapper reads only the stored map record, index metadata, and persisted
chunk text. It does not call an LLM or enqueue a generation job. It returns
`node_id`, `topic`, `explanation`, `node_type`, optional persisted confidence,
owner-verified citations, relations, `missing`, and `degraded`. Foreign source
chunks are omitted rather than guessed or fabricated.

## Commits

- FE: `50941f9`, `0d7b77c` — shared inspector wiring and ask-about context propagation
- BE: `97d5f00`, `e2efb9e` — persisted node context endpoint and query-job propagation
- Tests: `6d7b7a2` — `test: cover shared inspector and node context mapping`
- Docs: this report (commit created after verification)

## Tests and verification

- BE focused mapper tests: **PASS — 4 passed**.
- Python syntax compile for the changed BE files: **PASS**.
- FE tests/build/lint: **BLOCKED in this clean worktree**. `npm install`
  failed while running the Windows `esbuild.exe` install step with `EBUSY`
  (resource busy/locked); consequently `vitest`, `vite`, and `eslint` binaries
  were unavailable. This is an environment blocker, not reported as a pass.
- `git diff --check`: run for scoped changes; no whitespace error was reported.
- Live account/document/map E2E and screenshot comparison: **not claimed**.
  No CORS bypass, mock production mode, deployment, or production config change
  was used.

## Gate conclusion

**LIVE GATE B BLOCKED BY CORS / local verification environment.** The persisted
node-context contract and FE wiring are implemented, but this branch is not
reported as overall complete or ready for production until FE dependencies,
fixture-backed browser screenshots, and live account/document/map verification
run on an origin with valid CORS.

No BE changes were made in the original dirty worktree. No merge or deploy was
performed.

## Verification rerun (HEAD `473323f`)

### EBUSY/EPERM diagnosis and recovery

The clean worktree had no `node.exe`, `esbuild.exe`, Vite, or Vitest process whose
command line or executable path belonged to `E:\memvid_NCKH\guided-mindmap-v3`.
The unrelated Node processes were MCP/CUA tooling or npm global tooling in other
paths and were not stopped. `npm cache verify` initially hit a locked global
cache entry, then completed successfully after a read-only elevated retry:
2,983 entries verified, 1,096 garbage-collected by npm's verifier. No global
cache-clean command was used.

The only removed path was:

`E:\memvid_NCKH\guided-mindmap-v3\FE\node_modules`

The first `npm ci` attempt hit `EPERM` creating that directory under the
restricted shell. A second `npm ci --foreground-scripts` under the permitted
verification environment succeeded: 464 packages added, esbuild and
Tailwind postinstall completed. The original EBUSY cause was therefore a
Windows file/permission lock around the local dependency tree/esbuild worker,
not a process owned by this clean worktree.

### FE results

| Command | Result |
|---|---|
| `npm test -- --run` | PASS — 96 files, 1,077 tests, 56.84s |
| `npm run build` | PASS — 2,372 modules, 19.50s |
| `npm run lint` | FAIL — 60 errors, 6 warnings; existing repository debt in ChatArea, Markdown, knowledgeParts, Toaster, hooks, utils, config. Changed-file lint reports the same pre-existing errors at unchanged lines; no new error points to the added context endpoint/wiring lines. |
| `git diff --check` | PASS |

Build emitted the existing Browserslist stale-data notice. No console/browser
runtime verification was claimed from this command-line run.

### BE results

| Command | Result |
|---|---|
| Focused V2/schema/relations/mapper suite (10 files) | PASS — 59 passed, 4 warnings, 7.82s |
| Auth/ownership/API suite (5 files) | PASS — 42 passed, 4 warnings, 19.81s |
| Full `test_mindmap*.py` suite | BLOCKED/FAIL — 86 passed, 1 failure (`test_generate_mindmap_and_poll`, SQLite `unable to open database file`), and collection error in `test_mindmap_service.py` because `shared.proto.gen` is unavailable in this checkout. |
| Changed BE syntax compile | PASS |

The full suite was not reported as green. The service/model-dependent test was
not replaced by a fake pass.

## Guided Mind Map V3 coverage audit (`origin/main...473323f`)

| Capability | Status | Evidence |
|---|---|---|
| Shared Context Inspector for Chat/Summary/Mind Map | Implemented | `FE/src/components/Layout/ContextInspector.jsx`, `MainLayout.jsx`, `SidebarRight.jsx`; `ContextInspector.test.jsx` |
| Guided creation modal | Missing | No guided-creation component or new modal flow in branch diff |
| Custom instruction | Missing | No guided instruction field/API contract |
| Suggested topics | Missing | No guided topic suggestion symbol/flow |
| Preset/detail level | Missing | No guided preset/detail-level state or payload |
| Guided API contract | Missing | Only node context GET was added; no guided-generation contract |
| Async guided job/progress | Missing | Existing legacy mind-map job remains; no guided job state added |
| Backend authorization/idempotency for guided generation | Missing | Existing legacy ownership remains; no new guided route/idempotency key |
| Guided retrieval/planning | Missing | No new guided planner/retriever path |
| V3 validator/schema | Partial | Existing V2 `schema.py` validator is reused; no new Guided V3 schema/validator |
| Node citations/relations payload | Implemented | `BE/app/domains/mindmap/context.py`, `GET /mindmaps/{map_id}/nodes/{node_id}/context`; mapper tests |
| V2 backward compatibility | Partial | Existing V2 normalizer/schema tests pass; context endpoint reports missing/degraded for absent evidence |
| Runtime uses persisted data, not FE mock | Implemented for inspector | `mindmapNodeContext.js` fetches BE context; no production mock-data mode added |

Therefore this branch is a **PARTIAL IMPLEMENTATION** of the larger Guided Mind
Map V3 epic: it delivers the Shared Context Inspector backend contract and
query-context propagation, but not the guided-generation pipeline itself.

## Fixture-backed visual QA

No runnable fixture/component harness for authenticated Chat/Summary/Mind Map
states was present in this checkout. The available local UI can render the
empty unauthenticated shell, but that cannot prove right-rail content,
selection, collapse/viewport preservation, guided modal states, or mobile
bottom-sheet behavior. No fabricated screenshot paths are recorded.

**FIXTURE VISUAL GATE BLOCKED** — live authenticated data and a fixture harness
are still required. This is separate from the passing FE automated suite.

## Guided Generation implementation pass (after d2452e7)

This pass implements a first vertical slice in the clean worktree
`E:/memvid_NCKH/guided-mindmap-v3`, branch
`feature/guided-mindmap-generation-v3`. The original dirty BE worktree was not
edited, staged, stashed, reset, or cleaned.

Commits:

- `8d2f2f0` — Guided FE dialog, source summary, API payload, topic loading, and the existing library/empty-state owner wiring.
- `4d705d7` — Suggested-topic route, readiness/ownership/idempotency contract, guided intent propagation, schema V3 metadata and validator.
- `bfa67bb` — FE dialog and deterministic Guided V3 regression tests.

Final SHA for this pass: `fa01273478d7489122028bbd408a78d60137ef66`.

Coverage implemented: desktop modal/mobile bottom sheet; custom instruction,
purpose and detail level; backend-derived suggestions from selected indexed
chunks; source ownership/readiness validation; idempotency response and status
URL; real outline/enrichment prompt intent propagation; V3 guided metadata and
validator; persisted node context/citations/relations; and V2-compatible
default schema behavior. Full adaptive retrieval/planning/repair acceptance is
still partial and is not claimed complete.

Verification:

- FE: `npm test -- --run` PASS, 97 files / 1,079 tests; `npm run build` PASS, 2,373 modules; changed-file ESLint PASS with 0 errors and 0 warnings.
- Repository lint: FAIL WITH BASELINE, 60 errors and 6 warnings, all in unrelated existing debt; no changed-file findings.
- BE relevant Mind Map/Guided suite: PASS, 85 tests and 5 warnings.
- `python scripts/build_proto.py`: PASS; generated protobuf modules are ignored build artifacts.
- `git diff --check`: PASS.

The earlier SQLite failure was reproduced as a permission problem creating
isolated test database/checkpoint files and passed in the permitted isolated
run. The `shared.proto.gen` collection error was caused by generated modules
missing from the checkout and was fixed by the repository generation script;
production configuration was not changed.

No authenticated account/document/map, model-provider credential, or fixture
browser harness was available. Therefore no visual screenshot or real-provider
generation pass is claimed. The original BE dirty worktree remains byte-for-byte
untouched.

## Final verdict

- **LOCAL FE GATE: FAIL** — tests/build pass; repository lint fails on existing lint debt.
- **LOCAL BE GATE: BLOCKED/FAIL** — deterministic targeted groups pass, full Mind Map suite has the documented collection/environment failures.
- **FIXTURE VISUAL GATE: BLOCKED** — no authenticated fixture harness available.
- **IMPLEMENTATION SCOPE: PARTIAL** — Guided BE generation/planning pipeline is not present in this branch.
- **LIVE GATE B: BLOCKED BY CORS** — no real account/document/map acceptance was claimed.
