# Architecture

> Rewritten for v1.0 release. The previous version of this document
> described an abandoned "QR-code video encoding" concept (`videos/`,
> `chunk_processor.py`, FastAPI/`uvicorn`) that does not exist in this
> codebase — confirmed absent from both git and disk before writing this.
> Every fact below was read from the actual source or generated with a
> reproducible command; none of it is carried over from the old version
> unchecked.

## Mục lục

1. [System Context](#system-context)
2. [Frontend Architecture](#frontend-architecture)
3. [Backend Architecture](#backend-architecture)
4. [AI Pipeline](#ai-pipeline)
5. [Study Pipeline](#study-pipeline)
6. [Authentication](#authentication)
7. [Data Flow](#data-flow)
8. [Deployment](#deployment)
9. [Folder Organization](#folder-organization)
10. [Major Design Decisions](#major-design-decisions)
11. [Trade-offs](#trade-offs)
12. [Future Improvements](#future-improvements)

---

## System Context

```
┌──────────┐      HTTPS (SPA)      ┌────────────┐      REST /api/*      ┌──────────────┐
│  Browser │◄─────────────────────►│   nginx    │◄─────────────────────►│  Flask app   │
└──────────┘                       │ (FE image) │                       │ (BE main.py) │
                                    └────────────┘                       └──────┬───────┘
                                                                                  │
                    ┌──────────────────────────┬───────────────────────────────┼───────────────────┐
                    ▼                          ▼                                ▼                   ▼
             ┌─────────────┐           ┌───────────────┐                ┌─────────────┐    ┌────────────────┐
             │  Postgres   │           │ SQLite chunk  │                │ llm-gateway │    │ mindmap-service │
             │ (Supabase)  │           │ store (legacy)│                │   (gRPC)    │    │     (gRPC)      │
             └─────────────┘           └───────────────┘                └──────┬──────┘    └────────┬────────┘
                                                                                  ▼                    ▼
                                                                        Ollama / Gemini / Groq / FPT AI
```

Redis is an optional cache-only dependency (`redis:7-alpine`, 256mb
allkeys-lru) — every subsystem that touches it (semantic cache,
single-flight, general rate limiting) fails open when it's absent.
`rq-worker` is a Docker Compose profile, off by default; the app runs as
a single Flask process when `QUEUE_ENABLED` is unset.

## Frontend Architecture

React 19 + Vite, plain JavaScript (no TypeScript). Routes are code-split
with `React.lazy()` at the router level (`FE/src/App.jsx`) — every page
except `Landing` loads on demand.

No global state library. A single React Context, **Study Context**
(`FE/src/study/`), broadcasts the current cross-surface selection
(document / topic / entity / summary / node / question / learning mode)
as plain IDs to every study surface that wants to react to it. It is
explicitly a broadcast layer, not a second data store — each component
still owns its own detailed local state. Selection transitions are pure,
tested functions (`studySelection.js`), not inline `setState` calls.

Key surfaces, all wired through Study Context:

- **Workspace** (`/app`) — the chat reading room (`ChatArea.jsx`), with
  a left sidebar (source library) and a right column that toggles
  between "Bằng chứng" (citation margin) and "Gia sư AI" (the AI Tutor
  panel: live context card, quick actions, session-only Tutor Memory).
- **Study Library** (`/app/study`) — document collections, the Knowledge
  Panel per document, a Learning Dashboard (progress/coverage/weak
  topics/review queue, all derived client-side from already-fetched
  data), and Demo Mode (opens the best already-processed real document —
  never fabricated content).
- **StudyMap** (`/app/study/map/:documentId`) — a react-d3-tree knowledge
  graph with pluggable layouts, search, focus mode, presentation mode,
  and image export.
- Quiz/Practice/Review pages, each its own lazy-loaded route.

A single shared `ui/Modal.jsx` (focus-trap, auto-focus, focus-restore)
backs every dialog in the app rather than each surface implementing its
own.

## Backend Architecture

Flask app (`BE/app/main.py`, ~98 route handlers), domain-organized under
`BE/app/domains/` (auth, documents, retrieval, ...). AI work is expressed
as LangGraph state machines under `BE/app/graphs/` (ingest, query,
mindmap, and related generation graphs), invoked from route handlers via
`BE/app/wiring.py`. Two microservices exist as separate Docker Compose
services sharing the backend's image but running a different entrypoint:
`llm-gateway` (gRPC, centralizes LLM calls behind a global concurrency
cap — `MAX_CONCURRENT_LLM_CALLS`) and `mindmap-service` (gRPC).

Served over `gunicorn`, `WEB_CONCURRENCY` pinned to 1 by requirement (not
a tuning choice): HITL resume metadata and an in-process quiz-job dedupe
dict both live in single-process memory — a second worker would silently
break resume and let one "Tạo quiz" click spawn duplicate jobs.

## AI Pipeline

LangGraph query pipeline, in order:

```
Cache lookup ─▶ Memory tree (conditional) ─▶ Hybrid retrieval (BM25 + FAISS, RRF fusion)
   ─▶ [Rerank: cross-encoder, RERANK_ENABLED] ─▶ [VerifyContext: NLI contradiction check, NLI_ENABLED]
   ─▶ Context builder (citations) ─▶ Generate answer ─▶ Finalize (SSE stream)
```

- **Hybrid retrieval**: BM25 (keyword) + FAISS (vector) fused by
  Reciprocal Rank Fusion (`RRF_score = Σ 1/(k + rank_i) / n`, k=60).
- **Rerank** (optional, off by default): cross-encoder
  (`BAAI/bge-reranker-v2-m3` by default) re-scores the Stage-1 candidate
  set; on any failure or timeout it degrades to Identity (original order)
  rather than breaking the pipeline. Code: `BE/app/domains/retrieval/rerank.py`.
- **NLI contradiction check** (optional, off by default): catches pairs
  of retrieved chunks that are semantically opposed despite both scoring
  high on cosine similarity (negation, changed numbers/dates) using
  `MoritzLaurer/multilingual-MiniLMv2-L6-mnli-xnli`; same fail-safe
  degrade-to-passthrough behavior. Code: `BE/app/domains/retrieval/nli.py`.

**Model configuration** (`BE/.env.example` defaults): chat/summary/mindmap
LLM = `qwen2.5:7b-instruct`, intent classifier = `gemma2:2b`, embeddings =
`BAAI/bge-m3`. **Provider chain**: Ollama (local), Google Gemini, Groq,
and **FPT AI** — a fourth provider (`BE/app/clients/llm_factory.py`)
providing chat, embeddings, reranking, and vision (image transcription),
not commonly documented elsewhere in this repo before this rewrite.
Providers are selected via a fallback chain, not hardcoded to one vendor.

## Study Pipeline

Separate from the RAG query pipeline: server-computed "knowledge
projection" per document (`BE/app/domains/documents/tri_thuc.py`) —
topics with weight/mastery/status, a readiness score (pipeline coverage +
engagement + mastery, weighted), and a timeline of real events (upload,
summary/mindmap created, quiz created/graded, review plan created). This
projection is computed once per document as part of the bulk `/api/library`
response and consumed directly by the frontend's Learning Dashboard,
Learning Journey stepper, and Demo Mode candidate-picker — none of those
features perform their own calculation of "how far along is this
document," they all read this one server-computed value.

## Authentication

Stateless Bearer token, `itsdangerous`-signed (`BE/app/domains/auth/tokens.py`),
not a session cookie and not a standard-library JWT. Payload is
`{uid, token_version}`; `token_version` on the user row allows
server-side revocation (password change, logout-everywhere) without a
session table. Default 7-day TTL, configurable
(`AUTH_TOKEN_TTL_SEC`). Also supports an NKS SSO identity provider path
(`BE/app/domains/auth/`) alongside local email/password registration.

## Data Flow

Two identity systems, bridged deliberately, not accidentally:

- **`document_id`** (Postgres) — the newer StudyMap domain: documents,
  collections, quizzes, attempts, concept mastery, review plans.
- **`source_stem`** (SQLite chunk store) — the older chat/summary/mindmap
  generation pipeline, which predates the Postgres schema.

A document object carries both fields; frontend code that needs to route
between "the chat/summary/mindmap world" and "the StudyMap world" reads
`doc.source_stem` to bridge them. See `docs/deployment/database-boundary.md`
for the full reasoning.

## Deployment

`BE/Dockerfile` (`python:3.11-slim`, both stages), `FE/Dockerfile`
(`node:18-slim` build → `nginx:alpine` runtime — the official nginx image
already drops worker processes to a non-root user). `docker-compose.yml`
defines 6 services: `backend`, `llm-gateway`, `mindmap-service`,
`rq-worker` (profile-gated, off by default), `redis:7-alpine`, `frontend`.
Postgres is external (Supabase — `SUPABASE_URL`/`DATABASE_URL`). Health
check at `GET /health`. `render.yaml` targets Render's free tier with a
documented set of production-posture env vars (`AUTH_REQUIRE_SECRET=true`,
Render-generated `AUTH_SECRET`, `CORS_ORIGINS="*"` — deliberate, see
`docs/SECURITY_SUMMARY.md`).

## Folder Organization

```
BE/
├── app/
│   ├── main.py           # Flask app, ~98 routes
│   ├── domains/          # auth, documents, retrieval, ...
│   ├── graphs/           # LangGraph pipelines (ingest/query/mindmap/...)
│   ├── clients/          # llm_factory and other provider clients
│   ├── db/                # SQLAlchemy models + session
│   └── wiring.py         # Wires graphs to their dependencies
├── services/              # llm-gateway, mindmap-service (gRPC, separate entrypoints)
├── alembic/                # Postgres migrations
├── evaluation/             # Retrieval/answer-quality evaluation harness (E0-E7)
├── scripts/                # perf/, build_proto.py, and other one-off tools
├── tests/                  # pytest — 198 files, ~2009 test functions
└── .env.example             # 476 lines, every variable commented with why

FE/
└── src/
    ├── pages/              # Landing, Login, Register, Workspace, study/
    ├── components/         # Layout/, mindmap/, study/, ui/
    ├── study/               # Study Context, pure selection/aggregation logic + tests
    ├── auth/                # AuthContext, tokenStore, ProtectedRoute
    ├── hooks/                # usePanelLayout, useTheme, ...
    └── utils/                # api client, job pollers, SSE stream (tests sit beside source)

docs/                        # This file, deployment/, decisions/, playbooks/, SECURITY.md, ...
.playbook/                   # known-issues.md + lessons-learned.md — read before changing code
```

## Major Design Decisions

- **Study Context is a broadcast layer, not a store.** Every component
  keeps its own detailed state; the context only carries IDs. Prevents
  the class of bug where two copies of "what's selected" drift apart.
- **Dual data store, bridged explicitly.** Rather than a big-bang
  migration off the SQLite chunk store, the Postgres StudyMap domain was
  built alongside it, with `source_stem` as the documented bridge field.
- **Everything derived, not duplicated.** The Learning Dashboard, review
  queue, and Demo Mode all read the same server-computed knowledge
  projection rather than each implementing their own progress/mastery
  calculation.
- **Fail-open caching/rate-limiting.** Every Redis-dependent subsystem
  degrades to "no cache" / "no limit" rather than blocking requests when
  Redis is absent — a deliberate choice for the free-tier deployment
  target, with a known trade-off (see below).
- **Provider-chain AI, not vendor lock-in.** Ollama/Gemini/Groq/FPT AI
  are all wired through the same `llm_factory` interface.

## Trade-offs

- Fail-open rate limiting means general API rate limiting is currently
  ineffective on the free-tier deployment (Redis absent). Password routes
  have an independent in-process guard specifically because of this.
- `CORS_ORIGINS="*"` in production is a conscious trade — Bearer-token
  auth reduces the classic CSRF blast radius, but it's not zero risk, and
  the team's own config comment states the plan to tighten it later.
- The legacy SQLite chunk store adds a second identity system to reason
  about (`source_stem` vs `document_id`) instead of a single migration —
  cheaper to build against, more to hold in your head.
- `BE/app/main.py` at 5525 lines is a maintainability cost accepted in
  exchange for not risking a structural split during active feature work.

## Future Improvements

- Split `main.py` by concern (routing / caching / rate-limiting / auth
  handlers) — deferred everywhere in this project's recent history as
  too risky to do without dedicated regression coverage; not attempted
  in this release.
- Add nginx security headers (X-Frame-Options, CSP) and a non-root user
  in `BE/Dockerfile`.
- Enable Redis-backed general rate limiting once a Redis instance is
  available in the target deployment tier.
- Full page-by-page accessibility sweep (this release fixed the shared
  Modal component only).
- AI-pipeline latency benchmarking (summary/mindmap/query turnaround) —
  not measured in this release; see `docs/BENCHMARK.md`.
