# CI Architecture & Test Pyramid Specification

**System**: StudyMap / MemVid Platform  
**Target Repository**: `levuanh2/memvid_baocaototnghiep`  
**Architecture Version**: 2.0 (Production-Grade)

---

## 1. Test & Gate Model for StudyMap

```text
               ▲
              / \
             /   \      [Layer 9] Release / Deploy Gate (Main branch only, post-CI)
            /     \     [Layer 8] Production Build & Container Verification
           /       \    [Layer 7] Smoke Tests (Health & Readiness)
          /         \   [Layer 6] Deterministic E2E & Flow Regressions (Mocked AI)
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
| **1. Static Quality** | **Yes** | Fast fail. Validates syntax (`py_compile`), protobuf code generation, TypeScript/JSX parsing via Vite build check, `git diff --check`, and security scans before heavy runners initialize. |
| **2. Unit Tests** | **Yes** | Fast isolated verification of math, graph algorithms, evidence unescaping, time formatting, chunk extraction, and question prompt validation without external services. |
| **3. Component Tests** | **Yes** | Frontend interactive UI validation with mocked browser boundaries (Sidebar, EvidenceDrawer, KnowledgeInspector, MindElixirView, Modal). 93 test files run in ~35s under Vitest. |
| **4. Integration Tests** | **Yes** | Multi-component validation with Postgres test container (SQLAlchemy models, `documents` and `collections` repositories, user session stores, Redis caching). |
| **5. API / Contract Tests** | **Yes** | Strictly prevents FE/BE drift on `/mindmaps/capability`, `/generate-mindmap`, `/generate-summary`, `/mindmap-status/<id>`, and data persistence shapes. |
| **6. Database & Migration** | **Yes** | Validates Alembic migrations from base to head, validates rollback where supported, and executes strict `migration_guard` to guarantee test/prod isolation. |
| **7. Deterministic E2E / Regressions** | **Yes** | End-to-end simulated user flow: capability probe -> submit -> queue -> poll -> complete -> reload -> node click. Completely offline using mock LLMs to avoid flaky 3rd party APIs. |
| **8. Smoke Tests** | **Yes** | Gunicorn boot sanity check + `/health` endpoint verification before containers are marked deployable. |
| **9. Security / Dependency Gates** | **Yes** | Secret pattern scans, Python dependency vulnerability audit (`pip-audit` / safety), and npm package integrity validation. |
| **10. Release / Deploy Gate** | **Yes** | Separate CD workflow (`deploy.yml`) triggered strictly upon successful completion of all required CI checks on `main`. |

---

## 2. CI Workflow DAG (Directed Acyclic Graph)

```mermaid
graph TD
    Trigger([PR or Push to Main]) --> Changes[Path & Change Analysis]

    subgraph Fast_Parallel_Static_and_Unit ["Fast Parallel Stage (~1-2m)"]
        Changes --> FE_StaticUnit["Frontend: Test & Static (Vitest)"]
        Changes --> BE_StaticUnit["Backend: Compile, Proto & Unit Tests"]
        Changes --> Security["Security: Secret & Dependency Scan"]
    end

    subgraph Build_Stage ["Build Stage (~1m)"]
        FE_StaticUnit --> FE_Build["Frontend: Production Build (Vite)"]
    end

    subgraph Integration_and_Contracts ["Integration & Contract Stage (~2-3m)"]
        BE_StaticUnit --> BE_DB_Migration["Database: Alembic Migrations (Postgres 16)"]
        BE_DB_Migration --> BE_Integration["Backend: Integration Suite (Postgres)"]
        BE_StaticUnit --> Contract_Tests["Contract Tests: FE/BE API & Schema Guard"]
        BE_StaticUnit --> Regression_Tests["Regression Tests: Ingest, Safety, Guided Flow"]
    end

    subgraph Container_Verification ["Container & Smoke Stage (Main / Full CI)"]
        FE_Build --> Docker_Build["Docker Compose Build & Health Check"]
        BE_Integration --> Docker_Build
    end

    subgraph Aggregate_Gate ["Final Aggregate Gate"]
        FE_Build --> CI_Required["CI / required (Aggregate Gate)"]
        BE_Integration --> CI_Required
        Contract_Tests --> CI_Required
        Regression_Tests --> CI_Required
        Docker_Build --> CI_Required
        Security --> CI_Required
    end

    subgraph CD_Deployment ["Continuous Deployment (Main Only)"]
        CI_Required -.-> Deploy["Deploy Workflow (AWS EC2 via SSH)"]
    end
```

---

## 3. Path-Aware Execution Rules

To balance rapid developer feedback on PRs with zero false negatives on protected branches, paths are evaluated as follows:

| Trigger / Context | Path Filter Behavior |
| :--- | :--- |
| **Push to `main`** | **Full Matrix Always**: Every check (FE, BE, Migrations, Integration, Docker, Security) executes unconditionally. No jobs skipped. |
| **Frontend-only PR** (`FE/**`) | Executes: FE Test & Static, FE Build, Contract Tests, Security. Skips: Heavy Backend Integration & Docker Compose. |
| **Backend-only PR** (`BE/**`) | Executes: BE Compile & Unit, Migrations, Integration, Contract Tests, Regressions, Security. Skips: FE Test & Build. |
| **Full / Shared PR** (`.github/**`, `docker-compose*`, `shared/**`, `alembic/**`, root) | Executes full suite across all layers. |

---

## 4. Test Services & Environment Isolation

### 4.1 PostgreSQL Container
- **Image**: `postgres:16-alpine`
- **Environment**: `POSTGRES_DB=studymap_test`, `POSTGRES_USER=postgres`, `POSTGRES_PASSWORD=postgres`
- **Healthcheck**: `pg_isready -U postgres`
- **Isolation Guard**: `TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/studymap_test`.
- `shared.migration_guard.chon_dich()` strictly checks that the database host is in `{'localhost', '127.0.0.1', 'postgres'}` and the database name ends with `_test`. If `DATABASE_URL` matches `TEST_DATABASE_URL`, the guard aborts execution immediately.

### 4.2 Redis Container
- **Image**: `redis:7-alpine`
- **Options**: `--maxmemory 256mb --maxmemory-policy allkeys-lru --appendonly no`
- Used for distributed cache testing and single-flight deduplication tests.

### 4.3 Fake / Offline Model Execution
- PR CI sets `SKIP_MODEL_LOAD=1` and `MEMVID_DISABLE_LC_DEFAULTS=1`.
- Neural embeddings are handled via `FakeEmbeddings` (dimension 1024), completely avoiding downloads of BGE-M3 (2.2 GB) or Ollama weights during CI runs.
- Query graphs and mindmap graphs utilize in-memory mock invocations (`_MockQueryGraph`, `_MockMindmapGraph`).

---

## 5. Live Provider Integration Strategy (`live-integration.yml`)

External providers (FPT AI, live Ollama SLM, live Supabase, AWS EC2) are **strictly decoupled** from pull request CI:

- **Schedule**: Weekly cron (`0 2 * * 1`) or manual trigger (`workflow_dispatch`).
- **Scope**:
  - Live FPT embedding probe (verifying credentials and latency).
  - Staging backend health & CORS validation.
  - AWS EC2 SSH connectivity check.
- **Fail Policy**: Non-blocking for PR merges. Failures emit high-priority GitHub issue alerts rather than blocking unrelated feature development.

---

## 6. Coverage Policy & Ratchet

- **Current Baseline**:
  - Frontend: 93 test files, 1072 tests (high component and utility coverage).
  - Backend: 232 test files, ~2450 tests.
- **Policy**:
  - CI generates XML test reports (`pytest --junitxml=reports/backend-junit.xml`).
  - No arbitrary 80% or 90% hard gate that causes spurious failures on glue code.
  - Core domain logic (`app/domains/**`, `shared/**`, `services/mindmap/pipeline/**`) requires regression test additions for any bug fix.
  - Diagnostics artifacts are archived on failure for immediate triage.

---

## 7. Artifact Retention Policy

| Artifact Name | When Captured | Contents | Retention |
| :--- | :--- | :--- | :--- |
| `backend-test-results` | Always | `reports/backend-junit.xml` | 14 days |
| `frontend-build-dist` | On PR / Main push | `FE/dist/**` production build bundle | 7 days |
| `docker-compose-logs` | On failure only | Compose logs (`backend`, `redis`, `gateway`) | 14 days |

*Strict Security Exclusion*: `.env`, private SSH keys, and raw document corpora are never archived.

---

## 8. Branch Protection Specification

Protected branch: **`main`**

### Required Status Check
The branch protection rule in GitHub Repository Settings must require exactly one aggregate check:
```text
CI / required
```
This check is provided by the `ci-success` job in `.github/workflows/ci.yml`.  
Because `ci-success` depends on all active pipeline jobs (`needs: [frontend, backend, contracts, regressions, ...]`), any upstream failure automatically blocks `main` merge without needing to constantly reconfigure branch protection rules when individual test jobs are refactored.
