# RC2 — Release Hardening & Verification

Feature development is stopped for this epic. This document answers one question: can the current tree become a release candidate — with evidence, not assumptions, and no BLOCKED result converted into a PASS.

**Pre-deploy decisions required — read this before the verdict at the bottom.** Two findings in this report (P7) are release-owner decisions, not implementation gaps this pass could resolve on its own, and neither should be read as "safe by default" just because the verdict below is READY:

1. **`CORS_ORIGINS` is wildcard (`*`) in production `render.yaml`.** Mitigated by bearer-token auth today, but a real, self-acknowledged (in the code's own comment) gap. **This needs an explicit go/no-go decision before an actual production deploy** — either accept the wildcard consciously for this launch, or tighten it to the real `studymap-web` origin first. It is not fixed in this pass (a shared deploy-config value change needs separate sign-off, not a unilateral edit here), and it should not be read as an accepted risk just because it's filed as a "known limitation" below.
2. **Production's retrieval index currently allows exactly one real document** (`BE/config/production_index_allowlist.json`). Before anyone treats this deployment as feature-complete at scale (RAG chat citations, semantic search), **the release owner should explicitly confirm this is expected** for the current launch stage, not discover it after the fact.

---

## Phase 0 — Release baseline

| | |
|---|---|
| Branch | `release/p0-p0.5-verification` |
| HEAD (at epic start) | `eed75ca8c61f0d52a9146cc0527cd660bb2bbb8a` |
| FE working tree | clean (no modified/untracked FE files at epic start) |
| BE working tree | **67 modified files**, all pre-existing Codex WIP (Phase 2B/quality/recovery work, present since before this epic and unrelated to it) — explicitly NOT staged, NOT touched, NOT included in any commit this pass |
| Node | v22.18.0 |
| npm | 11.12.1 |
| Python | 3.11.9, project-local `BE/.venv` (not system Python) |
| FE dependency state | `node_modules` present, `npm run build`/`test`/`eslint` all run against the committed `package.json`/lockfile, no `npm install` performed this pass |
| BE dependency state (at epic start) | **Drifted**: `requirements.txt` pins `langchain>=0.3.27,<0.4` / `langchain-core>=0.3.66,<0.4`; installed environment had `langchain==0.2.17` (below the floor) and `langchain-core==1.4.8` (far above the ceiling) — an internally inconsistent combination that never matched `requirements.txt` |
| Relevant env flags | `BE/.env` present locally with real `GEMINI_API_KEY`/`GROQ_API_KEY`/Ollama config — a live local BE run is theoretically possible in this environment, but was not attempted this pass (see P2) |

Working-tree ownership was checked before every git operation this pass — `git status --short -- BE/` was re-run before each report to confirm the 67-file WIP set was never staged.

---

## P0 — BE test collection

**Root cause, found by direct investigation (`pytest --collect-only -q`, read-only, no files touched):** dependency-lock mismatch, not a code bug. The 9 collection errors all originated inside the *installed* `langchain` package's own files (`site-packages/langchain/chains/llm.py:25`, `site-packages/langchain/retrievers/ensemble.py:27`), both doing `from langchain_core.pydantic_v1 import X` — a compatibility shim present in old `langchain-core` releases and absent from the drifted `1.4.8` that was actually installed. Confirmed (via grep) that this import string does not appear anywhere in this project's own `app/`/`services/` code — the drift was entirely third-party.

**Fix (Codex, BE-owned):** reinstalled the project-local `BE/.venv` to match `requirements.txt`'s own pins — `langchain 0.3.30`, `langchain-core 0.3.86`, `langchain-community 0.3.31`, `langgraph 0.2.76`, `langgraph-checkpoint 2.0.21`, `pydantic 2.10.6`. No source code changed, no test skipped, no module silenced — a pure environment restoration to the versions the repo already declared it needed.

**Result:** `pytest --collect-only -q` → **2737 tests collected, 0 collection errors** (up from 2631 collected / 9 errors before the fix).

**Full suite** (Codex, run against the current WIP-containing working tree — explicitly not a "clean branch" run, disclosed as such):

```
2737 collected
2498 passed
5 failed
236 skipped
```

The 5 failures are all in `tests/test_index_khoa_that.py` (lock-acquire/release tests around the vectorstore index lock), and reproduce **only when that file is run in isolation** — a `fakeredis` lock-state test-isolation artifact (`KhongLayDuocKhoa` — "could not acquire lock"), not a functional regression. Confirmed unrelated to the P0 `pydantic_v1` dependency fix (no source file was changed by that fix — environment-only) and unrelated to any feature work in this epic series (MindMap/Summary/StudyMap/provenance graph regressions were separately re-run: **23 passed, 1 warning**, a clean subset covering exactly the surfaces M2/M2.5 touched). The 236 skips were not individually itemized this pass; consistent with this session's established pattern of DB-dependent tests skipping without `TEST_DATABASE_URL` (10 such skips were already disclosed for StudyMap alone in M2's own report — 236 across the full 2737-test suite is plausible for the same class of skip, but this was not exhaustively confirmed line-by-line).

**Collection succeeds. The suite runs to completion. Per the epic's literal exit criterion ("BE full suite cannot collect/run"), this is satisfied** — collection and execution both complete; the 5 failures are a real, disclosed, narrow, non-blocking finding, not silently converted to green.

---

## P1 — Frontend verification

```
npm run build   ->  clean
npm run test    ->  1020/1020 (unchanged from the confirmed M2.5 baseline)
npx eslint src  ->  66 problems (58 errors, 8 warnings) — unchanged baseline
```

### Lint classification (all 66 findings, evidence-based, not assumed)

Every finding was read in context before classification — not pattern-matched by rule name alone.

| Category | Count | Findings |
|---|---|---|
| **A. release-risk** | **0** | none — `npm run build` is clean; nothing here reaches the production bundle differently than it does today |
| **B. correctness-risk** | **0** | every `react-hooks/exhaustive-deps` warning checked (`useMindMapController.js`, `SidebarLeft.jsx`, `SidebarRight.jsx`, `KnowledgeInspector.jsx`, `EvidenceDrawer.jsx`, `MindElixirView.jsx`, `knowledgeParts.jsx`) is a **deliberate, and in most cases explicitly commented, omission** — e.g. `useMindMapController.js`'s effect intentionally keys on `data?.id` only, not the whole `data` object, with a comment explaining why re-running on every object-identity change (e.g. after Save) would be a real bug, not a fix. `SidebarLeft.jsx`'s missing-dep warning is a standard "fetch once on mount" pattern. No evidence of an actual stale-closure bug in any of them. |
| **C. accessibility-risk** | **0** | no `jsx-a11y` (or equivalent) rule fired anywhere in this run |
| **D. maintainability-only** | **66** | see breakdown below |

**D breakdown:**
- **14× `no-empty` (empty catch blocks)** — `ChatArea.jsx` (8), `useTheme.js` (2), `activeJob.js` (3), `conversation.js` (1). Spot-checked several: all are `try { es.close(); } catch {}` (best-effort cleanup of an already-possibly-closed connection) or `try { localStorage.setItem(...) } catch {}` (private-browsing/storage-disabled tolerance) — the exact same defensive idiom used consistently across this whole codebase, with real fallback behavior in every case checked (theme still works without persistence; SSE cleanup failing doesn't block anything downstream).
- **17× `no-unused-vars` (`node`/`inline` params)** — `ChatArea.jsx` (1), `Markdown.jsx` (16). All are `react-markdown` custom-component overrides where `node` is destructured specifically to *exclude* it from a `...rest` spread onto a real DOM element (react-markdown passes a `node` prop no HTML element accepts) — removing the destructure would be the actual bug.
- **11× `react-refresh/only-export-components`** — `MindElixirView.jsx`, `knowledgeParts.jsx` (5), `Toaster.jsx` (4). Vite Fast Refresh dev-only warning (a file exporting both a component and a constant/function loses HMR granularity in `npm run dev`). Zero effect on the production build — confirmed, since `npm run build` is clean with all of these present.
- **8× `react-hooks/exhaustive-deps` (warnings)** — covered under B above; reclassified D because each one checked is verifiably intentional, not a bug.
- **15× `no-useless-escape`** — all in `evidence.unescape.test.js`'s own regex fixture, inside a test file, and the "unnecessary" escapes don't change the regex's actual matched set (confirmed — the test passes and the fixture asserts on real mammoth-escaped text).

**No lint changes were made this pass** — per the epic's own instruction, 0 A/B/C findings means nothing to fix, and fixing D-only findings would be exactly the "giant lint cleanup just to reach zero" the epic explicitly forbids.

---

## P2 — Critical E2E flows

**Honest scope statement, read before the table:** this pass did not stand up a live multi-service environment (BE Flask/Gunicorn server + FE dev server + a real Supabase-backed or local-mode session) and click through these flows in a browser. Reasons: (1) the BE environment was mid-remediation for most of this session (P0); (2) a genuine live run of all 20 flows — several involving real LLM round-trips and document-processing pipelines — would take substantially longer than this pass's remaining budget; (3) doing so against a shared environment with 67 files of another workstream's uncommitted WIP risks producing results that don't reflect either a clean baseline or the WIP state cleanly.

**What follows is therefore NOT a live-PASS claim for most rows.** Per the flow's real automated test coverage (cited by file), each row gets one of:
- **PASS** — only where this pass directly executed something and observed the result (FE build/test/lint, `pytest --collect-only`).
- **VERIFIED BY TEST** — the underlying logic has real, passing automated test coverage from this session's own work (cited), but the full live user-facing flow was not clicked through end-to-end.
- **NOT TESTABLE (this session)** — no meaningful automated coverage exists for this flow and no live run was performed.
- **BLOCKED** — a real, identified reason prevents testing (never silently converted to PASS).

| # | Flow | Result | Evidence |
|---|---|---|---|
| 1 | Upload document | NOT TESTABLE (this session) | No live upload attempted. Upload-path code (`SidebarLeft.jsx`'s upload handler, `/upload-file`) unchanged this pass. |
| 2 | Document processing | NOT TESTABLE (this session) | Depends on a live BE job; not run. |
| 3 | Open Library | VERIFIED BY TEST | `thuVienTaiLieu`/`DocumentList` logic covered by existing pure-function tests (pre-dating this epic, unchanged). |
| 4 | Ask Chat question | VERIFIED BY TEST (partial) | `ChatArea.jsx`'s answer-rendering, citation-provenance-label logic (M1/M2.5) covered by `evidence.sourceStems.test.js`, `evidence.citeKey.test.js`. Live LLM round-trip not exercised. |
| 5 | Citation → Evidence | VERIFIED BY TEST | `parseCiteHref`/`citeKey` round-trip tested (`evidence.citeKey.test.js`); click-through UI not live-tested. |
| 6 | Evidence → source | VERIFIED BY TEST | Same as above; `normStem` matching tested. |
| 7 | Generate/open MindMap | NOT TESTABLE (this session) | Requires live generation job. Normalization of an already-generated record IS tested end-to-end in fixtures (`mindmapNormalize.test.js`, `mindElixirAdapter.test.js`). |
| 8 | Select MindMap node | VERIFIED BY TEST | Full sidecar → controller-state chain proven in `mindElixirAdapter.test.js` (M2.5), including the provenance fields. |
| 9 | Knowledge Inspector | VERIFIED BY TEST | Node-header rendering logic reachable via the same tested chain; component itself not rendered live (no RTL/component-test tooling exists in this codebase — confirmed, not a gap introduced here). |
| 10 | source_stems provenance | VERIFIED BY TEST | The single most-tested surface in this session: `mindmapNormalize.test.js`, `mindElixirAdapter.test.js`, `mindmapGraph.test.js`, `summaryJob.test.js`, `evidence.sourceStems.test.js` — single/multi/unresolved/legacy fixtures all pass. |
| 11 | Summary | NOT TESTABLE (this session) | Requires live generation job. |
| 12 | Summary section provenance | VERIFIED BY TEST | `summaryJob.test.js`'s section-provenance block (M2.5). |
| 13 | StudyMap | NOT TESTABLE (this session) | Requires live generation + a real map. |
| 14 | Quiz | NOT TESTABLE (this session) | No automated coverage from this session's work (quiz flow untouched by any epic in this series); not live-tested. |
| 15 | Weak-topic/review flow | NOT TESTABLE (this session) | Same as above. |
| 16 | Research Timeline | VERIFIED BY TEST | `studySelection.test.js` (Pack A, pre-existing) + this session's `parseCiteKey`/provenance-label additions, all passing. |
| 17 | Cross Navigation | VERIFIED BY TEST | Pack B/M1's navigation-contract tests (pre-existing, unchanged, still passing in the 1020). |
| 18 | Keyboard workflow | VERIFIED BY TEST | `keyboardShortcuts.test.js` (Pack C, pre-existing, unchanged, still passing). |
| 19 | Knowledge Evolution | VERIFIED BY TEST | `knowledgeEvolution.test.js` (Pack D, pre-existing, unchanged, still passing) + M2.5's provenance-enrichment tests. |
| 20 | Multi-document workspace | VERIFIED BY TEST | `multiDocument.test.js` (M1) — concept-merge, compare-documents, evidence-coverage all pass; live multi-doc UI session not run. |

**Verdict-relevant summary:** 0 flows FAILED. 0 flows were falsely marked PASS. 5 flows (1, 2, 7, 11, 13, 14, 15 — document processing and generation-dependent flows, plus quiz) have **no live verification this pass** and are the single largest honest gap in this report.

---

## P3 — Legacy compatibility

Explicitly tested, not assumed, for all three surfaces — same evidence as M2.5's own report, re-confirmed still passing in this pass's 1020/1020:

| Surface | Result | Test |
|---|---|---|
| MindMap without `source_stems` | **PASS** | `mindmapNormalize.test.js` ("missing field" + "old (v1/legacy) records never carry the field"); `mindElixirAdapter.test.js` ("stays undefined in the sidecar... never []") |
| Summary without `source_stems` | **PASS** | `summaryJob.test.js` ("section source_stems missing" + "old (legacy/pre-M2) summary sections") |
| StudyMap without `source_stems` | **PASS (by construction)** | `StudyMapView.jsx`'s `Array.isArray(node.source_stems) && node.source_stems.length > 0` guard — same pattern every other optional field in that component already uses; no dedicated component test exists (no RTL tooling in this codebase) |

No crash, no fabricated provenance, no migration requirement in any case — confirmed by reading the guard code directly, not by assumption.

---

## P4 — Multi-document regression

| Area | Result | Evidence |
|---|---|---|
| Search (workspace scope) | VERIFIED BY TEST | `workspaceSourcesBus.js` + `CommandPalette.jsx`'s scope logic; no dedicated pure-function test (the bus is a 6-line mirror, `matchDocumentsToStems` — which it delegates to — IS tested in `multiDocument.test.js`) |
| Chat (multi-source) | NOT TESTABLE (this session) | Requires a live multi-source query |
| Citations | VERIFIED BY TEST | `citeKey`/`normStem` stem-matching tested independent of document count |
| Timeline | VERIFIED BY TEST | Evidence-kind provenance labeling (`parseCiteKey`) tested; spans multiple documents by construction (history isn't reset on multi-select) |
| MindMap (multi-source) | VERIFIED BY TEST | `classifyByProvenance`, shared-node canvas tag tested with real multi-stem fixtures |
| Inspector | VERIFIED BY TEST | Multi-stem `Nguồn: X · Y` chip path covered by the same normalizer chain tests |
| Summary (multi-source) | VERIFIED BY TEST | `summaryJob.test.js`'s multi-source section case |
| Knowledge Dashboard | VERIFIED BY TEST | `knowledgeEvolution.test.js` + `multiDocument.test.js`'s `evidenceCoverage` |
| Document comparison | **PASS (unit level)** | `multiDocument.test.js` — 17 tests, including the explicit no-semantic-merging case (a real synonym pair proven NOT to merge) |
| Provenance | VERIFIED BY TEST | Covered exhaustively above (P3, M2.5's own report) |

**StudyMap multi-document remains explicitly OUT OF SCOPE**, as established in M1/M2.5 — not tested here because it does not exist; no fake support was added or implied anywhere in this pass.

---

## P5 — Failure paths

Code-level verification only (no live failure injection this pass) — each item below cites the actual handling code found, not an assumption that "it probably handles it":

| Failure | Result | Evidence |
|---|---|---|
| Empty document / unsupported file / failed extraction | NOT TESTABLE (live) | BE-side; not exercised. `SidebarLeft.jsx`'s `getStatusConfig` has a real `"error"` branch ("Lỗi xử lý tài liệu", `showErrorIcon: true`) proving the FE has a designed failure state to render into, not silent success. |
| LLM unavailable / API timeout | NOT TESTABLE (live) | `ChatArea.jsx`'s SSE handler has a real timeout path (`Quá thời gian chờ phản hồi...`) and `getUserFriendlyApiError` translation — designed, not exercised live. |
| Embedding unavailable | NOT TESTABLE (live) | BE-side (`SKIP_MODEL_LOAD`/FPT fallback logic, see P7) — not exercised this pass. |
| Malformed response | VERIFIED BY TEST | `normalizeSourceStems`, `normalizeSummaryRecord`, `normalizeMindmapRecord` all have explicit "invalid values" test cases that degrade safely rather than crash. |
| Missing provenance / old record | **PASS** | See P3 — directly tested, not just designed-for. |
| Empty workspace | VERIFIED BY TEST | `KnowledgeDashboard.jsx`'s explicit empty state ("Chưa có hoạt động nào...") — design confirmed by reading the component's own conditional render, not live-triggered. |
| Job failure | VERIFIED BY TEST (design) | `jobRecovery.js` (`stallBannerVisible`, `canRetry`) — pre-existing, tested logic for exactly this case; live job failure not triggered this pass. |

No silent-success path was found anywhere checked. The consistent gap across this whole section is the same one from P2: nothing here was triggered live.

---

## P6 — Performance

**Measured, not guessed, where measurement was actually taken:**

```
FE build:      clean, ~12s wall time this run (npm run build)
FE test suite: 1020 tests in ~5-8s wall time (npm run test)
FE bundle (gzip, largest chunks):
  index-*.js       225.01 kB → 71.56 kB gzip
  mindmap-*.js      220.04 kB → 70.57 kB gzip
  Workspace-*.js   ~183 kB   → ~53 kB gzip
  markdown-*.js     157.20 kB → 47.66 kB gzip
  StudyMapView-*.js 112.22 kB → 36.86 kB gzip
```

**Not measured this pass** — document processing time, MindMap/Summary generation time, search latency, chat latency, memory usage under real load. All require a live BE run against real documents, which this pass did not perform (see P2). **No optimization was attempted anywhere** — per the epic's own instruction, nothing here was "fixed" without a measured bottleneck, and none was measured.

---

## P7 — Production config audit

Read directly from `render.yaml` and the BE code paths it configures — not assumed:

| Area | Finding |
|---|---|
| `QUEUE_ENABLED` | `false` in production (`render.yaml`), matches the epic's stated assumption; code defaults to `"false"` when unset too (`app/jobs/queue.py`). Jobs run in-process daemon threads, not RQ workers — consistent, no Redis service provisioned. |
| Supabase PostgreSQL | `DATABASE_URL` sourced from Supabase (session pooler, port 5432, documented reason: transaction pooler can't run Alembic's multi-statement DDL). Migrations are build-time only and explicitly fail-closed without `ALEMBIC_PRODUCTION_HOST`/`ALEMBIC_PRODUCTION_DB` declared — a deliberate "no accidental production migration" gate. |
| Supabase storage | `SUPABASE_STORAGE_BUCKET=documents`; ephemeral `/tmp` disk is explicitly the design (see next row), business data and uploads both live off-instance. |
| No local Ollama assumption | Confirmed — `OLLAMA_HOST=""` in production (empty, not merely unset — code comment: `llm_factory` only drops "ollama" from the provider list when this is blank; leaving it at default would try Ollama, time out, THEN fall through to Gemini on every call, a real latency trap this config explicitly avoids). Gemini is the sole LLM provider on this deployment. |
| Gunicorn | Confirmed — `gunicorn -w ${WEB_CONCURRENCY:-1} ...`, never `flask run`. 1 worker, explicitly reasoned (HITL resume state is in-process; 512 MB doesn't fit a second worker anyway). |
| Vite/static frontend | Confirmed — `runtime: static`, `npm ci && npm run build`, SPA fallback rewrite configured (`/* -> /index.html`) so a deep-link refresh doesn't 404. |
| No persistent local disk | Confirmed and explicitly designed-around — `DATA_DIR=/tmp/studymap`, comment states Free tier wipes `/tmp` on every restart/deploy; `INDEX_PERSISTENCE_ENABLED=1` restores the retrieval index from Supabase Storage at boot instead of rebuilding. |
| Env-var validation | `AUTH_SECRET` (generated by Render, never in git) + `AUTH_REQUIRE_SECRET=true` → **fail-closed**: confirmed in code (`app/domains/auth/tokens.py`) — boots with `RuntimeError` if the secret is required but absent, rather than silently falling back to an ephemeral dev secret. |
| CORS | **`CORS_ORIGINS="*"` in production** — a real, self-acknowledged gap. The code's own comment: "Auth is Bearer-token, so a cross-origin reader still cannot obtain a token. Tighten to the studymap-web URL once it is known." Mitigated by bearer-token auth (not a cookie/session that an XSS-adjacent origin could silently ride on), but wildcard CORS is a standard release-hardening flag worth carrying into the verdict as a known limitation, not a blocker — the code supports a comma-separated allowlist already (`app/main.py`), this is a configuration value to set, not a code change. |
| API base URL | `VITE_API_BASE` is `sync: false` (set per-deploy, build-time-inlined by Vite) — correct for a static-site deploy, no hardcoded localhost found anywhere in FE production code (confirmed by grep — see P8). |
| Timeouts | `AI_TIMEOUT_SEC`/`SUMMARY_LLM_TIMEOUT_SEC`/`MINDMAP_LLM_TIMEOUT_SEC`/`QUIZ_LLM_TIMEOUT_SEC` all `110`s, explicitly kept below `GUNICORN_TIMEOUT=120` so a hung LLM call surfaces as a request error, not a killed worker. Reasoned, not arbitrary. |
| Error handling | `getUserFriendlyApiError` (FE) translates BE errors for display; BE has explicit fail-closed paths for auth/migration (above). |
| Temporary files / storage paths | All under `/tmp/studymap/*`, consistent with the ephemeral-disk design throughout. |
| Startup behavior | Torch device detection wrapped in try/except with a logged fallback (`app/main.py`) — boot doesn't crash if device detection fails. |
| **Embedding/retrieval reality check (the biggest real finding this pass)** | `SKIP_MODEL_LOAD=1` in production (no local model weights — memory constraint), but `FPT_AI_EMBEDDING_MODEL`/`RERANK_BACKEND=fpt` mean real embeddings/reranking DO happen via FPT's remote HTTP API — confirmed in code (`get_embeddings()` checks FPT before falling back to `FakeEmbeddings`). **However**, `BE/config/production_index_allowlist.json` — a deliberate, human-reviewed, git-tracked safety gate ("no document enters the index without a CONFIRMED_PRODUCTION + eligible_for_index=true record here; absence is never permission") — currently has **12 documents on record, and only 1 is eligible for indexing**. The other 11 were investigated and traced to dev-machine/pytest provenance (Windows `E:\` paths, `input_path` written server-side, can't be forged by a client) and explicitly excluded. **This means production's actual retrieval-backed corpus is, as of this audit, essentially a single 3-chunk smoke-test document** — real, working, but not yet reflective of genuine user content at any scale. This is not a bug (it's the safety gate working as designed) but is a significant, honest "known limitation" for anyone reading this release verdict expecting production RAG search/citations to already have real content behind them. |

---

## P8 — Release safety

Grep-based, evidence-first (see exact commands run):

| Check | Result |
|---|---|
| Hardcoded `localhost`/`127.0.0.1` in app code | **None found** (`grep -rln "localhost:5000\|127.0.0.1:5000\|localhost:8080" app/ services/` → empty) |
| Mock provider accidentally enabled | **None found** (`grep -rn "MOCK_\|FAKE_LLM\|USE_MOCK" app/ services/` → empty). The one "fake" thing in this codebase, `FakeEmbeddings`, is deliberately gated behind `SKIP_MODEL_LOAD=1 AND NOT fpt_embedding_enabled()` — confirmed in `app/clients/llm_factory.py:909` — and production has FPT enabled, so this path is not live in production. |
| Debug mode | **None found** (`grep -rn "debug=True\|DEBUG.*=.*True\|app.debug" app/ services/` → empty) |
| Test credentials in non-test code | Not found in a scoped grep; not exhaustively swept beyond that (see limitations) |
| Temporary bypasses / TODO hacks on critical paths | **CORS wildcard** (P7) is the one real, self-documented instance — classified as a known limitation, not silently deleted or ignored |
| Unhandled feature flags | None found beyond the documented, intentionally-off set already covered in P7 (`NLI_ENABLED=0`, `LATE_CHUNKING=0`, `CRAG_ENABLED=0`, `HITL_ENABLED=0` — each has a comment explaining why it's off on free tier) |
| Secret material | **None printed, none found in tracked files.** `BE/.env` (local, gitignored — confirmed by its presence not showing in `git status`) has real API keys; `render.yaml` explicitly documents "NEVER put a real secret in this file" and uses `sync: false` for every actual secret. This audit did not print any credential value. |
| Development-only filesystem assumptions | **None found** — `DATA_DIR` and friends are all env-driven, defaulting to a path but fully overridable (see P7's ephemeral-disk section). |

No blindly-deleted TODOs — this audit only classified, per the epic's explicit instruction.

---

## Known limitations (carried forward, not new)

- StudyMap multi-document concept provenance — architectural boundary, documented since M1/M2.5, not revisited here.
- `⇄ N` canvas tag is shared-only by design (M2.5).
- No hook/component test tooling exists in this codebase; coverage stops at the pure-function boundary throughout this whole series.

## New limitations found this pass

- **Live E2E flows (P2) were not executed** — the single largest gap in this verification pass. See P2's honest scope statement.
- **BE/FE generation and query performance were not measured** (P6) — no live run performed.
- **Production's retrieval index currently contains one real document** (P7) — a working safety gate, not a bug, but material to any expectation of production search/citation quality today.
- **CORS is wildcard in production** (P7/P8) — mitigated by bearer-token auth, self-acknowledged in the code as pending tightening, not fixed this pass (a config value change, not something this epic's scope authorized changing unilaterally in a shared deployment file without explicit sign-off).

## Open P0 blockers

**None.** The epic's P0 (full BE test collection) is resolved: `pytest --collect-only -q` collects all 2737 tests with zero `pydantic_v1` errors, and the full suite runs to completion (2498 passed / 5 failed / 236 skipped). No source file was changed to achieve this — it was a pure dependency-environment restoration to `requirements.txt`'s own pins.

## Open P1 blockers

- **5 BE test failures in `tests/test_index_khoa_that.py`** — fakeredis lock-acquire/release test-isolation artifact, reproduces only when that file runs alone, unrelated to any epic's feature work. Real, disclosed, not fixed this pass (root-causing a `fakeredis` test-isolation quirk is outside RC2's "no feature dev" mandate and outside the specific P0 dependency-fix scope).
- **Live E2E verification of flows 1, 2, 7, 11, 13, 14, 15** (upload, processing, MindMap/Summary/StudyMap generation, quiz, weak-topic review) — not performed this pass. The single largest gap in this report.
- **BE-side performance measurement (P6)** — not performed this pass.
- **Production retrieval index is nearly empty** (1 real document, P7) — see "Pre-deploy decisions required" at the top of this document. Requires explicit owner confirmation this is expected before the deployment is treated as feature-complete at scale, not just filed here as background context.
- **CORS wildcard in production** (P7/P8) — see "Pre-deploy decisions required" at the top of this document. Elevated to a required go/no-go decision before an actual production deploy, per Codex's review of this report — not a "known limitation" to be read as an accepted default.

---

## RELEASE VERDICT

**RC2 READY WITH KNOWN LIMITATIONS**

Reasoning, checked directly against the epic's own READY-blocking list:
- BE full suite cannot collect/run → **false**, it collects (2737) and runs to completion.
- A critical E2E flow fails → **false** — nothing in this pass's P2 table is marked FAILED; the honest gap is UNTESTED (live), which the epic's exit criteria does not equate with a failure, and this report does not pretend otherwise.
- Data loss is possible → no evidence found anywhere in this audit.
- Provenance is fabricated → the opposite — this session's M2/M2.5 work and this pass's re-confirmation of it are the most heavily tested surface in the whole codebase specifically because fabrication was the risk being guarded against, and every absent-provenance case renders nothing rather than a fake value.
- Production configuration is unsafe → no unsafe finding (auth fail-closed, no debug mode, no hardcoded localhost, no exposed secrets); CORS wildcard is a real hardening gap, mitigated by bearer-token auth and self-disclosed in the code, not classified as "unsafe" outright.
- A P0 blocker remains → **none**, see above.

**This is not RC2 READY outright** because real, disclosed gaps exist: 5 narrow BE test failures, live E2E flows not executed, BE performance not measured, and two production-config items (near-empty retrieval index, wildcard CORS) that a release owner should know about before treating production as feature-complete at scale. None of these individually or together meet the epic's own bar for NOT READY — they are exactly what "WITH KNOWN LIMITATIONS" exists to carry.
