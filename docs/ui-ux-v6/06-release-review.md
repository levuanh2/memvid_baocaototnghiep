# V6 release review (2026-11-16) — for the owner, not a release approval

Status: **READY FOR OWNER REVIEW** for the 28 Draft pull requests #159-#186, once every head
named here has a green required check (section 7). **Not** ready for production release:
the GO/NO-GO list in section 9 has open NO-GO items. Nothing is merged, deployed or marked
Ready. `main` is `db005ab`.

## 1. #185 migration safety (changed after trial 8)

Problem: `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS`. An interrupted concurrent build
leaves `uq_quiz_attempts_user_submit_key` INVALID; `IF NOT EXISTS` checks only the name, so a
rerun stamped the revision while one-key-per-learner was not enforced. A wrong hand-made
index with that name passed the same way, and nothing looked again once Alembic was at head.

Fix (#185 `0f5fce0`, replacing the auto-DROP of `2bb0c48`):
- Migration: builds the index only when absent, keeps `CONCURRENTLY`, then proves it from
  `pg_index` (`BE/shared/db_schema_checks.py`: schema and table, `indisvalid`, `indisready`,
  `indisunique`, btree, columns `(user_id, submit_key)` without expressions, predicate
  `submit_key IS NOT NULL`). Any problem raises, so the revision is not stamped. An existing
  index is never dropped, rebuilt or reindexed.
- `python -m scripts.verify_db_schema --moi-truong production`: read-only (`SET TRANSACTION
  READ ONLY`), same target rules as `run_migrations` (shared `xac_dinh_dich`), exit 0 / 2
  target refused / 3 schema problem / 4 unreachable. It runs every deploy, so it also catches
  an index dropped after the revision was stamped.
- Recovery: `docs/RUNBOOK_SUBMIT_KEY_INDEX.md` (read state, decide, manual approved
  `DROP INDEX CONCURRENTLY` / rebuild, verify, resume). No downgrade.

Evidence:
- Red first: `ee152c3` added only the tests; CI on PostgreSQL 16 failed 10 of them against
  the `2bb0c48` logic (success reported on 1 interrupted and 4 wrong-definition indexes, an
  existing index dropped and rebuilt, no verifier). Log:
  `studymap-qa-execution/v6/results/185-migration-red-ee152c3.log`.
- Green: `0f5fce0`: `CI / required` success (run 43811959733); Backend Integration on PostgreSQL 16: 3025 passed, 8 skipped, 0 failed, all 10 migration tests passed.
- Faults are real, no catalog edits: a writer holding `quiz_attempts` past `lock_timeout`
  interrupts the build; a duplicate key breaks it; four hand-made definitions; a drop at head.
- Deploy harness (WSL, no Docker): `test_deploy_pinning.sh` asserts migration, verification,
  activation in that order, and that a failed verification exits non-zero, never runs
  `compose up`, never downgrades; `test_deploy_guard_mutations.sh` fails when the step is
  removed or its `die` becomes `echo`.

## 2. Deploy gate

`scripts/deploy.sh` step 5b, after `scripts.run_migrations` and before `compose up -d`. On
failure: `die` (exit 1), the running backend is left as is (nothing stops or recreates it
before step 6), the message names the runbook, no rollback or downgrade runs.

Known limits (from `task21-codex-deploy-gate.md`): if the post-activation health check fails,
nothing rolls the backend back automatically (`scripts/rollback.sh` is manual and never runs
Alembic). The database is already migrated when step 5b fails, so every migration must keep
working with the previous backend; #183/#185's are additive and nullable.

## 3. What a merge to `main` deploys today (read-only analysis)

- CI on `main` -> `.github/workflows/deploy.yml` (`workflow_run`, success, push, `main`) ->
  EC2 backend via `deploy_remote.sh`/`deploy.sh`. Environment `production` is attached, but
  **it has no protection rules** (`gh api …/environments/production`: `protection_rules: []`,
  read 2026-11-16). A merge deploys the backend with no human step.
- Render `studymap-web` (`render.yaml`, `autoDeployTrigger: checksPass`) publishes the
  frontend independently. There is **no ordering** between Render and EC2.
- Consequence for the planned order (migration -> verification -> backend -> frontend): only
  the first three are ordered (inside `deploy.sh`); the frontend can land first. For #185 that
  is safe: the old backend reads only `answers` and ignores `idempotency_key` (verified on
  `main`), so a new frontend on an old backend behaves as today.

Proposal (not applied; owner action in GitHub/Render settings):
1. Before any merge: add required reviewers to the `production` environment (smallest,
   reversible, no repository change; keeps all current SHA/CI checks).
2. If the frontend must wait too: set Render `studymap-web` auto-deploy to off (or manual)
   for the release window, and deploy it after the backend is verified.
3. Alternatives with trade-offs: `workflow_dispatch`-only deploy (needs the SHA/CI checks
   re-plumbed), or a repository variable kill switch (global, easy to forget).

## 4. Release plan, step by step (owner runs it; nothing here is automated by this review)

| Step | Action | Check before going on | If it fails |
|---|---|---|---|
| 0 | Configure the `production` reviewers (and Render manual, if wanted). Confirm on EC2 that `AUTH_PROTECT_APP_APIS=true` (section 8 C). Take a database backup (`scripts/backup.sh` or the provider snapshot). | Protection visible in GitHub; backup exists | Stop |
| 1 | Merge in the order of `04-integration-checklist.md`; #170 first. Each merge waits for its green `main` CI. | `CI / required` green on `main` | Revert the merge commit (no deploy happens without approval) |
| 2 | Approve the backend deploy of the `main` SHA that contains #183 + #185. `deploy.sh` runs migration (step 5) and verification (5b). | Log shows `[verify-db] … valid, ready, unique`; `alembic_version` = `20261115_attempt_submit_key` | Deploy stops, old backend keeps serving. Follow the runbook; do **not** downgrade |
| 3 | Backend activation and health (steps 6-7). | Health OK; `POST /api/practice/<id>/submit` twice with one key returns one attempt (staging or a test account) | `scripts/rollback.sh <previous ledgered SHA>` (code only; schema stays, it is backward compatible) |
| 4 | Frontend: let Render publish (or trigger it manually). | Library, chat, quiz, practice pages load; `Idempotency-Key` retry visible in the network panel | Roll back the Render deploy to the previous build |
| 5 | Post-deploy: rerun `scripts.verify_db_schema`; watch errors for 24 h; check no new attempts stuck in `submitted`. | Exit 0; no 5xx spike | Same as step 3/4 |

Never part of rollback: `scripts.run_migrations --go-lui` (drops the key columns and the
stored keys).

## 5. Integrations and test results

| Tree | What | Result |
|---|---|---|
| Trial 8 `d1ed4a3` / `8ca03e042ccf` | all 28 heads of 2026-11-16 morning (#185 at `06a65f8`) | Vitest 2095/2095 (+ seed 61201), build, lint 63/67, Fixture Smoke 333 passed / 6 skipped of 339, full audit 686 passed / 5 skipped of 691, 0 failed, 0 flaky; backend 3008 passed, 6 failures also on `main`. Chromium only |
| Trial 9 `64e701b` / `b97da2793ae6` | trial 8 + #185 `0f5fce0` | Merge: code clean, `.playbook` append conflicts only. `FE/` subtree hash `1c07e765902c` **identical** to trial 8, so the frontend test inputs are byte-identical; they were not re-run. Deploy harness on this tree: 38 PASS incl. mutations. `BE/` (`a6cae7ebff23`) and `scripts/` (`171d3be99334`) are **identical** to #185 `0f5fce0`, whose CI ran the backend suite on PostgreSQL (3025 passed) and the deploy tests. Only `.github` differs from #185 (the smoke list of #170). Every subtree was therefore tested with exactly this content, but **not as one combined run**: the backend suite was not run on this tree locally (no local PostgreSQL; Docker Desktop is off) |

No other open V6 pull request changes `BE/`, `scripts/` or the deploy workflow (`#170` only
changes the smoke list in `ci.yml`). No pull request is stacked on #185.

## 6. Pull request heads

All 28 are Draft. Heads unchanged since trial 8 except #159 (documentation) and #185
(`0f5fce0`). The table in `README.md` lists every head.

## 7. CI on the changed heads

| PR | Head | `CI / required` |
|---|---|---|
| #185 | `0f5fce0` | **success** (run 43811959733, incl. Backend Integration Suite & Migrations and Deploy script tests) |
| #159 | this commit | documentation only |

## 8. Backend risks still open (not fixed by #185; details `task22-agy-backend-risks.md`)

| | Risk | Priority | Blocks #183/#185? | Proposal | Tests needed |
|---|---|---|---|---|---|
| A | Diagnostic grading has no claim: sync and background callers use `grade_attempt(once=False)`; a duplicated job grades twice and runs mastery twice | P2 | No | pass `once=True`; lease on diagnostic attempts as for practice | two graders behind a barrier: one save, one mastery run |
| B | A diagnostic attempt stays `submitted` forever after a crash or grading error (a retry gets 409) | P1 | No (pre-existing) | retry path for `submitted` without score; maintenance sweeper re-enqueues stale ones | crash after submit, retry reaches `graded` |
| C | Open mode (`AUTH_PROTECT_APP_APIS` off) shares one anonymous owner: attempts, keys, progress shared between visitors | P2 with auth on; **P0 if production runs open** | No, but production must run with auth on | per-client anonymous identity, or auth required | two anonymous clients isolated |
| D | Idempotency covers only `POST /api/practice/<id>/submit`; generic attempt routes accept a practice quiz | P2 | No | `open_attempt` accepts only diagnostic quizzes | practice quiz on the generic route -> 404, no row |

The repository does not pin `AUTH_PROTECT_APP_APIS` for production (`.env.example` says
`false`; `docker-compose.prod.yml` and `validate-env.sh` do not mention it). Its real value
lives on EC2 and was not read.

## 9. GO/NO-GO checklist for the owner

| # | Item | State |
|---|---|---|
| 1 | Every head green on `CI / required` | GO: 28/28 (#185 on `0f5fce0`, #159 on its docs head) |
| 2 | Trial integration fully tested on the exact tree to merge | **open**: trial 9 is tested per subtree (identical hashes), not as one combined run; run its backend suite once Docker is available |
| 3 | `production` environment requires a reviewer | **NO-GO**: no protection rules today |
| 4 | Render frontend auto-deploy decision taken (on, or manual for the window) | open |
| 5 | `AUTH_PROTECT_APP_APIS=true` confirmed on EC2 | open (risk C becomes P0 otherwise) |
| 6 | Backup taken before the migration | open |
| 7 | Runbook read; who approves a manual index repair is named | open |
| 8 | Real-device, Firefox, WebKit, screen reader checks | not done; accept the risk or run them |
| 9 | Risks A, B, D accepted for this release (not regressions) | open |
| 10 | Pre-existing backend failures (`test_index_khoa_that.py` x5, `test_fpt_rerank.py` x1) accepted; they fail on `main` too | open |
