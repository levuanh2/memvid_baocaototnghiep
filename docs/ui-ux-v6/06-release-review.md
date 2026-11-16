# V6 release review (2026-11-16) — for the owner, not a release approval

Status: **READY FOR OWNER REVIEW** for the 28 Draft pull requests #159-#186, once every head
named here has a green required check (section 7). Production: **NO-GO** until the three
blocking items of section 9 (production reviewer, Render manual deploy, database backup
restored once) are GO with the evidence that section asks for; each is an owner action in a
production setting (section 11). Nothing is merged, deployed or marked Ready. `main` is
`db005ab`.

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
| 0 | Configure the `production` reviewers and Render manual deploy (section 3 A, B). Database backup and restore test (section 4c), plus Storage and `/opt/memvid/data` (section 4d); `scripts/backup.sh` only archives `/opt/memvid/data` on EC2 and does **not** contain the database. Confirm the port the migration uses (section 4a). | Protection visible in GitHub; a backup that was restored once into a disposable database | Stop |
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
  of bounds for this review). Owner action: the dump and restore test of section 4c right
  before step 2; uploaded files and `/opt/memvid/data` are separate (section 4d).
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

Each rule checked against the code on #185 `0f5fce0` (product code unchanged in `5e18271`) and a test that fails if it breaks:

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
**Fixed in #185 `5e18271`** (owner decision 2026-11-16; tests and `.playbook` only, no change
to the migration, the verifier or the Idempotency-Key logic): `_run` passes
`encoding="utf-8", errors="replace"` (the pattern already in
`test_production_migration_contract.py`) and `PYTHONUTF8=1`; the `db` fixture teardown,
which pytest runs after a failed test too, resets `lock_timeout` and clears duplicate keys
(test database only) before rebuilding the index. Evidence on a cp1252 console without
`PYTHONUTF8`, disposable PostgreSQL 16 (logs `studymap-qa-execution/v6/results/185-harness/`):
- before, `0f5fce0`: the file alone 6 failed, 4 passed, 1 error;
- after: the ten migration/idempotency/concurrency files and `test_guided_postgres_store.py`
  155 passed, 0 failed; verifier valid afterwards;
- the runbook test forced to fail right after it creates duplicate keys, followed by the two
  tests that cascaded in trial 9: old fixture -> teardown ERROR and
  `test_one_key_on_two_quizzes_at_once...` fails; new fixture -> no teardown error, both
  pass, verifier valid.

## 4c. Database backup and restore test (owner runs it; nothing here was run against the hosted database)

Goal: a dump of the production PostgreSQL taken right before step 2, and proof that it opens
in a disposable database with the same schema, tables, row counts and Alembic revision. A
restore that printed errors is **not** a pass, even if most tables arrived.

What it contains: everything in schema `public` (section 4d): accounts with password hashes,
documents, quizzes, learners' attempts, answers, scores, mastery and review plans. Treat the
file as learners' personal data.

**Before you start**
- Client: `pg_dump`/`pg_restore` **17 or newer** (the server is PostgreSQL 17.6; an older
  `pg_dump` refuses a newer server). Check with `pg_dump --version`. The restore target is
  PostgreSQL **17** so the test matches production. If Docker Desktop on that machine also
  starts other projects' containers, use another machine or a PostgreSQL 17 install instead.
- Connection: the Supabase **session pooler** (`aws-0-ap-northeast-2.pooler.supabase.com`,
  port **5432**, user `postgres.<project_ref>`) or the direct host (`db.<project_ref>.supabase.co:5432`,
  IPv6 unless the IPv4 add-on is on). **Not** the transaction pooler on 6543: `pg_dump` needs
  a session.
- Credentials never go on a command line, into a log, an artifact, a chat or Git. Use a
  `~/.pgpass` entry written with an editor (one line `host:5432:postgres:postgres.<ref>:<password>`,
  `chmod 600`), and connection settings in environment variables. Do not use `set -x`.
- Work in a directory outside the repository, created with `umask 077`.

**1. Dump** (read-only for the server)

```bash
umask 077; mkdir -p ~/studymap-backup && cd ~/studymap-backup
export PGHOST=aws-0-ap-northeast-2.pooler.supabase.com PGPORT=5432 PGDATABASE=postgres \
       PGUSER=postgres.<project_ref> PGSSLMODE=require        # password comes from ~/.pgpass
F=studymap-public-$(date -u +%Y%m%dT%H%MZ).dump
pg_dump --format=custom --schema=public --no-owner --no-privileges --file "$F"; echo "pg_dump exit $?"
sha256sum "$F" > "$F.sha256"
pg_restore --list "$F" | grep -c 'TABLE DATA'                 # number of tables with data
# Source facts for the comparison, read-only: revision and exact row counts.
psql -XAt -v ON_ERROR_STOP=1 -c "select version_num from public.alembic_version" > source-revision.txt
psql -XAt -v ON_ERROR_STOP=1 -f count-rows.sql > source-counts.txt
```

`count-rows.sql` (same file for source and restore; it only reads):

```sql
select format('select %L, count(*) from public.%I;', tablename, tablename)
from pg_tables where schemaname = 'public' order by tablename \gexec
```

**2. Restore into a disposable PostgreSQL 17** (local only, removed afterwards)

```bash
docker run --rm -d --name studymap-restore-check --memory 1g \
  -p 127.0.0.1:55499:5432 -e POSTGRES_PASSWORD=restore-only postgres:17-alpine
for i in $(seq 1 30); do docker exec studymap-restore-check pg_isready -q && break; sleep 1; done
export R="postgresql://postgres:restore-only@127.0.0.1:55499/postgres"   # throwaway, local
psql "$R" -XAt -v ON_ERROR_STOP=1 -c "drop schema public"   # the dump creates it; a fresh database already has an empty one
pg_restore --exit-on-error --no-owner --no-privileges --dbname "$R" "$F"; echo "pg_restore exit $?"
```

Pass only if `pg_restore exit 0`. Without the `drop schema public` line it stops at the first
statement (`schema "public" already exists`, exit 1): a dump made with `--schema=public`
contains `CREATE SCHEMA public`. Drop it only in the fresh disposable database, never
anywhere else. With `--exit-on-error` the first error stops it; fix the
cause (usually a Supabase object in `public` that refers to a role or function the plain
image lacks: create that role in the disposable database, or report it) and restore again
into a **fresh** container. Never accept a partial restore.

**3. Check the restore**

```bash
psql "$R" -XAt -v ON_ERROR_STOP=1 -c "select version_num from public.alembic_version" > restore-revision.txt
psql "$R" -XAt -v ON_ERROR_STOP=1 -f count-rows.sql > restore-counts.txt
diff source-revision.txt restore-revision.txt && diff source-counts.txt restore-counts.txt && echo "counts and revision match"
psql "$R" -XAt -c "select count(*) from pg_tables where schemaname='public'"
psql "$R" -XAt -c "select count(*) from pg_index i join pg_class c on c.oid=i.indexrelid
  join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not i.indisvalid"   # must be 0
psql "$R" -XAt -c "select count(*) from public.users" -c "select count(*) from public.quiz_attempts"
```

Before #185 is deployed the revision is the one production has today (`20261001_job_usage_ctx`
if nothing else was applied); after it, `20261115_attempt_submit_key`. A row count that
differs means writes happened between the dump and the count (dump in a quiet window and
re-count), not something to wave through.

Optional, stronger: point a local backend at the restored database
(`DATABASE_URL=$R`, never a hosted URL) and run `python -m scripts.verify_db_schema --moi-truong test`
after migrating a **copy**; this exercises the #185 migration on real data shapes.

Dry run of steps 1-3 (2026-11-16, local disposable PostgreSQL 16, schema from the
migrations plus 3 synthetic users, no real data): `pg_dump` exit 0, 27 `TABLE DATA` entries;
restore without the `drop schema` line exit 1, with it exit 0; revision
`20261115_attempt_submit_key` and all 27 counts identical; 0 invalid indexes; the submit-key
index valid and unique. Log: `studymap-qa-execution/v6/results/185-harness/runbook-syntax-check-pg16.log`.
It proves the commands and the checks, not the production backup: that needs client and
target 17 and the real dump.

**4. Evidence to keep** (no host, user, password or row content in it)

`restore-evidence.txt`: date and time (UTC), who ran it, `pg_dump --version`, server major
version, dump file name, size and SHA-256, number of `TABLE DATA` entries, `pg_restore exit 0`,
source and restored revision, the `diff` result of the counts, number of public tables,
number of invalid indexes (0). Paste that file (not the dump) into the release record.

**5. Protect and remove**

- The dump stays on the owner's encrypted disk (BitLocker/FileVault/LUKS) or is encrypted
  at once (`age -p` or `gpg -c`), `chmod 600`. Never in the repository, a shared drive, an
  artifact, CI, chat or e-mail.
- Remove the disposable database after the check: `docker stop studymap-restore-check`
  (`--rm` removes the container and its anonymous volume).
- Keep the dump only as long as the release window needs (for example 30 days), then delete
  it and its copies. Note the deletion in the release record.

## 4d. What a backup has to cover (inventory, read from the repository 2026-11-16)

| Data | Where it lives | In the 4c dump? | How to back it up | State |
|---|---|---|---|---|
| Business data: `users` (password hashes), `identities`, documents and chunks, knowledge maps, quizzes, attempts, answers, mastery, review plans, `jobs`, guided mind-map jobs, usage ledger, `alembic_version` | Supabase PostgreSQL 17.6, schema `public` | yes | 4c | **not done** |
| Supabase Auth (schema `auth`) | Supabase | no | the app does not use it: sign-in is the app's own (`BE/app/domains/auth/`, tables `users`/`identities` in `public`); whether `auth` holds rows was not read | owner: check `select count(*) from auth.users`; if not 0, decide whether it matters |
| Uploaded files | Supabase **Storage**, private bucket `SUPABASE_STORAGE_BUCKET` (`BE/app/domains/documents/storage.py`) | **no**: `pg_dump` does not contain object bytes; `storage.objects` rows are metadata only and outside `public` | copy the bucket with the S3-compatible Storage endpoint (e.g. `rclone sync` with an S3 access key created for this) to the encrypted backup location; compare the object count with the bucket listing | **not done** |
| Vector index, local SQLite (chat history with its 24 h retention, memory), graph checkpoints, `input_docs` | EC2 `/opt/memvid/data` (`docker-compose.prod.yml` volumes) | no | `scripts/backup.sh` (tar to `/opt/memvid/backups`), restore test with `scripts/restore.sh` on a copy. A tar of a SQLite file that is being written can be inconsistent: run it with the backend quiet, or check the restored files open | **not done**; restore never tested |
| Server secrets (`/opt/memvid/env/.env`) | EC2 | no | the owner's password manager; never Git or a backup tarball shared with others | owner |
| Frontend | Render, built from Git | n/a | rebuild from the commit; Render keeps earlier deploys for rollback | covered |

A backup is complete only when the first, third and fourth rows are done and restored once.
Until then call it "database backup only", not "full backup".

Two facts to check while doing this (not verified here):
- `docs/deployment/database-boundary.md` (2026-09-04) found the local development
  configuration and the then-production Render service pointing at **the same** Supabase
  database. If EC2 still uses that database, a developer running the backend locally writes
  to production. Compare the project ref (not the password) of EC2's `DATABASE_URL` with
  `BE/.env`.
- Whether the Supabase plan has daily backups or PITR. A dashboard restore replaces the whole
  project, so it is a last resort, not a substitute for the 4c restore test.

## 5. Integrations and test results

| Tree | What | Result |
|---|---|---|
| Trial 8 `d1ed4a3` / `8ca03e042ccf` | all 28 heads of 2026-11-16 morning (#185 at `06a65f8`) | Vitest 2095/2095 (+ seed 61201), build, lint 63/67, Fixture Smoke 333 passed / 6 skipped of 339, full audit 686 passed / 5 skipped of 691, 0 failed, 0 flaky; backend 3008 passed, 6 failures also on `main`. Chromium only |
| Trial 9 `64e701b` / `b97da2793ae6` | trial 8 + #185 `0f5fce0` | Merge: code clean, `.playbook` append conflicts only. `FE/` subtree hash `1c07e765902c` **identical** to trial 8, so the frontend test inputs are byte-identical; they were not re-run. Deploy harness on this tree: 38 PASS incl. mutations. `BE/` (`a6cae7ebff23`) and `scripts/` (`171d3be99334`) are **identical** to #185 `0f5fce0`, whose CI ran the backend suite on PostgreSQL (3025 passed) and the deploy tests. Only `.github` differs from #185 (the smoke list of #170). **Backend on this tree** (disposable PostgreSQL 16.15, 2026-11-16): migration to `20261115_attempt_submit_key` and rerun at head exit 0; `verify_db_schema` exit 0 before and after the suites; full suite 3018 passed, 9 skipped, 6 failed = the 6 that fail on `main`; migration, idempotency and concurrency files run alone: 144 passed, 0 failed (submit-key migration 10/10). A first run on a cp1252 console had 8 more failures, all from one Windows-only test-harness defect (section 4b), none from product code |

After trial 9, #185 moved to `5e18271`: `BE/tests/test_attempt_submit_key_migration.py` and
`.playbook/` only. Trial 9's product code (`BE/` outside that test, `scripts/`, `FE/`) is the
same as the new head's; the changed test file was run on its own (section 4b) and in CI.

No other open V6 pull request changes `BE/`, `scripts/` or the deploy workflow (`#170` only
changes the smoke list in `ci.yml`). No pull request is stacked on #185.

## 6. Pull request heads

All 28 are Draft. Heads unchanged since trial 8 except #159 (documentation) and #185
(`0f5fce0`, then `5e18271` test harness). The table in `README.md` lists every head.

## 7. CI on the changed heads

| PR | Head | `CI / required` |
|---|---|---|
| #185 | `5e18271` | **success** (run 43837028065: Backend Integration Suite & Migrations, Backend Unit & Contract, Deploy script tests, Fixture Smoke, E2E, Frontend tests and build all success) |
| #185 (previous) | `0f5fce0` | success (run 43811959733) |
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
  `main`; CI on Linux passes them (0 failed on #185 `0f5fce0` and `5e18271`). Environment, not V6.
- Firefox, WebKit, real devices, screen readers: not tested on any V6 branch. Unknown, not
  low: the V6 changes are mostly layout and focus handling, which is where engines differ.

## 8b. Plan for risks B and A (diagnostic grading), P1, not implemented

Read from #185 `5e18271` (same product code as `0f5fce0`). Needs the owner's approval as
its own backend pull request after #183/#185; it adds no migration (`grading_claimed_at`
already exists from `20261115`).

How B happens: `POST /api/attempts/<id>/submit` -> `attempts_uc.submit_attempt` commits
`in_progress -> submitted` (`repository.submit`, its own transaction), then grades:
- objective-only quiz: `grade_attempt(attempt_id)` in the request. An exception or a killed
  process after the commit leaves `submitted` with no score.
- with short answers: a background job; on any exception
  `run_short_answer_grading_job` marks the **job** `error` and leaves the attempt
  `submitted`. `sweep_stuck_jobs` marks dead jobs `interrupted`; nothing ever looks at the
  attempt.
A second submit gets `AttemptKhongConDangLam` (409): the learner cannot recover it, mastery
and the review plan for that attempt never appear.

How A happens: both callers use `grade_attempt(..., once=False)`, so `save_grades` neither
locks the row nor checks the status. Two graders of one attempt (a duplicated or retried job,
or the request path racing a job) both write the answers and both run gap analysis: mastery
counted twice.

Plan (one pull request, backend only; practice already has every piece, reuse it):
1. Claim at submit. In the same `FOR UPDATE` transaction that sets `submitted`, set
   `grading_claimed_at = now` (as `submit_practice` does with `_claim_grading`).
2. Grade once. Both callers pass `once=True`. In the job runner, a `None` from
   `grade_attempt(once=True)` with the attempt already `graded` is "someone else finished":
   the job ends `done` with the stored result, not `error` (today `None` is read as
   "attempt does not exist"; changing only `once` would turn every lost race into a failed
   job).
3. On a grading exception in this process, `release_grading_claim(attempt_id, claimed_at)`
   (as practice does), so a retry can grade at once.
4. Retry instead of 409. Submit on an attempt that is `submitted`, not graded, with no live
   claim (null or older than `GRADING_LEASE_S`) re-claims and grades again (request path or
   a new job). With a live claim: 202 "grading" (and the job id if one runs), not 409.
   `graded` still answers 409 as today.
5. Stuck sweep, bounded. In the existing maintenance tick, re-enqueue grading for attempts
   `submitted` with an expired claim and `submitted_at` older than, for example, 15 minutes,
   at most N per tick, logged. Covers learners who never come back.
6. FE (small): a 202 "grading" on submit polls as for a job; no new screen.

Tests (PostgreSQL, red first on the current code):
- grading raises after the submit commit: attempt `submitted`; the retry reaches `graded`
  (today 409);
- a killed grader (claim older than the lease): retry grades; with a live claim: 202, no
  second grade;
- two graders behind a barrier on one attempt: one `save_grades`, one gap-analysis run, the
  loser's job ends `done`;
- the sweep re-enqueues only stale `submitted` attempts and never touches `graded` ones;
- an old grader finishing after a re-claim does not overwrite the newer result.

Existing data: attempts already stuck can be counted read-only by the owner
(`select count(*) from quiz_attempts where status = 'submitted' and submitted_at < now() - interval '1 hour'`);
after the fix the sweep regrades them. No hand edits of attempts.

Not in this plan: risk D (generic routes accept a practice quiz) and per-client identity in
open mode (C); both stay as in the table above.

## 9. GO/NO-GO checklist for the owner

Blocking (production stays NO-GO until all three are GO with the evidence named):

| # | Item | Evidence that makes it GO | State |
|---|---|---|---|
| 3 | `production` environment requires a reviewer | `gh api repos/levuanh2/memvid_baocaototnghiep/environments/production` shows a `required_reviewers` rule naming the owner; the admin-bypass decision written down (on as emergency path, or off); one run seen waiting in "Review deployments" (e.g. the first FE-only merge) and approved or rejected by hand | **NO-GO**: `protection_rules: []` (read 2026-11-16); approved in principle |
| 4 | Render `studymap-web` Auto-Deploy Off for the window | screenshot or dated note of Settings > Build & Deploy showing Auto-Deploy Off; after a merge, no new Render deploy until the owner starts one by SHA | **NO-GO**: dashboard not read; `render.yaml` says `checksPass`; approved in principle |
| 6 | Database backup taken and restored once | `restore-evidence.txt` of section 4c: `pg_restore exit 0`, counts and revision identical, 0 invalid indexes, dump SHA-256, dump stored encrypted. A restore with any error is not GO | **NO-GO**: not done |

Also required before step 2 of section 4 (they do not block the frontend merges):

| # | Item | Evidence | State |
|---|---|---|---|
| 7 | Migration connection on EC2 | owner prints host and port only, inside the backend container: `python -c "import os; from urllib.parse import urlsplit as u; x=u(os.environ['DATABASE_URL']); print(x.hostname, x.port)"`. 5432 (session pooler) or direct is GO; 6543 means switch for the release or accept the risk in writing (section 4a) | open |
| 8 | Who approves a manual index repair | a named person who has read `docs/RUNBOOK_SUBMIT_KEY_INDEX.md` and is reachable during the #185 deploy window, recorded with the release | open |
| 14 | Development does not write to the production database | compare the Supabase project ref (the `<ref>` of user `postgres.<ref>`, and of `SUPABASE_URL`) of EC2's `DATABASE_URL` with the developer's `BE/.env` and root `.env`; print the ref only, never the URL. Read locally 2026-11-16: both local files point database **and** Storage at one project. If EC2 uses the same ref, every local backend run (quiz, submit, migration) changes learners' real data: move development to its own project or a local PostgreSQL before step 2, and run local migrations only against it | **open**; production side not read |
| 13 | Uploaded files and `/opt/memvid/data` backed up (section 4d) | object count of the bucket copy equals the bucket listing; a `scripts/backup.sh` archive restored once on a copy | open; without it the backup is "database only" |

Already GO, or owner decisions that do not block:

| # | Item | State |
|---|---|---|
| 1 | Every head green on `CI / required` | GO: 28/28 (#185 `5e18271`, section 7; #159 its docs head) |
| 2 | Trial integration tested on the exact tree to merge | GO: trial 9 `64e701b`; differs from the heads by #159 docs and the #185 test-harness file (section 5) |
| 5 | Auth on in production | GO: 401 without token on two protected routes (section 8); the env file itself not read |
| 9 | Real-device, Firefox, WebKit, screen reader checks | not done; accept the risk or run them |
| 10 | Risks A, B, D accepted for this release (not regressions; B is P1, plan in 8b) | open |
| 11 | 6 pre-existing local backend failures accepted (environment, pass in CI) | open |
| 12 | Windows test-harness fix | done in #185 `5e18271` (section 4b) |

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
- Supabase: the dump and restore test of section 4c; reading the plan's backup settings;
  copying the Storage bucket (section 4d); checking `auth.users`.
- EC2: reading `DATABASE_URL` host and port and `AUTH_PROTECT_APP_APIS` (no secret printed);
  `scripts/backup.sh` and a restore test of it; checking the deploy ledger for `db005ab`;
  comparing the project ref of EC2's `DATABASE_URL` with the development one (section 4d).
- Each merge to `main`, and each deploy approval.
- Any manual index repair from `docs/RUNBOOK_SUBMIT_KEY_INDEX.md`.
