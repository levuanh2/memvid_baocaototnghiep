# CI Audit Report: StudyMap / MemVid

**Repository**: `levuanh2/memvid_baocaototnghiep` (StudyMap / MemVid NCKH)  
**Date**: September 2026  
**Auditor**: Antigravity CI Architecture Engine  
**Status**: Comprehensive Baseline Established

---

## 1. Executive Summary

A comprehensive audit was performed across all GitHub Actions workflows, build systems, test suites, database migration frameworks, container specifications, deployment automation, and environment contracts.

The existing CI configuration (`.github/workflows/ci.yml`) is functional for a basic two-tier monolith (Node 22 frontend + Python 3.11 backend) with throwaway PostgreSQL 16 containerization. However, it lacks a modern directed acyclic graph (DAG) structure, lacks path-filtering optimizations, lacks explicit contract testing between frontend and backend, runs Docker and compose validation sequentially on every push, lacks automated coverage tracking and JUnit artifact emission, lacks security vulnerability scanning, and has no isolated live-provider verification layer.

---

## 2. Existing Workflow Inventory

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
- **Safety Analysis**:
  - Strict host key checking is enabled (`StrictHostKeyChecking=yes`).
  - Deploy is strictly gated on `conclusion == 'success'` of `CI` on `main`.
  - Feature branch PRs are cleanly excluded (`head_branch == 'main' && event == 'push'`).
  - Gaps: No timeout specified on the deploy job; concurrency is not restricted (two rapid pushes to `main` could trigger concurrent SSH deployments).

---

## 3. Detailed Component Audit

### 3.1 Frontend (`FE/`)
- **Package Manager**: `npm` (`FE/package-lock.json` lockfileVersion 3).
- **Core Framework**: React 19.1.0, React Router DOM 7.7.1, Vite 7.0.4.
- **Test Framework**: Vitest 4.1.9 with `jsdom` 29.1.1.
- **Test Inventory**: 93 test files, 1072 unit and component tests passing.
- **Build Output**: `npm run build` outputs static assets into `FE/dist/` (vendor splitting: `react`, `markdown`, `mindmap`). Build time: ~28s.
- **Linting**: ESLint 9 (`eslint.config.js`). Currently reports 66 problems (60 errors, 6 warnings) mostly concerning unused parameters, Fast Refresh exports, and Tailwind configuration module syntax. `ci.yml` correctly executes linting with `continue-on-error: true` so pre-existing debt does not mask critical failures.

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

## 4. Known Duplication & Gaps in Current CI

1. **No Job DAG / Excessive Sequential Run**:
   - `frontend` and `backend-tests` run concurrently, but `docker-build-test` and `docker-compose-run-test` run unconditionally on every PR push. Building full Docker images for both FE and BE on every commit adds 7–10 minutes of redundant CI time.
2. **Missing Path Filtering**:
   - A markdown doc change or frontend CSS tweak triggers backend pytest and full Docker builds.
3. **No Coverage Reporting**:
   - Neither FE nor BE generates XML/LCOV coverage artifacts. Coverage tracking does not exist in CI.
4. **No Test Report Artifacts**:
   - Failures only output to console logs. No JUnit XML or test summary artifacts are uploaded for easy triage.
5. **No Contract Validation Gate**:
   - No explicit automated gate verifies that API models returned by the backend match frontend expectation contracts (particularly critical for `/mindmaps/capability`, `/generate-mindmap`, `/generate-summary`, and job poller contracts).
6. **No Deterministic E2E / Flow Verification Gate**:
   - UI testing is restricted to Vitest unit/component mocks. There is no automated full-flow regression gate ensuring the end-to-end lifecycle (submit -> queue -> process -> done -> reload).
7. **No Separate Live Provider Workflow**:
   - Any test touching FPT AI or live models is either skipped or disabled in CI. There is no scheduled workflow to monitor live provider health.
8. **Missing PR Concurrency Cancellation**:
   - Rapid pushes on the same pull request queue up redundant CI runs, exhausting GitHub Actions concurrency quotas.
9. **Single Point of Gate Failure**:
   - Branch protection requires individual job names. Refactoring job names in `ci.yml` breaks branch protection rules on GitHub unless an aggregate status check (`CI / required`) is used.
