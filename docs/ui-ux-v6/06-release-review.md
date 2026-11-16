# V6 release review (2026-11-16) — for the owner, not a release approval

Status: **READY FOR OWNER REVIEW** for the 28 Draft pull requests #159-#186, once every head
named here has a green required check (section 7). **Not** ready for production release:
the GO/NO-GO list in section 9 has open NO-GO items (3 production reviewers, 4 Render manual deploy, 6 database backup), each an owner action in a production setting (section 11). Nothing is merged, deployed or marked
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
  frontend independently. There is **no ordering** between Render and EC2. GitHub records
  both for the last `main` push: deployments `production` and `main - studymap-web`, both
  `db005ab`, both 2026-11-11T08:16:57Z. The Render dashboard value of Auto-Deploy was not
  read (the Render API needs a workspace choice that is the owner's); the repository says
  `checksPass`, and the deployment record matches it.
- All three GitHub environments (`production`, `main - studymap-web`,
  `main - studymap-api`) have `protection_rules: []` and `can_admins_bypass: true`
  (read 2026-11-16).
- Consequence for the planned order (migration -> verification -> backend -> frontend): only
  the first three are ordered (inside `deploy.sh`); the frontend can land first. For #185 that
  is safe: the old backend reads only `answers` and ignores `idempotency_key` (verified on
  `main`), so a new frontend on an old backend behaves as today.

Proposal (not applied; owner action in GitHub/Render settings). The owner agreed to A and B
in principle; each still needs its own go-ahead before anyone changes a setting.

A. GitHub environment `production` (Settings > Environments > production):
   - Required reviewers: the owner. The job `Deploy backend to EC2` then waits in
     "Waiting" until approved; `deploy.yml` needs no change, the SHA/CI checks stay.
   - "Prevent self-review": only once a second, independent reviewer exists. With one
     owner who also merges, turning it on would block every deploy.
   - "Allow administrators to bypass" is on today. Turn it off if the rule must hold for
     the owner too; leave it on only as a documented emergency path.
   - Check what is waiting: Actions > the `Deploy` run shows "Review deployments", or
     `gh api repos/levuanh2/memvid_baocaototnghiep/actions/runs?status=waiting`.
     After approval, `gh run watch <run-id>`.
B. Render `studymap-web`: Settings > Build & Deploy > Auto-Deploy = Off before the first V6
   merge. Deploy by hand after the backend step is verified: "Manual Deploy > Deploy a
   specific commit" with the exact `main` SHA that EC2 runs (`curl -s
   https://api.studymap.space/health` or the deploy log), never "latest commit" on a moving
   `main`. Rollback: "Rollback" on the previous deploy in the same page. Turn Auto-Deploy back
   on (or keep manual) after the window; `render.yaml` still says `checksPass` and a Blueprint
   sync may set it back, so re-check after any Blueprint sync.
C. Alternatives with trade-offs: `workflow_dispatch`-only deploy (needs the SHA/CI checks
   re-plumbed), or a repository variable kill switch (global, easy to forget).

## 4. Release plan, step by step (owner runs it; nothing here is automated by this review)

| Step | Action | Check before going on | If it fails |
|---|---|---|---|
| 0 | Configure the `production` reviewers and Render manual deploy (section 3 A, B). Database backup of the Supabase PostgreSQL (section 4a); `scripts/backup.sh` only archives `/opt/memvid/data` on EC2 and does **not** contain the database. Confirm the port the migration uses (section 4a). | Protection visible in GitHub; a backup that was restored once into a disposable database | Stop |
| 1 | Merge in the order of `04-integration-checklist.md`; #170 first. Each merge waits for its green `main` CI. | `CI / required` green on `main` | Revert the merge commit (no deploy happens without approval) |
| 2 | Approve the backend deploy of the `main` SHA that contains #183 + #185. `deploy.sh` runs migration (step 5) and verification (5b). | Log shows `[verify-db] … valid, ready, unique`; `alembic_version` = `20261115_attempt_submit_key` | Deploy stops, old backend keeps serving. Follow the runbook; do **not** downgrade |
| 3 | Backend activation and health (steps 6-7). | Health OK; `POST /api/practice/<id>/submit` twice with one key returns one attempt (staging or a test account) | `scripts/rollback.sh <previous ledgered SHA>` (code only; schema stays, it is backward compatible) |
| 4 | Frontend: let Render publish (or trigger it manually). | Library, chat, quiz, practice pages load; `Idempotency-Key` retry visible in the network panel | Roll back the Render deploy to the previous build |
| 5 | Post-deploy: rerun `scripts.verify_db_schema`; watch errors for 24 h; check no new attempts stuck in `submitted`. | Exit 0; no 5xx spike | Same as step 3/4 |

Never part of rollback: `scripts.run_migrations --go-lui` (drops the key columns and the
stored keys).

## 4a. Backup, rollback and connection: what is and is not ready

- Database backup: **not proven.** Business data is in Supabase PostgreSQL
  (`docs/deployment/database-boundary.md`); `scripts/backup.sh` says so itself and archives
  only `/opt/memvid/data` (index, sqlite, checkpoints, uploads). Whether the Supabase plan
  keeps restorable daily backups or PITR was not read (hosted database and dashboard are out
  of bounds for this review). Owner action: take a `pg_dump -Fc` (or confirm a Supabase
  backup) right before step 2, and restore it once into a disposable local PostgreSQL to
  prove it opens. Same for `/opt/memvid/data` with `scripts/backup.sh` + `scripts/restore.sh`.
- Code rollback: `scripts/rollback.sh <sha>` redeploys a previously ledgered SHA; the ledger
  starts empty, so until a pinned deploy is recorded on EC2 every rollback is a break-glass
  rollback (`MEMVID_BREAK_GLASS=1` + reason). It never runs Alembic. Whether the EC2 ledger
  has `db005ab` was not read.
- Database rollback: none automatic, by design. #183/#185 add nullable columns and one
  partial index; the previous backend ignores them, so code rollback alone is safe. A
  downgrade drops the stored keys: not a rollback option.
- Production server: PostgreSQL 17.6 on Supabase (`database-boundary.md`); CI and every local
  run here use PostgreSQL 16. The catalog fields the check reads (`pg_index.indisvalid`,
  `indisready`, `indisunique`, `indkey`, `indexprs`, `indpred`, `pg_am.amname`) exist with
  the same meaning in 17, but the failure-injection tests were not run on 17.
- Connection the migration uses: `deploy.sh` runs it with the EC2 `DATABASE_URL`. A note in
  `BE/shared/migration_guard.py` says production runs on 6543 (Supavisor transaction
  pooler); `BE/alembic/env.py` asks for the session pooler (5432) or a direct connection.
  `CREATE INDEX CONCURRENTLY` in an autocommit block is one statement and should pass a
  transaction pooler, but this was never exercised. If it fails or is cut, the index stays
  INVALID, the migration and step 5b stop the deploy, and the old backend keeps serving
  (tested). Owner action: confirm the port on EC2 (print only host and port, never the URL)
  and prefer 5432 or direct for this release.

## 4b. Migration safety audit (2026-11-16, read-only) and one test-harness finding

Each rule checked against the code on #185 `0f5fce0` and a test that fails if it breaks:

| Rule | Where | Test |
|---|---|---|
| INVALID index detected | `db_schema_checks.submit_key_index_problems` (`indisvalid`, `indisready`) | interrupted build (real `lock_timeout`), duplicate key |
| Wrong structure refused | same function: unique, btree, columns and order, no expressions, predicate | 4 hand-made indexes |
| Missing at head detected | `scripts.verify_db_schema`, every deploy | drop at head: migration exit 0, verifier exit 3 |
| New backend not started on failure | `deploy.sh` step 5b `die` before `compose up` | `test_deploy_pinning.sh`, 2 mutations |
| No automatic DROP/REINDEX on upgrade or verify | migration builds only when absent; verifier `READ ONLY`, no DDL in source | same OID before and after; `test_the_verifier_never_writes` |
| Downgrade not a rollback | runbook + this review; `downgrade()` drops columns and index | (documented, explicit command only) |
| Recovery never automatic | runbook steps 3a/3b/4 are manual SQL; no code path runs them | search of `BE/` and `scripts/` outside `tests/`: the only `DROP INDEX`/`REINDEX` is in `downgrade()` (line 57) |

Finding (test harness, Windows only; not a product defect): `_run` in
`BE/tests/test_attempt_submit_key_migration.py` calls `subprocess.run(text=True)` without an
encoding. On a cp1252 console the child prints Vietnamese, the parent's reader thread dies
with `UnicodeDecodeError`, `stdout` is `None`, and `result.stdout + result.stderr` raises
`TypeError` (reproduced alone: `stdout None: True`). Six tests fail that way; the runbook test
dies before its repair steps and leaves duplicate keys, the `db` fixture cannot rebuild the
index, and two later tests fail on the INVALID index it leaves (one because the migration
correctly refused it). CI (Linux, UTF-8) is not affected; with `PYTHONUTF8=1` all pass.
Proposed fix, not applied (it would move #185's head during review): pass
`encoding="utf-8", errors="replace"` and `PYTHONUTF8=1` in `_run`, and make the fixture clear
duplicate keys before rebuilding. Owner decides whether it goes into #185 now or after.

## 5. Integrations and test results

| Tree | What | Result |
|---|---|---|
| Trial 8 `d1ed4a3` / `8ca03e042ccf` | all 28 heads of 2026-11-16 morning (#185 at `06a65f8`) | Vitest 2095/2095 (+ seed 61201), build, lint 63/67, Fixture Smoke 333 passed / 6 skipped of 339, full audit 686 passed / 5 skipped of 691, 0 failed, 0 flaky; backend 3008 passed, 6 failures also on `main`. Chromium only |
| Trial 9 `64e701b` / `b97da2793ae6` | trial 8 + #185 `0f5fce0` | Merge: code clean, `.playbook` append conflicts only. `FE/` subtree hash `1c07e765902c` **identical** to trial 8, so the frontend test inputs are byte-identical; they were not re-run. Deploy harness on this tree: 38 PASS incl. mutations. `BE/` (`a6cae7ebff23`) and `scripts/` (`171d3be99334`) are **identical** to #185 `0f5fce0`, whose CI ran the backend suite on PostgreSQL (3025 passed) and the deploy tests. Only `.github` differs from #185 (the smoke list of #170). **Backend on this tree** (disposable PostgreSQL 16.15, 2026-11-16): migration to `20261115_attempt_submit_key` and rerun at head exit 0; `verify_db_schema` exit 0 before and after the suites; full suite 3018 passed, 9 skipped, 6 failed = the 6 that fail on `main`; migration, idempotency and concurrency files run alone: 144 passed, 0 failed (submit-key migration 10/10). A first run on a cp1252 console had 8 more failures, all from one Windows-only test-harness defect (section 4b), none from product code |

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
`false`; `docker-compose.prod.yml` and `validate-env.sh` do not mention it). The EC2 file was
not read. Behaviour was checked instead, without credentials: `GET
https://api.studymap.space/api/documents` and `/api/study-maps/x` with no token return
`401 {"error":"unauthorized"}` (2026-11-16). `GET /api/documents` can only answer 401
through `_require_app_user`, which returns no error at all when the flag is off
(`BE/app/main.py`, `api_documents_list`). So production runs with auth on and C is P2 there. It becomes P0 again if the
flag is ever turned off; `validate-env.sh` does not stop that (proposal: make it required in
production).

Severity by real use:
- A (P2): needs two graders on the same diagnostic attempt (a duplicated job or a retry
  racing the sync path). Effect: mastery counted twice for one attempt. Not a data loss.
- B (P1): any crash or grading error between submit and grade leaves the attempt stuck;
  the learner cannot retry it (409). Pre-existing on `main`; V6 does not make it more likely.
- C (P2 in production, verified above).
- D (P2): the generic routes are reachable by a signed-in learner only (auth on); the worst
  case is a practice quiz graded without the idempotency key, i.e. today's behaviour.
- Pre-existing backend failures (6), local Windows only: `test_index_khoa_that.py` x5
  (`KhongLayDuocKhoa`: the index file lock is not acquired in time) and `test_fpt_rerank.py`
  x1 (`torchvision::nms does not exist`, a local torch/torchvision mismatch). Same 6 on
  `main`; CI on Linux passes them (0 failed on #185 `0f5fce0`). Environment, not V6.
- Firefox, WebKit, real devices, screen readers: not tested on any V6 branch. Unknown, not
  low: the V6 changes are mostly layout and focus handling, which is where engines differ.

## 9. GO/NO-GO checklist for the owner

| # | Item | State |
|---|---|---|
| 1 | Every head green on `CI / required` | GO: 28/28, re-read 2026-11-16 (#185 `0f5fce0`, #159 its docs head) |
| 2 | Trial integration tested on the exact tree to merge | GO: trial 9 `64e701b` frontend (identical to trial 8) and backend (combined run, section 5); differs from the heads only by #159 docs |
| 3 | `production` environment requires a reviewer | **NO-GO** until the owner sets it (section 3 A); approved in principle |
| 4 | Render `studymap-web` Auto-Deploy Off for the window | **NO-GO** until the owner sets it (section 3 B); approved in principle |
| 5 | Auth on in production | GO: 401 without token on two protected routes (section 8); the env file itself not read |
| 6 | Database backup taken and restored once | **NO-GO**: not done; `scripts/backup.sh` does not cover the database (section 4a) |
| 7 | Migration connection port confirmed (5432 or direct preferred) | open (section 4a) |
| 8 | Runbook read; who approves a manual index repair is named | open |
| 9 | Real-device, Firefox, WebKit, screen reader checks | not done; accept the risk or run them |
| 10 | Risks A, B, D accepted for this release (not regressions; B is P1) | open |
| 11 | 6 pre-existing local backend failures accepted (environment, pass in CI) | open |
| 12 | Windows test-harness fix (section 4b): now in #185, or later | owner choice; does not block |

## 10. Merge order for the owner (`04-integration-checklist.md`, with #183/#185 moved last)

The checklist allows #183/#185 anywhere in its step 6 once the deploy is planned; here they
go last so the only backend change is deployed alone. After #159-#165 are on `main`, do
the checklist's step 7 (smoke specs `WHEN_PRESENT` -> `REQUIRED`).

Only after items 3, 4 and 6 are GO. Each merge waits for green `CI / required` on `main`;
with item 3 in place, each backend deploy also waits for the owner's approval.

1. #170. 2. #160 -> #161. 3. #164 -> #165. 4. #167. 5. #166, #171, #172 -> #173 -> #176 -> #186.
6. #162, #163, #168, #169, #159, #181; #174 -> #177 -> #178 -> #180 -> #184; #175 -> #179 -> #182.
   Every merge to `main` triggers a backend deploy request even when only `FE/` changed;
   with item 3 each waits for approval (the backend code is unchanged until step 7).
   `deploy.yml` uses `concurrency: production-deployment`, `cancel-in-progress: false`: a
   run left waiting can hold the group, and GitHub keeps only the newest pending run. So
   approve or reject each request; do not leave one waiting.
7. Last, in its own window: #183 -> #185. Reject the deploy for the #183-only SHA;
   approve the one for the #185 merge SHA and follow
   section 4 steps 2-5; publish the frontend by hand (section 3 B) only after step 3 passes.
Stacked pull requests carry their bases' commits; merge the base first.

## 11. Production actions that each need a separate owner go-ahead

None of these was done in this review.
- GitHub: required reviewers on `production`; admin bypass on or off.
- Render: Auto-Deploy Off; each manual deploy by SHA; turning it back on.
- Supabase: `pg_dump` or backup confirmation; reading the plan's backup settings.
- EC2: reading `DATABASE_URL` host and port and `AUTH_PROTECT_APP_APIS` (no secret printed);
  `scripts/backup.sh`; checking the deploy ledger for `db005ab`.
- Each merge to `main`, and each deploy approval.
- Any manual index repair from `docs/RUNBOOK_SUBMIT_KEY_INDEX.md`.
