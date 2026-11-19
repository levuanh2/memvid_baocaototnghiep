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
   - `DELETE` of a review plan holding archived topics while its attempt, user and
     document all still exist (old-code regeneration, hand delete);
   - `DELETE` of an archived topic while its plan exists (direct, or children first);
     `UPDATE` that un-archives it or moves it to another plan;
   - `TRUNCATE` of `review_plans` or `review_plan_items` while archived topics exist.

   Not refused: deleting a document (Library) or an account, or an attempt, still removes
   everything made from it, archived history included, exactly as before #194. The new
   code's archiving and FK `SET NULL` updates are not affected.
   `verify_db_schema` fails while any guard trigger or function is missing or disabled.
2. **Rollback floor** in `scripts/rollback.sh`, before any checkout or build:
   `scripts.rollback_preflight` reads `archive_schema`, `archived_topics` and `guard`
   read-only. With archived topics, a target SHA is accepted only if its tree contains
   migrations `20261118_review_item_archive` and `20261119_review_item_guard` and its
   `BE/app/domains/review/service.py` knows `archived_at`. A failed or unreadable
   preflight refuses. `MEMVID_BREAK_GLASS` does not skip it.

Rules:
- **Schema:** `alembic downgrade` refuses below `20261119` and below `20261118` while
  archived topics exist. Do not force it.
- **Code:** roll back only to a SHA containing both migrations, or roll forward with a fix.
- **No automatic bypass.** Disabling a guard trigger (`ALTER TABLE ... DISABLE TRIGGER`)
  or skipping the preflight is a manual, owner-approved incident step, recorded in the
  incident log, and the verifier then blocks every deploy until the trigger is enabled
  again. Before doing it, export the archived history (step 1 queries, plus the practice
  quizzes listed in `archived_items`).
- Not covered: `pg_restore` of an older backup over the database, or a superuser session
  with `session_replication_role = replica` (triggers off). Both are owner-only
  operations covered by the backup/restore runbook, not by this guard.
