# Library Action Matrix: OFF vs ON on the real stack

Owner: Claude. Run on 2026-11-01 at about 16:34Z.

| Item | Value |
|---|---|
| Source tree | `c02e2b9` |
| Backend | Real Flask (`BE/scripts/run_e2e_server.py`); only the AI provider is stubbed |
| Database | Disposable Postgres 16 in Docker (`r82-pg`), migrated to head |
| Auth | `AUTH_PROTECT_APP_APIS=true`, as in production, where a request without a token gets 401 |
| OFF frontend | `c02e2b9` built with the flag unset, on `:4173`. This matches the production bundle |
| ON frontend | Same tree built with `VITE_LIBRARY_ACTION_MATRIX=true`, on `:4174`. This build was never deployed |

Files:

- Spec: `library-flag-real-backend.spec.js`
- Config: `library-flag.config.mjs`
- Raw results: `results.json`

| Check | Expected | Observed | Result |
|---|---|---|---|
| OFF renders the legacy Library | Legacy multiselect list visible, no matrix region | As expected | PASS |
| ON renders the Learning Action Matrix | Matrix region visible; "1 tài liệu phù hợp" for a fresh account with one upload | As expected | PASS |
| Browser Back restores Library state (ON) | A query is kept after an in-app navigation ("Phòng đọc") followed by Back | Query and the "0 tài liệu phù hợp" projection were restored | PASS |
| State is stored per account | Exactly one `memvidx.library.actionMatrix.v1:<userId>` key | 1 key | PASS |
| No cross-account Library state leak, same tab | Account B, registered after A, sees an empty search and none of A's query text | As expected | PASS |
| Server-side document isolation | B's `/api/documents` does not list A's document; `GET /api/documents/<A>` as B is rejected | Not listed; **404** | PASS |
| Bulk scope uses visible UUIDs only | — | Not re-run here. Covered by `libraryActionMatrix` unit tests and fixture spec `round6-library-action-matrix` (see `codex2/regression.md`) | See Codex2 |
| Readiness gates (R8-004) | — | Covered by the 44 unit/component tests (see `codex2/regression.md`) | See Codex2 |

## Environment finding

The CI end-to-end server runs with `AUTH_PROTECT_APP_APIS=false`, which is
open mode. In open mode every account shares one anonymous owner. The first
run of this probe in open mode showed a newly registered account the 8
documents uploaded by earlier test accounts.

This is test-harness behaviour, not a production defect. Production returns
401 for unauthenticated `/api/documents` and `/api/progress/attempts`, and the
protected local run isolates accounts. It does mean that **CI's E2E Critical
job cannot detect a cross-account leak**. The critical suite was therefore
also re-run locally with protection on: 40/40 passed (see `../critical-e2e/`).
