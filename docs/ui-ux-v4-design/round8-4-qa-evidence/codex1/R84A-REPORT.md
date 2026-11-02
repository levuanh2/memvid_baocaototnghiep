> **Read this first (added by Claude after review round 3).** This is Codex1's
> report as written after review round 2, kept as a historical record. The
> sections that describe ledger **inheritance** (an `inherited` entry seeded
> from the previous HEAD, and rollback to it without break glass) are
> **superseded**. Inheritance was removed in round 3; see "Round 3 fixes" at
> the end of this file and `../deployment-sha-pinning.md`. The current
> behaviour: the ledger trusts only what it recorded, and the first rollback
> after this change needs `MEMVID_BREAK_GLASS=1` plus
> `MEMVID_BREAK_GLASS_REASON`.

# Round 8.4A — deployment safety and protected-auth guard

## Changed files

- `.github/workflows/deploy.yml`: validates the completed CI run and remote
  main, then streams the verified `scripts/deploy_remote.sh` to EC2. Only a
  genuine supersession exit 75 becomes a successful skip.
- `.github/workflows/ci.yml`: runs the deploy harness and mutation proof,
  includes the job in `CI / required`, and gives protected Playwright an
  expectation independent from the backend auth switch.
- `scripts/deploy_gate.sh`: pure workflow-run provenance/current-main gate.
- `scripts/deploy_remote.sh`: shared production/test SSH-side checkout,
  previous-HEAD restore, and reserved-75 normalization.
- `scripts/deploy.sh`: independent GitHub CI verification, shared lock,
  current-main checks before build/migration/activation, clean build-context
  check, reserved-75 trap, break glass, ledger, and `APP_BUILD_SHA`.
- `scripts/rollback.sh`: shared lock, exact detached SHA, ledger authorization,
  break glass, successful rollback ledger entry, and `APP_BUILD_SHA`.
- `scripts/tests/test_deploy_pinning.sh`: no-network/no-Docker scenarios,
  controlled races/failures, ledger, lock, and real remote-wrapper coverage.
- `scripts/tests/test_deploy_guard_mutations.sh`: temporary-copy mutation
  proofs for eight safety guards.
- `FE/e2e/auth-protection.spec.js`, `FE/playwright.config.js`: independent
  protected/open expectation and inherited server environment.
- `render.yaml`: both services use `autoDeployTrigger: checksPass`; no other
  Blueprint line changed.
- `docs/AWS_DEPLOYMENT.md`, `.playbook/*`: operating, break-glass, ledger,
  lock, Render, runtime-revision, and residual-risk documentation.

The pre-existing untracked
`docs/ui-ux-v4-design/round8-4-qa-evidence/` directory belongs to another
track and was not touched.

## Pinning, skip, rollback, and provenance

The workflow gate rejects the wrong conclusion/event/branch/repository/head
repository/workflow path or malformed SHA. It skips before SSH if main already
advanced. Otherwise it streams the candidate commit's verified remote wrapper.
The wrapper records the server's previous HEAD, checks out the candidate
detached, and passes both SHAs to `deploy.sh`.

`deploy.sh` derives owner/repo from `origin` and queries GitHub's public
`ci.yml` runs API for a successful `push`/main run at exactly the pinned
SHA. Missing evidence, malformed JSON, or an unreachable API fails closed.
`MEMVID_BREAK_GLASS=1` is the sole human override for unverifiable pinned CI
or an unpinned deploy; every use logs operator/UTC time and is ledgered as
`break-glass`.

The script holds the shared non-blocking host lock, checks fresh
`origin/main == SHA` before build, again immediately before migration, and
again immediately before activation. Only these explicit supersession paths
set `SUPERSEDED=1` and exit 75. EXIT traps in both scripts convert any other
75 to failure 70. The wrapper restores the previous checkout only for genuine
75; other failures remain visible.

After pinning, tracked/untracked changes under `BE` or
`docker-compose.prod.yml` are refused even with `MEMVID_FORCE_RESET=1`.
Ignored files do not appear in `git status`; an ignored file not covered by
`BE/.dockerignore` remains the documented residual risk. No `git clean -x`
is used.

On the first successful pinned deploy with an empty/missing ledger, the wrapper
supplies the pre-deploy HEAD. If it is a valid full commit SHA, deploy records
`<utc> <previous> inherited` before `<utc> <new> deploy`. Rollback accepts
only exact full SHAs recorded as `inherited`, `deploy`, `rollback`, or
`break-glass`; an unrecorded SHA needs `MEMVID_BREAK_GLASS=1`. Successful
rollback records its exact detached HEAD. Deploy and rollback both export
`APP_BUILD_SHA`. Track B must consume it in Compose and expose `/health
revision`; both PRs are required for runtime provenance.

## Harness results

Command:

```text
bash scripts/tests/test_deploy_pinning.sh
```

Result: exit 0, all scenarios passed.

- A: current CI-verified A deployed; HEAD and `APP_BUILD_SHA` were A; Compose
  activation ran; ledger recorded success.
- B: after main advanced to B, late A returned genuine 75 through the real
  remote wrapper; previous B checkout was restored; no build or activation.
- C: failed CI and repo/head-repo/event/branch/path/remote-SHA mismatches were
  rejected by the pure gate.
- D: with an empty ledger and A checked out, remote deploy B recorded
  `A inherited` then `B deploy`.
- E: out-of-order A could not replace B.
- F: malformed, missing, unknown, and CI-unverified SHAs failed closed; missing
  SHA without break glass failed closed.
- G: immediate rollback to inherited A succeeded without break glass; an older
  never-recorded SHA was refused. Later recorded/unrecorded/break-glass ledger
  paths also behaved as specified.
- H: repeating the same pinned B deploy succeeded idempotently.
- Main advanced during build: exit 75 before migration; no activation; wrapper
  restored previous HEAD.
- Main advanced during migration: exit 75 before activation; no `compose up`.
- Local HEAD moved during build: failed; no activation.
- Build, migration, up, and health returning 75: all workflow-visible failures,
  never a superseded skip.
- Untracked file under `BE`: refused before build even with force-reset.
- Concurrent lock holder: second operation failed fast.
- CI API total_count=0: refused; pinned/unpinned break-glass paths warned,
  succeeded, and recorded `break-glass`.

## Mutation proof

Command:

```text
bash scripts/tests/test_deploy_guard_mutations.sh
```

Each case copied the relevant repository files under a fresh temporary
directory outside the worktree, removed exactly one guard, and ran the complete
harness against that copy.

| Removed guard | Harness result |
|---|---|
| current-main check before build | FAIL, exit 1 |
| current-main check before migration | FAIL, exit 1 |
| current-main check before activation | FAIL, exit 1 |
| local HEAD re-check | FAIL, exit 1 |
| independent CI verification | FAIL, exit 1 |
| exit-75 normalization | FAIL, exit 1 |
| untracked build-input refusal | FAIL, exit 1 |
| shared deploy/rollback lock | FAIL, exit 1 |

Mutation-suite result: exit 0; all eight removed guards were detected.

## Protected-auth browser guard

Both runs used only the local test database and assigned ports, with workers=1:
`postgresql://postgres:postgres@localhost:55432/studymap_test`, backend 8180,
frontend 4273. The heavy lock contained `codex1` and was removed after both
owned servers stopped.

- Open: `AUTH_PROTECT_APP_APIS=false
  E2E_EXPECT_PROTECTED_AUTH=false npx playwright test
  e2e/auth-protection.spec.js --workers=1` — 1 passed; unauthenticated 200,
  registered bearer token 200.
- Protected: `AUTH_PROTECT_APP_APIS=true
  E2E_EXPECT_PROTECTED_AUTH=true` with the same command — 1 passed;
  unauthenticated 401, registered bearer token 200.

The CI protected step sets both variables. The spec uses
`E2E_EXPECT_PROTECTED_AUTH` when present and falls back to the server switch
only for local convenience, so a removed/misspelled server flag cannot silently
turn the protected CI assertion into open mode.

## Render behavior and human follow-up

Render does not pin a workflow-run SHA. Both services deploy the newest main
commit whose detected checks passed, which still enforces “only CI-passed
commits deploy.” Render counts `success`, `neutral`, and `skipped` as
passing; a failure or zero checks blocks. Path-filtered PR jobs are documented,
and `CI / required` aggregates the active required jobs.

After merge, a human must confirm that Blueprint sync applied and both
`studymap-web` and `studymap-api` show **After CI Checks Pass**. A human must
also verify the workspace overlapping-deploy policy; select **Override** if
latest-only activation is required. These live Render settings cannot be
verified from this worktree.

## Static validation

- `npx --yes @action-validator/cli .github/workflows/ci.yml` — exit 0.
- `npx --yes @action-validator/cli .github/workflows/deploy.yml` — exit 0.
- `yaml.safe_load` for CI, deploy, and Render YAML — 3 passed.
- `bash -n` for all 14 scripts — passed after normalizing Windows checkout
  CRLF as the Linux checkout does.
- `npx eslint e2e/auth-protection.spec.js playwright.config.js` — passed.
- `git diff --check` — passed.

No commit, push, PR, SSH, real deployment, production request, or GitHub-secret
operation was performed.

## Round 3 fixes (Claude; Codex1 ran out of usage) — answering Codex2 round-2 BLOCK

Author disclosure: the changes below were written by Claude, the coordinator,
so they still need Codex2's independent re-review.

| Round-2 finding | Fix | Proof |
|---|---|---|
| HIGH: the remote wrapper moved the checkout before taking the lock | `deploy_remote.sh` takes `flock` on `$MEMVID_LOCK_FILE` before reading HEAD, fetching or checking out, and holds it (fd 9) through `deploy.sh` and any restore. `deploy.sh` reuses that descriptor via `MEMVID_LOCK_INHERITED=1`. It accepts the descriptor only if `/proc/$$/fd/9` resolves to the lock file, and still requires `flock -n 9` (`_lib.sh acquire_deploy_lock`) | Harness: with the lock held, deploy, rollback and the remote wrapper are all refused. The wrapper leaves HEAD untouched and runs no docker call. A spoofed inherited fd is refused. Mutations `wrapper-lock`, `rollback-lock`, `inherited-fd-check` and `wrapper-restore` are detected |
| HIGH: ignored files reached the image | `refuse_unclean_build_inputs` (`git status --porcelain --untracked-files=all --ignored -- BE docker-compose.prod.yml`) runs in the pinned deploy, the break-glass unpinned deploy and rollback, before any build | Harness: an ignored `BE/stale.so` is refused by both deploy and rollback, with no build. Mutation `ignored-build-inputs` is detected |
| HIGH: inheriting from an empty ledger could authorize a release that never ran | Inheritance is removed completely. The ledger trusts only what it recorded. The first rollback after this change needs break glass. A future bootstrap can compare `/health` `revision` (Track B) | Harness D/G/H: no `inherited` line, A absent, rollback to A refused without break glass. Mutation `rollback-ledger-check` is detected |
| MEDIUM: the CI-query harness did not prove the query | The curl shim models GitHub: count 1 only for the exact query (`ci.yml`, `head_sha`, `main`, `push`, `success`) of a SHA with green CI. Modes `curl-fail`, `bad-json`, `no-count` and `string-count` are added. The exact URL is asserted | Mutations removing each query component (`ci-query-head-sha`, `-branch`, `-event`, `-status`, `-workflow`) are all detected. Every failure mode fails closed |
| MEDIUM: the ledger was not an audit record | Break glass requires `MEMVID_BREAK_GLASS_REASON`. A `break-glass-attempt` line (user, reason) is written before any change, then `break-glass` or `break-glass-failed`. Attempt and failed lines are never rollback-eligible. The docs state the ledger is an audit aid, not a boundary against the deploy user | Harness asserts no-reason refusal and the attempt, success and failed lines. Mutations `break-glass-reason`, `break-glass-attempt-record` and `break-glass-failure-record` are detected |
| MEDIUM: CI verification fragile under rate limits | Fail-closed behaviour is kept. A failed API call now logs the URL and states that it may be a network error, an HTTP error or the unauthenticated rate limit. Using a GitHub App or token is deferred (no secret changes allowed in this round) | Documented |
| MEDIUM: preflight could say READY with unsafe state | Preflight now includes ignored files in the build-input check. An empty ledger prints a `WARN` that rollback needs break glass and a reason | Dry-run in WSL |
| LOW: `APP_BUILD_SHA` consumption | Unchanged here. Track B wires `docker-compose.prod.yml` and `/health` `revision`. Both PRs are required for runtime provenance | — |

Re-run in WSL, which has real `flock`, on 2026-11-02:

- `bash scripts/tests/test_deploy_pinning.sh`: all 13 scenario groups PASS.
- `bash scripts/tests/test_deploy_guard_mutations.sh`: **22/22 removed guards
  were detected**.
- `bash -n` passes on all scripts; `git diff --check` passes.

The harness needs `flock` and `/proc`, so it runs on Linux (CI, EC2) or WSL.
It does not run under Git Bash on Windows.
