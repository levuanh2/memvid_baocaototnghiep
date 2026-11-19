# V6 release review (2026-11-16) — for the owner, not a release approval

Status: **READY FOR OWNER REVIEW** for the 28 V6 Draft pull requests #159-#186 and the six
follow-ups #187 (dev/test isolation), #188 (diagnostic grading recovery, stacked on #185),
#189 (LLM deadlines), #190 (provisional grading recovery, stacked on #188), #191 (E2E
isolation), #192 (practice regrade, stacked on #190), #193 (practice regrade in the
background job, stacked on #192), #194 (review plan archive with a migration, stacked on
#190) and #195 (mind map contract test budget), once every
head named here has a green required check (section 7). Trial 13 integrated all 34 current heads (#159-#192) and passed the
PostgreSQL and E2E stages; trial 12 passed the full Fixture Audit (sections 5 and 12). Production: **NO-GO** until all seven
blocking items of section 9 are GO with the evidence that section asks for: production
reviewer, Render manual deploy, PostgreSQL backup restored, Storage and EC2 data backup
restored, dev/test isolated from production, migration port, index-repair approver. Each is
an owner action in a production setting (section 11). Nothing is merged, deployed or marked Ready. `main` is
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

## 4e. Dev/test isolation from production (read-only audit 2026-11-16, Draft PR #187)

Why: the developer machine's `BE/.env` and root `.env` point the database **and** Storage at
one Supabase project (read locally, ref not written here). Whether EC2 production uses the
same project is not known yet (item 14). Until it is, treat every connection from a dev or
test run to that project as a connection to production.

How configuration is loaded: `shared/env_loader.load_project_env()` fills variables in this
order: process environment, then `BE/.env`, then the root `.env`. A variable already present
wins, even when it is empty; `SKIP_DOTENV=1` turns the files off. `os.environ.pop` does
**not** keep a value out, because the next `load_dotenv` refills it from the file.

| Entry point | How it picks a target | Guard before #187 | After #187 |
|---|---|---|---|
| pytest, `app.db.database_url()` | `TEST_DATABASE_URL` only | refused only the same (host, db) as `DATABASE_URL`: a hosted database under another host name (direct host vs pooler), or with `DATABASE_URL` absent, **passed** | same rule as migrations: loopback/CI host, name ends in `_test`, not the `DATABASE_URL` target |
| pytest, guided job store (`guided_store.dsn()`) | `JOBS_DATABASE_URL`, else **`DATABASE_URL`** | none; active when `AUTH_PROTECT_APP_APIS=true` (set in the dev root `.env`) or `GUIDED_JOB_STORE_BACKEND=postgres` | `JOBS_DATABASE_URL` only, same rule; empty fails closed |
| pytest, Storage | `SUPABASE_URL` + `SUPABASE_SECRET_KEY` | none: values from `BE/.env` reached tests; an upload through the `client` fixture wrote to the **real bucket** | blanked at session start in `conftest.py`; storage tests set fake values and mock HTTP |
| Local Playwright backend (`scripts/run_e2e_server.py`) | `DATABASE_URL` (default local `studymap_test`), bucket keys from `BE/.env` | any `DATABASE_URL` from the shell accepted; bucket keys kept; provider keys "removed" with `pop` and refilled | provider and bucket keys set to `""`; a non-disposable `DATABASE_URL` exits 2 before the app is imported |
| `alembic`, `scripts.setup_test_db`, `scripts.run_migrations` (test) | `TEST_DATABASE_URL` | already fail closed: loopback/CI host, `_test`, not `DATABASE_URL`, live `current_database()` check | unchanged |
| `scripts.run_migrations` / `verify_db_schema --moi-truong production` | `DATABASE_URL` | needs `ALEMBIC_ALLOW_PRODUCTION=1` **and** declared `ALEMBIC_PRODUCTION_HOST`/`_DB` matching | unchanged; an explicit production action |
| Operator scripts (`audit_production_corpus`, `dem_tai_lieu_loi`, `don_input_docs`, `verify_supabase_storage`) | `DATABASE_URL`, bucket keys | read-only, or write only with an explicit flag (`--xoa` deletes local files after checking Storage; `--ensure-bucket`; the storage probe writes and deletes one probe object) | unchanged; run them only on purpose |
| Backend started by hand (`python -m app.main`, local gunicorn) | `DATABASE_URL` from `BE/.env` | none | **unchanged**: this is the developer's chosen target. It is safe only once item 14 shows the dev project is not production |
| Dev frontend (Vite) | `VITE_API_URL` | `FE/.env.local` points at `localhost` and wins over `FE/.env` (which names an old Railway host) | unchanged |

Independent review (Codex, read-only, four rounds; `task23-codex-187-review.md`) found
more ways out, all fixed in #187 with a red test first:
- URL query parameters (`?host=`, `?dbname=`, `?service=`...) replace the URL's host and
  database for libpq: `127.0.0.1/x_test?host=<hosted>` passed the first guard. A test URL
  may now carry only `sslmode`, `connect_timeout`, `application_name`.
- libpq environment variables (`PGHOSTADDR`, `PGSERVICE`, ...) move the socket even when
  the URL names the host, including when they only live in `BE/.env` and are loaded after
  the check, or are built with `${X}` from a variable another env file sets. A test run now
  refuses while any of them is or will be set (raw file values; fail closed).
- `REDIS_URL`, Gemini/Groq/Cohere keys, a remote `OLLAMA_HOST`, `LLM_GATEWAY_ADDR`,
  `MINDMAP_SERVICE_ADDR` reached tests or the E2E server; keys are blank, services kept
  only when local.
- The fingerprint now follows the effective target (query hosts, failover lists,
  percent-encoded users) and prints UNRELIABLE when libpq variables or `?service=` could
  move it.

Evidence for #187: `BE/tests/test_devtest_isolation.py` (48 tests) was red on each earlier
head for what that round added, run with a **fake** dev `.env` that only uses `.invalid`
hosts and TEST-NET addresses, so nothing could connect anywhere. Green locally without a database on the latest head: 232 passed, 12 skipped (those need
Postgres). An E2E server started with a fake `BE/.env` holding only `PGHOSTADDR`: before,
it started (exit 124); after, it refuses (exit 2).
CI on #187 `f48feaf` (run 43912792942): `CI / required` success; backend integration on
PostgreSQL 16 3033 passed, 0 failed; Playwright E2E 42 passed, normal and protected auth
(the E2E server's check accepts CI's database). Codex's final ledger after four rounds:
11 findings fixed, 1 out of scope (hand-started backend, below), 0 open.
under pytest or inside the E2E server. Logs: `studymap-qa-execution/v6/results/devtest-isolation/`.

**Owner procedure: is the dev project the production project?** (prints fingerprints only)

```bash
# 1. Developer machine, repository root (reads the files in the backend's order)
python BE/scripts/db_target_fingerprint.py BE/.env .env
# 2. EC2, in the deploy directory; the script is piped in, so it works before #187 is deployed
docker compose -f docker-compose.prod.yml exec -T backend python - < BE/scripts/db_target_fingerprint.py
```

Each line shows a variable, a 12-hex fingerprint, and the port. No URL, host, user,
password, key or project ref appears. The fingerprint is the same for one project at 5432,
6543, the direct host and `SUPABASE_URL`. Compare `DATABASE_URL` and `SUPABASE_URL` between
the two outputs and record **only** "same" or "different" with the date. Do not paste
either output into a chat or an issue.
- Different: item 14 is GO.
- Same: item 14 is NO-GO. Create a separate Supabase project (or use a local PostgreSQL)
  for development, point `BE/.env` and `.env` at it, rerun step 1 until it differs, and
  until then do not start the backend or run any migration locally with these files.
  Rotating the production keys that sit on the developer machine is the owner's decision.

Added to #187 on 2026-11-17 without any production change: `shared/dev_target_guard.py`
refuses a hand-started backend when `PROCESS_ROLE` is not `web`/`mindmap-worker`, a
`BE/.env` or root `.env` exists on disk, and `DATABASE_URL`/`JOBS_DATABASE_URL`/
`SUPABASE_URL` point off this machine (opt out: `STUDYMAP_ALLOW_REMOTE_TARGETS=1`, only
after the fingerprint check). Production is not affected: `docker-compose.prod.yml` sets
`PROCESS_ROLE` on both services and `BE/.dockerignore` keeps `.env` out of the image
(`tests/test_dev_target_guard.py` checks both). The earlier proposal, kept for the record:
a runtime guard that refuses a hand-started backend on the production database. It needs a marker
that only production sets (for example `STUDYMAP_RUNTIME=production` in
`docker-compose.prod.yml`). If the marker is missing on EC2, the production backend would
refuse to start, so it has to be deployed with its own check.

## 5. Integrations and test results

| Tree | What | Result |
|---|---|---|
| Trial 8 `d1ed4a3` / `8ca03e042ccf` | all 28 heads of 2026-11-16 morning (#185 at `06a65f8`) | Vitest 2095/2095 (+ seed 61201), build, lint 63/67, Fixture Smoke 333 passed / 6 skipped of 339, full audit 686 passed / 5 skipped of 691, 0 failed, 0 flaky; backend 3008 passed, 6 failures also on `main`. Chromium only |
| Trial 13 `e938adf` / `c31032816c03` (2026-11-18, local, not pushed) | trial 12 `f2b8c6a` + #159 `91443f5`, #192 `fd0812f`, #191 `ac1a411`: **34/34 current heads are ancestors**, all Draft | Merge: `.playbook` append conflicts, and one code conflict in `BE/scripts/run_e2e_server.py` between #187 and #191, resolved by hand (kept #187's shared disposable-database guard and emptied keys, added #191's `SKIP_DOTENV=1`, dropped #191's own database check as redundant; commit `cb13235`). Disposable PostgreSQL 17.6, fresh database per stage: `verify_db_schema` before and after exit 0; full backend suite 3182 passed, 8 failed, 9 skipped: the 6 baseline failures, plus 2 in `test_production_migration_contract` caused by the local cluster (the test hard-codes the CI role `postgres:postgres`; with that role added to the disposable cluster the file passes 12/12, `migration-contract-rerun-with-ci-role.log`); the 9 skips identical by name; Vitest 2131/2131; build ok; E2E critical (Chromium, 1 worker, #191 isolating each start): open auth 50 passed + 1 skipped, protected auth 51 passed, 0 flaky (includes the new practice regrade spec); no store under the checkout was written by E2E. Full Fixture Audit not re-run: trial 13 changes only `Practice.jsx`, `Practice.*.test.jsx`, the practice API and the E2E harness against trial 12. Logs: `studymap-qa-execution/v6/results/integration-34-trial13/` |
| Trial 12 `f2b8c6a` / `b4288c960736` (2026-11-18, local, not pushed) | trial 11 `6507818` + #159 `bc84e77`, #191 `f6092f6`, #192 `f8107c1`: **34/34 heads are ancestors** (#159-#192, checked one by one) | Merge: `.playbook` append conflicts only (the helper now refuses code files); `run_e2e_server.py` merged without conflict and was read back: #191's isolation and #188/#190's stubs both present. Disposable PostgreSQL 17.6 (loopback, fresh database per stage): `verify_db_schema` before and after exit 0; full backend suite 3178 passed, 6 failed, 9 skipped, the 6 failures and 9 skips identical by name to the trial 11 baseline; Vitest 2128/2128 (exit 0); build ok; E2E critical (Chromium, 1 worker, no data directory set in the shell, so #191 isolates each start) open auth 47 passed + 1 skipped, protected auth 48 passed, 0 flaky; Full Fixture Audit: run 1 (31 min, machine under load): 684 passed, 2 failed, 5 skipped - two mind map specs (`current-branch-collapsed-connectors` and `exact-node-export-v3`) timed out on both attempts; rerun alone 13/13 passed; run 2 (23.5 min): 686 passed, 5 skipped of 691, 0 failed, 0 flaky (exit 0). The two specs are recorded as load-sensitive, not as a regression (the trial changes only `Practice.jsx` and `api.js` in the frontend). Logs: `studymap-qa-execution/v6/results/integration-34-trial12/` |
| Trial 11 `6507818` / `86745345c82a` final run (2026-11-18), supersedes BLOCKED | 31 of 32 current heads exactly; #159 at its previous docs head | `verify_db_schema` before and after exit 0; full backend suite 3162 passed, 6 failed, 9 skipped, identical to the baseline; E2E critical open 47 + 1 skipped, protected 48, each run with its own fresh database, data and SQLite directories and a new backend process. `integration-32-trial11/TASK1-SUMMARY-6507818.md` |
| Trial 11 (2026-11-17, local, not pushed): `c30db74` / `f6325bc77a51`, then `5e6e304` / `9facee9a326e` (+ #190 `f514cae`), then `6507818` / `86745345c82a` (+ #190 `b74de27`) | all 32 heads, checked one by one at each step | Merge: `.playbook` append conflict; a `QuizResult.jsx` conflict first resolved wrongly by the keep-both-sides helper, then by hand (`c30db74`; the helper now refuses code files). **On `c30db74` and again on `5e6e304`** (disposable PostgreSQL 17.6, loopback, fresh database): migration and `verify_db_schema` before and after exit 0; targeted #183/#185 132, #187 87, #188 64, #189 53, #190 30 passed; full backend suite 3159 / 3160 passed, 6 failed (the known local failures: `test_index_khoa_that` x5 need a real Redis, `test_fpt_rerank` x1; they pass in CI), 9 skipped; Vitest 2122/2122 (exit 0); build ok; E2E critical (Chromium, 1 worker) open auth 47 passed + 1 skipped, protected auth 48 passed, 0 flaky; Full Fixture Audit (`--workers=1 --fail-on-flaky-tests`) 686 passed, 5 skipped of 691, 0 failed, 0 flaky, on both. **On `6507818`: BLOCKED** - its frontend is byte-identical to `5e6e304` (so Vitest, build and the fixture audit apply), but the full backend suite was stopped by the machine running out of memory and was not restarted; E2E critical was not run on it. #190 `b74de27` on its own: 207 grading and review tests on a fresh database, CI green. Not counted: a full run stopped at collection (gRPC stubs not generated in the new worktree), an E2E run on an unmigrated database, and two E2E runs that reused `BE/memory/mindmaps.sqlite` from an earlier run (item 19). Logs: `studymap-qa-execution/v6/results/integration-32-trial11/` (`BLOCKED-6507818.txt`) |
| Trial 10 PostgreSQL stages `3e140b8` (31 exact GitHub heads, #188 `16932dd`) | PostgreSQL 17.6 portable (owner-approved; no Docker) | migration and `verify_db_schema` exit 0 before and after; #183/#185 144 passed (2 contract tests needed the CI role `postgres`, then 12/12); #187 87; #188 64; #189 53; full suite 3136 passed, 6 failed (the same 6 local failures), 9 skipped. `integration-31-trial10/` |
| Trial 10 `c9eb9b2` / `bda16b09842b` (2026-11-17, local, not pushed) | trial 9 + #159 `fc06063`, #185 `5e18271`, #187 `7389d77`, #188 `16932dd`, #189 `2d174d8`: **31/31 heads are ancestors** (checked one by one) | Merge: only `.playbook` append conflicts (both sides kept). `FE/` differs from trial 9 only by `QuizResult.jsx` + its test. Backend targeted (#187/#188/#189 files, no DB): 146 passed, 0 failed, 84 skipped (need PostgreSQL). Full backend suite without a database: 2782 passed, 16 failed = the 6 failures `main` has locally + the 10 tests that need PostgreSQL (the same 10 fail on #185 without a database). Vitest 2106/2106; build ok; lint clean on the changed files; Fixture Smoke 334 passed / 5 skipped of 339, 0 failed, 0 flaky (`--fail-on-flaky-tests`). **Not run: the PostgreSQL stages** (migration, idempotency, concurrency, full integration on the integrated tree): Docker Desktop was stopped and was not started; each PR ran them alone in CI (section 7). Full Fixture Audit not re-run: the only frontend change since trial 8 is `QuizResult` (Vitest + smoke cover it). The run found one real defect, fixed in #187 `7389d77`: two isolation tests depended on the runner's `SKIP_DOTENV`. Logs: `studymap-qa-execution/v6/results/integration-31-trial10/` |
| Trial 9 `64e701b` / `b97da2793ae6` | trial 8 + #185 `0f5fce0` | Merge: code clean, `.playbook` append conflicts only. `FE/` subtree hash `1c07e765902c` **identical** to trial 8, so the frontend test inputs are byte-identical; they were not re-run. Deploy harness on this tree: 38 PASS incl. mutations. `BE/` (`a6cae7ebff23`) and `scripts/` (`171d3be99334`) are **identical** to #185 `0f5fce0`, whose CI ran the backend suite on PostgreSQL (3025 passed) and the deploy tests. Only `.github` differs from #185 (the smoke list of #170). **Backend on this tree** (disposable PostgreSQL 16.15, 2026-11-16): migration to `20261115_attempt_submit_key` and rerun at head exit 0; `verify_db_schema` exit 0 before and after the suites; full suite 3018 passed, 9 skipped, 6 failed = the 6 that fail on `main`; migration, idempotency and concurrency files run alone: 144 passed, 0 failed (submit-key migration 10/10). A first run on a cp1252 console had 8 more failures, all from one Windows-only test-harness defect (section 4b), none from product code |

After trial 9, #185 moved to `5e18271`: `BE/tests/test_attempt_submit_key_migration.py` and
`.playbook/` only. Trial 9's product code (`BE/` outside that test, `scripts/`, `FE/`) is the
same as the new head's; the changed test file was run on its own (section 4b) and in CI.

No other open V6 pull request changes `BE/`, `scripts/` or the deploy workflow (`#170` only
changes the smoke list in `ci.yml`). No pull request is stacked on #185.

## 6. Pull request heads

All 32 (#159-#190) are Draft, and every head has a green `CI / required` (checked
2026-11-17, one by one). The table in `README.md` lists every head.

## 7. CI on the changed heads

| PR | Head | `CI / required` |
|---|---|---|
| #185 | `5e18271` | **success** (run 43837028065: Backend Integration Suite & Migrations, Backend Unit & Contract, Deploy script tests, Fixture Smoke, E2E, Frontend tests and build all success) |
| #185 (previous) | `0f5fce0` | success (run 43811959733) |
| #187 | `7389d77` | **success** (run 44033127356: backend 3046 passed / 0 failed) |
| #188 | `8a16902` | **success** (run 44060712513: backend 3067 passed, E2E 44 + 44 with the QuizResult 200/202/409 spec) |
| #188 (previous) | `16932dd` | success (run 44032428574) |
| #190 | `b74de27` | **success** (run 44119547612: backend 3093 passed, E2E 47 + 48, Fixture Smoke 206) |
| #191 | `ac1a411` | **success** (run 44263766276: backend 2991 passed, E2E 42 + 42; based on `main`); earlier `f6092f6` run 44134704901 |
| #192 | `fd0812f` | **success** (run 44262980102: backend 3109 passed, Vitest 1977, E2E 50 + 51, Fixture Smoke 206); `0aaf594` failed on a focus-test race, fixed in `6828afb` |
| #193 | `f69d911` | **success** (first head `882bb6a` run 44350467761; review fixes `e49579b`, `f69d911` green) |
| #194 | `6145d62` | first head `1b095e7` **success** (run 44354303047); review fixes `c1d2641` green; `6145d62` docs only |
| #195 | `47dc4b1` | **success** (run 44363261244) |
| #189 | `2d174d8` | **success** (run 44035654037: backend 3000 passed / 0 failed) |
| #159 | this commit | documentation only |

## 8. Backend risks still open (not fixed by #185; details `task22-agy-backend-risks.md`)

| | Risk | Priority | Blocks #183/#185? | Proposal | Tests needed |
|---|---|---|---|---|---|
| A | Diagnostic grading has no claim: sync and background callers use `grade_attempt(once=False)`; a duplicated job grades twice, the second grader overwrites the first's scores, and gap analysis runs twice (it rewrites the per-attempt snapshot, so no duplicate mastery rows) | P2 | No | pass `once=True`; lease on diagnostic attempts as for practice | two graders behind a barrier: one save, one mastery run |
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
  racing the sync path). Effect, corrected 2026-11-16: the second grader's verdicts replace
  the first's (an LLM-graded score can change after the learner saw it), a second LLM pass
  is paid, and gap analysis runs twice. Mastery rows are **not** doubled:
  `analyze_attempt` deletes and rewrites the attempt's snapshot under UNIQUE
  `(attempt_id, concept_name)` (test `..._exactly_the_snapshot_...` green). Not a data loss.
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

## 8b. Plan for risks B and A (diagnostic grading), P1: implemented in #188 (section 8c)

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
or the request path racing a job) both write the answers (the last one wins) and both run
gap analysis (the snapshot is rewritten, not doubled).

A third case, found while writing the tests: a process that dies after `save_grades` and
before `analyze_attempt` leaves a `graded` attempt with no mastery rows, forever. Practice
repairs this on a `done` retry since #185; diagnostic does not.

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
   `graded` still answers 409 as today; a `graded` attempt without mastery rows is repaired
   by the sweep (step 5), not by a retry.
5. Recovery sweep, bounded: `attempts_uc.recover_grading(older_than_s, limit)`, called from
   the existing throttled `_run_jobs_maintenance` (`app/main.py`, `JOB_SWEEP_INTERVAL_SECONDS`,
   default 300 s). No new process, worker or schedule. It regrades `submitted` attempts whose
   claim expired and whose `submitted_at` is older than, for example, 15 minutes; it reruns
   gap analysis for `graded` attempts that have no mastery rows (no regrading). At most N
   per tick, each logged.
6. FE (small): `QuizResult` already polls a `submitted` attempt and says "stuck" after 5
   minutes (`REGRADE_STALL_MS`); add a "Chấm lại" action there that calls submit again. A
   202 "grading" on submit polls as the job flow already does.

Contract and interaction with #183/#185 (checked 2026-11-16 on `5e18271`):
- `POST /api/attempts/<id>/submit` already answers 202 with `job_id` for background grading
  and 200 for objective-only quizzes. **New**: on an `in_progress -> submitted` attempt that
  is stuck it answers 200/202 (graded or grading) where it answers 409 today; with a live
  claim it answers 202 "grading" instead of 409. Other 409s stay. A client that treats
  409 as "already submitted, open the result" still works, because the result page shows
  the same attempt.
- It uses only pieces #183/#185 added and tested for practice: `grading_claimed_at`
  (migration `20261115`, so this pull request stacks on #185 and must merge after it),
  `GRADING_LEASE_S`, `_claim_grading`, `release_grading_claim`, `save_grades(once=True)`.
  No new migration. The practice route and the Idempotency-Key logic are not touched.
- Diagnostic retry carries no idempotency key: the attempt id is the key (one attempt, one
  submit), so the replay window and fingerprint logic of practice do not apply.

Independent review of this plan and its tests (agy, read-only,
`task24-agy-diagnostic-plan-review.md`) adds requirements, accepted here:
- **Already graded, retried** (P1): an objective quiz grades in milliseconds; if the
  response is lost, the learner's second submit gets 409 and sees "Nộp bài thất bại" for
  an attempt that succeeded. Proposal: a `graded` attempt answers 200 with the stored
  result and `grading: "done"`, as practice does since #185. This changes
  `test_quiz_attempt.py` (which asserts 409 today) and is part of approval item 1.
- The job runner must treat `None` from `grade_attempt(once=True)` with a `graded`
  attempt as done (step 2; without it, fixing A turns every lost race into a failed job).
- The claim taken at submit is returned to the caller (`repository.submit` returns
  only status today), so a failure releases exactly that claim (step 3).
- The sweep never grades short answers on the web request thread: it re-dispatches a
  background job with the attempt's own `user_id` (otherwise the job is invisible to the
  learner when auth is on). It claims with one atomic conditional `UPDATE`, so a learner
  retry and the sweep cannot both grade; it only touches attempts whose `submitted_at` is
  older than the threshold, so it does not race a learner who just released a claim.
- A retry on the generic route refuses a practice quiz (risk D); practice keeps its
  Idempotency-Key route.
- More tests before the PR: the short-answer retry path; an old grader finishing after a
  re-claim (no overwrite, no second analysis); retry by another user -> 404 with auth on;
  sweep and learner retry at once; a released claim (`grading_claimed_at` NULL).

Approval needed before a Draft PR (owner):
1. The API change above: a stuck attempt's retry returns 200/202 instead of 409, and a
   retry of an already graded attempt returns 200 with the stored result instead of 409.
2. The sweep in the maintenance tick (regrades without a learner request; it spends LLM
   calls for short-answer attempts; N per tick and the age threshold are the knobs).
3. The FE "Chấm lại" action on the stuck message.
4. Order: after #185 is merged and deployed; the pull request is backend + one FE change.

Tests, written and run red (local branch `fix/diagnostic-grading-recovery` `f85d5ff` on
#185 `5e18271`, **not pushed**, waiting for the approval above;
`BE/tests/test_diagnostic_grading_recovery.py`, disposable PostgreSQL 16, log
`studymap-qa-execution/v6/results/diagnostic-grading/red-5e18271.log`): 5 red, 1 green.
- grading raises after the submit commit, retry reaches `graded`: **red** (409
  `AttemptKhongConDangLam`);
- killed grader, claim older than the lease, retry grades: **red** (409);
- live claim, retry does not grade again and answers "grading": **red** (409);
- two grading jobs forced to overlap: **red**, gap analysis ran 2 times (expected 1; the
  loser's job must end `done`);
- sweep regrades only the stale `submitted` attempt, leaves the live and graded ones, and
  rebuilds missing mastery without regrading: **red** (`recover_grading` does not exist);
- mastery rows are exactly the snapshot of the stored grades: green (today's behaviour,
  kept as a guard).
Still to add with the implementation: an old grader finishing after a re-claim does not
overwrite the newer result.

Existing data: attempts already stuck can be counted read-only by the owner
(`select count(*) from quiz_attempts where status = 'submitted' and submitted_at < now() - interval '1 hour'`);
after the fix the sweep regrades them. No hand edits of attempts.

Not in this plan: risk D (generic routes accept a practice quiz) and per-client identity in
open mode (C); both stay as in the table above.

## 8c. Diagnostic grading recovery: Draft PR #188 (owner-approved 2026-11-17)

Branch `fix/diagnostic-grading-recovery`, head `7e9ea88`, stacked on #185 (`5e18271`;
uses its claim columns, no new migration). Not merged, not deployed. Reviewed by Codex
(task25, four rounds) and agy (task24, task26, task27); every accepted finding was fixed
with a red test first (`studymap-qa-execution/v6/results/task25-*.md`, `task27-*.md`).

`POST /api/attempts/<id>/submit`, before and after:

| Situation | Before (#185) | After |
|---|---|---|
| `in_progress`, objective-only | 200 graded | 200 graded (unchanged) |
| `in_progress`, with short answers | 202 + `job_id` | 202 + `job_id` (unchanged) |
| already `graded` (e.g. the first response was lost) | 409 | **200** with the STORED result, no regrading; missing mastery rebuilt (no LLM) |
| `submitted`, a grader holds a live claim or its job is queued/running | 409 | **202** `grading: "pending"` (+ the running `job_id`), no second grader |
| `submitted`, nobody grading (crash, grading error, lost job) | 409 forever | **200/202**: regraded under a new claim |
| `submitted`, short-answer quiz, learner retries used up (`GRADING_MANUAL_RETRY_MAX`, 3) | 409 | 409 "Đã hết lượt thử chấm lại cho bài này" |
| `cancelled` | 409 | 409 |
| a practice quiz on this generic route | graded without its key rules | **409** (practice has its own route) |
| another learner's attempt (auth on) | 404 | 404 |
| `POST /api/practice/<id>/submit` retry of a stuck attempt | unlimited | capped like above (short-answer quizzes only) |

`GET /api/quizzes/results/<id>` adds `grading_state`: `graded` | `grading` (live claim or
a job reporting within the 300 s lease) | `stalled` (nobody grading: a retry is offered)
| `failed` (stalled and retries used up). The result page shows "Thử chấm lại" only on
`stalled`; an older backend without the field shows no button (today's behaviour).

One grader per attempt: the claim is taken at submit; a job may grade only if it is the
registered one; it renews the claim at every answer (heartbeat); a stale, superseded or
redelivered job ends before any model call; the final write is still `once=True`. A
failed enqueue leaves no ghost job and refunds the retry. The lease is
`max(300 s, GRADE_LLM_TIMEOUT_SEC + LLM_QUEUE_WAIT_TIMEOUT_SECONDS + 60 s)`, so one model
call always fits inside it whatever the configuration.

Mastery, exactly: before and after, mastery rows are never doubled (the per-attempt
snapshot is rewritten under UNIQUE `(attempt_id, concept_name)`); what changes is that a
second grader no longer runs the analysis again. A graded attempt without mastery rows
(process died between scores and analysis) is rebuilt by a retry, by the existing
`GET /api/attempts/<id>/concept-masteries`, and by the sweep when it is on; the rebuild
is deterministic, no LLM. Review plans are generated on request, not during grading, and
are not touched.

Recovery sweep: implemented, **OFF** (`GRADING_RECOVERY_ENABLED` unset), and a dry run
even when enabled unless `GRADING_RECOVERY_DRY_RUN=0`. It runs inside the existing
throttled jobs maintenance (every `JOB_SWEEP_INTERVAL_SECONDS`, 300 s), only enqueues
background jobs, takes one budget for all web processes (PostgreSQL advisory lock) and
logs one JSON line per run (`event: grading_recovery`).

Residual risk found in the last Codex round, not fixed in #188 (outside the approved
scope, owner decision): `app/clients/llm_factory.py` does not enforce a hard wall-clock
limit. `_invoke_chat` waits for the provider thread on exit of its `ThreadPoolExecutor`,
the Ollama client is built without the call timeout, and a fallback to the next provider
gets a full timeout of its own. A provider that hangs past the lease lets a retry take
over while the old call is still running. Effect, bounded: the result is still written
once and the old grader stops before its next model call, so at most one model call is
paid twice. This is pre-existing and affects every AI feature, not only grading.
Now addressed by Draft #189 (section 8d): grading passes one total deadline, the wait
really ends at it, and a timed-out call keeps its slot; a request already sent is still
not cancelled at the provider.

Cost if the owner enables it later (no LLM call is made while it is off, and none in
tests):
- objective-only attempt: 0 model calls per regrade; short answers: 1 model call per
  short-answer question per regrade; mastery rebuild: 0.
- per run at most `GRADING_RECOVERY_BATCH` (5) attempts, at most
  `GRADING_RECOVERY_MAX_INFLIGHT` (5) in progress, each attempt at most
  `GRADING_RECOVERY_MAX_ATTEMPTS` (3) recoveries; only attempts submitted more than
  `GRADING_RECOVERY_OLDER_THAN_S` (900 s) ago.
- upper bound: 12 runs/hour x 5 = 60 regrades/hour, and per stuck attempt
  3 x (short-answer questions) model calls from the sweep, plus at most 3 learner retries.
- Before enabling: a budget and rate limit on the provider side, a usage dashboard or
  alert, a dry run reviewed first, and the owner's separate approval.

Evidence: BE `test_diagnostic_grading_recovery.py` 41 tests (5 red on #185, the rest red
on intermediate heads after each review round), 8 grading files 163 passed, full backend
suite only the 6 failures `main` has locally; FE `QuizResult.retryGrading.test.jsx` 11 (8
red on earlier pages), Vitest 1952/1952; see section 7 for CI.

## 8d. LLM deadlines: Draft PR #189 (owner-approved 2026-11-17)

Branch `fix/llm-timeouts`, head `2d174d8`, from `main`. Audit by Codex (task28),
caller inventory by agy (task29), review and re-check by Codex (task30).

What was wrong (all reproduced with fake providers, no real model): `_invoke_chat` used
`with ThreadPoolExecutor`, whose exit waits for the provider thread, so a timeout never
gave control back early (a 1 s timeout over four hanging providers took 12.1 s); Ollama
had no HTTP timeout at all (`ChatOllama(timeout=)` is not a field in langchain-ollama
0.3.10 and was silently ignored); Gemini and Groq got no timeout and retried inside the
call (6 and 3 attempts); each fallback provider got a fresh full timeout.

Change: `timeout` keeps its meaning (per provider) but is a real limit; the opt-in
`total_timeout` is one deadline for the whole fallback chain and is used only by
grading, so #188's claim lease (`grading_lease_s = max(300, GRADE_LLM_TIMEOUT_SEC + queue
wait + 60)`) now holds for a real grading call. Every provider client gets a transport
timeout and bounded SDK retries when a deadline is given. A timed-out call keeps its
in-process slot until it really ends (no extra concurrency above
`MAX_CONCURRENT_LLM_CALLS`); a fallback takes its own slot with a bounded wait.

Limits, stated plainly: a request already sent is **not** cancelled at the provider (the
thread runs until the HTTP client's own timeout, and the provider may still bill it);
late usage accounting is best effort (refused by the ledger if the caller already closed
its reservation; logged with attempt and provider); a call that never returns can delay
graceful process exit; summary, mind map and coverage pipelines pass no timeout into
`ask_ai` (agy task29), and `get_llm`/streaming and `llm_cache`'s judge are unchanged:
follow-ups per caller.

Evidence: `tests/test_llm_deadlines.py` 15 tests (red on `main` or on the previous PR
head); LLM-related files 302 passed locally; CI run 44035654037: backend 3000 passed.

## 8e. Proposal: provider budget, real cost limits and usage alerts (for the owner, not implemented)

The recovery sweep of #188 is OFF and must stay OFF in production until this is decided.
Its limits (batch 5, 5 in flight, 3 recoveries per attempt, about 60 regrades/hour) are
counts, **not money**: one regrade costs one model call per short-answer question, and
each call's price depends on prompt + answer tokens (question, model answer, source
context up to `LLM_CTX_SIZE`, and up to `LLM_MAX_TOKENS` of output) and on the provider
that answers (FPT and Gemini/Groq bill per token; local Ollama costs CPU time). An
attempt with 10 short answers costs ten times one with 1, under the same "1 regrade".

Proposal, in order:
1. **Provider-side hard cap (real money):** a spending limit or quota on each paid
   provider account (FPT marketplace, Gemini project, Groq). This is the only limit
   that holds whatever the application does. Owner action in each provider console.
2. **Application token budget, per day:** read the existing usage ledger
   (`usage_events`, written through `record_provider_response`) for `feature=grade`.
   Before claiming, the sweep checks `GRADING_RECOVERY_DAILY_TOKEN_BUDGET` (and stops
   for the day when spent); learner retries count against the same budget.
3. **Per-attempt estimate before a regrade:** short-answer count x an average token
   cost from the ledger; skip attempts above a per-attempt cap and report them.
4. **Alerts:** grading tokens per hour above a threshold; any `late usage NOT
   recorded` log line (#189: a billed call the ledger refused); `grading_recovery` runs
   with `dispatch_failed` or a growing `gave_up`; the 5xx rate of the submit route.
5. **Rollout:** a week in dry run (`GRADING_RECOVERY_ENABLED=1`, default dry run) reading
   the `grading_recovery` JSON lines; then batch 1, 1 in flight, a small daily budget;
   widen only after reviewing the ledger.

Prerequisites: #189 merged (one real deadline per grading call), the usage ledger
verified in production, and a named owner for the alerts. Needs the owner's separate
approval; nothing here changes code or configuration today.

## 8f. Provisional grading recovery: Draft PR #190 (owner-approved 2026-11-17)

Branch `fix/provisional-grading-recovery`, head `b74de27`, stacked on #188 `8a16902`
(the PR targets `main` like #188, because CI runs only for pull requests into `main`;
review its own commits only). Reviews: Codex task34 (two re-checks, APPROVED), agy task35
(re-check, APPROVED); Codex re-checks 3 and 4 on the plan rules below (APPROVED).

**The gap it closes.** When the AI grader fails on a short answer (provider error,
timeout, untrustworthy answer), grading still finishes: the attempt is `graded` with
`ungraded_count > 0`, the page says "Kết quả tạm thời", and those answers keep no
verdict. Nothing could ever grade them again: #188's "Thử chấm lại" is only for an
attempt whose grading job died. #189 makes a slow provider hit its real deadline, so
this state can become more frequent.

**Change.** `POST /api/attempts/<id>/regrade` regrades only the short answers without a
verdict, with #188's claim, lease, retry cap (`GRADING_MANUAL_RETRY_MAX`) and job
fencing. 202 with one job (concurrent clicks share it); 200 with the stored result when
nothing is left; 409 when retries are used up (no model call, the provisional result
kept); 404 for another learner. The attempt stays `graded`; progress, statistics and the
Library keep excluding it until every answer is graded. Answers that have a verdict and
every `user_answer` are never rewritten. A finished regrade job cannot run again when the
queue redelivers it. The grading job holds the attempt until its gap analysis is
written, so the page never shows the new score with old mastery.

**Review plans (owner decisions 2026-11-17, revised the same day).** A plan from the
graded answers, marked as covering only them, whenever no regrade is running; the first
rule (only after the retries were used up) made a learner spend up to three paid
regrades to get one. A plan is written only under the attempt's row lock and only if the
result it was built from is still the stored one (a regrade can start during the model
call); a later regrade that changes the result flags the plan `outdated` (not deleted). "Tạo lại kế hoạch" deletes the old plan and, through the
database cascade, the practice quizzes made from it and their attempts; it now asks for
confirmation and says so.

**Evidence.** 23 PostgreSQL tests (red first); grading and review files 204 passed on a
fresh database; Vitest 1968/1968 (exit 0); E2E with a fake grader that fails once then
succeeds, both auth modes, including a 320px layout check that fails on the old banner;
CI run 44119547612 on `b74de27`: backend 3093 passed, E2E 47 + 48, Fixture Smoke 206.

**Not covered.** Practice attempts with a provisional result have no regrade (the route
refuses them); the recovery sweep does not touch provisional attempts and stays OFF.

## 8g. Review round task39-43 (2026-11-18): #191 and #192

Owner-approved read-only reviews by Codex (task39, re-check task42) and agy (task36-38, 40, 43);
every finding was verified, then fixed red-first or handed to the owner.

| Finding | PR | Severity | Outcome |
|---|---|---|---|
| A `DATABASE_URL` left in the shell won over the E2E default (Playwright passes the whole environment) | #191 | P0 (Codex) | fixed `2001943`: only a local database named `*_test`; on the integrated tree #187's shared guard does the same |
| Popped `*_DB_PATH` and provider keys came back from `BE/.env` through `load_project_env` | #191 | P1 (Codex) | fixed `2001943`: `SKIP_DOTENV=1`; tests made wording-neutral in `ac1a411` |
| No heartbeat inside the practice regrade request: after the lease a second request could pay for the same answers | #192 | P2 (Claude, Codex) | fixed `0aaf594`: renew before each model call, 409 on takeover |
| Takeover during the last model call answered 200 "thử thêm" | #192 | P3 (agy) | fixed `fd0812f`: 409 |
| A reload lost the provisional result, its offer and the used-up news | #192 | P2 (Claude, Codex) | fixed `0aaf594`: `latest_attempt_id` on GET practice (additive) |
| The result page offered a regrade that always failed for practice attempts | #192 | P2 (Claude) | fixed `0aaf594`: the generic route hands practice to `practice.regrade` |
| Focus test raced a `setTimeout(0)` (CI run 44260869397) | #192 | test | fixed `6828afb` |
| Inline grading on production's single sync worker (`WEB_CONCURRENCY=1`, `GUNICORN_TIMEOUT=120`; compose `environment:` overrides `.env`): one slow model call blocks every request and can be aborted at 120 s | #192 (and practice submit before it) | P1 (Codex), owner risk | **not changed**: owner decision (section 9 item 20) |
| A worker killed mid-grading keeps a counted retry until the lease ends | #192 | P2 (Codex) | **not changed**: same decision |

New E2E: `FE/e2e/practice-provisional-regrade.spec.js` (3 tests, real Flask + PostgreSQL +
browser, fake grader; practice question generation stubbed in `run_e2e_server.py`): local
open auth 3/3, protected auth 9/9 together with both diagnostic regrade specs. Reviews:
agy APPROVED both (task43); Codex re-check: done (task42): #191 PASS; #192 CONDITIONAL PASS FOR MERGE (192-1, 192-4 and the result-page route closed; 192-2 and 192-3 open for the owner).

## 8h. Owner decisions after task42/43 (2026-11-19): #193, #194, #195

| PR | Task | What | Evidence |
|---|---|---|---|
| #193 `fix/practice-regrade-background` `882bb6a` (stacked on #192) | A: 192-2 P1, 192-3 P2 | Practice regrade in #190's background grading job: 202 + `job_id` (one job while queued/running), 200 stored result, 409 used up; no model call in the request. A retry is given back once only when its job never started (no `regrade_started_job` marker **and** job row still `pending`); a started job keeps its retry. Shared `reclaim_for_regrade`, so the diagnostic route follows the same rule. Page polls every 3 s for at most 5 min. No schema change | backend 22 tests (red first), related 183 passed; Vitest +4; E2E open 8 + 1 skip, protected 9; CI run 44350467761 green |
| #194 `fix/review-plan-archive` `cb41f0b` (stacked on #190) | B: issue #18 option B, plus the owner's two guards (2026-11-19) | Migration `20261118_review_item_archive` (expand only, rerun-safe): `archived_at`, partial unique index over current topics replacing `uq_review_plan_items_priority`, verified before the drop. Regeneration keeps the plan, archives topics, moves `created_at`; `archived_items` (additive); 409 for new practice from archived topics. **Guard 1**, migration `20261119_review_item_guard`: PostgreSQL triggers, fail closed (SQLSTATE 23001, runbook hint, no row data), refuse deleting a plan with archived topics while its attempt, user and document exist, deleting an archived topic while its plan exists, un-archiving or moving one, and `TRUNCATE`; document, account and attempt deletes still cascade. **Guard 2**: `scripts/rollback.sh` runs the read-only `scripts.rollback_preflight` before any checkout/build and refuses a pre-archive target while archived topics exist, or when the facts cannot be read; break glass does not skip it. Runbook `docs/RUNBOOK_REVIEW_ITEM_ARCHIVE.md` | Archive: 9 behaviour + 6 migration tests; guards: 12 trigger tests (incl. old-code ORM delete and an old-code delete racing the archive), preflight 2, deploy harness section R (6) + 3 mutations; full backend 3115 passed with the 6 baseline failures and 9 skips; `verify_db_schema` before/after ok. **Disposable PostgreSQL 17.6 only; nothing applied to any hosted database** |
| #195 `test/mindmap-export-contract-slow` `47dc4b1` (from `main`) | C | `test.slow()` on the nine-case `exact-node-export-v3` contract test only, phase timings attached also on failure; nothing skipped or split | 40 runs at idle/50/100/150 % CPU: 40/40; at 100 % every run exceeded the old 45 s (max 71.7 s), max at 150 % 86.5 s of 135 s; forced timeout keeps trace + timings; CI **success** (run 44363261244) |

Reviews of #193/#194/#195 (2026-11-19):
- **#193** `f69d911`: agy APPROVED (task45). Codex task44 found two FE P2 (poller stopped under StrictMode; a wait for one quiz wrote into the next), fixed in `e49579b`; task46 found stale rejected/`load()` continuations, fixed in `f69d911`; task48 **APPROVE**.
- **#194** `6145d62`: agy APPROVED (task47). Codex task46/48 **REQUEST CHANGES / NO-GO until an enforced rollback floor**: once a topic is archived, code older than #194 cascade-deletes the archived history on regeneration, and `scripts/rollback.sh` accepts any ledgered pre-#194 SHA. Documented (`c1d2641`: migration docstring, downgrade message, `docs/RUNBOOK_REVIEW_ITEM_ARCHIVE.md`); the runbook's recovery for an already-stamped revision fixed in `6145d62` (re-check task49). **The hard guard (DB trigger refusing to delete a plan with archived topics, or a schema floor in `rollback.sh`) needs an owner decision** before #194 can be approved.
- **#195** `47dc4b1`: agy APPROVED (task47).

## 9. GO/NO-GO checklist for the owner

Blocking: production stays **NO-GO** until every row is GO with the evidence named. None
of these can be done by this review; each is an owner action (section 11).

| # | Item | Evidence that makes it GO | State |
|---|---|---|---|
| 3 | `production` environment requires a reviewer | `gh api repos/levuanh2/memvid_baocaototnghiep/environments/production` shows a `required_reviewers` rule naming the owner; the admin-bypass decision written down (on as emergency path, or off); one run seen waiting in "Review deployments" (e.g. the first FE-only merge) and approved or rejected by hand | **NO-GO**: `protection_rules: []` (read 2026-11-16); approved in principle |
| 4 | Render `studymap-web` Auto-Deploy controlled | screenshot or dated note of Settings > Build & Deploy showing Auto-Deploy Off; after a merge, no new Render deploy until the owner starts one by SHA | **NO-GO**: dashboard not read; `render.yaml` says `checksPass`; approved in principle |
| 6 | PostgreSQL 17 production backup taken and restored once | `restore-evidence.txt` of section 4c: `pg_restore exit 0`, counts and revision identical, 0 invalid indexes, dump SHA-256, dump stored encrypted. A restore with any error is not GO | **NO-GO**: not done |
| 13 | Supabase Storage and EC2 `/opt/memvid/data` backed up and restored once (section 4d) | object count of the bucket copy equals the bucket listing, and one object opened from the copy; a `scripts/backup.sh` archive restored once on a copy with its SQLite files opening | **NO-GO**: not done |
| 14 | Dev/test cannot write to production | #187 merged (tests, E2E server: disposable database only, no real bucket; a backend started by hand from a checkout with `.env` refuses hosted targets; section 4e), **and** the fingerprint comparison of section 4e recorded as "different" for `DATABASE_URL` and `SUPABASE_URL`; if "same", the dev project separated first | **NO-GO**: #187 is a Draft (`e5cb643`, CI run 44003969309 success); the comparison not done; locally both files point at one project |
| 7 | Migration connection on EC2 confirmed | owner prints host and port only, inside the backend container: `python -c "import os; from urllib.parse import urlsplit as u; x=u(os.environ['DATABASE_URL']); print(x.hostname, x.port)"`. 5432 (session pooler) or direct is GO; 6543 means switch for the release or accept the risk in writing (section 4a) | **NO-GO**: not read |
| 8 | A named person approves a manual index repair | a named person who has read `docs/RUNBOOK_SUBMIT_KEY_INDEX.md` and is reachable during the #185 deploy window, recorded with the release | **NO-GO**: not named |

The merges of section 10 start only after 3, 4 and 6 are GO (as written there); the backend
deploy of #183/#185 (section 10 step 7) needs all seven.

Already GO, or owner decisions that do not block:

| # | Item | State |
|---|---|---|
| 1 | Every head green on `CI / required` | GO: 32/32 (#159-#190, section 7) |
| 2 | Trial integration tested on the exact tree to merge | GO: trial 11 `c30db74` holds all 32 heads; differs from them only by the merge resolutions (section 5) |
| 5 | Auth on in production | GO: 401 without token on two protected routes (section 8); the env file itself not read |
| 9 | Real-device, Firefox, WebKit, screen reader checks | not done; accept the risk or run them |
| 10 | Risks A, B, D: A and B fixed in Draft #188 (section 8c), D's generic-route part too; merge #189 then #188 after #185, or accept them | open |
| 16 | Provisional result after an AI grader failure: diagnostic attempts regradable in Draft #190 (section 8f); merge it after #188, or accept that such answers stay ungraded | open |
| 17 | A practice attempt with a provisional result had no regrade | fixed in Draft #192 `fd0812f` (regrade inside the request with heartbeat; reload and result page keep it; 16 backend + 9 FE tests and 3 E2E, red first); open until #192 is merged |
| 19 | Local E2E runs shared `BE/memory/mindmaps.sqlite` | fixed in Draft #191 `ac1a411` (own empty stores per start, no `.env`, only a local `*_test` database; 6 tests red first); open until #191 is merged |
| 18 | "Tạo lại kế hoạch" deletes the old plan's practice history (10-step cascade, existed before V6) | implemented in Draft #194 with both owner-chosen guards (DB triggers + rollback floor, `cb41f0b`); migrations tested on disposable PostgreSQL only. **Open**: reviews of the guards (Codex task50, agy task51), owner approval of migrations `20261118` and `20261119` and their deploy window, and merge. Owner may still decide whether deleting a document or an account may remove archived history (implemented: yes, as before #194) |
| 20 | Inline LLM grading of the practice regrade on one sync gunicorn worker with a 120 s timeout | owner chose the background job: implemented in Draft #193 (section 8h); open until #193 is merged. Practice **submit** still grades inline (existed before V6): same risk, not changed |
| 15 | PostgreSQL stages on the integrated tree | done: trial 10 (31 exact heads) and trial 11 (32 heads) on a disposable PostgreSQL 17.6, section 5 |
| 11 | 6 pre-existing local backend failures accepted (environment, pass in CI) | open |
| 12 | Windows test-harness fix | done in #185 `5e18271` (section 4b) |

## 12. Acceptance status (2026-11-18)

Kept apart, as the owner asked:

| Kind | State |
|---|---|
| CI of each pull request | 34/34 heads green on `CI / required` (#159-#192; section 7) |
| Tests on the integrated tree | trial 13 `e938adf` (34 heads): full stages, section 5. Trial 14 merge check `9140fa8` / `ff5a7f7b2845` (37 heads, local): `verify_db_schema` ok, overlapping backend suites 150 passed, Vitest ReviewGuide/Practice/QuizResult 133 passed; the full trial 14 is proposed once the reviews of #193/#194/#195 are closed |
| New regressions | none: trial 13 fails only the 6 baseline tests plus 2 caused by the local cluster's role (12/12 with the CI role); skips identical |
| Known local failures (pass in CI) | 6: `test_index_khoa_that` x5 need a real Redis; `test_fpt_rerank` x1 |
| Skipped tests | 9: evaluation datasets not in git (3), NKS credentials (2), Supabase Storage (1), real Redis (1), load test (1), live vision (1) |
| Not accepted (not run) | Firefox, WebKit, real devices, screen reader; any hosted environment; the owner's production backup and restore tests |
| Code reviews of #191/#192 | done, section 8g: agy APPROVED both (task43); Codex re-check done (task42): #191 PASS; #192 CONDITIONAL PASS FOR MERGE (192-1, 192-4 and the result-page route closed; 192-2 and 192-3 open for the owner). Open for the owner: item 20 (inline grading on one worker) |
| Fixture Audit trial 12 run 1 | kept as failed (2). `exact-node-export-v3` contract test: addressed by Draft #195 (`test.slow()`, measured under load). `current-branch ... opposite side`: download stall not reproduced, **open** |
| Production | **NO-GO**: the seven blocking items of section 9 (3, 4, 6, 7, 8, 13, 14) have no evidence yet |

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
8. #187 any time (no production runtime change; it is GO/NO-GO item 14's first half).
9. #189 before #188 (grading relies on its real deadline); it changes `llm_factory` for
   every AI feature, so watch errors and latency after its deploy.
10. #188 after #185 and #189 are deployed and verified, in its own window (backend +
   `QuizResult`; no migration). Keep `GRADING_RECOVERY_ENABLED` unset; enabling it is a
   separate owner decision with the budget of section 8e.
11. #190 after #188, in the same or the next window (backend + `QuizResult` +
   `ReviewGuide`; no migration).
12. #192 after #190 (practice regrade; backend + `Practice`; no migration).
13. #191 any time (E2E test harness only; no production code). After #187 it conflicts in
    `run_e2e_server.py`: keep #187's guard and emptied keys, add `SKIP_DOTENV=1` (trial 13
    commit `cb13235`).
14. #193 after #192 (practice regrade in the background job; no migration).
15. #194 after #190, **in its own approved migration window** (#185 process). Its only
    code conflict in trial 14 was the `ReviewGuide.jsx` React import line (both sides add
    `useRef`).
16. #195 any time (test only).
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
