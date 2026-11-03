# Render deploy gate: independent review of PR #112 and options A / B

| Item | Value |
|---|---|
| Checked | 2026-11-03, by Claude, read-only (GitHub API, Render API GET, public HTTPS) |
| `main` | `2d283aa384f2cef1e88f2209032bbeefbe4f3e67` |
| PR #112 | `fix/ci-main-no-queue`, head `4c8486b97cc2e9ed5b8058aca1b60cce04fffdac`, Draft, `mergeStateStatus=CLEAN`, CI 12/12 green including `CI / required` |
| Authority | Nothing merged, deployed or reconfigured. This is an assessment only |

## 1. What happened on 2026-11-03 (reconstructed from check suites and Render deploys)

Four PRs merged within 45 s. `CI` used one concurrency group for `main`
(`CI-refs/heads/main`, `cancel-in-progress: false`), so only one main run could
be active and one pending; a newer pending run cancels the older pending one.

| Time (UTC) | Event |
|---|---|
| 03:56:01 | Push `741ed48` (#106). CI starts; its check runs exist from 03:56:04 |
| 03:56:16 | Push `f109484` (#107). CI run is **pending** (no check runs) |
| 03:56:36 | Push `e83f1f3` (#110). CI pending; the pending `f109484` run is **cancelled** (03:56:37) |
| 03:56:39 | `workflow_run` for the cancelled `f109484` run starts **Deploy** on the default-branch HEAD (`e83f1f3`). Its job is skipped: check run `Deploy backend to EC2 = skipped` lands on `e83f1f3` (03:56:40) |
| 03:56:44 | **Render deploys `e83f1f3`**: the only check run on the commit is `skipped`, which Render counts as passing |
| 03:56:47 | Push `2d283aa` (#111). CI pending; the pending `e83f1f3` run is cancelled (03:56:49) |
| 03:56:51 | Same pattern: skipped Deploy check run on `2d283aa` |
| 03:56:55 | **Render deploys `2d283aa`**, 15 minutes before its CI passed (`CI / required` success at 04:10:29) |

Render's documented rule (render.com/docs/deploys, "After CI Checks Pass"): a
GitHub check passes if its conclusion is `success`, `neutral` or `skipped`;
Render does **not** deploy when "zero checks are detected" or "at least one
CI check fails". The queued check *suites* that other GitHub apps create
(cursor, vercel, netlify, render, supabase) contain no check runs and do not
block anything.

Control evidence that Render does wait while check runs are in progress:

| Commit | `CI / required` completed | Render deploy created |
|---|---|---|
| `56c7c35` | 17:42:53 | 17:42:57 |
| `2eba83e` | 18:05:33 | 18:05:39 |
| `ffbd1bf` | 18:26:59 | 18:27:03 |

(`1f4d4d7` deployed at push time because it was the PR #101 merge that
switched `autoDeploy: true` to `autoDeployTrigger: checksPass`; the old
"on commit" trigger was still live when Render received that push.)

Exposure on 2026-11-03: no functional incident was observed, and main CI on
`2d283aa` passed 14 minutes later. The combined tree had **not** been tested
before Render served it: PRs #106, #107, #110 and #111 were each tested as a
merge ref on the same base `290d2ff` (branch protection was not on yet), so
`2d283aa`'s `FE` tree (`90a6dc9a…`) differs from PR #111's tested merge ref
(`bc41c0ad…`, `FE` tree `c2927614…`). The gate was bypassed. (Correction
raised by Codex1's independent review.)

Observed, not documented by Render: a late CI completion does not roll the
frontend back. `741ed48`'s `CI / required` succeeded at 04:03:57, after
Render had already deployed the newer `2d283aa` (03:56:55), and Render never
deployed `741ed48` (nor `f109484`). One observation only.

## 2. PR #112 against the five required properties

| # | Property | Result | Evidence |
|---|---|---|---|
| 1 | Main CI runs are no longer cancelled by shared concurrency | **PASS** | Group becomes `CI-<sha>` on `refs/heads/main`; no other run shares it, so no main run is pending or cancelled *because of shared concurrency* (runner queueing and manual cancellation still exist). `cancel-in-progress` stays false on main |
| 2 | Each main commit starts its own run | **PASS** | Same reason. A run waiting for a runner still has queued check runs, which Render treats as "not complete" |
| 3 | PR CI behaviour unchanged | **PASS** | For `pull_request`, `github.ref` is `refs/pull/N/merge`, so the expression yields the same group as before and `cancel-in-progress` stays true. #112's own PR run shows it |
| 4 | EC2 deploy stays pinned to the verified SHA | **PASS with one new liveness edge** | `deploy.yml` and `scripts/deploy_gate.sh` are untouched: only a successful push CI run of `.github/workflows/ci.yml` on `main` in this repository, whose SHA equals the current `main`, deploys, and `deploy_remote.sh` pins that SHA. See edge below |
| 5 | Branch protection still works | **PASS** | The job is still named `CI / required` (GitHub Actions, app 15368); #112 is `CLEAN` under the protection enabled on 2026-11-03 |

**New edge introduced by #112 (fail-stale, not fail-unsafe).** `Deploy` keeps
one concurrency group (`production-deployment`) with one running and one
pending slot. Before #112 main CI runs finished in push order, so the newest
arrival was always the newest SHA. With parallel main CI, a slow older run
(for example backend changes, about 14 min) can finish *after* a fast newer
one (docs only, about 3 min). If at that moment one Deploy is running and the
newest SHA's Deploy is pending, the late older Deploy cancels it, then skips
with `main_advanced`. EC2 stays on the previous SHA while Render serves the
new frontend. It needs three overlapping deploys and out-of-order completion,
which strict branch protection makes rare. It is visible in `/health`
`revision` vs `studymap-build`. Recovery: re-run the cancelled Deploy run
(`gh run rerun <id>`), or the next merge fixes it. Option B below removes it.

## 3. Residual risk after #112 (option A)

#112 removes the *minutes-long* window (a pending CI run with no check runs).
It cannot remove every window, because Render reacts to whatever check runs
exist on the commit at the moment it evaluates:

1. Push `N` lands. GitHub creates CI(N)'s first check run about 1–3 s later
   (`741ed48`: push 03:56:00, suite 03:56:01, first job 03:56:04).
2. If in those seconds a *completed* check run lands on `N` from another
   workflow, Render can see "all checks passed". The realistic source is
   `Deploy` (it attaches to the default-branch HEAD), which runs after
   **every** CI completion, including pull-request CI: PR #113's CI finished
   at 06:19:41 and Deploy run 41589178442 put a `skipped` check run on the
   then-HEAD `2d283aa` at 06:19:43. So any CI run (main or PR) finishing in
   those seconds opens the window, not only CI(N-1). Small follow-up that
   removes the PR source (not implemented, needs approval): add
   `branches: [main]` under `on.workflow_run` in `deploy.yml`, so PR CI runs
   no longer start Deploy at all. The job-level `if:` stays as the real gate.
3. Before that check appears, Render sees zero checks and, per its docs, does
   not deploy. So the remaining window is seconds and requires a coincidence.

4. Out-of-order completion after #112 (Codex1): CI(A) and CI(B) now run in
   parallel, so an older commit's checks can finish after a newer one's. The
   2026-11-03 data above shows Render did not deploy the older `741ed48` when
   its CI finished after `2d283aa` was live. That is one observation, not a
   documented guarantee. Verify on the first parallel merges after #112 by
   reading the Render deploy list (no older SHA may appear after a newer one).

Compensating control, **prospective only** (from 2026-11-03, while
`strict: true`, required PRs, `enforce_admins: true` and the required
GitHub Actions check `CI / required` stay enabled): a PR can merge only when
it already contains `main` and `CI / required` passed on its merge ref, so
the tree that lands on `main` is the tree CI already passed. In the race,
Render would build a tree that passed required CI, only without the
post-merge confirmation. This did **not** hold for the 2026-11-03 merges,
which happened before protection was enabled.

## 4. Option B: GitHub-driven frontend deploy (design only, not implemented)

Render auto-deploy for `studymap-web` is turned off, and `Deploy` deploys the
frontend after the backend, from the same verified SHA.

| Concern | Design |
|---|---|
| CI provenance | Keep `deploy_gate.sh` checks (conclusion `success`, event `push`, branch `main`, repository and head repository equal `github.repository`, workflow path `.github/workflows/ci.yml`). Add an API check with `permissions: checks: read`: the target SHA has a check run named `CI / required`, `app.id == 15368`, conclusion `success` |
| Repository and branch | As above; the run fails closed on any mismatch (`decision=reject`) |
| Immutable SHA | Only a 40-hex SHA is accepted. Render is called with that SHA, never a branch name |
| Current main | `git ls-remote` of `refs/heads/main` immediately before triggering, and again before declaring success |
| Superseded runs | Change the gate from "deploy my SHA if it is still main" to "deploy the **current main** SHA if it has a successful `CI / required`". Whichever Deploy run executes last deploys the newest verified commit, so a cancelled pending run can no longer leave production stale (removes the edge in §2) |
| Credentials | Do not put a Render API key in GitHub (Render keys are account-wide). Use the `studymap-web` **Deploy Hook** URL as an environment secret of the `production` environment. It can only trigger deploys of that one service. Call it with `?ref=<sha>` |
| Serialization | Same `production-deployment` group. Frontend job `needs:` the EC2 job, so the backend goes first and a failed backend deploy blocks the frontend |
| Revision check | Poll the public `https://studymap.space/` for `<meta name="studymap-build" content="<sha>">` (no credential), up to 10 min. Record SHA, run id and both revisions in the job summary |
| Failure | A failed Render build keeps the previous deploy live. The job fails and the run is red. No automatic retry of a different SHA |
| Rollback | Render Dashboard, then Deploys, then Rollback on the last good deploy; or trigger the hook with an older `main` SHA that has green `CI / required`. Then confirm the meta tag |
| Blueprint | `render.yaml` must say `autoDeployTrigger: "off"` for `studymap-web`. Changing only the dashboard is undone by the next Blueprint sync |

Gaps raised by Codex1's review that a B implementation must close:

- **Provenance binding.** Bind the `CI / required` check run to the exact
  workflow run that fired `workflow_run` (run id, check suite id, attempt,
  event, path, head SHA), not only to its name and app id: another Actions
  workflow could use the same job name.
- **Reconcile, not just detect.** Under the serialized group: pick the
  candidate, verify it, trigger and record the Render deploy id, poll that
  deploy for the commit, then re-read `main`. If `main` moved to a newer
  verified SHA, deploy that before reporting success.
- **Hook handling.** Deploy hook URL as a `production` environment secret
  restricted to `main`, never echoed, with a rotation procedure, timeouts,
  no blind retries, and fail-closed handling of HTTP errors. `?ref=` can
  name any SHA, so a leaked hook can replay old builds.
- **Rollback.** A frontend-only rollback breaks the "backend and frontend on
  the same SHA" invariant and contradicts the current-main-only gate. It
  needs its own break-glass path: audit record, migration/API compatibility
  check, EC2/frontend order, and a roll-forward criterion. Revision checks
  must bust caches and match the deploy id, not only the HTML meta tag.

## 5. Recommendation

| | A: keep `checksPass`, merge #112 | B: workflow-triggered frontend deploy |
|---|---|---|
| Change size | 1 line (ready, green) | New job, new secret, `render.yaml` change, dashboard change, tests for the gate |
| Frontend waits for main CI | Almost always; residual window of seconds (§3) | Always; deploys only a SHA with a verified `CI / required` |
| Backend/frontend same SHA, in order | Not guaranteed; independent paths | Yes |
| Stale-EC2 edge from §2 | Present (rare, detectable, re-run fixes it) | Removed |
| New attack surface | None | Deploy-hook URL; a leak lets someone redeploy refs of this service |
| Depends on GitHub Actions being up | No (Render polls GitHub checks) | Yes, for every frontend deploy |

**Recommendation: A now, B as the first post-release hardening.** Merge #112
(owner decision), and accept the residual risk recorded in §3, together with
the §2 edge and its recovery step. While strict branch protection stays on,
every new `main` tree has passed `CI / required` as a PR merge ref, so the
residual window cannot ship untested code, only code whose post-merge CI had
not finished yet. Condition on A: after the first merges under #112, read the
Render deploy list and `studymap-build`; if Render ever deploys an older SHA
after a newer one (§3 item 4), treat it as a release blocker and move to B.
B is the right end state, but it adds a credential, touches both production
deploy paths and still has the open design points above; it should not be
introduced in the same window as the V4 release.

Independent review: Codex1, `independent-review-codex1.md` (REQUEST CHANGES;
findings 2–4 accepted and applied; finding 1 answered with the 2026-11-03
observation and turned into the verification condition above).
