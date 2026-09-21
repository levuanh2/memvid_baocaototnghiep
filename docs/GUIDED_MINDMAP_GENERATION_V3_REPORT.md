# Guided Mind Map Generation V3 — implementation report

## CURRENT AUTHORITATIVE STATUS — Production Durability Round

This section supersedes the earlier release-hardening verdicts below. Those
sections are historical evidence and must not be read as the current gate state.

- Worktree: `E:\memvid_NCKH\guided-mindmap-v3`
- Branch: `feature/guided-mindmap-generation-v3`
- Pre-round HEAD: `089735921b2d242c0b5215b60a6ea62b4adf7275`
- Current pre-report HEAD: `eb25c2c` (`fac55bf`, `35f0a42`, `fd9f3b7`, `eb25c2c` are the new commits)
- `168541b` is an ancestor; `cbeb475` is not an ancestor.
- The original main worktree BE WIP was not edited, staged, reset, stashed, or cleaned.

### Durable architecture

Guided V3 now selects `BE/app/domains/jobs/guided_store.py`: production web and
worker processes use `JOBS_DATABASE_URL` or `DATABASE_URL` and fail closed when
the Postgres ledger is unavailable. The additive Alembic migration
`20260921_guided_job_ledger` creates `guided_mindmap_jobs` and
`guided_mindmap_worker_heartbeats`; it is forward-only on downgrade so a
controlled rollback does not delete job history.

The web process only inserts a durable row and returns 202 for Guided requests.
`python -m app.jobs.guided_worker` is the supervised worker entrypoint
(`PROCESS_ROLE=mindmap-worker`). Claiming uses `FOR UPDATE SKIP LOCKED`, leases,
heartbeat renewal, bounded retry/backoff, and result-hash reconciliation before
a provider call. The worker reconstructs source input from source IDs and guided
config; document content and credentials are not stored in the job row.

Required variable names (values intentionally omitted): `DATABASE_URL` or
`JOBS_DATABASE_URL`, `PROCESS_ROLE`, `GUIDED_JOB_STORE_BACKEND=postgres`,
`GUIDED_WORKER_HEARTBEAT_TTL_SEC`, `GUIDED_JOB_LEASE_SECONDS`,
`GUIDED_JOB_MAX_ATTEMPTS`, `GUIDED_WORKER_POLL_SECONDS`, and the existing real
provider variables (`GEMINI_API_KEY`/other configured provider). Render now has
a separate paid `studymap-mindmap-worker` definition; no worker was created or
deployed. Global Guided remains OFF and V2 remains the fallback.

### Gate evidence

| Gate | Status | Evidence |
|---|---|---|
| DURABLE JOB CODE GATE | PASS | Postgres ledger, atomic idempotency, lease claim, heartbeat worker, fail-closed production selection; `BE/tests/test_guided_release_hardening.py` 7 passed and AST/import checks passed. |
| POSTGRES INTEGRATION GATE | BLOCKED | New `BE/tests/test_guided_postgres_store.py`: 3 skipped because `TEST_DATABASE_URL` is absent; no `psql`, Docker daemon unavailable. No production DB was used. |
| DEPLOY-LIKE RESTART GATE | BLOCKED | Cannot run web+worker against a disposable Postgres without the same missing test database. SQLite is not substituted for this gate. |
| CONTROLLED DEPLOYMENT CANDIDATE | NO | Postgres integration and deploy-like restart evidence are still blocked. |
| PRODUCTION DURABILITY PROOF | BLOCKED | Requires controlled QA deployment and restart/recovery observation. |
| REAL PROVIDER GATE | BLOCKED | No credential was read or printed in this round; QA deployment is required. |
| PRODUCTION ENABLEMENT | NO | `GUIDED_MINDMAP_V3_ENABLED=false`; V2 fallback preserved. |

### Configuration and integrity

Render web uses `PROCESS_ROLE=web`, exact CORS `https://studymap.space`, and
`GUIDED_JOB_STORE_BACKEND=postgres`; the worker uses the same code revision and
database with `PROCESS_ROLE=mindmap-worker`. The existing `JOBS_DB_PATH` is
legacy-only configuration and is not selected by Guided production code.
Migration is additive and repeat-safe through Alembic. Rollback means deploy
the prior application with the new tables retained; destructive table removal
requires a separately approved cleanup migration. The main worktree still has
the pre-existing BE WIP files only; this round did not touch them.

### Verification run

- FE `npm test -- --run`: exit 0, **1088/1088 passed** (98 files), 17.08s.
- FE `npm run build`: exit 0, Vite production build completed, 2373 modules transformed.
- FE repository lint `npx eslint src`: exit 1, **58 errors / 6 warnings**; unchanged baseline class and outside this BE durability scope. No FE files changed.
- BE relevant command: `PYTHONPATH=BE pytest -q BE/tests/test_guided_mindmap_v3.py BE/tests/test_guided_release_hardening.py BE/tests/test_mindmap_node_context.py BE/tests/test_mindmap_routes.py BE/tests/test_mindmap_schema_v2.py BE/tests/test_mindmap_v2_constraints.py BE/tests/test_mindmap_relations.py BE/tests/test_mindmap_graph.py BE/tests/test_mindmap_store.py BE/tests/test_cors_methods.py BE/tests/test_migration_guard.py BE/tests/test_production_migration_contract.py BE/tests/test_guided_postgres_store.py`: exit 0, **68 passed / 15 skipped**, 15.62s. Postgres tests are the 3 skips inside that total.
- Narrow hardening command: `PYTHONPATH=BE pytest -q BE/tests/test_guided_release_hardening.py`: exit 0, **7 passed**.
- `git diff --check`: exit 0. Python AST parse of changed Python files: exit 0.
- Postgres probe: no `TEST_DATABASE_URL`, no `psql`, and Docker daemon was unavailable; no production or shared database was contacted.

Historical sections follow.

### WIP boundary update — authoritative after `0239751`

Claude's read-only WIP review confirms that the original dirty main worktree is
a separate backend initiative: Document AST, Semantic AST, Citation Engine V2,
enrichment rewrite, validators, and Adaptive Skeleton. Guided V3 and that WIP
are **not integrated** and this branch is not claimed to be cleanly mergeable
with it.

Integrity snapshot before this boundary-only report change:

- starting HEAD: `0239751a3fecabb42a7bb759e4168c2a8b45f5ff`
- `BE/services/mindmap/pipeline/enrich.py`: `4e6d0a5a1bb5fb39115590576ca60638b11288ab`
- `BE/app/clients/mindmap_factory.py`: `1336bfa8e3e8116aa452d3b18ea842c8b637f42f`
- WIP-owned paths `BE/services/document_ast/`, `BE/services/semantic_ast/`,
  `BE/services/citation/`, `BE/services/mindmap/analytics/`, and the listed
  Adaptive Skeleton modules are absent at this clean-branch HEAD; their dirty
  main-worktree files were not read, copied, or staged.

Boundary rules for this round: no changes to `enrich.py`, `mindmap_factory.py`,
extraction/cleaning/chunking, Document AST, Semantic AST, Citation Engine V2,
or Adaptive Skeleton/concept-extraction core. `context.py` remains only the
temporary compatibility adapter used by Shared Context Inspector. Integration
debt is explicit: **replace the persisted legacy context provider with the
Citation Engine V2 provider after the WIP contract stabilizes**. The current
endpoint remains because Guided UI depends on it.

Future integration must use a dedicated integration branch with WIP-owner
review. `enrich.py` and `mindmap_factory.py` have known future merge conflicts;
they must not be resolved with `ours` or `theirs`. The temporary `context.py`
adapter is likely to be superseded when Citation Engine V2 is wired into the
endpoint.

Post-change proof: `git diff --name-only 0239751a3fecabb42a7bb759e4168c2a8b45f5ff..HEAD`
contains only this report. No new commit touches `enrich.py`,
`mindmap_factory.py`, or any WIP-owned path. The original main worktree remains
dirty with its pre-existing WIP and was not modified, staged, reset, stashed, or
cleaned.

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

## Latest semantic-generation pass (after `ab447cb`)

The clean worktree stayed isolated from the original dirty BE WIP. The latest
implementation is split into these commits:

Final implementation SHA before report-only commits: `fd6dce1`. The current
branch tip is the report-only commit that records this verification.

- `ef2e379` — adaptive, evidence-backed Guided V3 planner wired into the graph.
- `c57c03e` — V3 validator, bounded repair, relation/citation checks, and BE tests.
- `e0a2e6b` — FE guided dialog readiness/idempotency payload and job lifecycle coverage.
- `32d6467` — test-only fixture harness for the real guided dialog.
- Docs commit: this report update.

### Coverage matrix

| Capability | Before | After | Evidence/tests |
|---|---|---|---|
| Shared Context Inspector | Implemented | Implemented | `ContextInspector.jsx`, `MainLayout.jsx`, node-context tests |
| Guided dialog/custom instruction/topics | Implemented | Implemented | `GuidedMindmapDialog.jsx`, dialog tests |
| Preset/detail propagation | Adapter only | Implemented in intent/planning config | `guided.py`, `guided_planner.py`, planner tests |
| Source-backed suggestions | Implemented | Implemented | `suggest_topics`, ownership/readiness route tests |
| Guided API/job/idempotency | Implemented | Implemented | guided route/job tests; FE job tests |
| Retrieval/planning | Adapter only | Implemented deterministic evidence-backed planner | `plan_guided`, multi-source/query/budget tests |
| Adaptive hierarchy/relations | Missing/partial | Implemented bounded planner | `guided_planner.py`; process/contrast tests |
| V3 schema/validator/repair | Partial | Implemented | `schema.py`, duplicate/orphan/relation/repair tests |
| Persistence/node context | Implemented | Implemented | `context.py`, node-context suite |
| V2 compatibility | Partial | Preserved | schema V2 tests, relevant suite |
| Runtime mock fallback | Unknown | No production mock fallback; provider absence fails closed | graph provider guard; test-only fakes |

### Actual call graph

`GuidedMindmapDialog` → `suggestMindmapTopics` / guided generate service →
`POST /mindmaps/generate` → persisted async job → `build_mindmap_graph` →
`collect_input` → `LocalMindmapPipeline.guided_plan` → indexed-chunk selection
and query plan → configured-provider enrichment/relations → `build_record` →
`validate_v3_record` → bounded `repair_v3_record` → persisted map → Mind Elixir /
Shared Context Inspector. Node selection reads persisted context and does not
start a generation job or call an LLM.

The production guided path checks the provider registry and fails with
`guided_provider_not_configured` when no provider is configured. Deterministic
fakes are used only in tests; the fixture harness injects only topic suggestions
for UI state setup and is not imported by the production entrypoint.

### Verification

- FE `npm test -- --run`: **PASS — 98 files, 1085 tests, 8.51s**.
- FE `npm run build`: **PASS — 2373 modules, 11.63s**.
- Changed-file ESLint: **PASS — 0 errors, 0 warnings**.
- Repository `npm run lint`: **FAIL WITH BASELINE — 60 errors, 6 warnings**;
  findings remain in pre-existing files and do not occur in changed feature files.
- Relevant BE Mind Map/Guided command: **PASS — 88 tests, 5 warnings, 15.43s**.
- `git diff --check`: **PASS**.
- Fixture harness: served at `FE/qa/guided-mindmap-harness.html`; DOM harness
  tests pass. PNG screenshots are **not available** because Playwright is not
  installed/cached and no browser provider is available; no path is fabricated.

### Remaining blockers and verdict

- Real model-provider generation was not run because no configured provider
  credential was available in this environment.
- Fixture visual screenshots are blocked by the missing browser/Playwright
  runtime, although the test-only harness is present and served locally.
- Live account/document/map acceptance remains unverified; no CORS or production
  configuration was changed.

**IMPLEMENTATION: PARTIAL**

**LOCAL FE PASS**

**LOCAL BE PASS**

**FIXTURE VISUAL BLOCKED**

**REAL LOCAL GENERATION BLOCKED**

**LIVE GATE B BLOCKED**

The original BE WIP worktree remains untouched; no merge, deploy, force-push,
or `cbeb475` ancestry was introduced.

- **LOCAL FE GATE: FAIL** — tests/build pass; repository lint fails on existing lint debt.
- **LOCAL BE GATE: BLOCKED/FAIL** — deterministic targeted groups pass, full Mind Map suite has the documented collection/environment failures.
- **FIXTURE VISUAL GATE: BLOCKED** — no authenticated fixture harness available.
- **IMPLEMENTATION SCOPE: PARTIAL** — Guided BE generation/planning pipeline is not present in this branch.
- **LIVE GATE B: BLOCKED BY CORS** — no real account/document/map acceptance was claimed.
## Fixture visual gate and release-readiness audit (2026-09-21)

This section supersedes the earlier browser-blocked fixture note above. The
approved reference PNGs named `e00640ad-e749-4706-8671-9d869f6f4616.png` and
`7ff064b6-a4f3-4125-9a0b-ccb59060fe82.png` were not present in this clean
worktree's `docs/`, so no pixel-diff comparison against those files was possible.

### Browser and fixture runtime

- System browser: `C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe`.
  File version: **153.1.95.104**; Python Playwright reported browser version
  **153.0.8010.53**.
- Python: `C:\Users\Vu Anh\AppData\Local\Programs\Python\Python311\python.exe`.
  Python Playwright **1.60.0** launched Brave with `executable_path` directly.
  Node Playwright and `playwright-core` were not installed; no browser bundle
  was downloaded.
- Probe/help command: `python "C:\Users\Vu Anh\.codex\skills\webapp-testing\scripts\with_server.py" --help` (exit 0).
- Fixture server: `npm run dev -- --host 127.0.0.1 --port 4173` (exit 0).
- Capture command: `python qa/capture_guided_mindmap_fixture.py` (exit 0).
- The harness is test-only (`FE/qa/guided-mindmap-harness.html` and
  `GuidedMindmapHarness.testonly.jsx`), renders production components, and is
  absent from the production bundle (`dist/qa` absent; no fixture harness strings
  found in `dist`). Fixture route responses are injected only by the QA script.

### Screenshot manifest

All files are under `docs/qa-screenshots/guided-mindmap-v3/`:

- `guided-dialog-desktop-light.png`, `guided-dialog-desktop-dark.png`
- `guided-dialog-tablet-light.png`, `guided-dialog-tablet-dark.png`
- `guided-bottom-sheet-mobile-light.png`, `guided-bottom-sheet-mobile-dark.png`
- `guided-dialog-loading-desktop.png`, `guided-dialog-empty-desktop.png`,
  `guided-dialog-error-desktop.png`, `guided-dialog-ready-desktop.png`
- `guided-workspace-inspector-desktop.png`,
  `guided-workspace-inspector-tablet.png`,
  `guided-workspace-inspector-mobile.png`

The captures cover 1440x1024 desktop, 1024x768 tablet, and 390x844 mobile,
light/dark dialog states, suggestion loading/empty/error/ready states, and the
real Shared Context Inspector shell in desktop/tablet/mobile fixture states.
The fixture does **not yet** capture generation progress/failed-retry states or
the multi-map library state, so the required fixture gate is not closed. The
fixture also cannot prove real provider generation or live Chat/Summary data.

### Interaction and DOM checks

- Console errors: **0**; page errors/unhandled Playwright page errors: **0**.
- `document.documentElement.scrollWidth > clientWidth`: **false** for every
  capture; no horizontal overflow observed.
- Escape closed the dialog: **true**. Mobile close control measured 40x40;
  topic chips measured at least 40px high; primary CTA remained a full-width
  touch target. Focus restoration and duplicate-submit protection are covered by
  the focused dialog tests (7/7 pass); the synchronous submit guard prevents a
  rapid double click from creating a second request.
- Fixture states rendered the actual production dialog and inspector. Existing
  FE tests cover source readiness, payload propagation, job lifecycle, library
  updates, Mind Elixir preservation, and V2 compatibility. Live provider job
  transitions, account-backed map switching, and real viewport preservation were
  not claimed here.

### Release-readiness audit

| Check | Status | Evidence | Deployment action |
|---|---|---|---|
| V3 API compatibility | PASS | Guided fields are optional on the existing generate route; legacy V2 tests pass | Keep optional defaults during rollout |
| V2 map open/compatibility | PASS | V2 schema/lifecycle regression coverage passes | Keep explicit legacy/upgrade path |
| DB migration | PASS | No new V3 migration in this branch; existing startup migration remains | Run existing migration procedure before release |
| Async worker/restart durability | PARTIAL | Render has `QUEUE_ENABLED=false`; guided jobs use process-local async execution and `/tmp` job state | Use durable worker/queue and persistent job storage before production rollout |
| Required environment | PARTIAL | Render declares `DATABASE_URL`, Supabase secrets, and `GEMINI_API_KEY` as `sync:false` | Provision and verify secrets without logging them |
| Provider binding/fail-closed | PASS | Production graph checks configured provider; missing provider raises `guided_provider_not_configured` | Keep Gemini/provider health check; do not fall back to fixtures |
| Retry/idempotency across restart | PARTIAL | In-memory idempotency prevents same-process double submit but is lost on restart | Persist idempotency/job state or use durable queue semantics |
| API timeout/proxy | PARTIAL | LLM timeout is 110s and Gunicorn timeout 120s; static production FE uses `VITE_API_BASE` | Verify proxy/load-balancer timeout exceeds worst-case job request |
| Storage compatibility | PARTIAL | Existing Supabase/Postgres map store is reused; `/tmp/studymap` is ephemeral | Move job artifacts/ledger off ephemeral disk |
| Feature flag/rollback | PARTIAL | No dedicated guided-generation production flag; branch revert is available | Add controlled rollout flag before enabling broadly |
| Production CORS | BLOCKED | Current Render value is `https://studymap-web.onrender.com`; `https://studymap.space` is not configured | Configure the allowed production origin at deployment; do not add localhost |

### Current verification and commits

- FE after the visual changes: **1087/1087 tests pass**, production build
  **2373 modules**, changed-file lint **0 errors / 0 warnings**, and
  `git diff --check` clean. Repository lint remains **60 errors / 6 warnings**
  baseline in unrelated files.
- Relevant BE suite remains **88 pass / 5 warnings** from the prior verified
  run; no BE file changed in this visual round.
- Visual commits: `902b401`, `4bbd781`, `a584279`.
- Fixture/screenshot commit: `8f2c352`.
- Source/visual tip before this report commit: `8f2c352`.
- The main worktree's dirty BE WIP was not modified, staged, stashed, reset, or
  cleaned. No merge, deploy, force-push, CORS/config edit, or `cbeb475` ancestry
  was introduced.

### Final verdict for this round

**FIXTURE VISUAL FAIL** — the captured dialog/inspector screenshots and DOM
checks pass, but required generation progress/failed-retry and multi-map library
captures are missing; the approved reference files were also unavailable for
pixel comparison.

**IMPLEMENTATION PARTIAL** — the prior implementation status remains partial;
fixture capture does not turn provider-backed generation into a live proof.

**RELEASE CANDIDATE NO** — durable jobs/idempotency, production origin CORS, and
controlled rollout actions remain unresolved.

**REAL LOCAL GENERATION BLOCKED** — no provider credential was used in this
environment.

**LIVE GATE B BLOCKED** — no account/document/map acceptance on the deployed
origin was claimed.
## Release hardening round (2026-09-21)

### Durable Guided jobs and idempotency

The existing SQLite jobs store is now the durable ledger for Guided requests.
Its additive startup migration adds `map_id`, `result_map_id`,
`idempotency_key`, `request_fingerprint`, `source_ids_json`,
`guided_config_json`, `stage`, `attempts`, lease timestamps/owner, terminal
timestamps, and structured `error_code`. A partial unique index on
`(user_id, idempotency_key)` makes same-user concurrent creation atomic.

Same key plus same fingerprint returns the existing job; same key plus a
different fingerprint returns `409 idempotency_conflict`. The worker claims a
job with an atomic lease update, increments attempts, rejects a second active
claim, and turns expired running leases back to `pending`. Startup recovery can
rebuild `mm_input` from persisted source IDs and guided configuration; document
chunks and credentials are not stored in the job row. The existing map
persistence/content-hash path remains the deduplication boundary for result
save.

This closes the in-process idempotency gap, but the current Render deployment
still points `JOBS_DB_PATH` at ephemeral `/tmp/studymap/jobs.sqlite` and keeps
`QUEUE_ENABLED=false`. Therefore restart durability across a Render instance
replacement is **not yet production-proven**. A persistent disk or Postgres job
ledger plus a supervised worker is still required before enabling the feature
globally. Forward migration is additive and idempotent; rollback is to deploy
the previous code after preserving the new nullable columns (no destructive
rollback is required).

### Server-authoritative rollout

`GET /mindmaps/capability` returns `guided_mindmap_v3` and `fallback: v2`.
`GUIDED_MINDMAP_V3_ENABLED=false` is the tracked production default;
`GUIDED_MINDMAP_V3_QA_USER_IDS` is an out-of-band QA allowlist. With global OFF,
non-QA users receive a fail-closed `guided_v3_disabled` response from Guided
endpoints while the FE falls back to the existing V2 generate flow. Capability
fetch failure also fails closed for Guided UI and leaves V2 available. With
global ON, authenticated eligible users may use Guided V3. Client state is not
the security boundary.

### Effective production CORS

Tracked Render configuration now sets the exact allowlist origin to
`https://studymap.space`, with no wildcard and no localhost. No `www` origin was
added because that is not the confirmed production route. Flask-CORS retains
the existing Authorization/Content-Type headers and GET/POST/PUT/PATCH/DELETE/
OPTIONS methods. No deployment was performed; preflight must be rechecked after
the deployment environment applies the tracked value.

### Fixture visual manifest

The Brave/Python Playwright fixture capture now includes:

- `guided-generation-progress-desktop-light.png`
- `guided-generation-failed-desktop-light.png`
- `guided-generation-failed-desktop-dark.png`
- `guided-generation-progress-mobile-light.png`
- `guided-generation-failed-mobile-light.png`
- `guided-mindmap-library-desktop-dark.png`
- `guided-mindmap-library-tablet-inspector.png`

The prior dialog, suggestion, and Shared Inspector captures remain in the same
directory. The new library uses production `ModeLibraryMenu` with three maps,
active-map state and a long-title truncation case; the dialog progress/failed
states use the real `GuidedMindmapDialog`. Capture command exited 0 at 1440x1024,
1024x768, and 390x844. Console errors: 0. Page errors: 0. Horizontal overflow:
false for every record. Touch-target probe retained a 40x40 close control and
40px-high topic chips.

### Verification

- FE full suite: **1088/1088 pass**, 98 files.
- FE production build: **pass**, 2373 modules.
- Changed JS/JSX lint: **0 errors / 0 warnings**. QA Python was AST-checked;
  ESLint correctly ignores `.py`.
- Relevant BE hardening + Guided/Mind Map/job/queue suite:
  **74 pass, 4 warnings**.
- `git diff --check`: clean.
- Repository lint remains the existing baseline: **60 errors / 6 warnings**;
  unrelated findings were not changed.

### Release plan (not executed)

1. Merge candidate/deploy with `GUIDED_MINDMAP_V3_ENABLED=false`, apply the
   additive jobs migration, provision durable job storage/worker, and verify
   health/recovery.
2. Set only `GUIDED_MINDMAP_V3_QA_USER_IDS` for QA. With the configured Gemini
   provider, create a real map from an owned document, verify suggestions,
   citations, typed relations, reload and Inspector context, then restart the
   worker/app and verify recovery/idempotency.
3. If Gate B passes, enable globally. If it fails, set the global flag OFF;
   V2 remains available. Preserve the nullable migration columns on rollback.

### Verdict

**FIXTURE VISUAL PASS**

**DURABLE JOB GATE FAIL** — SQLite schema/atomic idempotency/lease recovery are
implemented and tested, but the current `/tmp` deployment storage and disabled
queue do not prove restart durability in production.

**CORS GATE PASS** — tracked production allowlist is exactly
`https://studymap.space`; deployment application/preflight remains pending.

**ROLLOUT GATE PASS** — server capability, QA allowlist, safe default and V2
fallback are implemented and tested.

**IMPLEMENTATION PARTIAL**

**CONTROLLED DEPLOYMENT CANDIDATE NO** — durable storage/worker hardening must
precede even a QA deployment candidate.

**PRODUCTION ENABLEMENT NO** — real provider Gate B has not passed.
