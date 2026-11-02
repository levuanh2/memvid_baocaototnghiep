# Protected-auth guard in CI (Round 8.4A)

| Item | Value |
|---|---|
| Source revision | `origin/main` `2479a32` plus branch `fix/studymap-v4-round8-4-deploy-safety` |
| Implemented by | Codex1 |
| Reviewed by | Codex2, independent: round 1 finding 8, round 2 "FIXED". Claude reviewed during integration (not independent) |
| Environment | Local real stack: Flask `BE/scripts/run_e2e_server.py` on `:8180`, production build on `:4273`, disposable Postgres `r82-pg` (`:55432`, alembic head), Chromium, `--workers=1` |

## Gap

Round 8.3 added a second critical Playwright pass with
`AUTH_PROTECT_APP_APIS=true`. In the CI logs, both passes had **zero** 401
responses, because every test sends a token. If protection stopped reaching
the server, the protected pass would stay green.

## Guard

`FE/e2e/auth-protection.spec.js` belongs to the critical suite, so both CI
passes run it.

- **What it expects comes from its own variable.**
  - The test takes `E2E_EXPECT_PROTECTED_AUTH` when that variable is set.
  - Only for local runs does it fall back to `AUTH_PROTECT_APP_APIS`.
  - The protected CI step sets both `AUTH_PROTECT_APP_APIS: "true"` (server)
    and `E2E_EXPECT_PROTECTED_AUTH: "true"` (test).
  - So a removed or misspelled server flag cannot quietly turn the protected
    assertion into open mode. Round 1, finding 8: fixed.
- **Protected mode:** an unauthenticated `GET /api/documents` must return
  **401**. The same request with the bearer token from the real
  `registerAndEnterApp` helper must return **200**.
- **Open mode:** the unauthenticated request must return **200**, which is the
  documented contract of `run_e2e_server.py`'s default. The token request must
  also return 200.
- **Real route.** `/api/documents` is an existing protected route
  (`_require_app_user` in `BE/app/main.py`). No route was invented for the test.
- **Environment reaches the backend.** `FE/playwright.config.js` gives the
  backend web server `env: { ...process.env, PORT }`. Locally,
  `reuseExistingServer` can attach to a server that is running in the other
  mode. The guard then fails, which is intended.

## Results

| Mode | Command | Expected | Observed | Result |
|---|---|---|---|---|
| Open | `AUTH_PROTECT_APP_APIS=false E2E_EXPECT_PROTECTED_AUTH=false npx playwright test e2e/auth-protection.spec.js --workers=1` | Unauthenticated 200, token 200 | 1 passed | PASS |
| Protected | Same command with both variables set to `true` | Unauthenticated 401, token 200 | 1 passed | PASS |
| Full critical suite, both CI passes, guard included | GitHub CI on the Draft PR | 41/41 per pass | Recorded in `README.md` from the PR's CI run | Pending CI |

## Limit

Deleting **both** variables from the protected step would switch the server
and the guard to open mode together. That is a visible edit to `ci.yml` in
review, not a silent inheritance failure.
