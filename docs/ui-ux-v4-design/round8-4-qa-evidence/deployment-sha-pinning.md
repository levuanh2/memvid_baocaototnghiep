# Deployment SHA pinning (Round 8.4A)

| Item | Value |
|---|---|
| Source revision | `origin/main` `2479a32` plus branch `fix/studymap-v4-round8-4-deploy-safety` |
| Implemented by | Codex1 (rounds 1–2, design by Claude). Claude made the round-3 fixes after Codex1 ran out of usage |
| Independent review | Codex2, not an author. Round 1: BLOCK, 11 findings. Round 2: BLOCK, 3 HIGH. Round 3: `track-a-independent-review-round3.md` (see `README.md` for its status) |
| Coordinator review | Claude. **Not independent:** Claude designed the change and wrote the round-3 fixes |
| Environment | Local bash harness in WSL (real `flock`, `/proc`), with a temporary bare `origin` repo, a server clone and command shims for `docker` and `curl`. No network, no real Docker, no SSH, no production |

## The defect

On 2026-11-02, PR #99 (`4862db6`) and PR #100 (`2479a32`) were merged 13
seconds apart. The old `deploy.yml` ran `git pull --ff-only origin main` over
SSH, and the old `deploy.sh` ran `reset --hard origin/main`. Neither used
`workflow_run.head_sha`, so the first CI run to succeed could deploy a newer
`main` whose own CI had not finished.

The Render frontend served `2479a32` from 07:42:00Z, while CI for that commit
was still running, because `autoDeploy: true` does not wait for CI.

**Invariant:** the exact commit deployed must be a commit whose required CI
passed.

## Design after three review rounds

**GitHub side (`deploy.yml`).**

- The existing `if:` stays: conclusion `success`, event `push`, branch `main`.
- `scripts/deploy_gate.sh` is a pure check with no network and no mutation.
  It **rejects** (exit 1) when any of these is wrong: SHA form, conclusion,
  event, branch, run repository, head repository, workflow path, or remote
  `main` SHA.
- It **skips** (exit 10) when `main` has moved past the run's SHA. In that
  case no SSH material is created, and the newer commit's own CI run owns the
  deploy.
- On `deploy`, the step streams `scripts/deploy_remote.sh` **from the verified
  commit** to `ssh … bash -s -- <sha>`.
- All event fields and secrets reach the scripts through `env:`. The host
  name is never echoed.

**Server side.** `deploy_remote.sh` does the following, in order:

1. Takes the shared host lock (`flock` on `/opt/memvid/deploy.lock`) **before**
   reading HEAD, fetching or checking out.
2. Records the previous HEAD.
3. Checks out `<sha>` detached.
4. Runs `deploy.sh <sha>`, which reuses the locked file descriptor through
   `MEMVID_LOCK_INHERITED`. The descriptor is accepted only if `/proc/$$/fd/9`
   is the lock file, and `flock` must still succeed on it.
5. On a genuine supersede (exit 75), restores the previous HEAD while still
   holding the lock.

`deploy.sh <sha>` does the following, in order:

1. Validates the SHA.
2. Verifies through `api.github.com` that a **successful push run of `ci.yml`
   on `main` exists for exactly this SHA**. This fails closed on network
   errors, HTTP errors, rate limits, malformed JSON, a missing or non-integer
   count, and zero runs.
3. Requires the SHA to be the current `origin/main` before build, before
   migration and before activation, fetching fresh each time. If `main` has
   moved, it exits 75 without activating.
4. Requires the SHA to be an ancestor of `main`.
5. Pins `main` to the SHA.
6. **Refuses modified, untracked or git-ignored files** under `BE/` and in
   `docker-compose.prod.yml` (`git status --ignored`), because
   `BE/Dockerfile` copies the whole context.
7. Exports `APP_BUILD_SHA`, which `/health` `revision` reports (Round 8.4B).
8. Re-checks `HEAD == sha` before `compose up`.
9. Normalises any other exit 75 to 70, so a failed build, migration, startup
   or health check can never look like a "superseded" skip.
10. Writes `deploy` to the ledger.

**Rollback and break glass.**

- `rollback.sh <full-sha>`:
  - takes the same lock;
  - accepts only a SHA that the ledger recorded as `deploy`, `rollback` or
    successful `break-glass`;
  - checks it out detached, refuses unclean build inputs, rebuilds, and
    ledgers the result.
- **The ledger starts empty, and nothing is inherited.** Round 2 showed that
  inheriting the previous HEAD could authorise a commit that never ran
  successfully. The first rollback after this change therefore needs break
  glass.
- Break glass (`MEMVID_BREAK_GLASS=1`) **requires `MEMVID_BREAK_GLASS_REASON`**.
  It writes `break-glass-attempt` (user, reason) before any change, then
  `break-glass` or `break-glass-failed`. Only a successful `break-glass` line
  makes a SHA eligible for rollback.
- The ledger is an audit aid, not a security boundary against the deploy user.

**Readiness check.** `scripts/deploy_preflight.sh` is read-only. Run it on
EC2 **before merging**; it can be streamed with `curl … | MEMVID_APP_DIR=…
bash`. It checks:

- `flock`, `curl`, `python3`, `git` and `docker compose`;
- the env file;
- write access to the lock and the ledger;
- a clean checkout with no ignored build inputs;
- that `api.github.com` is reachable.

It also warns when the ledger is empty.

**Render.** Both services change from `autoDeploy: true` to
`autoDeployTrigger: checksPass`. Render deploys only after every GitHub check
on the commit is `success`, `neutral` or `skipped`, and never deploys on a
failure or when there are zero checks. Sources:
https://render.com/docs/blueprint-spec and https://render.com/docs/deploys.

## Results

Run in WSL on 2026-11-02, after the round-3 fixes.

| # | Scenario | Expected | Observed | Result |
|---|---|---|---|---|
| A | CI(A) succeeds, `main` = A | Deploy A; ledger `deploy` | HEAD A; `compose up` called; `APP_BUILD_SHA=A`; ledgered | PASS |
| B | CI(A) succeeds, `main` advanced to an unverified B | A's run never deploys B | Gate `skip`. The remote wrapper gets exit 75 and restores the previous HEAD; no build or up | PASS |
| C | CI(B) failed, or provenance mismatch | Reject | Gate rejects a failed conclusion, a foreign repo or head repo, a PR event, a feature branch, another workflow, and a bad remote SHA | PASS |
| D/H | CI(B) succeeds; re-run | B deploys; re-run is idempotent | HEAD B; ledger `deploy`; second run OK | PASS |
| E | Out-of-order successful runs | An older run cannot overwrite a newer release | Gate `skip` or exit 75; the newer release stays | PASS |
| F | Wrong, invalid or missing SHA; missing CI evidence; API failure modes | Fail closed | Each of these exits 1 with no build: malformed, missing or unknown SHA; zero runs; `curl` failure; invalid JSON; missing count; string count. **The exact provenance query is asserted** | PASS |
| G | Rollback | Only ledgered SHAs; break glass with a reason otherwise | No-reason break glass refused; with a reason: attempt and success ledgered; then a normal rollback to that SHA is accepted | PASS |
| Races | `main` advances during build or migration; HEAD moves during build | No activation | Exit 75 before migration or activation; HEAD movement refused | PASS |
| 75 | Build, migration, up or health returns 75 | Visible failure, not "superseded" | Exit 70 (or 1 for health) | PASS |
| Inputs | Untracked `BE/` file; **git-ignored `BE/stale.so`** | Refused by deploy and rollback | Refused; no build | PASS |
| Lock | Another operation holds the lock | Deploy, rollback and the **remote wrapper** all refuse; the wrapper leaves HEAD untouched; a spoofed inherited fd is refused | As expected; no docker call | PASS |
| Break glass | Pinned without CI evidence; unpinned; failure | Reason required; attempt, success and failed lines | As expected | PASS |

**Mutation proof** (`scripts/tests/test_deploy_guard_mutations.sh`). Each run
removes one guard in a temporary copy and requires the full harness to fail.
**22 of 22 guards were detected:**

- the three current-main checks;
- the HEAD re-check;
- CI verification, and each query component: `head_sha`, `branch`, `event`,
  `status`, workflow path;
- exit-75 normalisation;
- the build-input refusal, including its `--ignored` part;
- the deploy lock, the inherited-fd check, the rollback lock, the wrapper lock
  and the wrapper restore;
- the rollback ledger check;
- the break-glass reason, attempt record and failure record.

The `head_sha` mutation is the one Codex2 used in round 2 to show the old
harness was blind.

**Static checks.**

- `action-validator` passes on `ci.yml` and `deploy.yml`.
- `yaml.safe_load` passes on CI, deploy and Render YAML.
- `bash -n` passes on all scripts, and `git diff --check` passes.
- ShellCheck runs in the new CI job when the runner has it.

## Known limits and human actions

- **Not run on a real EC2 host.** All tests use shims. Run
  `deploy_preflight.sh` on EC2 before merging, and watch the first deploy.
- GitHub's unauthenticated API rate limit (60 requests per hour per IP) is
  ample for deploys. If it is exhausted, or the repository becomes private,
  normal deploys stop (fail closed) until break glass is used or a read-only
  token is added. Adding a token is a secret change and is out of scope here.
- GitHub keeps at most one pending run per concurrency group. A replaced
  pending run can leave the newest verified commit waiting for the next CI
  success or a manual re-run. This affects liveness only, not safety.
- Render: a human must confirm the Blueprint sync, **"After CI Checks Pass"**
  on both services, and the workspace overlapping-deploy policy (Override if
  only the latest release may activate).
- A flaky required check now blocks both backend and frontend deploys. See
  `docs/AWS_DEPLOYMENT.md` "When CI is red" and the open decision in
  `residual-release-gates.md`.
- Runtime provenance needs **both** PRs. 8.4A exports `APP_BUILD_SHA`; 8.4B
  passes it into the container and serves it from `/health`.
