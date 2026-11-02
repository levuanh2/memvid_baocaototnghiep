# Git and deployment verification

Owner: Claude. Checked 2026-11-01 16:05–16:30 UTC from the audit worktree
`.worktrees/phase-c-round8-2-release-gate` (branch
`audit/studymap-v4-round8-2-release-gate`, created from `origin/main`).
Production was probed read-only: no login, no upload, no write request.

## GitHub

| Check | Method | Observed | Result |
|---|---|---|---|
| `origin/main` HEAD | `git fetch origin` then `git rev-parse origin/main` | `c02e2b91ae2207d472756cd34003b5cb6fee1620`, not advanced since the brief | PASS |
| PR #98 merged | `gh pr view 98 --json state,mergedAt,mergeCommit,headRefOid` | `MERGED` at 2026-11-01T15:28:08Z, merge commit `c02e2b9`, head `fb6aaec` | PASS |
| Merge reachable from main | `git log origin/main` | `c02e2b9` is the tip | PASS |
| Merge introduced nothing beyond the PR | `git diff --stat fb6aaec c02e2b9` | empty: the merge tree is byte-identical to the reviewed PR head | PASS |
| Backend code touched by Round 8.1 | `git diff --stat 16fcc84 c02e2b9 -- BE scripts docker-compose.prod.yml` | empty | n/a: the backend redeploy changed no backend code |
| Post-merge CI | `gh run view 41321373798` | push on `c02e2b9`, `success`. All 10 jobs succeeded, including Backend Unit & Contract, Backend Integration & Migrations, Docker Build, Docker Compose Run, E2E Critical Flows and Frontend Tests | PASS |
| Deploy workflow | `gh run view 41321856500` | `workflow_run` on `main` at `c02e2b9`, `success`, 15:33:52–15:36:04Z | PASS |

## Backend (AWS EC2, `api.studymap.space`)

Production topology is taken from `docs/PRODUCTION_RELEASE_GATE.md` ("Architecture
correction") and `.github/workflows/deploy.yml`:

- The backend runs on EC2 with Docker Compose.
- The frontend is the Render static site `studymap-web`, configured with
  `autoDeploy: true` from `main` (`render.yaml`).

Deploy log lines from run 41321856500. Secrets are masked by GitHub; the EC2 host appears as `***`.

```
15:34:03  16fcc84..c02e2b9  main -> origin/main
15:34:05  Updating 16fcc84..c02e2b9 / Fast-forward
15:34:08  HEAD is now at c02e2b9 Merge pull request #98 ...
15:35:02  [alembic] target: <supabase pooler> (production mode)
15:36:00  Container memvid_backend Healthy
15:36:00  backend healthy after 0s
15:36:01  memvid_backend ... Up 33 seconds (healthy)
```

| Check | Observed | Result |
|---|---|---|
| Revision checked out on EC2 | `c02e2b9`, according to the deploy log | PASS (log evidence) |
| Container rebuilt and restarted | Container started about 15:35:28Z and reported healthy | PASS |
| Live `/health` (16:15Z) | `200 {"status":"ok","mode":"normal","query_graph_ready":true,"ingest_graph_ready":true}`. No `SKIP_MODEL_LOAD` warning | PASS |
| Live `/ready` | `200 {"status":"ready","queue_depth":0,"admission_available":4,...}` | PASS |
| Running version exposed by the service | None: `/health` and `/ready` carry no build SHA | LIMITATION |

The running backend revision is attested only by the deploy job log. No
runtime identifier confirms it independently. Two facts limit the risk:

- Round 8.1 changed no file under `BE/`.
- `/health` and `/ready` behave as expected.

The deploy also ran `alembic upgrade` against production. Round 8.1 added no
migration, so that step was a no-op.

## Frontend (Render static site, `studymap.space`)

The frontend exposes no build SHA either. Its revision was identified by
content instead:

1. Fetch the production `index.html` and the entry chunk (`index-BH73g2k0.js`,
   `index-DF97yNpU.css`), plus every chunk the entry chunk references.
   This gives 34 files.
2. Build `c02e2b9` locally with
   `VITE_API_BASE=https://api.studymap.space npx vite build`. The Library
   flag is left unset.
3. Compare each production file with its local counterpart after two
   normalisations:
   - replace chunk-hash references with `HASH`;
   - remove Windows-checkout CRLF, which Vite emits as a literal `\r` in
     template literals.

   Script: `claude/cmp_bundles.py`.

Result: **34/34 match**. Raw output: `claude/prod-frontend-bundle-compare.txt`.

`index-DF97yNpU.css` matches even by exact hash. Production `index.html` has
`last-modified: 2026-11-01 15:28:39 UTC`, which is after the merge at 15:28:08Z.

`16fcc84..c02e2b9` changes 19 files under `FE/src`, among them the Quiz
autosave barrier and the export commit boundary. A pre-merge build therefore
could not have matched. Production serves the Round 8.1 frontend.

## Library Action Matrix flag

| Check | Observed | Result |
|---|---|---|
| How the flag is read | `FE/src/utils/libraryActionMatrixFlag.js`: on only when `VITE_LIBRARY_ACTION_MATRIX === "true"` at build time | — |
| Production bundle | Matches a local build with the flag unset, 34/34 normalised | OFF |
| Production env changed by this audit | No | PASS |

## Read-only production probes

Raw data:

- `claude/prod-unauth-browser-probe.json`, produced by script `claude/prod-unauth-browser-probe.mjs`.
- `claude/prod-index-headers.txt`.

| Probe | Observed | Result |
|---|---|---|
| `https://studymap.space/`, `/app`, `/login` in Chromium at 390×844 and 1440×900 | Status 200. `/app` redirects to `/login?next=%2Fapp`. 0 console errors, 0 failed requests, 0 `http://` requests, 0 px horizontal overflow | PASS |
| TLS | curl `ssl_verify_result=0` for the frontend, the API and the Render origin | PASS |
| `http://studymap.space/app` | `301` to `https://studymap.space/app` | PASS |
| CORS preflight from `https://studymap.space` on `/auth/me` | `200`, `Access-Control-Allow-Origin: https://studymap.space` | PASS |
| CORS preflight from `https://evil.example` | `200` with **no** `Access-Control-Allow-Origin` | PASS |
| `GET /auth/me` without a token | `401` | PASS |
