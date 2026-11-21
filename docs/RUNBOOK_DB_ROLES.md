# Runbook: least-privilege database roles

Owner decision 2026-11-19 (after Codex task59): separate the table owner, the backend
runtime and read-only tools. **Nothing here has been applied to any hosted database.**
Every hosted step below needs its own owner approval.

The contract is code: `BE/shared/db_roles.py` (`APP_TABLE_PRIVILEGES`). `python -m
scripts.db_roles apply` makes a database match it; `verify` checks it read-only.

## 1. The three roles

| Role | Logs in from | May |
|---|---|---|
| `studymap_owner` (on Supabase: the existing `postgres` role) | `MIGRATION_DATABASE_URL`, the deploy's migration step only | own the schema, tables and guard functions; DDL; `GRANT`; `CREATE POLICY` |
| `studymap_app` | `DATABASE_URL`, the backend at runtime | the per-table, per-column DML of section 2; nothing else |
| `studymap_readonly` | `verify_db_schema`, `rollback_preflight`, backups, support queries | `SELECT` on every table |

**Supabase's Data API roles** (`anon`, `authenticated`, `service_role`) get nothing on
StudyMap's tables: `apply` revokes their table grants and `verify` fails while any is
left. `service_role` is what `SUPABASE_SECRET_KEY` (kept by the backend for Storage)
logs in as; it has `BYPASSRLS` and, by Supabase default, grants in `public`, so through
the Data API it could rewrite history around this contract. The frontend never calls the
database directly and Storage uses its own schema, so nothing needs those grants
(modelled on PostgreSQL with roles of the same names; to confirm on Supabase, step 1).

Never granted to `studymap_app` or `studymap_readonly`: `TRUNCATE`, `TRIGGER`,
`REFERENCES`, `CREATE` on the schema, ownership of any object, membership in the owner
role, `SUPERUSER`, `CREATEROLE`, `CREATEDB`, `REPLICATION`. `verify` fails on any of them.

## 2. What the app may do, per table

Derived 2026-11-21 from the live schema plus an audit of every `INSERT`/`UPDATE`/`DELETE`
the backend issued during the full test suite (PostgreSQL `log_statement='mod'`, each
statement tagged app or test), cross-checked by reading the code. Evidence:
`studymap-qa-execution/v6/results/db-roles/dml-audit-run3.txt`.

- `SELECT` everywhere; `INSERT` everywhere except `alembic_version`.
- `UPDATE` only on non-identity columns: never `id`, a foreign key naming the owner or the
  parent, or `created_at` (closes R2 for the app role). Exceptions: `documents.collection_id`
  (moving a document between collections) and `review_plans.created_at` (regeneration).
- No `UPDATE` at all on `quiz_questions`, `concept_masteries`, the link tables
  (`*_chunks`), `usage_events`, `ai_validation_logs`.
- `quiz_answers`: `UPDATE` only of `user_answer, verdict, is_correct, score, feedback,
  graded_at, updated_at`.
- `DELETE` only on `concept_masteries` (gap analysis replaces an attempt's rows),
  `sections`, `document_chunks` (re-ingest), `documents` (sidebar hard delete) and
  `collections`. The app never deletes users, quizzes, attempts, plans or topics; a
  document's FK cascade runs as the table owner, so it needs no `DELETE` there.

A new table is unreachable for the app until it gets a row in the contract (`verify`
fails on a table without one). Add the row in the same pull request as the migration.

**Column grants die with the column.** A migration that adds a column the app must
update, or drops and re-adds one (a downgrade then upgrade), leaves the app without
`UPDATE` on it until the contract lists it and is applied. With `DB_ROLE_SEPARATION=1`,
`run_migrations` applies the contract right after `upgrade head` and `verify_db_schema`
fails on any difference, so the new backend never starts with a missing grant. Found on
the disposable database: the `submit_key` downgrade test re-created three columns and
every later practice submit failed with `permission denied for table quiz_attempts`
until the contract was applied again.

## 3. RLS: policies (recommended) or BYPASSRLS

RLS is enabled on 26 of 27 tables with no policies (deny-all for `anon`/`authenticated`).
A role without `BYPASSRLS` and without a policy reads **0 rows, with no error**.

| | Policies (`DB_RLS_MODE=policies`, default) | `BYPASSRLS` |
|---|---|---|
| How | `studymap_app_access` (`FOR ALL TO studymap_app USING (true) WITH CHECK (true)`) and `studymap_readonly_access` (`FOR SELECT TO studymap_readonly`) on each RLS table, created by `apply` as the owner | `ALTER ROLE ... BYPASSRLS` on both roles, by a role that has `BYPASSRLS` |
| Who can set it up | the table owner | Supabase: `postgres` (it has `bypassrls`; Supabase RLS docs). PostgreSQL 17: only a superuser or a role with `BYPASSRLS` can grant it |
| `anon`/`authenticated` | still deny-all (policies name one role each; `tests/test_db_schema.py` fails on any other policy) | unchanged |
| Guard functions (run as the caller) | see every row through the policy | see every row |
| Backups as `studymap_readonly` | need `pg_dump --enable-row-security` (default `pg_dump` stops: "query would be affected by row-level security policy") | default `pg_dump` works |
| Audit | every grant is a visible object; `verify` checks each policy's role, command and expression | one attribute; Supabase warns never to share such a role's credentials |

Both modes were run on a disposable PostgreSQL 17 (2026-11-21): the role, guard, archive,
history-delete, preflight and schema tests pass in each (policies: full suite; BYPASSRLS:
138 passed, 1 skipped), and `scripts.db_roles verify` is clean in each.

Recommendation: **policies**. They need no special role attribute, are created and
verified by the owner with everything else, and keep `anon` deny-all by construction.
The only cost is `--enable-row-security` on read-only backups.

## 4. Environment

| Variable | Value |
|---|---|
| `MIGRATION_DATABASE_URL` | the owner's URL. **Always required, and only in `/opt/memvid/env/migration.env` (mode 600)**, never in `/opt/memvid/env/.env`: both service containers (`backend`, `mindmap-worker`) read `.env` through `env_file`, so an owner URL there would hand the owner's rights to the running app (Codex task60). `validate-env.sh` refuses the deploy when it is missing from `migration.env`, present in `.env`, or `migration.env` is not mode 600. `scripts/_lib.sh` `compose_migration` passes it only to the one-shot migration, verification and rollback-preflight containers (`-e MIGRATION_DATABASE_URL`, never on a command line). Migrations, `verify_db_schema` and `rollback_preflight` never use `DATABASE_URL`. Before the roles exist it may name the same `postgres` user as `DATABASE_URL` |
| `DB_ROLE_SEPARATION` | `1` once the roles exist and the contract is applied; until then unset |
| `DATABASE_URL` | the app role: on the Supabase shared pooler the user is `studymap_app.<project_ref>` |
| `DB_RLS_MODE` | `policies` (default) or `bypassrls` |

Always: a production migration without `MIGRATION_DATABASE_URL` is refused
(`shared.migration_guard`); there is no fallback to `DATABASE_URL`.

With `DB_ROLE_SEPARATION=1`, in addition:
- the migration URL must log in as another user than `DATABASE_URL`, on the same database;
- `scripts.run_migrations` applies the role contract right after `upgrade head`, as the owner;
- `scripts.verify_db_schema` (deploy step 5b) also fails when the contract does not match
  or `DATABASE_URL` does not log in as `studymap_app`: the new backend does not start.

## 5. Proposed rollout (each step needs owner approval; none is done)

0. **Before the next deploy of this change** (any SHA containing it): create
   `/opt/memvid/env/migration.env` (`umask 077`, then `chmod 600`) with one line
   `MIGRATION_DATABASE_URL=<the current postgres URL>`, written with an editor, never on a
   command line. Do not add it to `/opt/memvid/env/.env`.
   Without it the deploy stops at step 1 (validate environment), before build or
   migration, and the running backend is untouched.

1. **Supabase test project, not production.** Create the two roles (administrator, once):
   ```sql
   CREATE ROLE studymap_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
   CREATE ROLE studymap_readonly LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
   ```
   Set each password interactively (`\password studymap_app` in `psql`), never on a command
   line, in a log or in Git.
2. On that test project: `ALEMBIC_ALLOW_PRODUCTION=1 DB_ROLE_SEPARATION=1 python -m
   scripts.run_migrations --moi-truong production` with that project's URLs, then
   `verify_db_schema`. Confirm through the pooler that `studymap_app.<ref>` logs in, sees
   the same row counts as the owner on every table, and is refused `TRUNCATE` and
   `ALTER TABLE ... DISABLE TRIGGER`. Run the backend suite against it as in section 7.
   Then, with a backend of that SHA running as `studymap_app` against the test project,
   **use every main feature by hand**, because the contract was derived from what the
   tests and a code read reach: sign up and sign in (email and the external provider),
   avatar, upload and re-ingest a document, rename/favourite/pin/tag/archive/move to a
   collection, create/rename/delete a collection, chat with sources, summary, mind map
   (guided and export), study map, diagnostic quiz (multiple choice and short answer),
   submit, regrade, gap analysis, review plan, "Tạo lại kế hoạch", practice from a topic,
   delete from the Library (soft) and from the sources sidebar (hard), usage limits.
   Afterwards search the backend log for `permission denied` / `InsufficientPrivilege`:
   any hit is a missing contract row; fix the contract, never by granting broadly.
   Also on that project, read-only first: the grants of `anon`, `authenticated` and
   `service_role` on `public` tables and their default privileges
   (`\dp public.*`, `\ddp`); whether the Data API exposes `public` (Dashboard > API
   settings > exposed schemas) and whether removing `public` there breaks nothing
   (Storage, auth); that after `apply` an API call with the secret key to
   `/rest/v1/quiz_answers` is refused; and that Storage upload/download still work.
3. **Production**, in the 01:00-03:00 (Vietnam time) window, only after the GO/NO-GO
   checklist (PR #159, `docs/ui-ux-v6/06-release-review.md` section 9) is all GO:
   1. backup, and the restore rehearsal of that backup;
   2. create the two roles (step 1's SQL) and set their passwords;
   3. all at once: in `/opt/memvid/env/.env`, `DATABASE_URL` = the `studymap_app.<ref>` URL
      and `DB_ROLE_SEPARATION=1`; `migration.env` keeps the `postgres` URL (step 0);
   4. deploy the same SHA. The deploy migrates and applies the contract as the owner
      (step 5), verifies schema, contract and runtime user (step 5b), and only then
      starts the backend as `studymap_app`. Any failure leaves the old backend running,
      but with the env file already changed: **restore the three variables before any
      restart**, or a restarted backend logs in as an app role that may have no grants yet;
   5. smoke tests (sign in, library, a quiz attempt, a review plan regeneration).
4. **Back out** (no database change needed): set `DATABASE_URL` back to the owner URL and
   unset `DB_ROLE_SEPARATION`, restart. Grants and policies may stay; they open nothing to
   `anon`.

## 6. Backups and read-only tools

- `pg_dump` as `studymap_readonly` with policies: add `--enable-row-security`. Verified on a
  disposable PostgreSQL 17 with a row in every one of the 27 tables (seeded as the app
  role): exit 0, 27 `TABLE DATA` entries, restore exit 0, row counts identical on every
  table, all six guard triggers present. Without the flag it exits 1 ("query would be
  affected by row-level security policy"). In BYPASSRLS mode the flag is not needed.
- Row visibility: with a row seeded **as the app role** in every table (so every
  policy's `WITH CHECK` was exercised), owner, app and read-only counts are equal on all
  27 tables; a control role with `SELECT` but no policy saw 0 rows on every RLS table.
- `verify_db_schema`, `rollback_preflight` and `scripts.db_roles verify` all run as
  `studymap_readonly` (verified); the deploy keeps running them through the migration
  URL unless a read-only URL is configured for them later.

## 7. Run the tests as the app role (local or disposable PostgreSQL only)

```bash
# roles and a *_test database owned by studymap_owner, created once by an administrator
TEST_MIGRATION_DATABASE_URL=postgresql://studymap_owner:...@127.0.0.1:55500/x_test \
TEST_DATABASE_URL=postgresql://studymap_owner:...@127.0.0.1:55500/x_test \
  python -m scripts.setup_test_db && python -m scripts.db_roles apply
TEST_DATABASE_URL=postgresql://studymap_app:...@127.0.0.1:55500/x_test \
TEST_MIGRATION_DATABASE_URL=postgresql://studymap_owner:...@127.0.0.1:55500/x_test \
TEST_READONLY_DATABASE_URL=postgresql://studymap_readonly:...@127.0.0.1:55500/x_test \
  python -m pytest tests
```

Tests doing owner-only work (DDL, `TRUNCATE`, disabling a trigger, cleanup of rows the
app may not delete) use `tests/_owner_db.owner_engine()`. `tests/test_db_roles.py` runs
its database cases only in this mode.

## 7b. Evidence (disposable PostgreSQL 17.6, 2026-11-21)

| Run | Result |
|---|---|
| Full backend suite **as `studymap_app`** (fresh database, contract applied) | 3222 passed, 9 skipped; 6 failed, all the known baseline (`test_index_khoa_that` x5, `test_fpt_rerank` x1) |
| Same suite in ordinary owner mode (as CI runs it) | 3147 passed, 83 skipped (the app-role cases), same 6 baseline failures |
| Playwright E2E, backend as `studymap_app` | open auth 47 passed / 1 skipped; protected auth 48 passed; 0 `permission denied` in the backend log |
| A row seeded as the app role in all 27 tables | owner = app = read-only on every table; a no-policy control role saw 0 |
| Read-only `pg_dump --enable-row-security` / restore | exit 0 / exit 0, 27 tables identical, 6 guard triggers |
| BYPASSRLS mode | role, guard, archive, preflight, schema tests 138 passed / 1 skipped; plain `pg_dump` works |
| Deploy harness (WSL) | `test_deploy_pinning` 18 PASS, `test_deploy_guard_mutations` 29 PASS |

Evidence files: `studymap-qa-execution/v6/results/db-roles/`.

## 8. What the roles do not cover

- The owner role can still disable triggers, truncate and rewrite anything: it is used
  only by the migration step, and its credential stays out of the runtime environment
  (`migration.env`, enforced by `validate-env.sh` and the deploy harness). Anyone with
  shell access to the EC2 host can still read `migration.env`.
- The app and read-only roles must be members of no role at all: a `NOINHERIT`
  membership still allows `SET ROLE`, and predefined roles such as `pg_write_all_data`
  bypass table grants. `verify` fails on any membership (Codex task60).
- The app role can still `UPDATE` non-identity columns and `INSERT` anywhere it inserts
  (for example regrade a `quiz_answers` row, or delete and re-insert an attempt's
  `concept_masteries`). These are the product's own writes.
- `pg_restore` of an old backup, and anyone holding the owner's credentials.
- `SUPABASE_SECRET_KEY` itself: after `apply` it has no rights on StudyMap's tables, but
  it still controls Storage (documents' files) and any table a later migration creates
  before `apply` runs again (Supabase default privileges grant new tables to the API
  roles). `run_migrations` applies the contract in the same step; keep it that way.
