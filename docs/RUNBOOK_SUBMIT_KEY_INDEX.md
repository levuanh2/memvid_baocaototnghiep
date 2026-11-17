# Runbook: `uq_quiz_attempts_user_submit_key` failed verification

Applies to migration `20261115_attempt_submit_key` (#185) and to
`python -m scripts.verify_db_schema`. Every step that changes the database is **manual and
needs the owner's approval for that run**. Nothing in the code drops, rebuilds or reindexes
this index on its own.

## What the index guarantees

`UNIQUE (user_id, submit_key) WHERE submit_key IS NOT NULL` on `quiz_attempts`: one
practice submission per idempotency key per learner. If it is missing or INVALID, two
retries with the same key can create two attempts and grade twice. The new backend relies
on it; the deploy does not start the new backend unless it is proven.

## When you get here

- The migration stopped with `uq_quiz_attempts_user_submit_key failed verification: …`
  (Alembic did **not** stamp `20261115_attempt_submit_key`), or
- `deploy.sh` stopped at step 5b: `database verification failed after migration — new
  backend NOT started`. The previous backend keeps serving.

Do **not** run `scripts.run_migrations --go-lui` (downgrade): it drops the three columns
and the keys already stored in them.

## 1. Read the state (read-only)

```sql
SELECT c.relname, n.nspname, t.relname AS table_name, i.indisvalid, i.indisready,
       i.indisunique, pg_get_indexdef(i.indexrelid) AS definition
  FROM pg_index i
  JOIN pg_class c ON c.oid = i.indexrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_class t ON t.oid = i.indrelid
 WHERE c.relname = 'uq_quiz_attempts_user_submit_key';

-- A build still running (do not act while one is):
SELECT pid, phase, blocks_done, blocks_total FROM pg_stat_progress_create_index;

-- Duplicate keys that would make a new build fail again:
SELECT user_id, submit_key, count(*) FROM quiz_attempts
 WHERE submit_key IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1;

SELECT version_num FROM alembic_version;
```

Expected good state: one row, `indisvalid = t`, `indisready = t`, `indisunique = t`,
definition `CREATE UNIQUE INDEX uq_quiz_attempts_user_submit_key ON public.quiz_attempts
USING btree (user_id, submit_key) WHERE (submit_key IS NOT NULL)`.

## 2. Decide

| What step 1 shows | Cause | Action (after approval) |
|---|---|---|
| `indisvalid = f` and no build in progress | interrupted `CREATE INDEX CONCURRENTLY` (lost connection, timeout, cancel, duplicate) | 3a, then 4 |
| Duplicate rows returned | two attempts already share a key | resolve them first (3b), then 3a and 4 |
| Index exists, wrong columns, not unique or no `WHERE` | created by hand or by another tool | 3a, then 4 |
| No row, `alembic_version` = `20261115_attempt_submit_key` | dropped after the migration | 4 |
| No row, `alembic_version` older | migration stopped before the build | rerun the migration (step 5) |

## 3a. Remove the broken index (manual, approved)

```sql
DROP INDEX CONCURRENTLY IF EXISTS public.uq_quiz_attempts_user_submit_key;
```

`CONCURRENTLY` does not block reads or writes on `quiz_attempts`. It cannot run inside a
transaction block (use `psql` with autocommit).

## 3b. Duplicate keys (manual, approved)

Do not delete attempts. Look at each pair (status, score, `submitted_at`); keep the key on
the attempt the learner saw, and clear it on the other:
`UPDATE quiz_attempts SET submit_key = NULL WHERE id = '<attempt id>';`
Record the ids in the incident note.

## 4. Build it again (manual, approved)

```sql
SET lock_timeout = '5s';   -- fail fast instead of queueing behind long transactions
CREATE UNIQUE INDEX CONCURRENTLY uq_quiz_attempts_user_submit_key
    ON quiz_attempts (user_id, submit_key) WHERE submit_key IS NOT NULL;
```

If it fails again, it leaves another INVALID index: go back to step 1.

## 5. Verify, then resume the deploy

```bash
docker compose -f docker-compose.prod.yml run --rm -e ALEMBIC_ALLOW_PRODUCTION=1 backend \
    python -m scripts.verify_db_schema --moi-truong production
```

Exit 0 and the line `uq_quiz_attempts_user_submit_key valid, ready, unique` are required.
If `alembic_version` is still older, run the migration (it builds nothing when a valid index
exists, and verifies it):
`… backend python -m scripts.run_migrations --moi-truong production`, then verify again.
Then rerun the deploy for the same SHA; it repeats migration and verification before
starting the backend.

## Exit codes of `scripts.verify_db_schema`

| Code | Meaning |
|---|---|
| 0 | verified |
| 2 | target refused (wrong environment class or flag) |
| 3 | schema problem; the problems are listed on stderr |
| 4 | database unreachable; treated as a failure, never as a pass |
