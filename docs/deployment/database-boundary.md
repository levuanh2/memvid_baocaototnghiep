# Database boundary — which Postgres is which

Written 2026-09-04 after a provenance audit found that the database the project
had been calling "production" contains **no production-origin document corpus**,
and that the live Render service is **no longer writing to it**.

Nothing here contains credentials. Databases are identified the only way that is
safe and correct: by **where they are actually reached**, never by account name.

---

## Configuration matrix

| Environment | URL comes from | Host | Database | Port | Purpose |
|---|---|---|---|---|---|
| local dev app | `BE/.env` → `DATABASE_URL` | `aws-0-ap-northeast-2.pooler.supabase.com` | `postgres` | 6543 (transaction pooler) | dev |
| local dev (root) | `.env` → `DATABASE_URL` | same host | `postgres` | 5432 (session pooler) | dev — **same database as the row above** |
| pytest (local) | `TEST_DATABASE_URL` only; **no fallback** | not configured on this machine | — | — | test |
| CI (`.github/workflows/ci.yml`) | `TEST_DATABASE_URL` at job scope | `localhost` (Postgres 16 service container) | `studymap_test` | 5432 | test |
| CI migration + smoke-boot steps | `DATABASE_URL`, set per step only | `localhost` | `studymap_test` | 5432 | test |
| CI docker-build job | `DATABASE_URL` placeholder | `localhost` | `ci_build_only` | 5432 | build-only, never connected |
| Render production | `DATABASE_URL`, `sync: false` in `render.yaml` | **not determinable from this repository** | — | — | production |
| alembic | `app.db.database_url()` (same resolution point as the app) | follows whichever environment it runs in | | | |

The dev database, measured read-only:

```
current_database()  postgres
server              PostgreSQL 17.6 on aarch64 (Supabase), port 5432
inet_server_addr()  2406:da12:5ca:b701:…            <- the actual server, not the pooler
contents            24 users / 11 documents / 189 chunks
```

### The pooler hostname identifies a region, not a project

Every Supabase project in a region answers on the same pooler hostname with the
same database name `postgres`. The project is selected by the **username**
(`postgres.<project_ref>`). Two consequences, both load-bearing:

- Host + database name cannot tell two Supabase projects apart.
- `app/db._danh_tinh_dich()` deliberately ignores the username, so it treats two
  *different* Supabase projects as the same target. That is fail-closed — it
  refuses a separate Supabase project as `TEST_DATABASE_URL`. Do not "fix" it by
  adding the username: that reopens the hole where two accounts pointing at one
  database read as two targets. Use a local Postgres or the CI container for
  tests (`scripts/setup_test_db.py`).

---

## What the dev database actually contains

Not a production corpus. Every one of its 11 documents carries a
`metadata_json.input_path` written by the server at upload time:

- 9 rows: `e:\memvid_NCKH\…\BE\input_docs\…` — a Windows workstation
- 2 rows: a pytest `tmp_path` directory

Render runs Linux and has no `E:` drive, so no row in that table arrived through
the production service. See `.playbook/known-issues.md`
("Không hàng nào trong 'DB production' do production nạp").

**These 11 documents / 189 chunks must never be promoted to a production corpus.**
They stay `eligible_for_index = false` in
`BE/config/production_index_allowlist.json`. Sample or demo data, if it is ever
wanted, has to be labelled as such and must not become production corpus by
default.

---

## Unresolved: which database does Render use today?

`DATABASE_URL` is `sync: false` in `render.yaml` — it lives only in the Render
dashboard, and no read-only API exposes its value. What measurement does say:

**It was this dev database, at least until 2026-09-03 ~13:33 UTC.** Two user
registrations match to the second across two independent devices:

| production request log | `users.created_at` in the dev DB |
|---|---|
| `2026-09-03T09:20:14.546Z POST /auth/register 201` (Chrome/Windows) | `levuanhhihihi@gmail.com` `09:20:14.266Z` |
| `2026-09-03T13:33:01.968Z POST /auth/register 201` (Android/Zalo) | `sunny@gmail.com` `13:33:01.696Z` |

Both rows land ~0.27 s before the response is logged, which is the right order
for insert-then-respond.

**It was not this database from 2026-09-03 ~17:17 UTC onward.** Six
`POST /auth/register` calls returned `201` from production between 17:17 and
17:23 (`fpt-smoke-<hex>@example.com`, `verify-<hex>@example.com`). `create_user`
has no fallback store — a `201` means a committed Postgres row. No such row
exists in the dev database (`SELECT count(*) … LIKE 'verify-%'` → 0), and nothing
in the codebase or the smoke scripts deletes users.

A deploy triggered through the Render API sits between the two observations
(`2026-09-03T17:06:52`).

Alembic has never logged a `Running upgrade` line on any Render build, including
the first one — so whichever database production talks to was already at head
before Render ever connected to it.

**Do not guess past this point.** Determining the live value requires reading the
environment variable in the Render dashboard, which is a human step.

---

## Intended flow for real production data

```
real production user
      ↓
Render production API  (studymap-api)
      ↓
production PostgreSQL          <- identity must be confirmed first
      ↓
documents / document_chunks
      ↓
explicit allowlist             BE/config/production_index_allowlist.json
      ↓  (CONFIRMED_PRODUCTION + eligible_for_index = true, human decision, via PR)
embedding
      ↓
FAISS index
      ↓
Supabase Storage persistence
```

Two rules this diagram encodes:

1. A rebuild runs against the **real** production database, only when invoked
   explicitly. The dev/test database is never a corpus source.
2. Absence from the allowlist is never permission. `AMBIGUOUS`, `CONFIRMED_TEST`,
   `UNKNOWN`, and `CONFIRMED_PRODUCTION` with the flag off are all "not eligible".

## Before any production corpus work

1. Read `DATABASE_URL` from the Render dashboard and record its host, database
   name, and port here (never the credentials).
2. Inspect that database read-only. Record users / documents / chunks. Do not
   assume it is empty.
3. Inventory any documents it holds as `UNREVIEWED`, `eligible_for_index = false`.
   Classify only on direct evidence, one document at a time.
