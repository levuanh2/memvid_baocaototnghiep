# Benchmark

Every number below was actually measured on this machine, this session.
Anything not measured says **"Not measured"** — nothing here is estimated
or fabricated.

## Frontend bundle size (production `vite build`)

Measured before/after route-level code splitting (Phase 6):

| | Before | After | Change |
|---|---|---|---|
| Main entry chunk (raw) | 565.93 kB | 223.34 kB | **-60.7%** |
| Main entry chunk (gzip) | 172.95 kB | 70.82 kB | **-59.3%** |
| Vite 500kB chunk warning | fires | does not fire | — |

Per-route chunks, current build, loaded on demand:

| Route | Raw | Gzip |
|---|---|---|
| StudyMapView | 111.24 kB | 36.49 kB |
| Workspace | ~109 kB | ~33.3 kB |
| DocumentList | 69.43 kB | 20.69 kB |
| QuizResult | 7.32 kB | 2.74 kB |
| QuizTaking | 7.01 kB | 2.87 kB |
| QuizSetup | 6.09 kB | 2.56 kB |
| Practice | 5.60 kB | 2.27 kB |
| ReviewGuide | 5.16 kB | 2.12 kB |
| Login | 4.33 kB | 1.87 kB |
| Register | 3.83 kB | 1.50 kB |

Shared vendor chunks (unaffected by the route split, already isolated
pre-existing): `mindmap-*.js` 220.03 kB / 70.68 kB gzip (mind-elixir),
`markdown-*.js` 157.20 kB / 47.66 kB gzip (react-markdown + remark
plugins), `react-*.js` 44.81 kB / 16.10 kB gzip.

## Frontend test suite

**831 tests / 65 test files, all passing.** Wall time: 6-30s depending on
machine load across repeated runs this session (transform+import time
dominates; actual test execution is ~1-2s). All pure-logic modules
(reducers, selectors, aggregation, pure helpers) — this codebase does not
use component-level/DOM testing (`@testing-library` is not a dependency),
so this number reflects logic coverage, not UI-interaction coverage.

## Backend test suite

**Not measured this session.** `pytest` could not complete collection in
the local environment — the installed `.venv` has `langchain==0.2.17` /
`langchain-core==1.4.8` while `requirements.txt` pins
`langchain>=0.3.27,<0.4` / `langchain-core>=0.3.66,<0.4`, so any test
importing `query_graph` fails at collection with
`ModuleNotFoundError: langchain_core.pydantic_v1`. This is a local
environment mismatch, not a defect in the repository — CI
(`.github/workflows/ci.yml`) does a fresh `pip install -r requirements.txt`
and runs the suite against a real Postgres service container. 195 test
files exist under `BE/tests/`; exact function-level test count and pass
rate were not obtained in this session.

## AI pipeline latency (summary / mindmap / question / tutor response)

**Not measured.** Would require running the full stack against a live LLM
provider (Ollama or a cloud provider) end-to-end; this documentation pass
did not execute the AI pipeline. `BE/scripts/perf/` contains prior dated
baseline scripts (`baseline_concurrency.py`, `cache_latency.py`) and
`reports/performance/` contains prior dated baseline reports from earlier
in the project's history — neither was re-run for this release.

## Cold start / warm start

**Not measured.** Would require booting the full Docker Compose stack
(backend + Postgres + optional Redis + frontend) and timing readiness;
not attempted in this session.

## Library loading (Study Library page, `/api/library`)

**Not measured.** No document set of known size was available to load
against and time in this session.

## Memory usage

**Not measured.** No profiling tool was run against a live process this
session.
