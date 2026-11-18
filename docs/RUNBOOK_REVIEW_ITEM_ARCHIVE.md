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

| Verifier problem | Recovery |
|---|---|
| column `archived_at` is missing | The revision was stamped without its first step. Rerun `scripts.run_migrations` (every step checks first). |
| index is missing | Rerun `scripts.run_migrations`: it builds the index `CONCURRENTLY`, verifies it, then drops the old constraint. |
| index is INVALID / not ready / wrong columns or predicate | `DROP INDEX CONCURRENTLY uq_review_plan_items_priority_active;` then rerun `scripts.run_migrations`. While the index is missing or broken, **do not** start the new backend: the verifier blocks it, and it must stay blocked. |
| constraint `uq_review_plan_items_priority` still exists | Rerun `scripts.run_migrations`; it drops the constraint only after the index is verified. If it was re-added by hand while archived topics exist, the `ADD` itself would have failed; check step 1 before anything else. |

After each recovery, run `scripts.verify_db_schema` again; only exit 0 allows the backend
to start.

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
