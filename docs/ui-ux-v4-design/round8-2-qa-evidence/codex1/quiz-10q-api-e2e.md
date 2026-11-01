# Round 8.2 — Quiz 10Q real API/Postgres E2E

- Git SHA: `c02e2b91ae2207d472756cd34003b5cb6fee1620`
- Environment: disposable Docker Postgres 16 on `127.0.0.1:55432/studymap_test`; protected Flask E2E backend on `127.0.0.1:8080`; production frontend build on `127.0.0.1:4173`.
- Timestamp: 2026-11-01T16:58:07.791Z through 2026-11-01T16:58:20.019Z.
- Method: Playwright Chromium driving the real frontend and protected Flask routes, plus `docker exec r82-pg psql` assertions against the disposable database.
- Real vs mocked: auth, attempt open/read, PATCH autosave, submit, objective grading, mastery, review plan, ownership and Postgres are real. Only AI question generation is replaced by `seed_quiz_10q.py`, which creates a deterministic indexed document, chunks, sections and 10 objective questions. Review prose uses the backend's existing rule fallback under `SKIP_MODEL_LOAD=1`.
- Expected: one durable 10-question learner journey with failure barriers, latest-write behavior, one submission, correct grading/mastery, scoped review sources and cross-account denial.
- Observed: 1 Playwright test passed, 0 failed, 0 skipped in 14.37s; 17 app API requests recorded.
- Verdict: **PASS**, with two unsupported surfaces explicitly marked NOT VERIFIED below.

## Journey and fault matrix

| Check | Expected | Observed | Verdict |
|---|---|---|---|
| Disposable learners | Two fresh local learners, no reused credentials | Both registered through real `/auth/register` | PASS |
| Indexed source and quiz | 1 owned indexed document, permitted sections/chunks, exactly 10 linked questions | Seed verified; psql question count = 10 | PASS |
| Open/reopen | Exactly one active main attempt; reload/reopen reuses it | Mid-flight psql active count = 1; returned attempt ID remained stable | PASS |
| Score secrecy before submit | No score/result before submission | open response `score=null`; results endpoint returned 409; psql score null | PASS |
| Async submitted-pending score secrecy | Final score must stay hidden during an async grading window | Objective-only fixture grades synchronously, so no submitted-pending window existed | NOT VERIFIED |
| Delayed PATCH latest-write | Change during delayed real PATCH must persist the newer value | First PATCH delayed and forwarded; second real PATCH stored `Correct 1` | PASS |
| Reload durability | Saved answers survive hard reload | Question 1 restored checked from real API/Postgres | PASS |
| Failed PATCH barrier | Aborted PATCH must prevent submit | UI showed save error; submit request count remained 0 | PASS |
| Retry after failed PATCH | Retained draft must save before submit | Retry PATCH succeeded, then submit proceeded | PASS |
| Repeated submit clicks | UI sends one submit; server rejects duplicate | Two synchronous DOM clicks produced one POST; direct duplicate POST returned 409 | PASS |
| Attempt switch | Second quiz must use a different attempt; main quiz remains stable | Distinct switch attempt; return reused original main attempt | PASS |
| Final grading | Persisted answers and awarded score agree | 10 answers; 8 correct by SQL; score 8/10 and UI 80% | PASS |
| Wrong-answer feedback | Two wrong answers show feedback and source provenance | UI showed two-review flow, deterministic feedback, and `Nguồn: 1 đoạn trong tài liệu` | PASS |
| Mastery | Mastery uses awarded scores | Core 5/5 = 1.0/mastered; Advanced 3/5 = 0.6/light_review | PASS |
| Review plan scoping | Review items point only to owned document sections/chunks | psql `review_sections_permitted=true`, `review_chunks_permitted=true` | PASS |
| Follow source reference | A learner can navigate from the provenance reference to source content | Current UI exposes only non-interactive source-count text, no navigation control | NOT VERIFIED |
| Practice quiz | Practice flow runs if deterministic AI support exists | Shared server does not stub quiz/practice AI generation | NOT VERIFIED |
| Cross-account GET/PATCH/submit | Hide existence and reject all operations | 404 / 404 / 404 | PASS |
| Expired/revoked session | Invalid token fails closed | Protected route redirected to `/login?next=...` | PASS |

The first runner attempt did not reach an application assertion: Playwright `.check()` targeted a visually hidden radio while its visible label intercepted the pointer. The isolated runner was corrected to click the visible label and still assert `toBeChecked`; no production source, existing test, or assertion was changed.

## Raw evidence

- `quiz-10q-playwright-report.json` — final Playwright JSON report.
- `quiz-10q-request-order.json` — ordered method/path/status ledger; no headers, tokens, passwords or request bodies.
- `quiz-10q-postgres-assertions.json` — mid-flight and final psql results.
- `quiz-10q-results.json` — machine-readable environment, method, observed values and verdict.
- `quiz-10q-api-e2e.spec.js`, `playwright.quiz-10q.config.js`, `seed_quiz_10q.py` — copied final runner sources.

Open issues: the result/review provenance reference is not actionable, and practice generation is outside the shared deterministic AI stub. Neither was represented as PASS.
