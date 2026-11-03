# StudyMap V4: final acceptance (Round 8.6 closure)

| Item | Value |
|---|---|
| Checked | 2026-11-03 08:34 UTC, by Claude; GitHub, Render and production reads only (GET) |
| `main` | `4ed8f47da275eb117d8717476fe91862467224d5` (merge of #114); unchanged since 07:15:41Z, no open PR |
| Backend (`/health`) | `revision=4ed8f47da275…`, `status=ok`, both graphs ready |
| Frontend (`studymap-build`) | `2d283aa384f2…` on `studymap.space` and `studymap-web.onrender.com` (latest `main` commit that changed `FE/`) |
| Authority | Claude made no merge, deploy, Manual Sync, Render setting change or flag change |
| History | Earlier rounds and this folder's earlier files are unchanged; this file supersedes the verdict in `README.md` §3 |

## 1. New finding: `studymap-web` Auto-Deploy is off

Render event for `studymap-web` (`srv-dacit3ifngtc73dlm0d0`) at
`2026-11-03T08:06:40Z`: `auto_deploy_disabled`, `fromTrigger: checksPass`,
`reason: setting_change`. The service now reads `autoDeploy=no`,
`autoDeployTrigger=off`. It was a Dashboard or API setting change, not a
Claude action and not a Blueprint sync (the Blueprint's last sync is still
`1f4d4d7`). `studymap-api` was **not** changed: still `autoDeploy=yes`,
`checksPass`.

Consequences:

1. `render.yaml` on `main` says `autoDeployTrigger: checksPass` for
   `studymap-web`. The service has drifted from the Blueprint, so a Manual
   Sync preview will now show a change to `studymap-web` (back to
   `checksPass`), and the operator step "`studymap-web` has no changes"
   (`README.md` §2 step 3) no longer holds as written.
2. While it stays off, Render deploys no frontend commit at all. The next
   merge that changes `FE/` stays undeployed until someone deploys it by hand,
   and the deploy-before-CI race of option A cannot happen.
3. Gate 6 below cannot be observed under option A while it is off.

The owner has to say which was meant (§5, decision D1).

## 2. Release gate matrix

Status: PASS, FAIL, BLOCKED, NOT VERIFIED, NOT APPLICABLE.

| # | Gate | Status | Commit | Evidence | Checked by | Remaining action |
|---|---|---|---|---|---|---|
| 1 | GitHub branch protection | PASS | `main` | Required check `CI / required` (app 15368), strict, PR required, admins included, conversation resolution, no force push, no deletion (`README.md` §1.3) | Claude | None |
| 2 | Required CI | PASS | `4ed8f47` | CI 41595145979 (push, `main`): all 13 check runs success, `CI / required` 07:23:38Z | Claude | None |
| 3 | EC2 deployment and SHA pinning | PASS | `4ed8f47` | Deploy 41596023594: created 07:23:41Z (3 s after CI), `RUN_EVENT=push`, `RUN_BRANCH=main`, `RUN_CONCLUSION=success`, repository, head repository and workflow path match; `decision=deploy reason=verified_sha_is_current_main`; pinned and activation SHA verified; ledger recorded 07:24:43Z; no break-glass | Claude | None |
| 3a | #114: PR CI no longer starts Deploy | NOT VERIFIED | `4ed8f47` | No PR CI has run since the merge. The last Deploy runs started by PR CI (41589178442, 41590477842, 41594099084, all `skipped`) predate #114 | Claude | Read-only check on the next PR's CI, see §4 |
| 3b | #114: main push CI still starts Deploy | PASS | `4ed8f47` | Deploy 41596023594 above | Claude | None |
| 3c | Cancelled main CI does not deploy | PASS | job `if:` unchanged by #114 | Cancelled CI 41575134914 (`f109484`) gave Deploy 41575169717 `skipped`; cancelled CI 41575164152 (`e83f1f3`) gave Deploy 41575185869 `skipped`; no ledger entry for either | Claude | None |
| 3d | Failed main CI does not deploy | NOT VERIFIED | job `if:` | No failed main CI since the gate existed. Same `conclusion == 'success'` condition as 3c. Not induced on purpose | Claude | Observe if it ever happens; no test on `main` |
| 4 | Render Blueprint | NOT VERIFIED | last sync `1f4d4d7` | `membaocaototnghiep` (`exs-dacf7q2fngtc73d8q5jg`) `in_sync`, Auto Sync on, last sync 2026-11-02T17:11:20Z for `1f4d4d7`; resources still `studymap-api` and `studymap-web`; no sync for `741ed48` (#106) or later | Owner | Decision D1, then Manual Sync (§5) |
| 5 | Legacy Render API (`studymap-api`) | NOT VERIFIED | last deploy `fdc1c9d` | Suspended by a user since 2026-09-15T18:25:52Z (PASS part); `autoDeploy=yes`, `checksPass` (open part); no deploy since 2026-09-15 | Owner | Auto-Deploy Off (§5) |
| 6 | Frontend deployment safety | NOT VERIFIED | FE `2d283aa` | Option A merged (#112, #114). No merge has changed `FE/` since #111. Render Auto-Deploy for `studymap-web` is now off (§1) | Owner, then Claude | Decision D1; then the check in §4 on the next `FE/` merge, or owner risk acceptance (§6) |
| 7 | Auth and CORS | PASS | BE `4ed8f47` | `GET /api/documents` without `Authorization`: 401. `OPTIONS` from `https://studymap.space` returns its origin in `Access-Control-Allow-Origin`; from an unknown origin, no `Access-Control-Allow-Origin` | Claude | None |
| 8 | Library feature flag | PASS (OFF) | FE `2d283aa` | Production bundle env has no `VITE_LIBRARY_ACTION_MATRIX`; the flag reader returns false | Claude | Rollout is a separate decision after V4 acceptance |
| 9 | Full Fixture Audit | PASS | `2d283aa` | Run 41586296321: 449 collected, 449 passed, 0 failed, 0 flaky, 0 skipped. #112, #113, #114 changed no `FE/` or fixture file, so no rerun | Claude | None |
| 10 | Screen reader acceptance (S1 NVDA/Chrome, S2 Narrator/Edge) | NOT VERIFIED | FE `2d283aa` | No filled sheet. An agent cannot produce this result | Human tester | Run S1 and S2 (`human-acceptance-sheets.md`) |
| 11 | Real-device touch (S3 Android/Chrome, S4 iPhone/Safari) | NOT VERIFIED | FE `2d283aa` | No filled sheet | Human tester | Run S3 and S4 |
| 12 | Final production readiness | CONDITIONAL | `4ed8f47` / `2d283aa` | Gates 1, 2, 3, 7, 8, 9 PASS; 4, 5, 6, 10, 11 open | Owner | §5 and §6 |

## 3. Human sheets S1–S4

All four are NOT VERIFIED. Use `human-acceptance-sheets.md` unchanged, with
these values for the build fields on 2026-11-03: frontend `2d283aa384f2…`,
backend `4ed8f47da275…` (or later `main` SHAs, read them again before you
start). A result counts only with a named tester, a real device or real
screen reader, and a filled checklist copy per reader (29 rows) or per phone
(5 + 5 taps). A first-tap miss after a flick on either phone is FAIL
(R84-TOUCH-01): record the attempt and a screen recording, and the proposed
fix is to also toggle selection on `pointerup` for `pointerType === "touch"`,
de-duplicated against the click; no GREEN until fixed and re-run.

## 4. Pending observations (read-only, by Claude)

On the next PR to `main`, after its CI completes:

- No Deploy run is created for that CI run (`gh run list -w Deploy` shows no
  run created within a minute of the PR CI's completion), and no new
  `Deploy backend to EC2` check run appears on `main` HEAD.

On the next merge that changes `FE/`, if Render auto-deploy is back on
`checksPass` (D1 = B below):

1. `CI / required` for that SHA is success.
2. Render's deploy for that SHA is created after that success.
3. The Render deploy commit equals the CI SHA.
4. No older SHA is deployed after it.
5. `studymap-build` equals the merge SHA and `/health` reports the same or a
   later `main` SHA.

Any of these false: gate 6 FAIL, Library rollout not recommended, and option B
(frontend deployed by a workflow that verified CI success,
`render-deploy-gate.md` §4) becomes required.

## 5. Owner actions on Render

Do these in order. Claude re-reads after each step; nothing here resumes or
deletes a service or touches secrets.

**D1. Decide what `studymap-web` Auto-Deploy should be.**

- A. Keep it **Off** (manual frontend releases): the next `FE/` merge is
  deployed by hand, only after its `CI / required` is green. Then
  `render.yaml` must say the same (`autoDeployTrigger: off`), or every
  Blueprint sync turns it back on. Claude prepares that one-line PR on
  request.
- B. Restore **On Commit, after CI checks pass** (`checksPass`), matching
  `render.yaml` and option A. Do it on `studymap-web`, Settings, Build &
  Deploy, Auto-Deploy. If the 08:06 change was meant for `studymap-api`,
  this is the fix.

**Blueprint sync** (after D1):

1. Dashboard, workspace "le's workspace", Blueprints, `membaocaototnghiep`.
2. Click **Manual Sync**. If it is only offered with Auto Sync off, set Auto
   Sync to No first and leave it there until step 5.
3. Read the preview before confirming. Expected: `studymap-api` no longer
   managed. For `studymap-web`: no change if D1 = B; with D1 = A, an
   Auto-Deploy change back to `checksPass` is shown unless the
   `render.yaml` PR is merged first, so merge it first. Anything else (new
   resource, environment variable, build or route change): cancel and report.
4. Confirm, wait for it to finish.
5. `studymap-api`, Settings, Build & Deploy, **Auto-Deploy: Off**. Do not
   Resume, delete or edit its environment.
6. Tell Claude. PASS needs, read back from the Render API: a sync for a
   commit at or after `741ed48`, Blueprint resources = `studymap-web` only,
   `studymap-api` suspended with `autoDeploy=no`, `studymap-web` in the
   state chosen in D1, no new deploy on either service.
7. Only then, if you changed it in step 2, set Auto Sync back to Yes.

## 6. Risk acceptance the owner may sign instead of waiting

Gate 6 can only be observed on a future `FE/` merge. If the owner wants
GREEN before that, this statement must be signed; otherwise gate 6 stays
NOT VERIFIED and the verdict stays CONDITIONAL.

> I accept that the frontend deploy order after #112 and #114 has not yet
> been observed on a merge that changes `FE/`. Residual risk: a deploy of a
> commit whose tree already passed `CI / required` on its PR (strict branch
> protection), seconds before its own `main` CI starts. I accept that the
> first `FE/` merge is checked as in §4 and that a failure there makes
> option B mandatory before the Library rollout.
>
> Owner, date (UTC): ____________________

Screen reader and touch sheets (gates 10, 11) cannot be replaced by a
signature under the V4 acceptance criteria; releasing with one screen reader
only still requires the written acceptance described in
`human-acceptance-sheets.md`.

## 7. Verdict

**CONDITIONAL.** No FAIL and no product defect is open. Remaining, by
priority:

1. **D1**: `studymap-web` Auto-Deploy changed at 08:06:40Z; owner decision
   (§5).
2. **Gates 10 and 11**: S1–S4 by a human tester.
3. **Gates 4 and 5**: Blueprint Manual Sync, then `studymap-api` Auto-Deploy
   Off.
4. **Gate 6**: first `FE/` merge check, or the signed acceptance in §6.
5. **Gate 3a**: next PR's CI (no action needed, it happens with any PR).

The Library Action Matrix stays OFF. Its rollout is a separate decision after
V4 is accepted.
