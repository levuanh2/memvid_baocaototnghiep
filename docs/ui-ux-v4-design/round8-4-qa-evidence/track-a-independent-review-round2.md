# Round 8.4A Track A — Independent Re-review

Reviewer: Codex2 — not an author of Track A

Review date: 2026-11-02 (Asia/Saigon)

Target reviewed read-only: `phase-c-round8-4a-deploy-safety`, including its diff from `origin/main` and untracked Round 8.4A files.

## Verdict: BLOCK

Round 2 fixes six of the eleven original findings and materially improves the deployment path. However, three release-blocking problems remain.

The streamed SSH wrapper changes the shared checkout before acquiring the deploy/rollback lock. Ignored files can still enter a supposedly pinned Docker build. The new rollback ledger can also inherit a Git commit that was never the running production release.

Both supplied harnesses pass. My independent mutation removed the GitHub API's exact-SHA filter, and the full pinning harness still passed. The CI-verification tests therefore do not prove the most important part of that query.

## Status of the eleven Round 1 findings

| # | Round 1 finding | Round 2 status | Evidence and assessment |
|---:|---|---|---|
| 1 | Caller-supplied SHA was treated as CI-verified | **FIXED** for the normal path | `scripts/deploy.sh:70-76,136-147` now requires a successful `ci.yml` workflow run filtered by exact SHA, main branch, push event, and success status. Failure needs explicit `MEMVID_BREAK_GLASS=1`. |
| 2 | Exit 75 could hide ordinary failures | **FIXED** | `scripts/deploy.sh:14-24,40-44` and `scripts/deploy_remote.sh:6-16,27-35` preserve 75 only for an explicit supersession. Other child status-75 failures become 70. |
| 3 | Current-main check became stale during build | **FIXED** | `scripts/deploy.sh:79-86,138,172-180` fetches and checks main before build, before migration, and before activation. The harness exercises main advances during build and migration at `scripts/tests/test_deploy_pinning.sh:272-292`. |
| 4 | Unpinned deploy and arbitrary rollback bypassed CI | **PARTIALLY FIXED** | Unpinned deployment now requires break glass at `scripts/deploy.sh:109-110,156-164`. Rollback requires an exact ledgered SHA at `scripts/rollback.sh:15,23-33`. The inherited-ledger and editable-ledger problems below can still authorize code that was never a healthy deployment. |
| 5 | Force reset could include files outside the pinned commit | **PARTIALLY FIXED** | `scripts/deploy.sh:128-153` rejects tracked and ordinary untracked production inputs. Git-ignored files remain invisible and can still enter `BE/Dockerfile:58` through the `BE` build context. The runbook acknowledges this at `docs/AWS_DEPLOYMENT.md:142-147`. |
| 6 | Deploy and rollback lacked one host-local lock | **NOT FIXED end-to-end** | `deploy.sh:46-50,113` and `rollback.sh:16-18` share a lock, but `deploy_remote.sh:20-28` fetches, checks out, and changes script modes before the child acquires it. The restore path also runs after the child releases it at `deploy_remote.sh:31-34`. |
| 7 | `APP_BUILD_SHA` was exported but not consumed | **NOT FIXED** | Export remains correct at `scripts/deploy.sh:154,162` and `scripts/rollback.sh:44`. `docker-compose.prod.yml:27-49,75-93` still does not pass it into either service or build. `R84A-REPORT.md:67-69` explicitly defers consumption to Track B. |
| 8 | Protected-auth test shared its expectation switch with the server | **FIXED** | CI sets independent `E2E_EXPECT_PROTECTED_AUTH=true` at `.github/workflows/ci.yml:461-466`. The test prefers that variable at `FE/e2e/auth-protection.spec.js:4-15`, while `FE/playwright.config.js:39-49` correctly carries the environment into Flask. |
| 9 | Harness missed activation guard and duplicated the SSH wrapper | **FIXED for the original finding** | The harness streams the production wrapper at `scripts/tests/test_deploy_pinning.sh:87-91`. It exercises remote-main and local-HEAD races at `:272-300`. The mutation suite removes all three current-main checks and the local HEAD check at `scripts/tests/test_deploy_guard_mutations.sh:35-40`. New query and rollback-lock coverage gaps remain below. |
| 10 | Render semantics and overlapping-deploy behavior were incomplete | **PARTIALLY FIXED / live state not verified** | `render.yaml:39,283` uses valid `checksPass`. `docs/AWS_DEPLOYMENT.md:172-187` now documents success/neutral/skipped semantics and Wait versus Override. Blueprint sync, both services' live Auto-Deploy setting, and the workspace overlap policy remain human checks. |
| 11 | Rollback claimed detached HEAD without enforcing it | **FIXED** | `scripts/rollback.sh:15,23-25,43-45` requires an exact full commit SHA, resolves a commit object, and checks it out detached. |

Summary: **6 FIXED, 3 PARTIALLY FIXED, 2 NOT FIXED**.

## Release-blocking findings

### HIGH — the remote wrapper mutates the checkout before taking the shared lock

Someone can start a manual rollback while an automated deployment begins. The rollback holds the documented lock, but the automated wrapper can still fetch and move `HEAD` underneath it before `deploy.sh` tries to acquire that lock.

**Evidence:** `scripts/deploy_remote.sh:20-28`; `scripts/deploy.sh:46-50,113`; `scripts/rollback.sh:16-18,41-48`.

The same gap can make the wrapper execute a different checkout's `scripts/deploy.sh` if another operation changes `HEAD` between wrapper checkout and child execution. A genuine supersession restore also happens after the child releases its lock.

**Suggested fix:** acquire the shared host lock in `deploy_remote.sh` before reading previous HEAD, fetching, checking out, or changing modes. Hold it through child completion and any restore. Pass the locked file descriptor into `deploy.sh`, or add a narrowly scoped internal mode that verifies the inherited lock instead of reacquiring it. Test wrapper-versus-rollback contention.

### HIGH — ignored files can still change a pinned production image

A stale ignored file under `BE` can be copied into the image even though it does not belong to the verified commit. This breaks the claim that the artifact is determined by the pinned SHA.

**Evidence:** `scripts/deploy.sh:128-153`; `scripts/rollback.sh:36-48`; `.gitignore:18,59,77,100,105`; `docker-compose.prod.yml:29-31,76-78`; `BE/Dockerfile:57-58`.

For example, the repository ignores `*.so`, while the backend Docker context is copied wholesale. An ignored Python extension module can therefore survive reset and affect imports. Rollback has the same exposure.

**Suggested fix:** build from a fresh worktree or `git archive` of the exact SHA. Another acceptable design is an allowlisted build context whose contents are compared with tracked files. Add a test with an ignored, Docker-visible file.

### HIGH — empty-ledger inheritance can authorize a revision that never ran successfully

After a failed deployment, the repository checkout can differ from the still-running containers. The next successful deployment treats that checkout as the previous production release and grants it normal rollback eligibility.

**Evidence:** `scripts/deploy_remote.sh:22,28,35-36`; `scripts/deploy.sh:95-103,125-126,193-195`; `scripts/rollback.sh:27`.

The wrapper restores previous HEAD only for supersession. A non-75 failure can leave candidate B checked out while production still runs A. If the ledger is empty when C later succeeds, B is written as `inherited`; rollback then accepts B without break glass. Direct callers can also supply `MEMVID_PREVIOUS_DEPLOY_SHA`.

**Suggested fix:** do not infer a prior release from repository HEAD. Bootstrap the ledger through an explicit audited operation that verifies the running image or `/health` revision against a known successful deployment. Until runtime provenance exists, leave the prior revision unseeded and require break glass for the first rollback.

## Other findings

### MEDIUM — normal CI verification is fail-closed but rate-limit fragile

The new GitHub API check fails closed on HTTP errors, connection errors, malformed JSON, missing/non-integer `total_count`, and zero results. It also uses server-side workflow, SHA, branch, event, and success filters, so I found no response-spoofing or fail-open path.

**Evidence:** `scripts/deploy.sh:52-76,136-146`. I also verified the current repository is public with `gh repo view`: `levuanh2/memvid_baocaototnghiep`, visibility `PUBLIC`.

GitHub permits unauthenticated workflow-run reads only for public repositories and applies a low unauthenticated rate limit. Exhaustion or a future visibility change blocks all normal deployments and pressures operators toward break glass. See [GitHub workflow-run API documentation](https://docs.github.com/en/rest/actions/workflow-runs) and [GitHub rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api).

**Suggested fix:** use a narrowly scoped read-only GitHub App or fine-grained credential without logging it, or use a signed CI attestation streamed from the trusted workflow. Log enough HTTP/rate-limit context to distinguish missing CI evidence from service exhaustion.

### MEDIUM — the ledger is an editable eligibility file, not a complete audit record

The deploy user can append a plausible line and make any local commit look rollback-eligible. The same user can invoke break glass, so this is mainly an audit-integrity failure, not a new privilege escalation.

**Evidence:** `scripts/deploy.sh:88-103,188-201`; `scripts/rollback.sh:27,47-56`.

Break-glass is recorded only after health succeeds. A break-glass attempt can run a migration or activate containers, fail health, and leave no ledger entry. Ledger records also omit operator identity, reason, attempt state, and result despite the report's claim that every use is audited.

**Suggested fix:** record a break-glass attempt before mutation and append its final result afterward. Require an operator-supplied reason. Store the record in an append-only or separately protected sink if it is used as an authorization boundary.

### MEDIUM — the CI-verification harness does not prove the GitHub query contract

The curl shim returns `total_count` for every URL and ignores all arguments. Tests cover a zero count but do not verify the workflow path, exact SHA, branch, event, success status, HTTP failure, or malformed response.

**Evidence:** `scripts/tests/test_deploy_pinning.sh:136-140,250-258`; `scripts/tests/test_deploy_guard_mutations.sh:40`.

My independent mutation removed `head_sha=${DEPLOY_SHA}` from `scripts/deploy.sh`. The complete `test_deploy_pinning.sh` suite still exited 0 and reported every scenario PASS.

**Suggested fix:** make the curl shim log and validate the exact URL and headers. Add response modes for non-zero curl exit, invalid JSON, missing count, string count, and zero count. Add one mutation for every required query component.

### MEDIUM — lock and ledger mutation coverage is narrower than the production surface

The supplied lock case proves only that direct deploy refuses contention. It does not call rollback while the lock is held and does not run the remote wrapper against a competing lock holder.

**Evidence:** `scripts/tests/test_deploy_pinning.sh:310-316`; `scripts/tests/test_deploy_guard_mutations.sh:9-23,43`.

Every supplied mutation edits only `scripts/deploy.sh`. Removing the rollback lock or wrapper restoration logic leaves the mutation suite outside those production paths.

**Suggested fix:** parameterize the mutation target file. Add rollback-lock, wrapper-lock, wrapper-restore, inherited-ledger, and failed-deploy-ledger mutations. Snapshot ledger length around rejected, failed, and superseded cases.

### MEDIUM — the new preflight can report READY while unsafe build and ledger state remain

An operator can receive `RESULT: READY` even when an ignored Docker-visible file will change the image or an empty ledger is about to trust repository HEAD as the running release.

**Evidence:** `scripts/deploy_preflight.sh:24-33,54-63`.

The preflight repeats the ordinary `git status` checks, so it misses ignored files. For an empty ledger, it prints inheritance as information and still returns ready without comparing repository HEAD with the running image.

This file appeared untracked in the target while the re-review was in progress. It is not referenced by the supplied harnesses, so I included it in the final read but did not treat the earlier harness results as coverage for it.

**Suggested fix:** make preflight verify the exact Docker build context, including ignored files. If the ledger is empty, require an independently verified running revision or report NOT READY for normal rollback eligibility.

### LOW — `APP_BUILD_SHA` remains an incomplete cross-track contract

The scripts export the right SHA, but the production Compose file does not consume it. A green shim assertion proves shell inheritance, not container or image provenance.

**Evidence:** `scripts/deploy.sh:154,162`; `scripts/rollback.sh:44`; `docker-compose.prod.yml:27-49,75-93`; `R84A-REPORT.md:67-69`.

**Suggested fix:** Track B must pass `${APP_BUILD_SHA}` explicitly into both relevant services or the image build, expose it at runtime, and verify the resolved Compose config and container response before the combined release is approved.

## Positive verification

- The workflow-run gate still checks conclusion, event, branch, repository, head repository, workflow path, SHA form, and current remote main: `.github/workflows/deploy.yml:36-91`; `scripts/deploy_gate.sh:10-29`.
- GitHub expressions are passed through step environment variables. The deploy SHA is exact lowercase hexadecimal before it reaches `bash -s`, so `.github/workflows/deploy.yml:118-128` does not introduce shell injection.
- Production secrets remain in step environment variables and are not printed. The streamed wrapper avoids constructing deployment logic in the SSH command.
- `git ls-remote` still fails closed because an empty or malformed result is rejected by `scripts/deploy_gate.sh:22`.
- `E2E_EXPECT_PROTECTED_AUTH` is independent from the backend switch in protected CI.
- The new status-75 normalization, three current-main checks, exact detached rollback, and production-wrapper reuse are covered by passing executable tests.
- Render's `checksPass` documentation now matches the official semantics. The remaining live settings are clearly marked for human verification.

## Verification performed by running code

### Supplied harness

Command:

```text
wsl -e bash -lc 'cd /mnt/e/memvid_NCKH/MemVid_BaoCaoTotNghiep/.worktrees/phase-c-round8-4a-deploy-safety && bash scripts/tests/test_deploy_pinning.sh'
```

Result: **PASS**, exit 0. All 13 reported scenarios passed.

### Supplied mutation harness

Command:

```text
wsl -e bash -lc 'cd /mnt/e/memvid_NCKH/MemVid_BaoCaoTotNghiep/.worktrees/phase-c-round8-4a-deploy-safety && bash scripts/tests/test_deploy_guard_mutations.sh'
```

Result: **PASS**, exit 0. All 8 removed guards made the main harness fail.

### Independent mutation

Mutation copy:

```text
qa-r84/track-a-round2-mutation/ci-query-without-head-sha/
```

Change: removed the exact `head_sha=${DEPLOY_SHA}` filter from `verify_ci_success()`.

Result: **HARNESS MISSED MUTATION**, exit 0. All pinning scenarios still passed. The Track A worktree was not modified.

## Verification performed by reading

- Read the full production deploy, remote wrapper, rollback, gate, preflight, harness, mutation harness, CI workflow, deploy workflow, auth E2E, Playwright config, Compose build context, Dockerfile, runbook, and Round 8.4A report.
- Reconciled all eleven Round 1 findings against their new implementation and tests.
- Checked CI verification failure handling, repository derivation, exact filters, break-glass behavior, ledger seeding, ledger authorization, lock scope, status normalization, remote streaming, protected-auth expectation, Render semantics, and runtime SHA propagation.
- Verified repository visibility through GitHub CLI and checked the new API design against current official GitHub documentation.

## Changes required before approval

1. Move the shared lock to cover the remote wrapper's checkout and restore operations.
2. Make production build inputs derive only from the pinned commit, including ignored files.
3. Replace repository-HEAD ledger inheritance with verified running-release bootstrap.
4. Make the CI-query harness assert every provenance filter and fail mode.
5. Make preflight reject the same ignored-input and ledger-bootstrap states that block this review.
6. Complete `APP_BUILD_SHA` consumption in the combined Track A/Track B release.

