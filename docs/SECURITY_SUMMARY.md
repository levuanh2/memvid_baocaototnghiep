# Security Summary

Condensed from `docs/SECURITY.md` (full detail, file:line evidence) and
`docs/RELEASE_CHECKLIST.md` (release-audit re-verification against the live
`render.yaml`). Written for someone deciding whether to deploy this, not for
someone auditing the code line-by-line.

## Authentication

Stateless Bearer token (`itsdangerous`-signed, not a library JWT — loosely
called "JWT" in some comments/docs, but it's a signed+timed token, not an
RFC 7519 JWT). Payload is just `{uid, token_version}`; no server-side
session table. `token_version` on the user row allows server-side
revocation (password change, logout-everywhere) without one. 7-day TTL by
default (`AUTH_TOKEN_TTL_SEC=604800`), configurable.

Production posture (`render.yaml`): `AUTH_SECRET` is Render-generated
(`generateValue: true` — created once, never in git, never shown),
`AUTH_REQUIRE_SECRET=true` (fails loudly instead of silently falling back
to a dev-only ephemeral secret).

## Authorization

Every route needing a user calls `_require_app_user` (81 call sites in
`BE/app/main.py`). Document/progress data is filtered by `user_id` at the
repository/query layer, not re-filtered client-side.

## Secrets

Real credentials exist only in untracked `.env` files. Verified this
release: `BE/.env` holds a real-looking API key on disk, but
`git log --all --full-history -- BE/.env` returns nothing — it has never
been committed. `.gitignore` covers `*.env`. Grepped every git-tracked file
for API-key-shaped strings (`AIza…`, `sk-…`, `ghp_…`, private-key headers)
— zero hits.

## Uploads

100MB cap (`MAX_CONTENT_LENGTH`, configurable via `MAX_UPLOAD_MB`). Accepted
file types are enforced on both sides and kept in sync by a dedicated test
(`BE/tests/test_upload_formats.py`).

## Rate Limiting

Two independent layers:
- General API rate limiting is Redis-backed and **fails open without
  Redis** — and the current production config does not enable it
  (`RATE_LIMIT_ENABLED` is absent from `render.yaml`). **Not effective on
  the live deployment today.**
- Password-accepting routes (login, NKS re-auth, password change) have a
  separate, working, in-process failure counter
  (`BE/app/domains/auth/gioi_han.py`) that does **not** depend on Redis —
  built specifically because the general limiter can't be relied on here.

## Known Risks (carried into v1.0, all P1 — real, none catastrophic)

| Risk | Status |
|---|---|
| `CORS_ORIGINS="*"` in production | Deliberate, documented in `render.yaml` itself; team's own stated plan is to tighten once the frontend's production URL is fixed. Mitigated by Bearer-token (not cookie) auth. |
| General rate limiting off | Password routes are covered independently; other endpoints are not. |
| No security headers at nginx (X-Frame-Options, CSP, etc.) | Real gap. Mitigated by zero `dangerouslySetInnerHTML` anywhere in the frontend (low XSS injection surface) and Bearer-token auth (reduces classic CSRF applicability). Clickjacking on the login page is the most concrete residual concern. |
| BE Docker image runs as root | Standard container-hardening gap; no active exploit path identified in this audit. (Frontend's `nginx:alpine` runtime image already drops to a non-root worker by default — no gap there.) |

None of the above blocked the release decision (`READY WITH KNOWN
LIMITATIONS`, `docs/RELEASE_CHECKLIST.md`) — they're documented,
prioritized follow-ups, not silent gaps.
