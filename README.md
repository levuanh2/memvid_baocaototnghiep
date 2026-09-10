# MemVidX

**Upload a document, then chat, summarize, mind-map, and quiz yourself on
it — every answer cited back to the source, every study surface reading
from one shared context.**

![MemVidX hero screenshot placeholder](docs/assets/hero-placeholder.png)
<!-- Placeholder — replace with a real screenshot of the Workspace before
     publishing. See "Screenshots" below for the full shot list needed. -->

---

## Table of Contents

1. [Feature Overview](#feature-overview)
2. [AI Capabilities](#ai-capabilities)
3. [Screenshots](#screenshots)
4. [Architecture Overview](#architecture-overview)
5. [AI Pipeline](#ai-pipeline)
6. [Technology Stack](#technology-stack)
7. [Folder Structure](#folder-structure)
8. [Installation](#installation)
9. [Environment Variables](#environment-variables)
10. [Running Locally](#running-locally)
11. [Running with Docker](#running-with-docker)
12. [Deployment](#deployment)
13. [Testing](#testing)
14. [Benchmark](#benchmark)
15. [Known Limitations](#known-limitations)
16. [Roadmap](#roadmap)
17. [License](#license)
18. [Acknowledgements](#acknowledgements)

---

## Feature Overview

- **Document chat with citations** — ask questions, get answers grounded
  in the documents you selected, each claim linked back to its source
  chunk.
- **Summary v2** — structure-aware summaries, generated as a background
  job with progress and cancel.
- **Mindmap v3** — auto-generated, multi-level mind maps, exportable as
  an image.
- **StudyMap** — a knowledge graph per document (react-d3-tree) with
  layout switching, search, focus mode, and presentation mode.
- **Study Library** — collections, per-document Knowledge Panel (topics,
  entities, related documents, suggested questions), and a Learning
  Dashboard (progress, weak-topic detection, review queue) — all derived
  from already-loaded data, no extra network calls.
- **AI Tutor panel** — a live context card, quick actions (Explain /
  Summarize / Quiz-in-chat), and session-only memory of what you've
  recently looked at, wired into the same chat composer as everything
  else.
- **Quiz, grading, and review plans** — generate a quiz, take it, get
  graded, get a review plan for what you missed.
- **Demo Mode** — one click opens the best already-processed real
  document in your library. Never fabricated content; if nothing is
  ready yet, the button simply doesn't appear.

## AI Capabilities

- Hybrid retrieval: BM25 + FAISS vector search, fused by Reciprocal Rank
  Fusion.
- Optional two-stage precision: cross-encoder reranking
  (`BAAI/bge-reranker-v2-m3` by default) and an NLI-based contradiction
  filter that catches retrieved chunks that are semantically opposed
  despite scoring similarly (negation, changed numbers/dates) — both off
  by default, both degrade safely to a no-op on any failure or timeout.
- Multi-provider LLM chain: **Ollama** (local), **Google Gemini**,
  **Groq**, and **FPT AI** (chat, embeddings, reranking, and vision/image
  transcription) — selected via a fallback chain, not locked to one
  vendor.
- LangGraph-orchestrated pipelines for ingest, query, mindmap generation,
  and quiz generation.
- Deterministic (non-LLM) Suggested Question engine — derives questions
  from already-computed topic/entity/mastery data instead of generating
  new ones per view.

## Screenshots

*(Placeholders — capture these before publishing. None are included in
this repository; no image has been fabricated.)*

| Screen | File |
|---|---|
| Workspace — chat + citations | `docs/assets/screenshot-workspace.png` |
| AI Tutor panel | `docs/assets/screenshot-tutor.png` |
| Summary view | `docs/assets/screenshot-summary.png` |
| Mindmap | `docs/assets/screenshot-mindmap.png` |
| StudyMap knowledge graph | `docs/assets/screenshot-studymap.png` |
| Study Library + Learning Dashboard | `docs/assets/screenshot-library.png` |
| Quiz taking | `docs/assets/screenshot-quiz.png` |

## Architecture Overview

Two services: a React/Vite frontend behind nginx, and a Flask backend
(~98 routes, domain-organized) running LangGraph pipelines. Two data
stores by design — Postgres for the newer StudyMap domain
(documents/collections/quizzes/progress), a legacy SQLite chunk store
still serving chat/summary/mindmap generation. Optional gRPC
microservices (`llm-gateway`, `mindmap-service`) and an optional Redis
cache, both fail-open when unavailable.

Full detail, diagrams, and every major design decision/trade-off:
**[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)**.

## AI Pipeline

```
Cache lookup ─▶ Memory tree (conditional) ─▶ Hybrid retrieval (BM25 + FAISS, RRF)
   ─▶ [Rerank, optional] ─▶ [NLI contradiction check, optional]
   ─▶ Context builder (citations) ─▶ Generate answer ─▶ SSE stream
```

Ingest, mindmap generation, and quiz generation are separate LangGraph
pipelines. Full node-by-node detail: `docs/ARCHITECTURE.md#ai-pipeline`.

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, React Router 7, Vite, Tailwind CSS, react-markdown, mind-elixir, react-d3-tree |
| Backend | Flask, gunicorn, LangChain/LangGraph (pinned `<0.4` — see `requirements.txt` for why), FAISS, sentence-transformers |
| Databases | PostgreSQL (via SQLAlchemy + Alembic, Supabase-hosted), SQLite (legacy chunk store) |
| AI providers | Ollama, Google Gemini, Groq, FPT AI |
| Document parsing | PyMuPDF/pymupdf4llm, python-docx, python-pptx, openpyxl, striprtf |
| Infra | Docker, docker-compose, nginx, Redis (optional), gRPC (optional microservices) |
| Testing | Vitest (frontend, 831 tests), pytest (backend, ~2009 tests across 198 files) |

No TypeScript — the frontend is plain JavaScript by project convention.

## Folder Structure

```
BE/
├── app/
│   ├── main.py        # Flask app, ~98 routes
│   ├── domains/        # auth, documents, retrieval, ...
│   ├── graphs/          # LangGraph pipelines
│   └── clients/          # llm_factory and other provider clients
├── services/              # llm-gateway, mindmap-service (gRPC)
├── alembic/                 # Postgres migrations
├── evaluation/               # Retrieval/answer-quality evaluation harness
├── tests/                      # pytest
└── .env.example                 # every variable commented with why

FE/
└── src/
    ├── pages/          # Landing, Login, Register, Workspace, study/
    ├── components/      # Layout/, mindmap/, study/, ui/
    ├── study/             # Study Context + pure aggregation logic, tested
    ├── auth/               # AuthContext, tokenStore, ProtectedRoute
    └── utils/               # API client, job pollers, SSE stream

docs/                   # Architecture, security, deployment, product docs
```

Full 2-level tree and legacy-artifact confirmation (what was checked and
found NOT to exist): `docs/ARCHITECTURE.md#folder-organization`.

## Installation

**Requirements**: Python 3.11, Node.js 18+, and either a running Ollama
instance or an API key for Gemini/Groq/FPT AI. Docker + Docker Compose
optional but recommended.

```bash
git clone <this-repository-url>
cd MemVid_BaoCaoTotNghiep

# Backend
cd BE
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env        # then edit — see Environment Variables below

# Frontend
cd ../FE
npm install
# No .env.example ships for the frontend — in dev it falls back to
# http://localhost:8080 automatically (FE/src/utils/api.js). Only create
# a .env if you need to point at a different backend URL:
#   echo "VITE_API_URL=http://localhost:8080" > .env
```

## Environment Variables

`BE/.env.example` is the authoritative reference — 476 lines, every
variable commented with *why*, not just what. Root `.env.example` (219
lines) is the Docker/production profile. Highlights:

| Variable | Default | Purpose |
|---|---|---|
| `OLLAMA_HOST` | `http://localhost:11434` | Local LLM provider |
| `SLM_MODEL_CHAT` / `SLM_MODEL_SUMMARY` / `MINDMAP_MODEL` | `qwen2.5:7b-instruct` | LLM used per task |
| `EMBEDDING_MODEL_NAME` | `BAAI/bge-m3` | Embedding model |
| `RERANK_ENABLED` | off | Enable cross-encoder reranking |
| `NLI_ENABLED` | off | Enable contradiction-check filtering |
| `AUTH_SECRET` | *(required in prod)* | Token signing key — must be set, or the app falls back to a per-process dev-only secret |
| `AUTH_REQUIRE_SECRET` | `false` | Set `true` in production to fail loudly instead of falling back |
| `CORS_ORIGINS` | `*` | Allowed frontend origins |
| `DATABASE_URL` / `SUPABASE_URL` | — | Postgres connection |
| `REDIS_URL` | — | Optional; every dependent feature fails open without it |
| `WEB_CONCURRENCY` | `1` | Must stay `1` — see `docs/ARCHITECTURE.md#backend-architecture` for why |

## Running Locally

```bash
# Terminal 1 — backend
cd BE
python -m app.main   # or: gunicorn -w 1 -b 0.0.0.0:8080 app.main:app

# Terminal 2 — frontend
cd FE
npm run dev
```

## Running with Docker

```bash
docker-compose up --build
```

Starts `backend`, `frontend`, `llm-gateway`, `mindmap-service`, and
`redis`. `rq-worker` is a Compose profile, off by default
(`docker-compose --profile worker up` to include it). A Windows-specific
compose override exists at `docker-compose.windows.yml`.

## Deployment

`render.yaml` targets Render's free tier with a documented
production-posture configuration (auto-generated `AUTH_SECRET`,
`AUTH_REQUIRE_SECRET=true`, health check on `/health`). Full deployment
detail: [`docs/deployment/render-free.md`](docs/deployment/render-free.md),
[`docs/deployment/database-boundary.md`](docs/deployment/database-boundary.md).

## Testing

```bash
# Backend
cd BE
pytest

# Frontend
cd FE
npm run test    # vitest
npm run lint     # eslint
npm run build     # production build
```

Frontend: **831 tests passing, 65 files** (measured this release — see
`docs/BENCHMARK.md`). Backend: 198 test files, ~2009 test functions;
CI (`.github/workflows/ci.yml`) runs the full suite against a real
Postgres service container on every push.

## Benchmark

Only measured numbers — nothing estimated. Full detail:
[`docs/BENCHMARK.md`](docs/BENCHMARK.md).

- Frontend main bundle: **565.93kB → 223.34kB** (-60.7%) after
  route-level code splitting.
- Frontend test suite: 831/831 passing.
- AI-pipeline latency, cold/warm start, memory usage: **not measured** in
  this release — stated plainly rather than estimated.

## Known Limitations

- General API rate limiting is not effective on the current free-tier
  deployment (fails open without Redis); password-accepting routes have
  an independent guard.
- `CORS_ORIGINS` defaults to `*` in production — a documented, deliberate
  trade-off (Bearer-token auth, not cookies), not an oversight.
- No security headers (CSP, X-Frame-Options) at the nginx layer yet.
- Backend Docker image runs as root.
- No LICENSE file currently exists in this repository (see below).
- Full detail: [`docs/SECURITY_SUMMARY.md`](docs/SECURITY_SUMMARY.md),
  [`docs/RELEASE_CHECKLIST.md`](docs/RELEASE_CHECKLIST.md).

## Roadmap

- Split `BE/app/main.py` (currently ~5,500 lines) into focused modules.
- Nginx security headers + non-root backend container.
- Enable Redis-backed general rate limiting once available in the target
  deployment tier.
- Full page-by-page accessibility audit (this release fixed the shared
  dialog component only).
- Measure AI-pipeline latency and publish real numbers.

## License

**No LICENSE file currently exists in this repository.** Add one before
publishing publicly — until then, all rights are reserved by default
under copyright law regardless of the repository being visible on
GitHub.

## Acknowledgements

Built on Ollama, LangChain/LangGraph, FAISS, sentence-transformers, and
React. This project's original working name was **MemVid**, exploring an
encode-memory-as-QR-video approach; that direction was abandoned early
and no longer exists in this codebase — mentioned here only so the
repository name doesn't cause confusion for anyone reading the git
history.
