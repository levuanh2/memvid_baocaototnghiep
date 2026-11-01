# R8-002 — Quiz autosave / submit race

Original finding: `round8-qa-evidence/defects.md` § R8-002 "submit can race an
already-started autosave" (P1, audit worktree `phase-c-round8-regression-audit`).

## Invariant

No `submitAttempt()` call before every answer write for that attempt has been
acknowledged by the server.

## Root cause

`queueSave` removed the batch from the local draft ledger (`soNhap.layDeGui()`)
before its PATCH resolved. `onSubmit` then saw an empty ledger and submitted
while the earlier PATCH was still in flight. Queue emptiness was mistaken for
server acknowledgement.

## Fix

| Commit | Change |
|---|---|
| `e196bbb` | `flushPending()` serialises every save on one promise tail (`saveTailRef`). Submit chains onto that tail, then drains answers created while waiting (`do … while (forSubmit && so.coGi())`). A rejected save returns its batch to the ledger, records `saveErrorRef`, and the next submit rethrows it instead of grading. `submittingRef` gives one synchronous submit owner. Every step checks mount state, attempt generation and attempt id. Inputs are disabled while submitting. |
| `21ab319` | Two defects found in review of `e196bbb`: (1) the unmount cleanup set `mountedRef=false` and nothing restored it, so React StrictMode's dev mount → unmount → mount left every autosave and submit aborting silently (`main.jsx` wraps the app in `<React.StrictMode>`); (2) an attempt switch mid-submit returned on `AbortError` without clearing `submitting`/`confirming`/`saving`, leaving the new attempt disabled behind a stale dialog. |

API contracts (`saveAnswers`, `submitAttempt`, `openAttempt`), draft
restoration from `openAttempt().answers`, and the Round 7.1 pending-grading
navigation are unchanged.

## Verification matrix

All cases use controlled deferred promises (`deferred()` in
`FE/src/pages/study/QuizTaking.round7.test.jsx`), not timers that resolve
requests immediately.

| # | Required case | Test | Observed ordering |
|---|---|---|---|
| 1 | In-flight autosave blocks submit | `blocks submit behind an already in-flight autosave…` | `saveAnswers#1` pending → confirm clicked → `submitAttempt` calls = 0 → resolve save → `submitAttempt` calls = 1 |
| 2 | Resolved autosave permits submit | same test, after resolve; `shows pending autosave state and flushes before submit` | save ack precedes the single submit |
| 3 | Rejected autosave prevents submit | `does not submit when the in-flight autosave rejects…`; `does not submit when the flush-before-submit save rejects…` | reject → `submitAttempt` calls = 0, error shown, "1 câu chưa lưu được" |
| 4 | Newer answer supersedes older in-flight | `waits for the durable newer answer when A is saving and the user changes to B` | `saveAnswers#1 {q-1:A}` pending → user picks B → resolve A → `saveAnswers#2 {q-1:B}` pending, submit = 0 → resolve B → submit = 1 |
| 5 | Final persisted answer = latest selection | same test | last write before submit is `{q-1:"B"}` |
| 6 | Double submit → one request | `guards a double confirmation click with one synchronous submit owner` | two clicks → `saveAnswers` = 1, `submitAttempt` = 1 |
| 7 | Failed save stays retryable | rejection tests + retry | retry sends `{q-1:"A"}` again; `invocationCallOrder(last save) < invocationCallOrder(submit)` |
| 8 | Unmount / attempt change cannot submit to wrong attempt | `does not submit or navigate after unmount…`; `does not carry an old attempt's in-flight completion into a new quiz attempt` | after unmount: submit = 0, navigate = 0; after switch to attempt-2: no `submitAttempt("attempt-1")`, attempt-2 inputs enabled and submits only to attempt-2 |
| 9 | Pending/saving UI truthful | pending-count assertions above | unsaved count shown until ack; restored on failure |
| — | StrictMode (dev) | `autosaves and submits once when mounted through React StrictMode` | red on `e196bbb` (0 `saveAnswers` calls), green on `21ab319` |

Result: 10/10 in the focused file, stable across 5 consecutive runs.

## Not covered here

A real API-backed ten-question journey against Flask + PostgreSQL. See
`residual-release-gates.md`.
