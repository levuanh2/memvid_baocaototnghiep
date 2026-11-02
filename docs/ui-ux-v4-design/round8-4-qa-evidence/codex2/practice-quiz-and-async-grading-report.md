# Round 8.4 Part C — Practice Quiz real API/DB E2E

## Scope and implementation contract (recorded before execution)

This track verifies only the disposable stack at `127.0.0.1:8280` / `127.0.0.1:4373`
against `postgresql://postgres:postgres@localhost:55432/studymap_test`. It does not
use production URLs or databases and does not add product behavior.

### Generation

- `POST /api/practice/generate` requires an authenticated app user and a
  `review_item_id`; it returns 400 when the id is absent and delegates to the shared
  quiz dispatch path (`BE/app/main.py:4277-4298`).
- The dispatch looks up an owned review item, requires its `chunk_ids`, copies its
  document, source attempt, source review item, topic and requested quiz config into a
  new `quiz_generation` job. Practice deliberately has no inflight dedupe: every call
  creates a new job (`BE/app/application/quiz_dispatch.py:185-222`).
- Practice uses the same real quiz-generation use case as diagnostic quizzes. It reads
  only the review item's chunks, creates a `quizzes` row, calls
  `app.domains.quiz.generator.generate_questions`, validates/normalizes the returned
  questions, forces the review topic into every question's concept tags, persists the
  accepted questions, marks the quiz ready, and only then marks the job done
  (`BE/app/application/quiz_generation.py:22-35,48-73,75-121,181-193`).
- The external AI boundary is `app.clients.llm_factory.ask_ai`, resolved inside
  `generate_questions` when no explicit `ask` is supplied. It asks at most twice for
  valid JSON (`BE/app/domains/quiz/generator.py:134-188`). The E2E stub must therefore
  replace this generator/LLM boundary, not repositories or HTTP routes.
- Persistence is real: `quizzes` and `quiz_questions` plus provenance links in
  `quiz_question_chunks`; practice rows require `source_review_item_id`
  (`BE/app/db/models.py:364-440`; `BE/app/domains/quiz/repository.py:19-79`).

### Read, submit, score and review

- `GET /api/practice/:id` returns only an owned `quiz_type=practice` quiz and strips
  answers/explanations before submission (`BE/app/main.py:4301-4311`;
  `BE/app/application/practice.py:39-63`). Foreign and diagnostic quiz ids are
  intentionally indistinguishable from missing ids (404).
- Practice submission is intentionally one-shot: `POST /api/practice/:id/submit`
  validates question ids, opens an attempt, saves all supplied answers, submits and
  grades it in that single request (`BE/app/main.py:4314-4329`;
  `BE/app/application/practice.py:66-93`). The durable rows are `quiz_attempts` and
  unique-per-attempt/question `quiz_answers` (`BE/app/db/models.py:462-524`;
  `BE/app/domains/attempts/repository.py:109-132`).
- Review/comparison is exposed by `GET /api/practice/:id/comparison`; before any graded
  practice attempt it returns 409, afterwards it compares the source diagnostic attempt
  with the latest graded practice attempt for the review topic
  (`BE/app/main.py:4332-4346`; `BE/app/application/practice.py:96-130`).

### Frontend and supported retry semantics

- `ReviewGuide` posts generation config, polls the generic job, and navigates to
  `/app/study/practice/:quizId` when the job result contains a quiz id
  (`FE/src/pages/study/ReviewGuide.jsx:35-40,79-99,157-180`).
- `Practice` loads the practice quiz and comparison, keeps answers only in component
  state, and sends all answers once through `submitPractice`; the implementation says
  explicitly that practice does not save per-question drafts
  (`FE/src/pages/study/Practice.jsx:20-49,58-79,124-183`). The API wrapper has only
  get/submit/comparison for practice (`FE/src/utils/studyApi.js:157-166`).
- Therefore a separate "start practice attempt" and pre-submit answer persistence over
  reload are **NOT SUPPORTED**. Those generic attempt routes exist for the diagnostic
  quiz journey (`BE/app/main.py:4120-4169`) but the practice product path does not call
  them. Reload before submit resets local answers by design.
- Retrying generation is supported as a new independent job/quiz (no dedupe)
  (`BE/app/application/quiz_dispatch.py:194-195,217-222`). Retrying a completed practice
  means another one-shot submit, which opens another attempt; there is no endpoint to
  PATCH an already-created practice attempt. Duplicate submission of one HTTP request
  is not idempotent by contract and must not be invented as such.

## Disposable stub design and diff

The smallest safe change is in the existing disposable launcher,
`BE/scripts/run_e2e_server.py`; no second server or product path is introduced.

- `E2E_PRACTICE_AI_STUB` defaults off. When enabled, the launcher wraps
  `app.domains.quiz.generator.generate_questions`. Non-practice configs call the
  original function unchanged; practice configs receive deterministic valid questions.
  The real job, context lookup, validation, persistence and route layers still execute.
- `E2E_SHORT_ANSWER_GRADING_STUB` defaults off. When enabled, the launcher wraps
  `app.domains.attempts.grading.grade_short_answer` only to inject an `ask` callable
  into the original parser/scorer. The callable sleeps for
  `E2E_SHORT_ANSWER_GRADING_DELAY_SEC` (5 seconds in this run), returns a deterministic
  valid verdict, or raises when the learner answer contains
  `E2E_SHORT_ANSWER_FAIL_MARKER`. The original grading function converts that exception
  to `None`; the real service/job/repository handles `ungraded_count`.
- This boundary choice mirrors the existing graph substitutions: external AI is
  deterministic, while HTTP, authorization, jobs, validation, grading orchestration and
  Postgres remain real. Both flags are absent/off by default.

## Scenario results

### Practice Quiz

| Scenario | Expected | Observed | Verdict |
|---|---|---|---|
| Generation through UI | Review Guide posts generation, polls a real job, and navigates to a persisted practice quiz | UI POST returned 202; job `5a927d1f-1d5b-43a0-8c42-1c1ea13efdbe` completed; UI loaded quiz `bf0a5440-b51e-402f-ad45-38ddeed7755a` with 5 questions | **PASS** |
| Practice provenance | Quiz remains traceable to the review item/source attempt and only permitted chunks | SQL showed matching `source_review_item_id`, `source_attempt_id`, 5 questions and 5 `quiz_question_chunks` links; every result question referenced the seeded permitted chunk | **PASS** |
| Start an attempt before answering | A distinct start endpoint/attempt exists if the product supports it | Practice has no start call; the attempt is opened only inside the one-shot submit (`BE/app/application/practice.py:66-93`) | **NOT SUPPORTED** |
| Pre-submit answer durability | Reload restores answers if draft persistence is supported | UI selected answer 1, hard reload, then selection was absent. `Practice.jsx` stores answers only in component state and explicitly sends no drafts (`FE/src/pages/study/Practice.jsx:20-24,58-64`) | **NOT SUPPORTED** |
| Exactly one submission | One UI action creates one durable attempt and five answers | Browser emitted one submit POST; SQL showed `attempt_count=1`, `answer_count=5` | **PASS** |
| Scoring | Four correct and one wrong answer produce 4/5 (80%) | UI showed `4 / 5`; API and SQL both showed score 4, max 5, 80%, 4 correct and 1 incorrect | **PASS** |
| Review content | Post-submit API exposes answers, correct answers, explanations and feedback | Generic result API returned all five review records; wrong question 5 contained correct answer `Correct 5`, deterministic explanation/feedback and chunk provenance | **PASS** |
| Detailed review on Practice page | Practice UI itself renders per-answer verdict/correct-answer feedback | Practice page shows score/comparison and locks questions, but has no detailed verdict/correct-answer review component (`FE/src/pages/study/Practice.jsx:102-183`) | **NOT SUPPORTED** |
| Before/after comparison | Latest graded practice attempt compares the trained topic against the source attempt | API/UI comparison showed topic `round 8.4 practice topic`, mastery 0.0 → 0.8, delta 0.8, became mastered | **PASS** |
| Generation retry | Repeated generation creates independent jobs (practice intentionally has no dedupe) | Two API retries returned 202 with distinct job ids `215a7d2a-...` and `ca846c7b-...` | **PASS** |
| Retake the same quiz from UI | A retake control exists if supported | Reload after completion loads comparison and disables answer controls; there is no retake endpoint/control in the Practice API wrapper/page (`FE/src/utils/studyApi.js:157-166`; `Practice.jsx:79,142,151,171`) | **NOT SUPPORTED** |
| Account isolation | User B cannot read/submit A's practice or GET/PATCH/submit A's attempt | Practice GET/submit and attempt GET/PATCH/submit all returned 404 | **PASS** |

The first automation invocation stopped before browser navigation because the temporary
Python runner used the JavaScript-style positional form of `add_init_script`. It was
corrected to embed the token safely and the clean rerun above passed; no product code or
assertion was changed.

## Async grading

### Contract

- A submitted quiz containing any non-objective question creates a
  `short_answer_grading` job and returns a pending public attempt plus `job_id`; objective-
  only attempts grade synchronously (`BE/app/application/attempts.py:182-215`). The Flask
  route returns 202 for that background branch (`BE/app/main.py:4157-4169`).
- Ownership-filtered polling is `GET /api/attempts/jobs/:job_id`; foreign/wrong-type jobs
  are hidden as missing (`BE/app/application/attempts.py:218-234`;
  `BE/app/main.py:4172-4182`).
- Objective types are only `multiple_choice` and `true_false`; short answers call the
  LLM boundary `ask_ai` and return `None` on exception/invalid output rather than awarding
  an unjustified zero (`BE/app/domains/attempts/grading.py:22,71-116`).
- The service grades the whole attempt and writes once. A failed short-answer grade
  increments `ungraded_count`, leaves that answer verdict/score null, but still finalizes
  the attempt as graded so the valid portion can be viewed
  (`BE/app/domains/attempts/service.py:23-30,44-90`).
- The job reports progress and stores `{attempt_id, score, max_score, percentage,
  ungraded_count}` on completion (`BE/app/application/short_answer_grading.py:18-46`).
- The result UI polls every 3 seconds while status is `submitted`, including after reload;
  after five minutes it offers only “Chờ thêm” (continue polling), not regrade
  (`FE/src/pages/study/QuizResult.jsx:21-25,44-86,127-143`). All final-score and detailed-
  review presentation is explicitly gated by `status === "graded"`
  (`QuizResult.jsx:88-104,150-189,205-233`).

### Results

| Scenario | Expected | Observed | Verdict |
|---|---|---|---|
| Async submit contract | Submit returns 202, `status=submitted`, `grading=pending`, job id | Both success and failure quizzes returned exactly that contract with distinct job ids | **PASS** |
| Pending API score secrecy | Before background grading commits, result fields contain no score/verdict | Success and failure pending bodies had `score=null`, `percentage=null`, counts null and both answer verdicts/scores null | **PASS** |
| Pending DOM score secrecy | Result page shows pending state without final score or question review | DOM showed “Đang chấm”; `2 / 2`/`1 / 2` and “Từng câu” were absent | **PASS** |
| Reload while pending | A hard reload resumes polling and reaches the final state | Both flows reloaded during the 5-second stub delay, showed pending again, then reached graded UI | **PASS** |
| Successful completion | Objective + accepted short answer produce 2/2 and matching feedback | Job `cee311a9-...` ended `done`; UI/API showed 2/2, 100%, deterministic feedback; SQL matched 2.00/2.00 with two scored answers | **PASS** |
| LLM failure | Exception becomes an ungraded answer, not a fabricated incorrect verdict | Failure marker made the original grader return `None`; job `7b6e6a9e-...` still ended `done`, API/SQL recorded `ungraded_count=1`, one scored and one null-verdict answer | **PASS** |
| Failure UI | The learner sees valid partial totals and the unresolved answer visibly marked | UI showed `1 / 2`, 50%, and “Chưa chấm” on the short answer. It does not show a separate `ungraded_count` banner | **PASS** (current contract) |
| Regrade/retry | A retry route/control works if present | No regrade route or API wrapper exists; resubmitting the already-submitted attempt returned 409. “Thử lại” only retries failed polling, and “Chờ thêm” only restarts the wait timer (`QuizResult.jsx:127-143`) | **NOT SUPPORTED** |
| Job isolation | User B cannot poll A's background grading job | User B received 404 for both job ids | **PASS** |

## Request log

Practice browser sequence (method path → status):

```text
GET  /auth/me → 200
GET  /api/review-plans/b672f059-fd2d-4b7b-ba10-31f2e6a20343 → 200
POST /api/practice/generate → 202
GET  /api/jobs/5a927d1f-1d5b-43a0-8c42-1c1ea13efdbe → 200 (twice)
GET  /api/practice/bf0a5440-b51e-402f-ad45-38ddeed7755a → 200
GET  /api/practice/bf0a5440-b51e-402f-ad45-38ddeed7755a/comparison → 409
GET  /auth/me → 200 (reload)
GET  /api/practice/bf0a5440-b51e-402f-ad45-38ddeed7755a → 200 (reload)
GET  /api/practice/bf0a5440-b51e-402f-ad45-38ddeed7755a/comparison → 409 (reload)
POST /api/practice/bf0a5440-b51e-402f-ad45-38ddeed7755a/submit → 200
GET  /api/practice/bf0a5440-b51e-402f-ad45-38ddeed7755a/comparison → 200
```

Async success/failure each followed this browser sequence:

```text
POST /api/quizzes/:quiz_id/attempts → 201
PATCH /api/attempts/:attempt_id/answers → 200
POST /api/attempts/:attempt_id/submit → 202
GET /api/quizzes/results/:attempt_id → 200 (submitted; then reload/polls; then graded)
GET /api/attempts/:attempt_id/concept-masteries → 200 (only after graded)
```

The success result endpoint was requested four times and the failure endpoint four times,
covering initial pending load, hard reload, polling, and final state. Direct ownership and
retry probes are recorded in the scenario tables; no tokens, passwords or request bodies
are included in this report.

## SQL read-backs

Practice quiz/attempt:

```json
{"quiz_type":"practice","status":"ready","owner":"8aa462e4-bfa6-4cb0-a5be-b93bfe8e80e5","source_review_item_id":"7cb5d680-cbe9-4a88-a465-7e3b3476437a","source_attempt_id":"b672f059-fd2d-4b7b-ba10-31f2e6a20343","question_count":5,"provenance_links":5,"attempt_count":1,"attempt_status":"graded","score":4.00,"max_score":5.00,"percentage":80.00,"answer_count":5,"correct_answers":4,"incorrect_answers":1}
```

Async attempts:

```json
[
  {"id":"7d74b991-b309-40ff-83e5-579c64e41bec","status":"graded","score":1.00,"max_score":2.00,"percentage":50.00,"metadata_json":{"ungraded_count":1},"answer_rows":2,"ungraded_answer_rows":1,"scored_answer_rows":1},
  {"id":"ebdf51f9-459b-431c-8178-d039a2f35809","status":"graded","score":2.00,"max_score":2.00,"percentage":100.00,"metadata_json":{"ungraded_count":0},"answer_rows":2,"ungraded_answer_rows":0,"scored_answer_rows":2}
]
```

## Commands

Run from the detached worktree at `origin/main` `2479a32`:

```powershell
cd BE
python scripts/build_proto.py
python -m py_compile scripts/run_e2e_server.py

cd ..\FE
npm ci
$env:VITE_API_URL='http://127.0.0.1:8280'
npm run build

# After acquiring E:\memvid_NCKH\r84-heavy.lock with content "codex2":
$env:PORT='8280'
$env:DATABASE_URL='postgresql://postgres:postgres@localhost:55432/studymap_test'
$env:TEST_DATABASE_URL=$env:DATABASE_URL
$env:AUTH_PROTECT_APP_APIS='true'
$env:E2E_PRACTICE_AI_STUB='true'
$env:E2E_SHORT_ANSWER_GRADING_STUB='true'
$env:E2E_SHORT_ANSWER_GRADING_DELAY_SEC='5'
$env:QUEUE_ENABLED=''
python BE/scripts/run_e2e_server.py
npx serve -s FE/dist -l 4373

# These runners were reconstructed after the original temporary .tmp copies
# were deleted during cleanup; each file is marked RECONSTRUCTED in its header.
python qa-r84/r84_practice_e2e.py
python qa-r84/r84_async_grading_e2e.py

docker exec r82-pg psql -U postgres -d studymap_test -At -c '<read-back SQL>'
git diff --check
```

Environment boundaries: only `127.0.0.1` was used; database port was 55432 in container
`r82-pg`; Playwright used one headless Chromium worker/process; no production endpoint or
database was contacted. No commit or push was made.

## Re-run with reconstructed runners

Re-run completed at **2026-11-02T15:53:15+07:00** on the same disposable stack:
Flask `127.0.0.1:8280`, built frontend `127.0.0.1:4373`, and `r82-pg` database
`studymap_test` on port 55432. The heavy lock was owned as `codex2` for the run.

The original `.tmp` runners had been deleted during cleanup. The executable copies used
for this re-run were reconstructed from the session transcript and are explicitly marked
`RECONSTRUCTED` in their module docstrings:

- `qa-r84/r84_practice_e2e.py`
- `qa-r84/r84_async_grading_e2e.py`

### Re-run verdicts

| Runner/scenario | Observed from reconstructed runner | Verdict |
|---|---|---|
| Practice generation + UI job polling | 202 generation; job completed; five persisted questions loaded in UI | **PASS** |
| Practice pre-submit reload characterization | Selected answer disappeared after hard reload, matching the documented local-only contract | **PASS** |
| Practice one-shot submit/scoring | Exactly one browser submit; score 4/5 (80%); comparison 0.0 → 0.8 | **PASS** |
| Practice review/provenance | Result carried correct answers, explanations, feedback and the permitted chunk reference | **PASS** |
| Practice account isolation | Practice GET/submit and attempt GET/PATCH/submit returned `404,404,404,404,404` for user B | **PASS** |
| Practice generation retry | Two retries returned `202,202` with distinct job IDs | **PASS** |
| Async success pending secrecy | Submit returned 202; pending API score/percentage/verdicts were null; DOM withheld score and detailed review | **PASS** |
| Async reload/poll completion | Reload during the five-second delay resumed polling; final score was 2/2 (100%), job `done` | **PASS** |
| Async LLM failure/ungraded path | Failure marker produced 1/2 (50%), `ungraded_count=1`, null verdict/score for the short answer, and UI “Chưa chấm” | **PASS** |
| Async job isolation | User B received 404 for both grading-job IDs | **PASS** |
| Async duplicate/regrade characterization | Duplicate submit returned 409; no regrade route/control appeared | **PASS** for existing contract; regrade remains **NOT SUPPORTED** |

### Differences from the first run

No behavioral or verdict differences were observed. Only generated identities, UUIDs,
timestamps and durations changed. The same stable values repeated: Practice 4/5 and all
five isolation probes 404; async success 2/2; async failure 1/2 with
`ungraded_count=1`; both async jobs `done`; both foreign job probes 404; duplicate
async submit 409.

The re-run produced fresh machine-readable evidence and screenshots next to the runners:

- `qa-r84/r84-practice-results.json`
- `qa-r84/r84-async-results.json`
- `qa-r84/r84-review-guide.png`
- `qa-r84/r84-practice-graded.png`
- `qa-r84/r84-async-success.png`
- `qa-r84/r84-async-failure.png`
