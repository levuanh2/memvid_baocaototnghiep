# Round 8.4A Track A — Independent Review

Reviewer: Codex2 — not an author of Track A

Review date: 2026-11-02 (Asia/Saigon)

Target reviewed read-only: `phase-c-round8-4a-deploy-safety`, including the diff from `origin/main` and its untracked test, E2E, and evidence files.

## Verdict: BLOCK

Track A should not be released in its current form. The automatic GitHub workflow has good provenance and quoting controls, but the repository still contains direct deployment paths that can activate a commit whose CI failed or never ran. A separate defect can turn an unrelated command failure with exit code 75 into a successful “superseded” deployment result.

The current-main protection also has a time-of-check/time-of-use gap. It checks `origin/main` before the build, then checks only local `HEAD` before activation. A newer push during the build does not stop the older revision from going live.

## Findings

### 1. Critical — a caller-supplied SHA is treated as CI-verified without evidence

**Evidence:** `scripts/deploy.sh:27-33`, `scripts/deploy.sh:50-62`.

**Failure scenario:** commit B is current `origin/main`, but B's CI failed. A person or another automation path runs `scripts/deploy.sh <B's-full-SHA>`. The script validates only SHA syntax, ancestry, and equality with current main. It never verifies a CI result, so it builds, migrates, and activates B without requiring `MEMVID_DEPLOY_UNPINNED=1`.

This means the `<verified-main-sha>` label is a caller assertion, not a property enforced by the script.

**Suggested fix:** separate the workflow-only entry point from manual deployment. Require a CI-issued, server-verifiable attestation for the normal path. Require an explicit, audited break-glass flag for every manual path, including a manually supplied SHA. Document the trust boundary if shell operators are intentionally outside the deployment-security model.

### 2. Critical — exit code 75 can hide a real deployment failure

**Evidence:** `scripts/deploy.sh:22,77-102`; `.github/workflows/deploy.yml:123-140`.

**Failure scenario:** `compose build`, the migration command, `compose up`, or the health script returns 75 for an ordinary failure. Because `deploy.sh` uses `set -e`, that status propagates. The remote wrapper treats every 75 as “main advanced,” restores the previous checkout, and converts the workflow result to success.

The result shown to operators is a safe skip even though a build, migration, activation, or health check failed.

**Suggested fix:** reserve 75 inside `deploy.sh`. Normalize unexpected child-command failures to another non-zero status, or return a separate authenticated outcome that cannot collide with a child process status. Add cases where build, migration, startup, and health return 75; each must fail the workflow.

### 3. High — the current-main check is stale by activation time

**Evidence:** `scripts/deploy.sh:52-58`, `scripts/deploy.sh:77-98`; `.github/workflows/deploy.yml:23-25`.

**Failure scenario:** A passes CI and begins building. B is pushed while A builds. A fetched main before B existed. The final guard compares only local `HEAD` with A, which still matches, so A migrates and activates even though current main is now B. B may still be running CI or may later fail CI.

GitHub concurrency does not close this gap. With `cancel-in-progress: false`, the running A deployment continues. GitHub keeps one pending run by default and replaces an older pending run with the newest one, but the running job is not canceled. See [GitHub's concurrency documentation](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).

**Suggested fix:** fetch `origin main` again immediately before irreversible migration and again before activation. Compare the fresh `origin/main` SHA with `DEPLOY_SHA`; use the reserved superseded outcome only for that exact condition. Add a harness scenario that advances origin during the build shim.

### 4. High — the documented unpinned and rollback paths can deploy code without passed CI

**Evidence:** `scripts/deploy.sh:20-21,31-32,64-70`; `scripts/rollback.sh:11-19,26-37`.

**Failure scenario:** `MEMVID_DEPLOY_UNPINNED=1 scripts/deploy.sh` deploys current main while CI is pending or failing. Separately, `rollback.sh` accepts any locally resolvable commit, tag, or branch, including a commit that was never a successful production release.

Rollback is a valid operational need, but its current input is an arbitrary Git ref rather than a recorded release.

**Suggested fix:** restrict rollback to exact SHAs from an immutable successful-deployment ledger. If unpinned deployment remains as break glass, require separate authorization, an audit record, and an unmistakable workflow result. Do not present either path as preserving the CI-passed invariant.

### 5. High — force reset can build files that are not in the pinned commit

**Evidence:** `scripts/deploy.sh:14-18,44-61`; `docker-compose.prod.yml:27-31,75-78`; `BE/Dockerfile:57-58`.

**Failure scenario:** an untracked or ignored file remains under `BE/`. `MEMVID_FORCE_RESET=1` bypasses the dirty-tree refusal, but `git reset --hard` does not remove that file. Docker uses `BE/` as the build context and `COPY . .` copies the extra file into the image. The deployed artifact is therefore not determined by the pinned SHA.

**Suggested fix:** build from a clean archive or fresh worktree. If force reset remains, define and safely enforce the intended cleanup policy for untracked and ignored build inputs. Add a test with an untracked file that changes the build context.

### 6. Medium — deploy and rollback lack a shared host-local lock

**Evidence:** `.github/workflows/deploy.yml:23-25`; `scripts/deploy.sh:44-98`; `scripts/rollback.sh:26-37`.

**Failure scenario:** GitHub serializes its own workflow, but a manual deploy or rollback can run at the same time on the EC2 host. Both commands mutate the same checkout and run Compose. They can race during checkout, image build, migration, and activation.

**Suggested fix:** acquire the same host-local `flock` in automated deploy, manual deploy, and rollback before any checkout or build. Define whether a competing operation waits or fails.

### 7. Medium — `APP_BUILD_SHA` is exported but not wired into the production artifact

**Evidence:** `scripts/deploy.sh:62,69`; `scripts/rollback.sh:30`; `docker-compose.prod.yml:27-49,75-93`.

**Failure scenario:** the harness proves only that its Docker CLI shim inherits the shell variable. The production Compose file does not pass `APP_BUILD_SHA` as a service environment value or build argument. The backend and worker therefore cannot report the deployed SHA from this change alone.

**Suggested fix:** pass `${APP_BUILD_SHA}` explicitly to the relevant service environment or image build argument. Verify it with `docker compose config` and from the running container. If Round 8.4B is intentionally the consumer, state that Track A exports but does not yet provide runtime provenance.

### 8. Medium — the protected-auth test derives its expectation from the same switch as the server

**Evidence:** `FE/e2e/auth-protection.spec.js:4-14`; `.github/workflows/ci.yml:458-465`; `FE/playwright.config.js:39-49`.

**Failure scenario:** in today's protected CI step, `AUTH_PROTECT_APP_APIS=true` is passed to both Playwright and the backend, so the test does fail if the backend boots open despite receiving `true`. However, if the CI variable is removed or misspelled, both the server and the test silently select open mode and the “protected auth” pass can stay green.

The `webServer.env` merge itself is correct: `{ ...process.env, PORT }` preserves the protected setting.

**Suggested fix:** make the protected project expectation independent of the server switch. For example, pass a separate fixed `EXPECT_PROTECTED_AUTH=true` to the test while passing `AUTH_PROTECT_APP_APIS=true` only to the backend, or define a dedicated Playwright project whose assertion is always 401.

### 9. Medium — the harness does not cover the final activation guard or the real workflow wrapper

**Evidence:** `scripts/tests/test_deploy_pinning.sh:45-84,141-149,163-251`; `.github/workflows/deploy.yml:121-140`.

**Failure scenario:** the harness replaces Docker, migration, startup, and health behavior with a shim that always succeeds. It never moves `HEAD` or advances remote main between build and activation. It also duplicates the workflow's inline remote command instead of invoking a shared production wrapper, so workflow and test can drift.

Mutation evidence confirms the gap:

- Removing the initial current-main equality check made scenario B fail: expected 75, observed 0.
- Removing the pre-activation `HEAD` check left every scenario green and the harness exited 0.

**Suggested fix:** add controlled shims that move local `HEAD`, advance `origin/main`, return 75 from migration, and create dirty/untracked build inputs during deployment. Extract the SSH-side command into a versioned script used by both the workflow and harness.

### 10. Medium — Render's setting is valid, but its pass and ordering semantics are broader than the comments imply

**Evidence:** `render.yaml:37-40,281-284`.

`autoDeployTrigger: checksPass` is valid Blueprint syntax. Render documents it as waiting for CI checks, but GitHub conclusions `success`, `neutral`, and `skipped` all count as passed. Zero detected checks or any failed check blocks deployment. See the [Blueprint field definition](https://render.com/docs/blueprint-spec) and [Render's CI-check semantics](https://render.com/docs/deploys#integrating-with-ci).

Render also manages overlapping deploys with a workspace setting that is not represented in `render.yaml`. Under **Wait**, an older running deploy may finish and go live before the newest queued deploy; intermediate queued deploys are skipped. **Override** cancels the running deploy. See [Render's overlapping-deploy policy](https://render.com/docs/deploys#handling-overlapping-deploys).

**Failure scenario:** a skipped or neutral check is assumed to mean “all checks succeeded,” or the workspace uses Wait while the release policy assumes only the newest revision can activate.

**Suggested fix:** verify the live Blueprint sync and both services' Auto-Deploy setting. Audit which checks can finish neutral or skipped. Record and verify the workspace overlapping-deploy policy; choose Override if latest-only activation is required.

### 11. Low — rollback does not guarantee the detached state it reports

**Evidence:** `scripts/rollback.sh:18-31`.

**Failure scenario:** passing a branch name succeeds, and `git checkout "$REF"` attaches `HEAD` to that branch even though the log says the rollback is detached. `rev-parse --verify` also accepts objects that are not commits.

**Suggested fix:** resolve `"$REF^{commit}"` to an exact commit and use `git checkout --detach "$resolved_sha"`.

## Security controls that passed review

- The `workflow_run` job checks success, push event, and main branch before running. The gate also verifies repository, head repository, workflow path, SHA format, current remote main, and conclusion: `.github/workflows/deploy.yml:36-46,55-91`; `scripts/deploy_gate.sh:10-29`.
- GitHub expressions in deploy shell blocks are passed through `env` instead of being interpolated directly into shell syntax. The only reviewed expression inside a CI `run` block joins controlled job-result enums: `.github/workflows/ci.yml:581-592`.
- `DEPLOY_SHA` must be 40 lowercase hexadecimal characters and is single-quoted inside the SSH command. No user-controlled shell metacharacters survive that validation: `.github/workflows/deploy.yml:118-129`; `scripts/deploy_gate.sh:10-14`.
- Secrets are put into step environment variables and written with `printf`; the workflow does not enable shell tracing or echo their values: `.github/workflows/deploy.yml:93-112,117-129`.
- A failed or empty `git ls-remote` result is converted to an empty SHA and rejected by the gate. The `|| true` prevents an early shell exit but does not fail open: `.github/workflows/deploy.yml:67-89`; `scripts/deploy_gate.sh:22`.
- Checking out deployment scripts at the candidate `head_sha` is consistent with deploying that CI-passed revision. The provenance gate runs before production secrets are loaded. This remains safe only while protected main and the CI workflow are trusted to review changes to those scripts.
- The first pinned ancestry/current-main check works, and the intended 75 supersession path restores the previous remote `HEAD`: `scripts/deploy.sh:52-61`; `.github/workflows/deploy.yml:123-135`.
- Repeating the same pinned deployment was idempotent in the supplied harness.

## Verification performed by running code

### Unmodified harness

Command, run 2026-11-02:

```text
bash /mnt/e/memvid_NCKH/MemVid_BaoCaoTotNghiep/.worktrees/phase-c-round8-4a-deploy-safety/scripts/tests/test_deploy_pinning.sh
```

Result: **PASS**, exit 0. Scenarios A-H, provenance rejection, malformed/unknown/missing SHA rejection, rollback followed by pinned deployment, idempotency, and manual unpinned opt-in all reported PASS.

### Mutation checks in the Codex2 worktree

Copies were created under:

```text
qa-r84/track-a-mutations/no-current-main/
qa-r84/track-a-mutations/no-activation-recheck/
```

Results:

| Mutation | Harness result | Meaning |
|---|---:|---|
| Removed `origin/main == DEPLOY_SHA` before build | **FAIL**, exit 1 | The harness detects loss of its initial current-main check. Scenario B expected 75 and observed 0. |
| Removed pre-activation local `HEAD == DEPLOY_SHA` check | **PASS**, exit 0 | The harness does not exercise or prove the final activation guard. |

The target Track A worktree was not modified.

## Verification performed by reading

- Reviewed the complete Track A diff from `origin/main` plus the listed untracked test, auth E2E, and evidence files.
- Traced `workflow_run` provenance, `git ls-remote`, gate outputs, secret handling, SHA quoting, SSH status handling, and concurrency behavior.
- Traced pinned, unpinned, dirty-tree, reset, migration, activation, health, rollback, and repeated-deploy paths.
- Confirmed the production Docker build contexts copy the `BE` worktree and do not consume `APP_BUILD_SHA`.
- Traced the protected-auth CI environment into Playwright's backend server and assertion.
- Compared `render.yaml` with Render's current official Blueprint, CI-check, and overlapping-deploy documentation.

## Required changes before approval

1. Enforce CI provenance for every non-break-glass deployment entry point; do not trust a caller-supplied SHA label.
2. Prevent exit-code 75 collisions from turning real failures into successful skips.
3. Fetch and compare current remote main immediately before migration and activation.
4. Make pinned builds immune to untracked or ignored worktree content.
5. Add harness cases for the activation race, remote-main race, status-75 failures, dirty/force-reset behavior, and the production remote wrapper.

