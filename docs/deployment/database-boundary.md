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
| Render production | `DATABASE_URL`, `sync: false` in `render.yaml`; value read from the Render dashboard on 2026-09-04 | `aws-0-ap-northeast-2.pooler.supabase.com` | `postgres` | 5432 | production — **the same database as local dev** |
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

## What the production database actually contains

Not a production corpus — even though it is the production database. Every one of its 11 documents carries a
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

## Which database does Render use? — answered 2026-09-04

`DATABASE_URL` is `sync: false`, so no API exposes it. A human read it from the Render
dashboard (`studymap-api` → Environment). Its host, port, database name, and Supabase
project reference are **identical to the local development `DATABASE_URL`**.

```
host      aws-0-ap-northeast-2.pooler.supabase.com
port      5432                       (BE/.env uses 6543 — the other pooler on the same DB)
database  postgres
project   same Supabase project reference as local dev (verified by comparison, not printed)
```

**There is one database.** Render production, the local application, and — until commit
`3058272` — the pytest suite all write to it. The audit numbers below are therefore the
production numbers.

### Correction: an earlier inference here was wrong

An earlier revision of this document argued that production had stopped writing to this
database, because six `POST /auth/register` calls returned `201` on 2026-09-03 between
17:17 and 17:23 UTC and no matching `users` row exists.

That reasoning was unsound, and the flaw is worth keeping: **absence proves nothing in
this database, because rows are routinely hard-deleted from it.** Measured read-only:

```
distinct document_id values ever referenced by jobs   1401
jobs still pointing at a surviving document              4
documents currently in the table                        11
orphaned document_chunks                                 0
```

Roughly 1 397 documents have been created and hard-deleted here over its lifetime — the
pytest suite ran against this database for weeks. A missing row is the normal state, not
a signal. The two second-exact registration matches (2026-09-03 09:20:14 and 13:33:01)
remain valid positive evidence; only the negative inference was wrong.

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

## Production corpus inventory (read-only, 2026-09-04)

```
users            24
documents        11        completed 8 | processing 2 | failed 1
document_chunks 189        1 document has zero chunks
```

| # | filename | owner | status | chunks | created (UTC) | ingested from |
|---|---|---|---|---|---|---|
| 1 | `2-day24-ragas-guardrails.pdf` | demo@local.test | completed | 132 | 2026-08-21 04:35 | workstation |
| 2 | `slide-giai-tich.pptx` | smoke+11ffbb29@local.test | completed | 1 | 2026-08-24 05:22 | workstation |
| 3 | `diem-lop.xlsx` | smoke+11ffbb29@local.test | completed | 1 | 2026-08-24 05:22 | workstation |
| 4 | `tich-phan.html` | smoke+11ffbb29@local.test | completed | 1 | 2026-08-24 05:22 | workstation |
| 5 | `giao-trinh.epub` | smoke+11ffbb29@local.test | completed | 1 | 2026-08-24 05:22 | workstation |
| 6 | `Bai giang dao ham.pptx` | demo@local.test | completed | 2 | 2026-08-24 08:06 | workstation |
| 7 | `Day08- RAG Pipeline.docx` | test2@local.com | completed | 18 | 2026-08-25 04:49 | workstation |
| 8 | `[VinUn_20k] Đào tạo hội nhập.pptx` | test2@local.com | **failed** | 31 | 2026-08-25 04:49 | workstation |
| 9 | `thu-don-tam-f3633a.html` | demo@local.test | completed | 1 | 2026-08-25 11:37 | workstation |
| 10 | `cua nguoi khac.md` | search_o_92cd43f9@example.com | processing | 1 | 2026-09-04 03:37 | pytest tmp_path |
| 11 | `own (2).md` | owner_ac21137b@example.com | processing | **0** | 2026-09-04 03:37 | pytest tmp_path |

Two rows never finished: #8 failed with `disk I/O error`; #10 and #11 are still
`processing` because the pytest run that created them ended mid-pipeline.

All eleven remain `eligible_for_index = false`. Their classifications
(7 `CONFIRMED_TEST`, 4 `AMBIGUOUS`) were established from direct evidence in
`BE/config/production_index_allowlist.json` and are **not** downgraded to
`UNREVIEWED` — that would discard evidence, not add caution.

## Before any production corpus work

1. `DATABASE_URL` identity: recorded above. Re-check it after any Render env change.
2. Inspect read-only. Record users / documents / chunks. Do not assume it is empty.
3. Inventory new documents as `UNREVIEWED`, `eligible_for_index = false`.
   Classify only on direct evidence, one document at a time.
4. Nothing here is eligible today, so there is nothing to embed or index yet. A real
   production corpus starts with the first upload that arrives through
   `studymap-api` — its `input_path` will be a Linux path, not an `E:` drive.
