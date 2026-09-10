# MemVidX — v1.0 Release Checklist

Final release audit. Every line below is backed by something actually read or
run in this repository at audit time — nothing here is guessed. Where a check
could not be completed (e.g. BE test suite locally), that is stated plainly
instead of a number being invented.

## Architecture

Flask + SQLAlchemy/Postgres backend (`BE/app/`), with a legacy SQLite
chunk-store still serving the older chat/summary/mindmap pipeline
(dual-store split, by design — see `docs/deployment/database-boundary.md`).
Vite/React frontend (`FE/`), plain JS, no TypeScript. LangGraph pipelines
(Ingest/Query/Mindmap) over a provider chain (Ollama local, Groq/Gemini as
configured fallbacks — `Active providers: ['fpt', 'ollama', 'gemini']` on
this machine's `.env`). Nginx reverse-proxies `/api/` to the Flask backend
in production (`FE/nginx.conf`), serves the built SPA otherwise.

## Backend

98 route handlers in `BE/app/main.py` (5525 lines — a large but functioning,
not broken, file; see Final Freeze audit for the maintainability note, not a
release blocker). Domain-organized under `BE/app/domains/` (auth, documents,
retrieval, ...). Stateless Bearer-token auth (`itsdangerous`-signed, not a
library JWT, despite "JWT" being used loosely in comments/docs) with a
`token_version` column for server-side revocation without a session table
(`BE/app/domains/auth/tokens.py`).

## Frontend

10 routes, all route-level code-split via `React.lazy()` (Landing stays
eager as the most common cold entry). Top-level `ErrorBoundary` +
`unhandledrejection` logger (added Phase 6 — previously neither existed
anywhere). Shared `ui/Modal.jsx` has focus-trap/auto-focus/focus-restore
(added Phase 6), used by 5 dialog consumers.

## AI Pipeline

LangGraph-based Ingest/Query/Mindmap/Quiz graphs. Provider fallback chain
configured, not hardcoded to one vendor. No prompt content was read or
audited in this pass (out of scope — "no AI changes" for this phase, and
prompt content wasn't part of what was asked to verify).

## Testing

- **Frontend**: `vitest run` → **831/831 passing**, 65 test files, ~10-30s
  wall time depending on machine load (measured this session, most recent
  run above). `eslint` scoped to session-touched files: clean. Whole-tree
  `eslint .`: 62 pre-existing errors in files untouched this project
  (documented in the Final Freeze audit — necessary react-markdown
  destructuring patterns and an intentional silent-catch idiom used
  throughout the codebase, not bugs).
- **Backend**: `pytest` could **not** be run to completion locally this
  session — the local `.venv` has `langchain==0.2.17`/`langchain-core==1.4.8`
  installed while `requirements.txt` pins `langchain>=0.3.27,<0.4` /
  `langchain-core>=0.3.66,<0.4`; collection aborts with
  `ModuleNotFoundError: langchain_core.pydantic_v1` in any test importing
  `query_graph`. **This is a local environment problem, not a repository
  defect** — `.github/workflows/ci.yml` does a fresh `pip install -r
  requirements.txt` + a real Postgres service container + `alembic upgrade
  head` + `pytest -q` + a gunicorn smoke-boot hitting `/health`, which would
  install the correctly pinned versions. Not fixed locally (reinstalling
  packages in a shared venv was judged out of scope/risk for an audit pass).
  195 test files exist under `BE/tests/`.
- One backend module import chain (`query_graph` → `ensemble_retriever` →
  `langchain.retrievers`) was verified to fail gracefully at runtime (caught
  internally, logged as `QUERY_GRAPH không khởi tạo được`, does not crash
  module load) — confirmed by direct import in this session, not assumed.

## Security

Full detail in `docs/SECURITY.md` (Phase 6). This pass re-verified and adds:

- **No real secrets in git history.** `BE/.env` contains a real-looking API
  key (`FPT_AI_API_KEY=sk-...`) on disk, but `git ls-files` and
  `git log --all --full-history -- BE/.env` both confirm it has **never**
  been tracked or committed. `.gitignore:4` (`*.env`) covers it. Grepped all
  git-tracked files for API-key-shaped patterns (`AIza...`, `sk-...`,
  `ghp_...`, `xox[a-z]-...`, private-key headers) — zero hits.
- **No hardcoded credentials.** The only `password=` literals found are test
  fixtures (`BE/tests/test_auth.py:47`, `"password123"`/`"correcthorse"`)
  and a form error-message object key (`FE/src/auth/matKhauForm.js:55`,
  `loi.password = "..."`) — not a credential.
- **No `console.log` calls anywhere in FE production source** (0 hits,
  grepped). 15 `console.error` call sites, none logging token/password/auth
  values (grepped for that specifically).
- **No `dangerouslySetInnerHTML` anywhere in FE** — all rendering goes
  through JSX auto-escaping or `react-markdown`'s controlled renderer.
- **`localhost:8080` fallback in `FE/src/utils/api.js:12`** is gated behind
  `import.meta.env.DEV` — stripped in production builds, does not leak into
  the prod bundle's behavior.
- **CORS is `*` in the actual production config**
  (`render.yaml:224`, `value: "*"`), and this is a **documented, deliberate**
  choice, not an oversight — the inline comment states the reasoning
  ("Auth is Bearer-token, so a cross-origin reader still cannot obtain a
  token") and a stated follow-up ("Tighten to the studymap-web URL once it
  is known"). **P1** — real gap, consciously accepted, not yet closed.
- **`AUTH_SECRET` is correctly production-configured**: Render
  `generateValue: true` (auto-generated, never in git, never shown),
  `AUTH_REQUIRE_SECRET: "true"` set for prod (fails loudly if somehow
  missing), 7-day TTL (`AUTH_TOKEN_TTL_SEC: "604800"`).
- **General API rate limiting has no effect in the current production
  config** — `RATE_LIMIT_ENABLED` is not set in `render.yaml` at all, and
  `REDIS_URL` is present as a key but the free-tier posture leaves it
  effectively empty, so the Redis-backed general limiter fails open. Only
  password-accepting routes have an independent, working, in-process
  limiter (`BE/app/domains/auth/gioi_han.py`) built specifically because of
  this gap. **P1** — same conclusion as Phase 6, re-confirmed against the
  live `render.yaml` this time rather than inferred.
- **No security headers at the nginx layer** — `FE/nginx.conf` sets
  `Cache-Control` only; no `X-Frame-Options`, `X-Content-Type-Options`, or
  `Content-Security-Policy`. **P1**: real, standard defense-in-depth gap.
  Impact is moderated (not eliminated) by: no `dangerouslySetInnerHTML`
  anywhere (low stored/reflected-XSS surface), and Bearer-token auth (not
  cookies, so classic CSRF via ambient credentials doesn't apply the same
  way). Clickjacking risk on the login page is the most concrete residual
  concern of the four.
- **BE Docker image runs as root** — neither `USER` nor `adduser`/`useradd`
  appears in `BE/Dockerfile`. **P1/P2**: standard container-hardening gap,
  not an active exploit path found in this audit, but worth closing before
  a hardening pass. (FE's runtime image is `nginx:alpine`, whose official
  build already drops worker processes to a non-root user by default — no
  gap there.)

## Performance

Real, measured (Phase 6/7, re-confirmed clean tree matches these commits):
main entry chunk 565.93kB → 223.34kB (gzip 172.95kB → 70.82kB) after
route-level code-splitting. Vite's 500kB chunk warning no longer fires.
Route chunks load on demand (DocumentList 69.43kB, StudyMapView 111.24kB,
Workspace 109.00kB, etc.).

## Accessibility

Shared `Modal.jsx` focus-trap/auto-focus/focus-restore (Phase 6), benefiting
5 dialog consumers at once. Not a full page-by-page WCAG sweep — scoped
fixes only, documented as such in the Phase 6 report.

## Deployment

`BE/Dockerfile`, `FE/Dockerfile`, `docker-compose.yml` +
`docker-compose.windows.yml`, `render.yaml`, well-commented `.env.example`.
Health check at `GET /health` (`BE/app/main.py:801`). `.dockerignore`
present at repo root (applies to both build contexts — FE's Docker build
context is repo root, confirmed via `docker-compose.yml:274-275`) and at
`BE/.dockerignore`; correctly excludes `.env`/`.env.*` while explicitly
un-ignoring `.env.example`. `FE/nginx.conf` has gzip, 1-year immutable
caching on hashed assets, no-cache on `index.html`, SPA fallback, and a
300s proxy timeout sized for long AI jobs.

## CI/CD

`.github/workflows/ci.yml`: fresh `pip install`, real Postgres service
container, `alembic upgrade head`, `pytest -q`, a gunicorn smoke-boot that
curls `/health`, then a separate frontend job. Real, not a stub.

## Documentation

Architecture (`docs/ARCHITECTURE.md`), deployment
(`docs/deployment/render-free.md`, `database-boundary.md`), security
(`docs/SECURITY.md`, Phase 6), API reference (`docs/NKS API.md` +
`docs/nks-api.md` — verified NOT duplicates: one is the raw vendor doc, the
other a deliberately maintained "cleaned" rewrite). All present.

## Benchmark

Bundle-size numbers above are real, measured production `vite build`
output. No AI-latency (summary/mindmap/question/tutor) or cold/warm-start
numbers were measured in this session — doing so would require running the
full stack with a live LLM provider, which this audit pass did not attempt.
Not fabricated; simply not measured. `BE/scripts/perf/` and
`reports/performance/` contain prior dated baseline runs (Phase 6 finding)
not re-run here.

## Known Risks (carried into v1.0)

1. CORS wildcard in production, consciously accepted, stated as temporary.
2. General API rate limiting ineffective on the current free-tier deploy
   (password routes are protected independently).
3. No security headers (X-Frame-Options / X-Content-Type-Options / CSP) at
   the nginx layer.
4. BE Docker image runs as root.
5. BE test suite unverifiable in this local environment (CI covers it).
6. `main.py` is a 5525-line god-file (maintainability risk, not a release
   risk — functions correctly, just hard to navigate).

## Release Notes (factual summary, not marketing)

Document chat with citations, Summary v2, Mindmap v3, StudyMap knowledge
graph, Question Engine, Study Context + AI Tutor panel, Learning Analytics
dashboard + review queue, Quiz/Practice/Review, Demo Mode (opens an
already-processed real document, never fabricated content). Route-level
code splitting, a top-level error boundary, and a shared-Modal
accessibility fix landed this release cycle.

## Rollback Notes

No DB schema changes were made in Phases 6-7 of this session (verified —
neither phase touched `BE/app/db/`, migrations, or `alembic/`). Frontend
changes are additive/refactor-only and route through existing components;
reverting to the previous tag requires no data migration. `AUTH_SECRET` is
Render-managed and does not change across a rollback.
