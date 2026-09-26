# CI Audit Report: StudyMap / MemVid

**Repository**: `levuanh2/memvid_baocaototnghiep` (StudyMap / MemVid NCKH)
**Date**: September 2026
**Auditor**: Antigravity CI Architecture Engine
**Status**: Comprehensive Baseline Established

---

## 0. 2026-09-27 re-audit note (Claude, continuing AGY's work)

This document was written against the OLD pre-AGY `ci.yml` (4 flat jobs). Before
building on top of it, every claim below and in `CI_ARCHITECTURE.md` was
re-verified against the actual file contents on disk, not trusted as-is —
AGY's own audit can go stale relative to later hand-edits. Discrepancies found:

- **§3.1 ESLint count was stale.** Documented as "66 problems (60 errors, 6
  warnings)". Running `npm run lint` directly on 2026-09-27 measured **67
  problems (61 errors, 6 warnings)** — one more error than documented. The
  ratchet baseline (`FE/.eslint-baseline.json`) uses the freshly-measured 67,
  not the stale 66.
- **`CI_ARCHITECTURE.md` §4.2 Redis options were aspirational, not real.** The
  doc described `--maxmemory 256mb --maxmemory-policy allkeys-lru
  --appendonly no`; the actual `redis` service in `ci.yml` has no such
  options, only a healthcheck.
- **§4.1 Postgres healthcheck command was overstated.** Documented as
  `pg_isready -U postgres`; the actual command is bare `pg_isready` (no
  `-U` flag). Cosmetic, but the doc should describe the real command.
- **§5 Live-provider cron time was wrong.** Documented as `0 2 * * 1`
  (02:00 UTC Monday); the actual `live-integration.yml` cron is `0 3 * * 1`
  (03:00 UTC Monday).
- **§7 Artifact names didn't match the workflow.** Documented artifact name
  `backend-test-results`; the actual `upload-artifact` step names it
  `backend-junit-report`. Also, the documented `docker-compose-logs`
  artifact **does not exist** — the "Logs on failure" step in
  `docker-compose-run-test` prints to the runner's stdout only, nothing is
  ever uploaded as an artifact under that name.
- **§9 "Security / Dependency Gates — Yes" overstated what existed.** The
  actual `security-and-static` job only ran a `git diff --check` and a grep
  for accidentally-committed private key headers. There was no `pip-audit`,
  no `npm audit`, no dependency-diff gate of any kind — this pass adds
  `actions/dependency-review-action` (PR-only, new critical/high only) and a
  report-only `pip-audit` step; see `CI_ARCHITECTURE.md` §9 for the actual
  policy now in place.
- **The DAG's "Layer 7: Deterministic E2E / Regressions" was not browser
  E2E.** `BE/tests/test_ci_regressions.py::test_guided_v3_full_deterministic_flow`
  is a pure-Python simulation (`FakeGuidedWorker`, no Flask, no HTTP, no
  rendered frontend) asserting the *shape* of a guided-job lifecycle. It
  never drove a real browser against a real running frontend + backend.
  This is exactly the gap the current pass (B2/B3) fills with
  `FE/playwright.config.js` + `FE/e2e/**`, wired in as the new
  `e2e-critical` job. `test_ci_regressions.py` now says so explicitly in a
  header comment, and is kept (it's a fast, useful contract check) but no
  longer conflated with "E2E" in this document or `CI_ARCHITECTURE.md`.

Nothing above was a regression AGY introduced on purpose — this is the normal
drift of documentation vs. a workflow that kept getting hand-edited. Fixed in
this pass; see `CI_ARCHITECTURE.md` for the corrected, current-state
description of every section listed here.

---

## 1. Executive Summary

A comprehensive audit was performed across all GitHub Actions workflows, build systems, test suites, database migration frameworks, container specifications, deployment automation, and environment contracts.

The existing CI configuration (`.github/workflows/ci.yml`) is functional for a basic two-tier monolith (Node 22 frontend + Python 3.11 backend) with throwaway PostgreSQL 16 containerization. However, it lacks a modern directed acyclic graph (DAG) structure, lacks path-filtering optimizations, lacks explicit contract testing between frontend and backend, runs Docker and compose validation sequentially on every push, lacks automated coverage tracking and JUnit artifact emission, lacks security vulnerability scanning, and has no isolated live-provider verification layer.

*(This paragraph describes the ORIGINAL pre-AGY state that motivated this whole audit — it is intentionally left as historical record. See §0 above and `CI_ARCHITECTURE.md` for what the pipeline actually does today.)*

---

## 2. Existing Workflow Inventory (historical — pre-AGY baseline)

### Workflow 1: `.github/workflows/ci.yml`
- **Name**: `CI`
- **Trigger**:
  - `push` to `main`
  - `pull_request` to `main`
- **Concurrency**: None configured (multiple commits on a PR trigger redundant full runs).
- **Permissions**: Default token permissions (not explicitly set to `contents: read`).

#### Job Inventory

| Job Name | Runs-On | Services | Steps / Checks | Dependencies | Runtime (approx) | Blocking? | Artifacts |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `backend-tests` | `ubuntu-latest` | `postgres:16-alpine` | 1. actions/checkout@v4<br>2. actions/setup-python@v5 (py3.11, pip cache)<br>3. pip install -r requirements.txt<br>4. python scripts/build_proto.py (gRPC stubs)<br>5. alembic upgrade head<br>6. python -m pytest -q<br>7. Gunicorn smoke boot & health check loop | None | ~3m - 4m | Blocking | None |
| `frontend` | `ubuntu-latest` | None | 1. actions/checkout@v4<br>2. actions/setup-node@v4 (node 22, npm cache)<br>3. npm ci<br>4. npm test (Vitest run)<br>5. npm run build (Vite client build)<br>6. npm run lint (`continue-on-error: true`) | None | ~1m - 2m | Blocking (lint non-blocking) | None |
| `docker-build-test` | `ubuntu-latest` | None | 1. docker build backend (`BE/Dockerfile`)<br>2. docker build frontend (`FE/Dockerfile`)<br>3. docker compose build (`docker-compose.yml`) | None | ~4m - 6m | Blocking | None |
| `docker-compose-run-test` | `ubuntu-latest` | None | 1. docker compose up -d --build<br>2. wait for backend health check (loop 40 retries)<br>3. curl health check<br>4. docker compose logs on failure<br>5. docker compose down -v | `docker-build-test` | ~3m - 5m | Blocking | Logs in runner stdout only |

**Total CI Duration**: 7m – 12m (due to full docker image builds and compose up running sequentially after build).

---

### Workflow 2: `.github/workflows/deploy.yml`
- **Name**: `Deploy`
- **Trigger**: `workflow_run` on completion of workflow `CI`.
- **Condition**:
  ```yaml
  github.event.workflow_run.conclusion == 'success' &&
  github.event.workflow_run.head_branch == 'main' &&
  github.event.workflow_run.event == 'push'
  ```
- **Target**: Backend host on AWS EC2 via SSH (`scripts/deploy.sh`).
- **Secrets Used**:
  - `EC2_KNOWN_HOSTS` (Pinned host key)
  - `EC2_SSH_KEY` (Deploy private key)
  - `EC2_USER`
  - `EC2_HOST`
- **Steps**:
  1. Write pinned EC2 host key to `~/.ssh/known_hosts`.
  2. Install deploy key to `~/.ssh/deploy_key` (chmod 600).
  3. SSH command executes remote `/opt/memvid/app/scripts/deploy.sh`.
  4. Status reporting.
- **Safety Analysis (original)**:
  - Strict host key checking is enabled (`StrictHostKeyChecking=yes`).
  - Deploy is strictly gated on `conclusion == 'success'` of `CI` on `main`.
  - Feature branch PRs are cleanly excluded (`head_branch == 'main' && event == 'push'`).
  - Gaps (fixed by this pass — see `CI_ARCHITECTURE.md` §8/B10): no
    concurrency group was present, so two rapid pushes to `main` could
    trigger two simultaneous SSH deployments. AGY's earlier pass already
    added `concurrency: { group: production-deployment, cancel-in-progress:
    false }` to `deploy.yml` — verified still present and correct in this
    pass (B10), not re-added.

---

## 3. Detailed Component Audit

### 3.1 Frontend (`FE/`)
- **Package Manager**: `npm` (`FE/package-lock.json` lockfileVersion 3).
- **Core Framework**: React 19.1.0, React Router DOM 7.7.1, Vite 7.0.4.
- **Test Framework**: Vitest 4.1.9 with `jsdom` 29.1.1.
- **Test Inventory**: 93 test files, 1072 unit and component tests passing (unchanged by this pass).
- **Build Output**: `npm run build` outputs static assets into `FE/dist/` (vendor splitting: `react`, `markdown`, `mindmap`). Build time: ~28s.
- **Linting**: ESLint 9 (`eslint.config.js`). Measured 2026-09-27: **67 problems
  (61 errors, 6 warnings)**, mostly unused parameters, Fast Refresh exports,
  and Tailwind config module syntax (`no-undef` on `module`/`require` in
  `tailwind.config.js` — that file is CommonJS by necessity, not a real bug).
  `ci.yml`'s `npm run lint` step stays `continue-on-error: true` for
  visibility; a new `npm run lint:ratchet` step (see `FE/scripts/lint-ratchet.mjs`)
  is now blocking and fails only if the total count exceeds the committed
  baseline (`FE/.eslint-baseline.json`, currently 67).
- **E2E**: `FE/e2e/**` (Playwright), new in this pass. See `CI_ARCHITECTURE.md` §7.

### 3.2 Backend (`BE/`)
- **Runtime**: Python 3.11.
- **Dependencies**: `BE/requirements.txt` (pinned versions for LangChain 0.3.x, LangGraph 0.2.57, PyTorch 2.5.1+cpu, SQLAlchemy 2.0+, Alembic, Psycopg 3.3+, etc.).
- **Protobuf / gRPC**: `python scripts/build_proto.py` compiles `.proto` files into `gen/` (stubs for `llm-gateway` and `mindmap-service`).
- **Test Framework**: `pytest` 8.0+ / 9.1+.
- **Test Inventory**: 232 test files across unit, integration, memory, quiz, graph, and API domains.
- **Isolation Mechanism**:
  - `BE/tests/conftest.py` purges development machine secrets (`FPT_AI_API_KEY`, `QUEUE_ENABLED`, `DATABASE_URL`).
  - Sets `SKIP_MODEL_LOAD=1` to substitute heavy neural encoders with `FakeEmbeddings`.
  - Sets `DATA_DIR` to temporary directories per test session.
  - Requires `TEST_DATABASE_URL` via fixture `can_db_test` for database-writing tests, cleanly preventing writes to live Supabase production.
  - `BE/scripts/run_e2e_server.py` (new) mirrors this exact isolation
    pattern for a REAL running server process (not the pytest test client),
    for the Playwright suite to drive over real HTTP — see
    `CI_ARCHITECTURE.md` §7.

### 3.3 Database & Migrations
- **Framework**: Alembic with SQLAlchemy.
- **Versions**: 8 revision scripts in `BE/alembic/versions/` (schema migrations for documents, collections, auth identities, RLS enforcement).
- **Safety Mechanism**: `BE/shared/migration_guard.py` implements a strict guard (`chon_dich()`, `kiem_tra_dich()`):
  - In test mode, target database MUST end in `_test`, host MUST be in allowlist (`localhost`, `127.0.0.1`, `postgres`, `db`), and MUST NOT match `DATABASE_URL`.
  - In production mode, requires explicit `ALEMBIC_ALLOW_PRODUCTION=1` and matching `ALEMBIC_PRODUCTION_HOST` & `ALEMBIC_PRODUCTION_DB`.
  - Verifies live database identity via `SELECT current_database()` to prevent DNS/pooler spoofing.

### 3.4 Docker & Deployment Infrastructure
- **Containers**:
  - `BE/Dockerfile`: Multi-stage Python 3.11-slim, PyTorch CPU wheel, gRPC proto generation, Gunicorn entrypoint.
  - `FE/Dockerfile`: Multi-stage build (Node 22 build -> static server).
  - `docker-compose.yml`: Coordinates `backend`, `llm-gateway`, `mindmap-service`, `redis`, and `frontend`.
- **Deployment Scripts**:
  - `scripts/deploy.sh`: Seven sequential steps: validate env -> ensure data layout -> git sync origin/main -> compose build -> run migrations (`scripts.run_migrations --moi-truong production`) -> compose up -d -> health check (`scripts/health.sh`).

---

## 4. Known Duplication & Gaps in Current CI (historical — pre-AGY baseline)

1. **No Job DAG / Excessive Sequential Run** — fixed (path-filtered DAG, see `CI_ARCHITECTURE.md` §2).
2. **Missing Path Filtering** — fixed (`detect-changes` job + `dorny/paths-filter`).
3. **No Coverage Reporting** — still open, deliberately (see `CI_ARCHITECTURE.md` §6, "no arbitrary hard gate").
4. **No Test Report Artifacts** — fixed (`backend-junit-report` artifact).
5. **No Contract Validation Gate** — fixed (`test_ci_contracts.py`).
6. **No Deterministic E2E / Flow Verification Gate** — fixed THIS PASS (`e2e-critical` job, Playwright against a real FE + real BE). Previously only had the pure-Python simulation described in §0 above.
7. **No Separate Live Provider Workflow** — fixed (`live-integration.yml`).
8. **Missing PR Concurrency Cancellation** — fixed (`concurrency:` block in `ci.yml`).
9. **Single Point of Gate Failure** — fixed (`ci-success` aggregate gate — see `CI_ARCHITECTURE.md` §8 for the exact skip/fail semantics, verified line-by-line this pass).
