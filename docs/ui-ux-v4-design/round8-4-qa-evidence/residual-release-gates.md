# Residual release gates after Round 8.4

Source revisions:

- `origin/main` `2479a32`;
- Round 8.4A branch `fix/studymap-v4-round8-4-deploy-safety`;
- Round 8.4B branch `fix/studymap-v4-round8-4-qa-hardening`.

Classification: PASS, FAIL, BLOCKED, NOT VERIFIED or NOT APPLICABLE.
"Decision" marks a choice that belongs to the release owner, not to an
engineer.

Final statuses as of 2026-11-02 ~17:30 +07:00, after all Round 8.4 runs, the
independent reviews and the Draft PR CI runs.

## Product findings that need a decision

### Short-answer AI grading failure is permanent and lowers the score (Decision, P2)

| Item | Detail |
|---|---|
| Evidence | `codex2/practice-quiz-and-async-grading-report.md`, section "Async grading", run on real Flask and Postgres |
| Behaviour | If the AI grader fails for a short answer, `grade_short_answer` returns `None`. The attempt is still finalised as `graded` with `ungraded_count=1`, and that answer is shown as "Chưa chấm" (`BE/app/domains/attempts/service.py:44-90`) |
| Score impact | The ungraded question **stays in the denominator**. Observed: 1 objective correct + 1 short answer with the grader down gives **1/2, 50%** (SQL `score 1.00 / max 2.00`). The learner loses marks for a provider outage |
| Recovery | None. There is no regrade route or control. Resubmitting returns 409. "Chờ thêm" only waits longer, and "Thử lại" only retries polling (`FE/src/pages/study/QuizResult.jsx:127-143`) |
| Report status | Codex2 marked the failure path PASS, meaning it **matches the current contract**. That is not a risk acceptance |
| Options | (1) Accept for this release and document it. (2) Exclude ungraded answers from `max_score` and mastery until graded. (3) Add a regrade endpoint for ungraded answers (new feature; needs approval) |
| Recommendation | Option 2 before broad release. It is the smallest change that stops an outage from penalising learners. Option 3 can follow |

### A flaky required check blocks all deploys (Decision)

From Round 8.4A and 8.4B onwards:

- EC2 deploys only after the whole "CI" workflow succeeds;
- Render (`checksPass`) deploys only after every GitHub check passes;
- the new blocking Fixture Smoke job (`--fail-on-flaky-tests`) can stop both
  deploys with a single flake.

Mitigations:

- Fixture Smoke passed 570/570 with 0 flaky over 3 repeats locally.
- "Re-run failed jobs" re-triggers the pinned deploy.
- The emergency break-glass path is documented in `docs/AWS_DEPLOYMENT.md`.

If deploy availability matters more, remove `fixture-smoke` from
`ci-success.needs`. That is a one-line change, and the job stays visible.

## Gates

| Gate | Status | Evidence | Owner and next action |
|---|---|---|---|
| Deploy pins the CI-verified SHA (EC2) | **PASS** (harness 13/13 + 22/22 mutations; Codex2 round 3: **APPROVE**). Never run on the real EC2 host | Track A PR #101: `deployment-sha-pinning.md`, `track-a-independent-review-round*.md` | Human: run `deploy_preflight.sh` on EC2 before merging; watch the first deploy |
| Render deploys only after checks pass | NOT VERIFIED (config only) | `render.yaml` `autoDeployTrigger: checksPass` | Human: confirm the Blueprint sync, "After CI Checks Pass" on both services, and the overlapping-deploy policy |
| Protected-auth CI guard | **PASS** (open 200/200, protected 401/200 locally; Codex2 round 2: FIXED) | Track A `protected-auth-ci.md` | Final GitHub run on PR #101 |
| Collection focus after a successful delete | **PASS** (Vitest 6/6; real Chromium) | `focus-and-touch-regressions.md`, `destructive-dialog-matrix.md` | — |
| Mobile touch selection at 390 px (emulated) | **PASS** (5/5; part of the GitHub Fixture Smoke) | `focus-and-touch-regressions.md` | — |
| R84-TOUCH-01: first tap after a fast flick | **NOT VERIFIED** on a real device (reproduces only in emulation) | `focus-and-touch-regressions.md` §3 | Human tester on a phone |
| Fixture smoke in CI | **PASS**: GitHub run, 10 specs, 191 passed | `fixture-ci-coverage.md` | — |
| Full fixture suite (448) | NOT VERIFIED on GitHub (weekly / manual) | `fixture-audit.yml` | Repository owner: one manual dispatch |
| Runtime revision (backend and frontend) | PASS locally (it is a deploy label, not an image proof); production NOT VERIFIED | `runtime-version-verification.md` | Read-only probe after the next release |
| Practice Quiz | **PASS** for supported scenarios; start-attempt, draft persistence, per-answer review and retake are NOT SUPPORTED by design | `practice-quiz-e2e.md` | — |
| Asynchronous grading | APPLICABLE; **PASS** for the current contract; see the decision above | `practice-quiz-e2e.md` | Release owner |
| Citation navigation | NOT IMPLEMENTED; recommendation below | this file | Release owner approval needed before any build |
| Delete collection dialog | **PASS** (7/7, real app) | `destructive-dialog-matrix.md` | — |
| Clear chat history dialog | **FAIL**: R84-A11Y-02 (P2), focus falls to `<body>` on cancel; the other 6 checks PASS | `destructive-dialog-matrix.md` | Frontend Chat: correction PR |
| Delete map / Delete summary dialogs | **NOT APPLICABLE**: no reachable trigger (`legacyInspectorSurfacesEnabled = false`) | `destructive-dialog-matrix.md` | Product: there is no UI to delete a saved map or summary (decision) |
| Screen readers | NOT VERIFIED | `accessibility-manual-checklist.md` | Human tester |

## Citation navigation: investigation and recommendation

The user asked not to implement this until it is approved separately.

**Current behaviour.**

- `QuizResult.jsx:319-325` shows "Nguồn: N đoạn trong tài liệu".
- `ReviewGuide.jsx:221-226` shows "N đoạn cần đọc lại", and `:273` shows
  "Nguồn: N đoạn từ chủ đề …".

Both are text counts. Nothing can be clicked, and no excerpt is shown.

**User impact.** The learner is told to reread N passages but cannot see which
ones. They have to find them in the document themselves, which weakens the
review loop the product is built around.

**Data available.**

- Every question and review item already carries `chunk_ids`.
- `GET /api/documents/<document_id>/chunks?limit&offset` (`BE/app/main.py:3621`)
  lists chunk text for an owned document, paginated with `limit ≤ 500`.
- `StudyMapView.jsx:259-260, 819` already resolves `chunk_ids` against that
  list (`new Map(list.map(c => [c.chunk_id, c]))`) and renders excerpts in
  `NodeDetail`.
- The backend also has `quiz/repository.py:194 chunks_by_ids`, which is not
  exposed over HTTP.

**Options.**

| # | Interaction | Cost | Notes |
|---|---|---|---|
| 1 | **Inline disclosure:** "Xem N đoạn nguồn" expands the excerpts under the question or review item | Frontend only. Reuses the StudyMapView resolution and the existing chunks endpoint | Keeps the learner in place. Documents with more than 500 chunks need pagination, or a by-id endpoint later |
| 2 | Link to the StudyMap with the source highlighted (`/app/study/map/:documentId?chunk=…`) | Frontend route-parameter handling plus highlight logic | Gives context in the map, but takes the learner away from the review |
| 3 | Side drawer with the excerpts plus "Mở tài liệu" through the signed file URL (`/api/documents/<id>/file`) | Largest | Needs page anchoring in the PDF to be truly useful |

**Recommendation:** option 1 (inline disclosure). It is the smallest change,
needs no backend work for typical documents, reuses a proven pattern, and
answers "which passages?" where the question is asked. Add a by-id endpoint
around `chunks_by_ids` only if documents with more than 500 chunks are common.
