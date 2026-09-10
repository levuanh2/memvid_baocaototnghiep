# Technical Report

## Architecture

Two-service application: a Flask backend (`BE/app/`) and a Vite/React
frontend (`FE/`), talking over `/api/*` REST, reverse-proxied through
nginx in production. Backend is domain-organized under `BE/app/domains/`
(auth, documents, retrieval, ...), with AI work expressed as LangGraph
pipelines under `BE/app/graphs/` (Ingest, Query, Mindmap, and related
generation graphs). Two data stores exist side by side by design: Postgres
(via SQLAlchemy + Alembic migrations) for the newer StudyMap domain —
documents, collections, quizzes, attempts, concept mastery, review plans —
and a legacy SQLite-backed chunk store still serving the older
chat/summary/mindmap generation pipeline, keyed by `source_stem` rather
than the Postgres `document_id`. See `docs/deployment/database-boundary.md`
for the reasoning; the frontend bridges the two identity systems wherever
a document object carries both fields.

## Libraries

Backend: Flask, SQLAlchemy + Alembic, LangChain/LangGraph (pinned below
1.x — see `requirements.txt`'s inline comment: langgraph 1.x pulls
`ormsgpack`, whose binary is blocked by Windows Application Control in
this project's dev environment), FAISS, sentence-transformers, PyMuPDF/
pymupdf4llm for PDF, python-docx/python-pptx/openpyxl for Office formats,
`itsdangerous` for token signing, `redis` (optional, fails open), `rq`
(optional background queue, gated by `QUEUE_ENABLED`). Frontend: React 19,
React Router 7, react-markdown + remark-gfm/remark-breaks, mind-elixir
(mindmap rendering), react-d3-tree (StudyMap knowledge graph), lucide-react
(icons), Tailwind CSS, Vite, Vitest. No TypeScript — plain JS by design (no
`tsconfig.json`, zero `.ts`/`.tsx` files).

## Performance

Real, measured numbers in `docs/BENCHMARK.md`. Headline: route-level
`React.lazy()` code splitting cut the frontend's main JS chunk by 60.7%
(565.93kB → 223.34kB raw). No AI-pipeline latency numbers were measured
in this documentation pass (stated as "Not measured", not estimated).

## Caching

Query response caching uses a single-flight pattern (dedupe concurrent
identical queries) plus a semantic cache layer (`docs/SEMANTIC_CACHE_SPEC.md`)
that fails open when `REDIS_URL` is unset — correctness never depends on
cache availability. An overload/admission-control subsystem exists
alongside it for backpressure. Both subsystems' small env/logging helpers
were deduplicated into shared functions during the Final Freeze cleanup
pass (verified byte-for-byte behavior-equivalent by direct execution, not
just review — see the corresponding commit message for the exact cases
checked).

## State Management

Frontend has no global state library (no Redux/Zustand/etc.) — a single
React Context ("Study Context") broadcasts the current cross-surface
selection (document/topic/entity/summary/node/question/learning mode) as
plain IDs, deliberately not a second copy of any component's detailed
local state. Every component still owns its own detailed state; Study
Context is a broadcast layer, not a data store. Selection logic itself is
pushed into pure, unit-tested `.js` reducer-style functions
(`FE/src/study/studySelection.js` and siblings), following this codebase's
established convention: push every decision into a tested pure function,
leave thin JSX untested.

## Testing Strategy

Backend: pytest, 195 test files under `BE/tests/`. Frontend: Vitest, 831
tests across 65 files, all testing pure logic modules — no
component/DOM-level test framework is used (`@testing-library` is not a
dependency). This is a deliberate convention observed consistently across
the whole session's work, not an oversight: business logic lives in tested
pure functions; JSX is thin enough that it's read-reviewed instead of
DOM-tested.

## Security

Full detail: `docs/SECURITY.md`, condensed in `docs/SECURITY_SUMMARY.md`.
Headline: Bearer-token auth with server-side revocation via a
`token_version` column, no real secrets in git history (verified this
release), four documented P1 hardening gaps (open CORS in prod, general
rate limiting currently ineffective, no nginx security headers, BE
container runs as root) — none rated as blocking release.

## Accessibility

Not a full page-by-page audit. Scoped, verified fixes: the shared
`ui/Modal.jsx` (used by 5 dialog components) gained a real focus trap,
auto-focus-on-open, and focus-restore-on-close where none of the three
existed before. Progress bars use `role="progressbar"` with
`aria-valuenow/min/max` and always print the percentage as text, not just
as a bar length.

## Deployment

`BE/Dockerfile`, `FE/Dockerfile` (multi-stage: `node:18-slim` build →
`nginx:alpine` runtime), `docker-compose.yml` + a Windows variant,
`render.yaml` for Render's free-tier deployment target, a well-commented
`.env.example`. Health check at `GET /health`. CI
(`.github/workflows/ci.yml`) runs against a real Postgres service
container with fresh dependency installs, migrations, the test suite, and
a gunicorn smoke-boot that curls `/health`.

## Monitoring

No dedicated monitoring/tracing infrastructure (no Sentry, no metrics
exporter) — explicitly out of scope to add per the phase constraints this
was built under ("no new infrastructure"). What exists: structured
`print`/`console.error` logging with greppable prefixes (`singleflight`,
`overload`), a frontend `ErrorBoundary` + `unhandledrejection` listener
added this release cycle (neither existed before — verified by grep, zero
prior hits for `componentDidCatch`/`unhandledrejection` anywhere in
`FE/src`), and the CI health-check smoke-boot as the closest thing to a
production monitor today.

## Known Limitations

- BE test suite unverifiable in the current local dev environment (CI is
  the source of truth for it).
- No AI-pipeline latency benchmarks measured.
- `BE/app/main.py` is a 5525-line file mixing routing, caching,
  rate-limiting, and inline auth handlers — functions correctly, flagged
  as a maintainability risk for future work, not touched this release
  given the risk of a structural change during a freeze.
- Four documented P1 security-hardening gaps (see Security section above).
- Accessibility work this cycle was scoped to the highest-leverage shared
  fix (Modal.jsx), not an exhaustive page sweep.
