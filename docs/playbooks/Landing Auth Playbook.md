# Playbook: Landing Page + Auth Shell

## Project
MemVid

## Status
**MERGED to main 2026-07-12** — PR #5 `feat/landing-auth-shell` → main (`6a46d68`). main now carries BOTH
Landing/Auth AND the Conversation Context Layer (PR #4) + the RQ/high-concurrency baseline. BE 122 + FE 66
green; integrated live smoke passed. Real `AUTH_SECRET` required for prod (`AUTH_REQUIRE_SECRET=true`).

**UPDATE 2026-07-14 — server-side gating SHIPPED.** The "app APIs OPEN by design" gap is now closed by
**Production Auth Hardening** (main @ `e11d20e`, PR #6): the `AUTH_PROTECT_APP_APIS` flag (default OFF)
gates all app routes + scopes data per owner. Docker staging rollout VERIFIED — see the section below and
[[2026-07-14 - Session Log]]. See [[MemVid - Resume State]], [[2026-07-12 - Session Log]],
[[High Concurrency Request Handling Playbook]].

## Purpose
Turn the app from "boots straight into the workspace" into a product entry flow: public landing `/`,
login/register, existing workspace behind a protected `/app`. Auth is a Bearer-token MVP so it works
cross-origin (Vercel FE + Railway BE) without cookie/CORS-credentials friction.

## Mental model (read first)
- **Router was dormant** — `react-router-dom@7` was in package.json but unused. Adding routing was a
  clean wrap: `main.jsx` → `<BrowserRouter><AuthProvider><App/>`; `App.jsx` → `<Routes>`. The workspace
  (`MainLayout` + 3 columns) is UNCHANGED — only its mount point moved to `/app` + a logout button added.
- **Auth transport = Bearer token in `Authorization` header** (user decision). Only CORS change is adding
  `"Authorization"` to `allow_headers` — no cookies, no `supports_credentials`, no SameSite tangle.
- **App APIs stay OPEN this phase.** Access control is FE-side (`ProtectedRoute`). No `@require_auth` on
  `/query`/upload/summary/mindmap → existing flows, RQ worker, and all tests unaffected. Server-side
  gating + user-scoped data are DEFERRED.
- **No new pip dependency.** Werkzeug (password hashing) + itsdangerous (token signing) ship with Flask.

## Architecture
```
Browser
  /            Landing (public, auth-aware CTA)
  /login       Login  (authed → <Navigate to={safeNext(next)}>)
  /register    Register (same)
  /app         <ProtectedRoute><Workspace/></ProtectedRoute>   (spinner→redirect /login?next→render)
  /app/chat    → /app     *  → /

FE apiFetch  ── Authorization: Bearer <token> (only if token && caller didn't set one)
  POST /auth/register {email,password,display_name?} → 201 {token,user}
  POST /auth/login    {email,password}               → 200 {token,user} | 401 invalid_credentials
  POST /auth/logout                                  → 200 {ok} (stateless; client drops token)
  GET  /auth/me   (Bearer)                           → 200 {user} | 401
```

### Key files
- **BE** `app/domains/auth/`: `users_store.py` (SQLite, jobs_store template, USERS_DB_PATH),
  `tokens.py` (itsdangerous signed {uid,tv}), `service.py` (`public_user`, `current_user_from_request`,
  unused `require_auth`). Routes + CORS header in `app/main.py`. Env in `.env.example` + compose.
- **FE** `src/auth/`: `tokenStore.js` (localStorage guarded), `context.js`+`AuthContext.jsx`+`useAuth.js`,
  `ProtectedRoute.jsx`, `authRedirect.js` (`getAuthRedirectState`/`safeNext`, pure+tested). Pages
  `Login`/`Register`/`Landing`/`Workspace`. `utils/api.js` (Bearer injection + auth helpers).

## Token design
Stateless `URLSafeTimedSerializer(AUTH_SECRET, salt="mv-auth-v1")`, payload `{uid, tv}`. Verified:
signature + age (`AUTH_TOKEN_TTL_SEC`, 7d) in `tokens.read_token`; `token_version` match vs the live
user row in `service.current_user_from_request` (bump `token_version` = revoke-all). No token table.
`bump_token_version` exists but is NOT wired to `/logout` (logout is client-side token drop).

## Runtime config
| Env | Meaning |
|-----|---------|
| `AUTH_SECRET` | token signing key. Empty in dev → ephemeral per-process secret + warn (tokens die on restart). NEVER hardcode. |
| `AUTH_REQUIRE_SECRET` | `true` in prod → fail loud if `AUTH_SECRET` missing. |
| `AUTH_TOKEN_TTL_SEC` | token lifetime (default 604800 = 7d). |
| `USERS_DB_PATH` | `/app/memory/users.sqlite` in Docker (shared volume), else `DATA_DIR/users.sqlite`. |
| FE `VITE_API_URL` \|\| `VITE_API_BASE` | API base (both accepted now; DEV → localhost:8080). |

## Operate / diagnose
- **Auth up?** `curl /auth/me` → 401 (route present) vs 404 (old image without auth). `curl /health` → 200 no token.
- **CORS for Bearer:** preflight `OPTIONS /auth/login -H "Access-Control-Request-Headers: authorization"`
  → response must include `Access-Control-Allow-Headers: authorization`.
- **Token in browser:** localStorage key `memvid-token`. Cleared on logout + on `/auth/me` 401.
- **Secret leak check:** `grep AUTH_SECRET` / plaintext password in server log → expect 0. `password_hash`
  must never appear in any API response (sanitized by `public_user`).

## Gotchas / invariants
- **Landing needs its own scroll container** — global `body { overflow: hidden }` (fixed workspace).
  Landing/Login/Register wrap in `h-screen overflow-y-auto`.
- **`apiFetch` must not clobber caller headers** — only add `Authorization` when absent; never force
  Content-Type (multipart upload sets its own). Verified: upload 200 with+without auth header.
- **safeNext** rejects external / `//` paths → `/app` (open-redirect guard).
- **react-refresh lint:** context object lives in its own `context.js` (component files export only components).
- **No jsdom/testing-library** — FE tests are pure helpers (tokenStore/authRedirect/apiAuth/validate);
  component render tests would need those devdeps (deferred).
- **Do NOT gate app APIs yet** — would break existing flows/tests/RQ. `/query` stays in-process, unmoved.

## Verified (2026-07-12)
BE test_auth 15 + regression 61. FE build + vitest 59. Live HTTP smoke (all auth codes, CORS
Authorization, app-open, /query 202, multipart 200, no secret/hash leak). Browser click-through: PASSED.

## Server-side gating — Docker staging rollout VERIFIED (2026-07-14)
Production Auth Hardening (`AUTH_PROTECT_APP_APIS`, default OFF) smoked in an isolated compose project
`memvid_auth_smoke` (rebuild `--no-cache` PASS). Diagnose flag state at runtime:
- **Flag OFF** (open, backward-compatible): no-token `/list-indexed` → 200, `/query` → 202, app surfaces
  reachable; only `/auth/me` is 401. No new 401/403.
- **Flag ON** (fail-closed, owner-scoped): no-token `/list-indexed` + `/query` → **401**; `/list-indexed`
  returns only the caller's sources; a `/query` naming a foreign source → **403 forbidden_source**; empty
  `sources` resolves to owned stems only; a foreign `/query-status`|`/query-stream`|`/query-resume` → **404**
  (indistinguishable from missing); `/stats`|`/rebuild-index`|`/memory-tree-status` → 401 without a token.
- `/query` STAYS in-process even with `QUEUE_ENABLED=true` (not routed to RQ); status polling works with the
  `Authorization` header. Logs: 0 AUTH_SECRET/token/password leak, 0 SQLite lock, 0 restart.
- Two-user smoke: **19/19 PASS**. VERDICT: safe to roll to real staging (deploy OFF + real AUTH_SECRET →
  verify open flows → flip ON → two-user smoke → then consider prod). Full record: [[2026-07-14 - Session Log]].
- **Test gotcha (Windows):** PowerShell 5.1 mangles embedded double-quotes to `curl.exe` → send JSON via
  `--data-binary "@file"`. Upload RESPONSE field is `video_stem` (registry stores `source_stem` internally).

## Deferred / future hardening
- ~~Server-side gating on app routes behind a flag~~ — **DONE** (`AUTH_PROTECT_APP_APIS`, staging-verified 2026-07-14).
- ~~User-scoped sources/files (per-user data isolation)~~ — **DONE** (owner-scoped under the flag).
- httpOnly cookie + same-origin proxy (drop localStorage token → kill XSS exposure).
- SPA deep-link fallback on the static prod host. Login-rate-limit only real with Redis + flag on.
