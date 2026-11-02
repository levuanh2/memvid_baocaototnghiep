# Round 8.2 — Backend stack and pytest gate

- Git SHA: `c02e2b91ae2207d472756cd34003b5cb6fee1620` (`origin/main` at audit start).
- Environment: Windows host; Python 3.11.9; Node v22.18.0; npm 11.12.1; Playwright 1.64.1; Flask 3.1.2; SQLAlchemy 2.0.36; Alembic 1.18.5; Docker 29.5.3; PostgreSQL/psql 16.15.
- Timestamp: 2026-11-02 Asia/Saigon release-gate session.
- Real vs mocked: pytest used real disposable PostgreSQL through `TEST_DATABASE_URL`; the shared E2E backend is the real Flask app with `SKIP_MODEL_LOAD=1` and its documented deterministic graph substitutions. No production service or database was contacted.

## Shared stack handoff and verification

Task 1 was completed by Claude before this runner was reassigned. Codex1 did not rerun the critical suite or restart the shared stack after that handoff.

| Component | URL/port | Observed | Verdict |
|---|---|---|---|
| Postgres container `r82-pg` | `127.0.0.1:55432`, database `studymap_test` | PostgreSQL 16.15; Alembic head `20261001_job_usage_ctx` | PASS |
| Protected Flask backend | `http://127.0.0.1:8080` | `/health` 200, mode `ci`, query/ingest graphs ready, production-role stub warning present | PASS |
| Production FE build | `http://127.0.0.1:4173` | HTTP 200; built with API URL 8080 and library flag off | PASS |
| Critical Playwright suite | shared stack | Claude handoff reports 40/40 in open-auth mode | NOT RERUN BY CODEX1 |

## Exact Task 2 command

Run from `FE/`:

```powershell
npx playwright test -c e2e-r82-codex1/playwright.config.js
```

Final result: **1 passed, 0 failed, 0 skipped**, 14.37s. The config uses the already-running protected backend/frontend and writes only to `round8-2-qa-evidence/codex1`.

## Exact Task 3 command

Run from `BE/`:

```powershell
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
$env:TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:55432/studymap_test'
$env:SKIP_MODEL_LOAD='1'
$env:MEMVID_DISABLE_LC_DEFAULTS='1'
$env:GUIDED_MINDMAP_V3_ENABLED='true'
$env:GUIDED_JOB_STORE_BACKEND='sqlite'
$paths = Get-ChildItem -LiteralPath 'tests' -File -Filter 'test_*.py' | Where-Object { $_.Name -match '(?i)(export|pdf|quiz|attempt|persistence)' } | Sort-Object Name | ForEach-Object { $_.FullName }
python -m pytest @paths -ra --junitxml='..\docs\ui-ux-v4-design\round8-2-qa-evidence\codex1\backend-pytest-junit.xml'
```

Selection: 36 files total — the same 26 export/PDF files from Round 8.1 plus 10 files matching quiz/attempt/persistence (`test_attempts_use_case.py`, `test_index_persistence.py`, `test_quiz_attempt.py`, `test_quiz_dispatch_use_case.py`, `test_quiz_generation.py`, `test_quiz_job_dedupe.py`, `test_quiz_job_ket.py`, `test_quiz_lua_chon_trung.py`, `test_quiz_ngan_sach_va_loi.py`, `test_quiz_prompt_va_bu_cau.py`).

- Expected: all selected tests execute against disposable DB with no skips or production access.
- Observed: **503 passed, 0 failed, 0 skipped, 4 warnings** in 70.14s.
- Warnings: three SWIG deprecations and one LangGraph pending-deprecation warning; no test or DB isolation warning.
- Verdict: **PASS**.
- Raw result: `backend-pytest-junit.xml`.

Worktree note: existing modified Round 6 screenshots/metrics and other agents' untracked evidence/runner directories were left untouched. Codex1 wrote only `FE/e2e-r82-codex1/` and `docs/ui-ux-v4-design/round8-2-qa-evidence/codex1/`.
