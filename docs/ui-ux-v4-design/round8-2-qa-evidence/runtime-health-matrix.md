# Runtime health matrix

Owner: Claude. Checked 2026-11-01 16:15–16:30 UTC with read-only probes. No
credentials were used and nothing was written to production. Details are in
`git-deployment-verification.md`.

| Component | Expected revision | Observed revision | Health | Evidence | Result |
|---|---|---|---|---|---|
| GitHub main | Current HEAD | `c02e2b9`. Unchanged; tree equals PR head `fb6aaec` | CI run 41321373798: success, 10/10 jobs | `gh pr view 98`, `gh run view` | PASS |
| Backend EC2 (`api.studymap.space`) | `c02e2b9` | `c02e2b9` per deploy log. The service exposes no runtime SHA | `/health` 200 in `normal` mode, both graphs ready; `/ready` 200 `ready` | Deploy run 41321856500 log; live probes | PASS. Revision is attested by the log only |
| Frontend hosting (Render `studymap-web`) | Build of `c02e2b9` | Content-equivalent to a local `c02e2b9` build: 34/34 chunks after normalising hashes and CRLF | `/`, `/app`, `/login` return 200 with 0 console errors, 0 failed requests and no mixed content | `claude/prod-frontend-bundle-compare.txt`, `claude/prod-unauth-browser-probe.json` | PASS |
| API compatibility | Compatible | Frontend calls `https://api.studymap.space`. Allowed-origin preflight 200 with exact ACAO; foreign origin gets no ACAO; unauthenticated `/auth/me` returns 401 | — | curl preflight | PASS for the unauthenticated surface. Authenticated flows were not exercised on production, as the brief requires |
| Library flag | OFF | OFF: the bundle matches the unflagged build | — | `libraryActionMatrixFlag.js`; bundle compare | PASS |

## CI test counts on `c02e2b9` (post-merge run 41321373798)

GitHub CI evidence category. These counts do not cover the fixture suite.

| Job | Result |
|---|---|
| E2E Critical Flows (real Flask + Postgres, `FE/playwright.config.js`) | 40 passed |
| Frontend Tests | 1,798 passed, 201 files |
| Backend Unit & Contract | 11 passed, 3 skipped |
| Backend Integration Suite & Migrations | 2,980 passed, 8 skipped |
| Docker Build, Docker Compose Run, Frontend Production Build, Security & Static | success |

No deployment lag: the backend and the frontend both serve the merge revision.
