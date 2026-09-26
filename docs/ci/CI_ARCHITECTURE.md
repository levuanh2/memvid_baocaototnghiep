# CI Architecture & Test Pyramid Specification

**System**: StudyMap / MemVid Platform
**Target Repository**: `levuanh2/memvid_baocaototnghiep`
**Architecture Version**: 2.1 — adds real deterministic browser E2E
(`e2e-critical`), an ESLint ratchet, and a dependency-review security gate on
top of AGY's v2.0 DAG. See `CI_AUDIT.md` §0 for the discrepancies this pass
found and fixed against v2.0's own text (stale lint count, aspirational
Redis options, wrong cron time, a "Layer 7 E2E" that was actually a
pure-Python simulation with no browser and no HTTP involved).

## Required PR CI vs. Main-branch CI vs. Scheduled/manual

Three distinct tiers, not one undifferentiated pipeline:

- **Required PR CI** (`ci.yml`, on `pull_request` — this is what the
  `CI / required` check gates): static/security (`security-and-static`,
  `dependency-review-action`), unit (`frontend-tests`,
  `backend-contracts-and-unit`), migration + integration
  (`backend-integration-and-smoke`), deterministic browser E2E
  (`e2e-critical`), build & container checks (`frontend-build`,
  `docker-build-test`, `docker-compose-run-test`), aggregated by
  `ci-success`. Path-filtered per §3 below — a docs-only PR legitimately
  skips the heavy jobs, and `ci-success` still passes (see §8).
- **Main-branch CI** (`ci.yml`, on `push` to `main`): the SAME workflow, but
  every job's `if:` has a `github.ref == 'refs/heads/main'` escape hatch —
  the full required gate always runs unconditionally on `main`. `deploy.yml`
  (`workflow_run`-triggered off `CI`'s completion, gated on
  `conclusion == 'success'`) then actually ships the change — see §8.
- **Scheduled/manual** (`live-integration.yml`): live FPT/EC2 provider
  health, weekly cron + `workflow_dispatch`. Never blocks a PR or a deploy
  — see §5.

---

## 1. Test & Gate Model for StudyMap

```text
               ▲
              / \
             /   \      [Layer 9] Release / Deploy Gate (Main branch only, post-CI)
            /     \     [Layer 8] Production Build & Container Verification
           /       \    [Layer 7] Smoke Tests (Health & Readiness)
          /         \   [Layer 6] Deterministic Browser E2E (Playwright, real FE + real BE, mocked LLM)
         /           \  [Layer 5] Database / Migration Safety Checks
        /             \ [Layer 4] API / Contract Tests (FE/BE Interface Integrity)
       /               \[Layer 3] Integration Tests (Service Containers, DB + Store)
      /                 \[Layer 2] Component & Unit Tests (Vitest + Pytest)
     /                   \[Layer 1] Static Quality (Lint, Compile, Diff, Security)
    ◄─────────────────────►
```

### Applied Layers & Rationales

| Layer | Applied in StudyMap? | Rationale & Scope |
| :--- | :--- | :--- |
| **1. Static Quality** | **Yes** | Fast fail. Validates syntax (`py_compile`), protobuf code generation, TypeScript/JSX parsing via Vite build check, `git diff --check`, secret-pattern scan, and `dependency-review-action` (new critical/high advisories on THIS PR's own dependency changes) before heavy runners initialize. |
| **2. Unit Tests** | **Yes** | Fast isolated verification of math, graph algorithms, evidence unescaping, time formatting, chunk extraction, and question prompt validation without external services. |
| **3. Component Tests** | **Yes** | Frontend interactive UI validation with mocked browser boundaries (Sidebar, EvidenceDrawer, KnowledgeInspector, MindElixirView, Modal). 93 test files run in ~35s under Vitest. |
| **4. Integration Tests** | **Yes** | Multi-component validation with Postgres test container (SQLAlchemy models, `documents` and `collections` repositories, user session stores). |
| **5. API / Contract Tests** | **Yes** | Strictly prevents FE/BE drift on `/mindmaps/capability`, `/generate-mindmap`, `/generate-summary`, `/mindmap-status/<id>`, and data persistence shapes (`test_ci_contracts.py`). |
| **6. Database & Migration** | **Yes** | Validates Alembic migrations from base to head, and executes strict `migration_guard` to guarantee test/prod isolation. |
| **7. Deterministic Browser E2E** | **Yes, new this pass** | Real Chromium, driven by Playwright, against a real production Vite build (`FE/dist`) served statically and a real running Flask backend (`BE/scripts/run_e2e_server.py`) — only the two LangGraph pipelines that would otherwise call a live model provider are swapped for deterministic mocks (same pattern `BE/tests/conftest.py` already uses for pytest). No live FPT, no production Supabase, no production AWS, no real user credentials — see §7 below. `test_ci_regressions.py::test_guided_v3_full_deterministic_flow` (a pure-Python `FakeGuidedWorker` simulation, no browser/HTTP) is kept as a fast contract check but is no longer conflated with "E2E". |
| **8. Smoke Tests** | **Yes** | Gunicorn boot sanity check + `/health` endpoint verification before containers are marked deployable. |
| **9. Security / Dependency Gates** | **Partial, by design** | `dependency-review-action` blocks NEW critical/high advisories on a PR's own dependency diff (npm + pip manifests). `pip-audit` runs report-only (pre-existing/accepted advisories are documented debt, never silently suppressed — see §9). `npm audit` (22 pre-existing advisories: 1 critical, 12 high, 7 moderate, 2 low, measured 2026-09-27) is likewise treated as debt, not gated — fixing 22 pre-existing advisories is out of scope for this CI pass. CodeQL evaluated, not added — see §9. |
| **10. Release / Deploy Gate** | **Yes** | Separate CD workflow (`deploy.yml`) triggered strictly upon successful completion of all required CI checks on `main`, with a `concurrency:` group preventing two simultaneous SSH deployments. |

---

## 2. CI Workflow DAG (Directed Acyclic Graph)

This mirrors the ACTUAL job graph in `ci.yml` (job names below are the real
`jobs.<id>` keys, not aspirational renamings):

```mermaid
graph TD
    Trigger([PR or Push to Main]) --> Changes[detect-changes]

    subgraph Fast_Parallel ["Fast Parallel Stage"]
        Changes --> Security["security-and-static"]
        Changes --> FE_Tests["frontend-tests (Vitest + lint + lint:ratchet)"]
        Changes --> BE_Unit["backend-contracts-and-unit (compile, proto, contracts, pip-audit report)"]
    end

    FE_Tests --> FE_Build["frontend-build (Vite prod bundle)"]
    BE_Unit --> BE_Integration["backend-integration-and-smoke (Postgres, full pytest, gunicorn smoke)"]

    subgraph E2E_Stage ["Deterministic Browser E2E — needs a real built FE AND a real running BE"]
        FE_Build --> E2E["e2e-critical (Playwright, own Postgres + own FE build with VITE_API_URL set)"]
        BE_Integration --> E2E
    end

    Changes --> Docker_Build["docker-build-test"]
    Docker_Build --> Docker_Run["docker-compose-run-test"]

    subgraph Aggregate_Gate ["Final Aggregate Gate — if: always()"]
        Security --> CI_Required["ci-success (CI / required)"]
        FE_Build --> CI_Required
        BE_Integration --> CI_Required
        E2E --> CI_Required
        Docker_Run --> CI_Required
    end

    CI_Required -.-> Deploy["Deploy workflow (workflow_run, main-push-only, AWS EC2 via SSH)"]
```

---

## 3. Path-Aware Execution Rules

| Trigger / Context | Path Filter Behavior |
| :--- | :--- |
| **Push to `main`** | **Full Matrix Always**: every job's `if:` has `github.ref == 'refs/heads/main' \|\| ...` — every check runs unconditionally, including `e2e-critical`. |
| **Frontend-only PR** (`FE/**`) | Runs: `frontend-tests`, `frontend-build`, `e2e-critical` (needs `frontend` OR `backend` OR `shared`), `security-and-static`. Skips: `backend-contracts-and-unit`, `backend-integration-and-smoke`, `docker-build-test`/`docker-compose-run-test` (shared-path only). |
| **Backend-only PR** (`BE/**`, `scripts/**`) | Runs: `backend-contracts-and-unit`, `backend-integration-and-smoke`, `e2e-critical`, `security-and-static`. Skips: `frontend-tests`/`frontend-build` (unless `shared` also changed). |
| **Docs-only PR** (e.g. `docs/**`, outside `FE/**`/`BE/**`/`scripts/**`/`.github/**`/`docker-compose*`/`*.yml`/`alembic/**`) | Only `detect-changes` + `security-and-static` run; every other job is legitimately **skipped**. `ci-success` still passes — see §8. |
| **Full / Shared PR** (`.github/**`, `docker-compose*`, `*.yml`/`*.yaml`, `alembic/**`) | Executes full suite across all layers, including `e2e-critical`. |

`e2e-critical`'s own `if:` is deliberately the union of `frontend`, `backend`,
and `shared` (not just `frontend`) — a backend-only change can just as
easily break a critical user flow (e.g. a job-status contract change) as a
frontend one, so it must not be skippable by a backend-only path filter.

---

## 4. Test Services & Environment Isolation

### 4.1 PostgreSQL Container
- **Image**: `postgres:16-alpine`
- **Environment**: `POSTGRES_DB=studymap_test`, `POSTGRES_USER=postgres`, `POSTGRES_PASSWORD=postgres`
- **Healthcheck**: `pg_isready` (bare — no `-U` flag; corrected 2026-09-27, see `CI_AUDIT.md` §0).
- **Isolation Guard**: `TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/studymap_test`.
- `shared.migration_guard.chon_dich()` strictly checks that the database host is in `{'localhost', '127.0.0.1', 'postgres'}` and the database name ends with `_test`. If `DATABASE_URL` matches `TEST_DATABASE_URL`, the guard aborts execution immediately.
- `e2e-critical` runs its OWN Postgres service container (same image/config) rather than reusing `backend-integration-and-smoke`'s — GitHub Actions services are per-job, not shareable across jobs; each job that needs Postgres declares its own.

### 4.2 Redis Container
- **Image**: `redis:7-alpine`, used by `backend-integration-and-smoke` only.
- **Options**: healthcheck only (`redis-cli ping`) — no `maxmemory`/`appendonly` tuning is actually configured (corrected 2026-09-27; the previous text described options that were never in the workflow).
- `e2e-critical` does NOT start a Redis service — nothing in the critical-flow suite exercises the distributed-cache/single-flight-dedup paths that need it (per B2's instruction: "Redis only if actually required").

### 4.3 Fake / Offline Model Execution
- **Pytest suites** (`backend-contracts-and-unit`, `backend-integration-and-smoke`): `SKIP_MODEL_LOAD=1` + `MEMVID_DISABLE_LC_DEFAULTS=1`. Neural embeddings via `FakeEmbeddings` (dimension 1024). `BE/tests/conftest.py`'s `client` fixture additionally monkeypatches `app.main.QUERY_GRAPH`/`MINDMAP_GRAPH` to `_MockQueryGraph`/`_MockMindmapGraph` for any test using the `client` fixture.
- **Playwright E2E** (`e2e-critical`): same env vars, but the mock swap happens in a REAL running server process, not a pytest fixture — `BE/scripts/run_e2e_server.py` boots the real Flask app then applies the identical monkeypatch (`QUERY_GRAPH`/`MINDMAP_GRAPH` → mocks, `_trigger_background_ingest` → fast no-OCR path) before calling `app.run()`. The mock `MINDMAP_GRAPH` also calls `mindmap_store.save_record(...)` — a real graph's `AssemblePersist` node does this too, and skipping it would make `GET /mindmaps` silently drop the just-created map back out of the library list after the FE's post-done refetch.
- **Guided Mind Map V3** in the E2E job: `GUIDED_MINDMAP_V3_ENABLED=true` and `GUIDED_JOB_STORE_BACKEND=sqlite` are set as job-scoped CI environment variables ONLY — never written to a `.env` file, never the project-wide default (which stays `false` per the hard constraint). `sqlite` backend makes `guided_store.use_postgres()` return `False`, so Guided jobs route through the same `MINDMAP_GRAPH` mock instead of requiring a separate Postgres-backed worker + heartbeat.
- **Deterministic forced failure**: any `/generate-mindmap` request whose prompt/instruction contains `__E2E_FORCE_FAIL__` is failed on purpose by the mock (`status="failed"`, a real error message) — this is what the `e2e-critical` suite uses to drive `FE/src/utils/jobPoller.js`'s "failed" terminal-state handling (protects PR #36) without depending on a real model actually failing.

---

## 5. Live Provider Integration Strategy (`live-integration.yml`)

External providers (FPT AI, live Ollama SLM, live Supabase, AWS EC2) are **strictly decoupled** from pull request CI:

- **Schedule**: Weekly cron, `0 3 * * 1` (03:00 UTC Monday — corrected 2026-09-27; previously documented as `0 2 * * 1`), or manual trigger (`workflow_dispatch`).
- **Scope** (as actually implemented today): a live EC2 `/health` probe, gated on `secrets.EC2_HOST` being set and the `test_ec2_health` input not being explicitly `false`. (A live FPT embedding probe is scaffolded as a `workflow_dispatch` input, `test_fpt`, but no step currently acts on it — noted here rather than silently left as an undocumented gap.)
- **Fail Policy**: Non-blocking for PR merges or deploys — a `::warning::` annotation on timeout/error, not a failed job.

---

## 6. Coverage Policy & Ratchet

- **Current Baseline**:
  - Frontend: 93 test files, 1072 tests.
  - Backend: 232 test files, ~2450 tests.
  - E2E: 2 spec files (`FE/e2e/critical-flows.spec.js`, `FE/e2e/tablet-layout.spec.js`), 12 tests, new this pass.
- **Policy**:
  - CI generates XML test reports (`pytest --junitxml=reports/backend-junit.xml`) and, on E2E failure, an HTML Playwright report + traces + screenshots.
  - No arbitrary 80% or 90% hard coverage gate that causes spurious failures on glue code.
  - Core domain logic (`app/domains/**`, `shared/**`, `services/mindmap/pipeline/**`) requires regression test additions for any bug fix.
  - **ESLint ratchet** (new this pass): `FE/.eslint-baseline.json` commits the current total problem count (67 — measured 2026-09-27, see `CI_AUDIT.md` §0 for why this isn't the older documented 66). `FE/scripts/lint-ratchet.mjs` (run as `npm run lint:ratchet`, blocking in `frontend-tests`) fails only if the CURRENT total exceeds the baseline — existing debt stays allowed, new debt does not. Lowering the baseline (i.e. fixing lint problems) is always allowed and expected over time.

---

## 7. Playwright E2E (`e2e-critical`)

- **Config**: `FE/playwright.config.js`. Single worker (`workers: 1`) — the
  suite shares one backend process and one Postgres DB across specs, and
  several assertions count network requests since a fixed point; parallel
  workers would race those counts. 1 retry on CI.
- **`webServer`** (Playwright's own process supervision, so the same config
  works identically in CI and on a developer machine):
  1. `python ../BE/scripts/run_e2e_server.py` — health-checked via `GET /health`.
  2. `npx serve -s dist -l 4173` — the REAL production build (`FE/dist`,
     built by the CI step immediately before with `VITE_API_URL` pointed at
     the server above). `-s` (single/SPA mode) gives history-mode fallback
     so a hard reload on a deep route (`/app/study/map/:id`, exercised by
     the reload-persistence spec) doesn't 404 against a plain static file
     server.
- **Specs**:
  - `critical-flows.spec.js` (`test.describe.serial`, one registered user +
    one uploaded document reused across steps — this is what makes
    "reload doesn't re-POST" and "A/B switching preserves identity"
    meaningful): app boot (no `pageerror`), backend `/health` reachability,
    a deterministic CI-safe registered+logged-in user (no production
    credentials — a fresh throwaway account per run), document upload +
    source selection, Guided V3 happy path (dialog → submit → done → map
    persisted and selected in the library), existing-map restore from the
    library list, reload-does-not-repost, A→B→A→B map-switching identity,
    Mind Map→Chat→Summary→Mind Map mode switching without accidental
    regeneration, and a deterministic Guided-create-failure path (forced
    via the `__E2E_FORCE_FAIL__` marker) asserting a visible error and no
    silent dialog disappearance.
  - `tablet-layout.spec.js`: 1024×768 and 768×1024 — no horizontal page
    overflow, and no bounding-box overlap between the chat composer and the
    Evidence panel (protects PR #35).
  - **Invisible-modal regression** (protects a P1 fix a parallel effort may
    still be shipping — see the task brief this pass was executed under):
    the happy-path spec asserts the Guided dialog is actually `visible`
    (not just present under an ancestor toggling
    `opacity:0/visibility:hidden` — `MainLayout.jsx`'s
    `.mindmap-tools-overlay`), and annotates the test with a `known-issue`
    note pointing at that exact toggle if the assertion ever needs
    softening again.
- **Artifacts on failure**: `FE/playwright-report/` (HTML) and
  `FE/test-results/` (traces, screenshots — video is off; the trace already
  gives full step-by-step DOM/network replay, a video added no extra
  diagnostic value for this suite's failure modes). Retention: 10 days.
  Never uploads `.env`, auth secrets, production data, or DB dumps — the
  E2E database is an ephemeral per-run Postgres service container that is
  destroyed with the runner.

---

## 8. Branch Protection Specification & Aggregate Gate Semantics

Protected branch: **`main`**

### Required Status Check
```text
CI / required
```
Provided by the `ci-success` job (`name: CI / required` in `ci.yml`).

### Exact skip/fail semantics (traced against the real YAML, not assumed)

`ci-success` has `if: always()` — it runs even if every one of its `needs`
was skipped or failed, which is what lets it act as a single stable branch
protection target regardless of which jobs a given PR's path filter
actually ran. Its body reads `needs.*.result` and fails only on the literal
strings `"failure"` or `"cancelled"`:

```yaml
for res in $results; do
  if [ "$res" = "failure" ] || [ "$res" = "cancelled" ]; then exit 1; fi
done
```

`"skipped"` is a distinct GitHub Actions result value and is NOT in that
list — a job skipped by its own `if:` (e.g. `backend-contracts-and-unit` on
a frontend-only PR) reports `result: "skipped"` to `ci-success`, which
passes it through as fine. This is the correct behavior (a path-irrelevant
job being skipped must not fail the gate) and was verified correct BEFORE
this pass — the risk case B6 warns about ("a job with `needs:` on a skipped
job is itself skipped by default unless `if: always()`") does not apply
here because `ci-success` itself always runs; it's only `ci-success`'s
*needs* that may be skipped, and skip ≠ failure in its own check.

**Three scenarios, traced:**

- **(A) PASS** — every required job that ran succeeded → every result is
  `"success"` or `"skipped"` → no `res` matches `"failure"`/`"cancelled"` →
  exit 0 → `ci-success` passes.
- **(B) FAIL** — one required job that ran failed → its result is
  `"failure"` → the loop matches it → exit 1 → `ci-success` fails, even
  though `if: always()` let it run at all.
- **(C) SKIP** — a path-irrelevant job (e.g. `e2e-critical` on a
  docs-only PR, once `.github/**`/`*.yml` stop matching that specific PR's
  diff) is skipped by its own `if:` → its result is `"skipped"` → the loop
  does not match it → `ci-success` still passes, exactly as it should.

This pass added `e2e-critical` to `ci-success`'s `needs:` list — the same
`if: always()` + string-match logic covers it with no other change required.
Proof from a real run (not local simulation): see the CI section of this
task's final report for the PR number, run ID, and each job's actual
`result` string from the GitHub Actions API/UI for this specific change.
Editing `.github/workflows/ci.yml` itself makes the `shared` path filter
match on every commit in this PR, so a live SKIP-scenario run could not be
observed inside THIS PR (every job ran) — the semantics above are verified
by tracing the actual YAML logic (not asserted from nothing), and a live
SKIP observation is deferred to the next PR that touches only `docs/**` or
similar, i.e. does not modify `.github/**`.

---

## 9. Security / Dependency Strategy

Evaluated all four options named in the task brief:

- **`actions/dependency-review-action`** — **added**, PR-only
  (`security-and-static` job), `fail-on-severity: high`. Diffs the PR's own
  dependency manifest changes against the base branch, so it can only ever
  flag NEW advisories introduced by THIS PR — it structurally cannot go red
  over a pre-existing advisory nobody touched, which is exactly the "gate
  only new critical/high, never silently suppress existing" policy the task
  requires.
- **`pip-audit`** — **added**, report-only (`continue-on-error: true` in
  `backend-contracts-and-unit`). Existing/accepted advisories in
  `requirements.txt` are documented debt (this file), not gated — a
  proper "new-advisory-only" gate for a single lockfile (as opposed to a
  PR diff) would need a second committed baseline + diff script; deferred
  as a P2 follow-up (see the task's final report, "Remaining CI gaps") since
  `dependency-review-action` already covers the higher-value "new PR
  changes" case for both ecosystems.
- **`npm audit`** — evaluated, NOT added as a separate CI step.
  `dependency-review-action` already covers npm; a second, less precise
  whole-tree `npm audit` step would only re-report the same 22 pre-existing
  advisories (1 critical, 12 high, 7 moderate, 2 low, measured 2026-09-27)
  without a baseline/ratchet mechanism, which is worse than not adding it.
- **CodeQL** — evaluated, NOT added. This is a large monorepo (Python + JS)
  with an already-heavy CI matrix (Docker builds, Postgres integration, now
  Playwright); CodeQL's own setup + scan time for a codebase this size is
  comparable to or larger than the rest of `ci.yml` combined, and it is a
  "deeper/scheduled" class of check, not a per-PR static-analysis check.
  Recommended as a P2 follow-up: a separate, scheduled (weekly, like
  `live-integration.yml`) `codeql.yml` that never blocks a PR.

**Policy statement**: existing/pre-existing advisories (npm: 22 total;
`requirements.txt`: not yet enumerated by a passing `pip-audit` baseline in
this pass — the report-only step surfaces them on every run) are documented
debt, tracked here, never silently suppressed. Only NEW critical/high
advisories introduced by a PR's own dependency changes are blocking.
