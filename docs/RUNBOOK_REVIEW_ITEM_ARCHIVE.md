# Runbook: review plan topic archive schema (migration `20261118_review_item_archive`)

Use this when `scripts.verify_db_schema` reports a problem with `review_plan_items.archived_at`,
`uq_review_plan_items_priority_active` or `uq_review_plan_items_priority`. For the practice
submit-key index, use `RUNBOOK_SUBMIT_KEY_INDEX.md` instead.

Every step is manual, owner-approved, and run against the database the verifier named.
Never delete or update rows of `review_plan_items` to make a check pass: archived topics
hold the practice history the migration exists to keep.

## 1. Read the facts (read-only)

```sql
SELECT column_name FROM information_schema.columns
 WHERE table_schema = current_schema() AND table_name = 'review_plan_items'
   AND column_name = 'archived_at';
SELECT i.indexrelid::regclass, i.indisvalid, i.indisready, i.indisunique,
       pg_get_indexdef(i.indexrelid)
  FROM pg_index i WHERE i.indexrelid = to_regclass('uq_review_plan_items_priority_active');
SELECT conname FROM pg_constraint
 WHERE conname = 'uq_review_plan_items_priority';
SELECT count(*) AS archived FROM review_plan_items WHERE archived_at IS NOT NULL;
SELECT version_num FROM alembic_version;
```

## 2. Recover

`scripts.run_migrations` runs only `upgrade head`. When `alembic_version` already says
`20261118_review_item_archive`, it reruns nothing (Codex task48). To rerun this revision
(every step checks first, so a rerun is safe), set the version back one step, then
migrate and verify. Owner-approved, one command at a time, on the EC2 host
(production) or with `--moi-truong test` on a test database:

```bash
# 1. Metadata only: no DDL, no data change. The env.py target guard applies.
docker compose -f docker-compose.prod.yml run --rm -e ALEMBIC_ALLOW_PRODUCTION=1   backend alembic stamp 20261115_attempt_submit_key
# 2. Reruns 20261118: adds the column if absent, builds and verifies the index,
#    drops the old constraint only after that.
docker compose -f docker-compose.prod.yml run --rm -e ALEMBIC_ALLOW_PRODUCTION=1   backend python -m scripts.run_migrations --moi-truong production
# 3. Read-only; only exit 0 allows the backend to start.
docker compose -f docker-compose.prod.yml run --rm -e ALEMBIC_ALLOW_PRODUCTION=1   backend python -m scripts.verify_db_schema --moi-truong production
```

| Verifier problem | Before step 1 |
|---|---|
| column `archived_at` is missing | nothing; steps 1-3 |
| index is missing | nothing; steps 1-3 |
| index is INVALID / not ready / wrong columns or predicate | `DROP INDEX CONCURRENTLY uq_review_plan_items_priority_active;` (outside a transaction), then steps 1-3. Step 2 refuses to drop the old constraint until the new index verifies |
| constraint `uq_review_plan_items_priority` still exists | check step-1 facts: with archived topics present the constraint cannot have been re-added; then steps 1-3 |
| guard trigger or function missing, or trigger disabled | nothing; steps 1-3 (the stamp to `20261115` reruns `20261118` and `20261119`, both rerun-safe); a disabled trigger is re-created enabled |

Until step 3 exits 0, do **not** start the new backend.
`BE/tests/test_review_item_archive_migration.py::test_the_upgrade_is_rerun_safe` runs
exactly steps 1-2 against a disposable database.

## 3. Rollback and the two guards (owner decision 2026-11-19)

Code older than this release does not know `archived_at`. On "Tạo lại kế hoạch" it
deletes the plan, and the foreign key cascade would take the archived topics with every
practice quiz, attempt, answer and mastery row made from them. Two layers stop that:

1. **Database guard** (migration `20261119_review_item_guard`), fail closed with SQLSTATE
   23001 and a hint naming this runbook (no row data in the message):
   - `DELETE` of a review plan holding practice history (an archived topic, or a practice
     quiz made from one of its topics) while its attempt, user and document all
     still exist (old-code regeneration, also before any archive exists; hand delete);
   - `DELETE` of an archived topic, or of a topic with practice quizzes, while its plan
     exists (direct, or children first);
   - any `UPDATE` or upsert of a topic with history (archived, or active with practice)
     except archiving an active one and its three nullable references being set to NULL
     (FK `ON DELETE SET NULL`): history is read-only;
   - `TRUNCATE` of `review_plans` or `review_plan_items` while any practice history exists.

   - `INSERT` of a practice quiz from an archived topic (or moving one onto it), whatever
     path inserts it. It locks in the regeneration's order (the plan's attempt, then the
     topic), so a worker racing a regeneration waits and is refused, never deadlocks;
   - `DELETE` of a practice quiz while its topic, plan, attempt, account and document
     exist; `DELETE` of any quiz (also the diagnostic one) whose attempts own a plan with
     history while its user and document exist; changing a practice quiz's provenance
     (`source_review_item_id`, `source_attempt_id`, `quiz_type`); `TRUNCATE quizzes`.

   Each guard function pins `search_path = <schema>, pg_temp`, so a session's
   temporary tables cannot shadow the tables it checks.

   Not refused (owner decision 2026-11-19, item 4): a HARD delete of a document (the
   sources sidebar "Xóa": `DELETE /sources/<id>` and `/delete-source`), or of an account
   or attempt row, still removes everything made from it, archived history included,
   exactly as before #194. The sidebar says so in a permanent-delete dialog with an
   explicit checkbox; only the owner can do it (404 otherwise). The Library's "Xoá"
   (`DELETE /api/documents/<id>`) is a SOFT delete: it hides the document and keeps all
   history. The app has no account-delete route today. `hard_delete` locks the
   document's attempts, then its plans, before the cascade, in the regeneration's order,
   so it never deadlocks with one. The new code's archiving and FK `SET NULL` updates are
   not affected.
   Every guard decision first locks the attempt that owns the plan (a regeneration holds
   it `FOR UPDATE`, a practice insert `FOR KEY SHARE`, the delete guards take it `FOR
   UPDATE`), then judges history with a fresh snapshot: a delete racing a regeneration or
   a practice insert waits and is refused. Accepted (owner item 5): only an OLD-code plan
   delete racing a regeneration may deadlock; PostgreSQL aborts one transaction and no
   history is lost (the surviving delete is judged under the lock). A deadlock between
   two current-code flows is a bug.
   `verify_db_schema` fails while any guard trigger is missing, disabled, on the wrong
   event or calling the wrong function, or a guard function's body differs from the
   contract in `BE/shared/db_schema_checks.py`.
2. **Rollback floor** in `scripts/rollback.sh`, before any checkout or build:
   `scripts.rollback_preflight` prints exactly one line
   `archive_schema=<0|1> history_topics=<n> guard=<0|1>` (read-only; history = a topic
   that is archived or has a practice quiz). Then:
   - archive schema present and `guard=0`: refused (restore the guard first, section 2);
   - archive schema present and a target that is not archive-aware: refused, with or
     without history yet (history can appear while the rollback builds; the schema only
     changes under the deploy lock this script holds). Code before #194 regenerates by
     deleting the plan, which the guard refuses, so it would be broken. Archive-aware means
     the TARGET tree carries both migrations and `BE/shared/archive_contract.py` with
     `ARCHIVE_CONTRACT_VERSION = 1`, whose behaviour CI enforces (a keyword is not proof);
   - preflight failed, or its stdout is not exactly that one line: only an archive-aware
     target may go (safe whatever the facts), so a database outage does not block an
     emergency rollback to a safe SHA; any other target is refused.
   `MEMVID_BREAK_GLASS` does not skip any of this.

   **Database down and a rollback is urgent:** roll back to the newest ledgered SHA that
   is archive-aware (`git show <sha>:BE/shared/archive_contract.py`). A pre-archive SHA
   cannot be rolled back to until the database answers.

Rules:
- **Schema:** `alembic downgrade` refuses below `20261119` and below `20261118` while
  any topic holds practice history (archived, or with practice quizzes); both lock
  `review_plans`, `review_plan_items` and `quizzes` against writes
  before counting and keep the lock until the last DDL (no autocommit step), so no
  archive can commit in between. Do not force it.
- **Code:** once #194 is deployed and any practice exists, roll back only to an
  archive-aware SHA, or roll forward with a fix. During the few seconds of the #194
  deploy between its migration and the new backend, the old backend's "Tạo lại kế
  hoạch" on a plan with practice fails (23001) instead of deleting history.
- **No automatic bypass.** Disabling a guard trigger (`ALTER TABLE ... DISABLE TRIGGER`)
  or skipping the preflight is a manual, owner-approved incident step, recorded in the
  incident log, and the verifier then blocks every deploy until the trigger is enabled
  again. Before doing it, export the archived history (step 1 queries, plus the practice
  quizzes listed in `archived_items`).
- Not covered: `pg_restore` of an older backup over the database, or a superuser session
  with `session_replication_role = replica` (triggers off). Both are owner-only
  operations covered by the backup/restore runbook, not by this guard.

## 4. Residual risks (owner decision 2026-11-19)

The guard covers old code and mistaken deletes of plans, topics and practice quizzes. It
does **not** make practice history immutable, and nobody should claim it does. Accepted,
documented risks:

| # | Not covered | Why it stays | Limited by |
|---|---|---|---|
| R1 | Hand-written `UPDATE`/`DELETE` on `quiz_questions`, `quiz_answers`, `review_item_chunks`, `concept_masteries` | valid product flows write them (regrade, gap analysis, document re-ingest); a trigger cannot tell those from a hand edit | role split below; hand SQL only through the read-only role |
| R2 | Hand `UPDATE` of identity columns (`review_plans.attempt_id/user_id/document_id`, `quizzes.document_id/user_id`, `quiz_attempts.quiz_id/user_id`): moves history under another parent, a later cascade can then take it | out of the agreed scope (owner item 1) | role split; column-level `UPDATE` grants are a follow-up needing approval |
| R3 | A hard delete of a document (sources sidebar), account or attempt removes its history | product decision (owner item 4); warned in a permanent-delete dialog, owner-only | `BE/tests/test_review_history_document_delete.py` |
| R4 | Deadlock between an OLD-code plan delete and a regeneration | owner item 5: aborted safely, nothing lost; only during a mixed-version window | current-code flows lock attempt then plan (same test file) |
| R5 | `pg_restore` of an old backup, a superuser, or the table OWNER disabling or dropping triggers | ownership can always change its own tables | role split: the runtime role must not own the tables |
| R6 | Seconds between migration and new backend in the #194 deploy: old code's "Tạo lại kế hoạch" on a plan with practice fails with 23001 | refusing is the guard's job | deploy window 01:00-03:00 (Vietnam time), after the 7 NO-GO conditions |

## 5. Least-privilege database roles (proposal, NOT applied)

Today the backend and the migrations use the same `DATABASE_URL`, so the runtime role
owns the tables and can `ALTER TABLE ... DISABLE TRIGGER`, `DROP TRIGGER`, `TRUNCATE`
(R5). Proposed split, verified only on a disposable PostgreSQL 17 cluster
(`least-privilege-probe.log` in the V6 QA evidence; Supabase not tested, no hosted
access was used):

| Role | Used by | Rights |
|---|---|---|
| `studymap_owner` | `scripts.run_migrations` only (deploy step) | owns schema, tables, guard functions; DDL |
| `studymap_app` | backend runtime (`DATABASE_URL`) | `LOGIN NOSUPERUSER`; `SELECT, INSERT, UPDATE, DELETE` on tables, `USAGE, SELECT` on sequences; no `TRUNCATE`, `TRIGGER`, `REFERENCES`, no `CREATE` on the schema; **needs `BYPASSRLS` or RLS policies** |
| `studymap_readonly` | `scripts.rollback_preflight`, `verify_db_schema`, support queries | `SELECT` only |

Probe results for a non-owner DML role: `DISABLE TRIGGER`, `DROP TRIGGER`, `TRUNCATE`,
replacing a guard function, `SET session_replication_role = replica` and `DISABLE ROW
LEVEL SECURITY` are all refused (42501). Ordinary DML works. **Pitfall:** RLS is enabled
on 26 of 27 tables with no policies; a role without `BYPASSRLS` silently reads 0 rows
(no error), so the app would look empty. Before applying: confirm Supabase allows
granting `BYPASSRLS` (or write policies), add a separate migration URL to `alembic/env.py`
and the deploy scripts, and rehearse on a test database. Every step needs owner approval.
