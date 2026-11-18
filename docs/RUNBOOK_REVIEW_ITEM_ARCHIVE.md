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

Until step 3 exits 0, do **not** start the new backend.
`BE/tests/test_review_item_archive_migration.py::test_the_upgrade_is_rerun_safe` runs
exactly steps 1-2 against a disposable database.

## 3. Rollback

- **Schema:** `alembic downgrade 20261115_attempt_submit_key` refuses while archived topics
  exist. Do not force it.
- **Code: no rollback below this release once a topic is archived.** Code older than
  this migration does not know `archived_at`, so it would:
  - show archived topics as current ones;
  - allow new practice from them;
  - on "Tạo lại kế hoạch", delete the plan, and the foreign key cascade would delete the
    archived topics with every practice quiz, attempt, answer and mastery row made from
    them.

  `scripts/rollback.sh` does not know this floor today. Before any rollback, check
  `SELECT count(*) FROM review_plan_items WHERE archived_at IS NOT NULL`. If it is not 0,
  roll back only to a SHA that contains this migration and its readers, or roll forward
  with a fix.
- A hard guard (a database trigger refusing to delete a plan that holds archived topics,
  or a schema floor in `rollback.sh`) is proposed and waits for owner approval; it is not
  part of this change.
