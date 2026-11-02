# Runtime revision observability (Round 8.4B)

| Item | Value |
|---|---|
| Source revision | `origin/main` `2479a32` plus branch `fix/studymap-v4-round8-4-qa-hardening`; the deploy-side export comes from Round 8.4A |
| Owner | Claude (implementation and local verification) |
| Environment | Local Windows 11: Python pytest with the Flask test client, Vite production builds |

## Problem

Before this round, production revisions could only be inferred. Round 8.2
compared 34 frontend chunk hashes and read an EC2 deploy log. Nothing told a
probe which commit was actually running.

## Implementation

### Backend: `/health` gains `revision`

- `BE/app/main.py` `_build_revision()` returns the first of `APP_BUILD_SHA`
  and `RENDER_GIT_COMMIT` that matches `^[0-9a-f]{7,40}$` after trimming and
  lowercasing. Otherwise it returns `"unknown"`.
- Only a value matching the hex pattern is echoed, and only from the two
  revision variables. A mis-set path, URL with a password, or free text becomes
  `unknown`. A *hex-shaped* secret wrongly put into `APP_BUILD_SHA` would still
  be shown, so only put commit SHAs there (Codex2 round-1 review, LOW).
- `/health` keeps every existing field and its 200 status. `revision` is
  additive, so the Docker healthcheck and `scripts/health.sh` are unaffected.
- On EC2, `docker-compose.prod.yml` passes
  `APP_BUILD_SHA: ${APP_BUILD_SHA:-unknown}` to the backend service. Round 8.4A
  `scripts/deploy.sh` and `scripts/rollback.sh` export it from the checked-out
  HEAD before `compose build` and `compose up`. Compose interpolation prefers
  the shell environment over the `--env-file`.
- On Render (Blueprint backend), Render sets `RENDER_GIT_COMMIT` itself.

### Frontend: `<meta name="studymap-build" content="<sha>">`

- `FE/vite.config.js` adds a small plugin. Its `transformIndexHtml` injects the
  meta tag into `index.html` at build time.
- The SHA source is the first of `VITE_BUILD_SHA`, `RENDER_GIT_COMMIT` (Render
  static build) and `GITHUB_SHA` (Actions) that is set. If none is, the plugin
  runs `git rev-parse HEAD`. The same hex-only rule applies; otherwise the value
  is `unknown`.
- No source maps and no environment dump. The value is a commit SHA that is
  already public in this repository.

## Verification

| # | Check | Expected | Observed | Result |
|---|---|---|---|---|
| 1 | `pytest tests/test_health.py` | Existing health tests unchanged; `APP_BUILD_SHA` (upper case) is reported in lower case; `RENDER_GIT_COMMIT` fallback works | 4 passed | PASS |
| 2 | The same tests with `APP_BUILD_SHA` set to `""`, `unknown`, `/opt/memvid/app`, `abc`, `postgresql://user:pw@host/db` and 40×`g` | `revision == "unknown"` for each | As expected | PASS |
| 3 | Local build, no env var: `npx vite build` | Meta equals `git rev-parse HEAD` | `2479a32a1c020c31be83fd2eacbaee7836b19fde`, the same as `git rev-parse HEAD` | PASS |
| 4 | Build with an invalid `GITHUB_SHA=abc` | `unknown` | `unknown` | PASS |
| 5 | Build with `RENDER_GIT_COMMIT=4862db6deadbeef` | That value | `4862db6deadbeef` | PASS |
| 6 | Builds with the Library flag OFF and ON | Both build; both carry the meta tag | Both exit 0, meta = HEAD | PASS |
| 7 | Deploy exports the same SHA (Round 8.4A harness, Docker shim records `APP_BUILD_SHA`) | Deployed HEAD = `APP_BUILD_SHA` | Scenarios A, D, G and H record the deployed SHA | PASS (8.4A) |
| 8 | CI build output matches the checked-out revision | The meta tag in the CI `npm run build` artifact = `GITHUB_SHA` | Not asserted by a CI step yet; `GITHUB_SHA` is what `actions/checkout` checks out by default | NOT VERIFIED |
| 9 | Production `/health` `revision` and production meta tag | Equal to the deployed main SHA | Not deployed. Production checks stay read-only, and nothing was deployed to test this | NOT VERIFIED (after release) |

## Production probe, once both PRs are deployed (read-only)

```bash
curl -s https://api.studymap.space/health | python -c "import json,sys; print(json.load(sys.stdin)['revision'])"
curl -s https://studymap.space/ | grep -o '<meta name="studymap-build" content="[^"]*"'
git rev-parse origin/main
```

All three should print the same SHA. If they differ, Render has not caught up
(it is waiting for checks) or a deploy was skipped. Do not guess from bundle
hashes.

## What `revision` proves, and what it does not (Codex2 review, MEDIUM)

`revision` is a **trusted deployment label**, injected at deploy time. It is
not a fingerprint of the code inside the image. With the Round 8.4A pinned
deploy, the label is the SHA that `deploy.sh` checked out, built and
activated. That is what makes it reliable in the normal path. Someone starting
an old image by hand with a newer `APP_BUILD_SHA` would make `/health` lie. To
make it tamper-evident, bake the SHA into the image at build time (a build
argument written into the image) and read that value. That is a follow-up,
not part of this round.

## Caveat

On pull-request CI, `GITHUB_SHA` is the temporary merge commit, not the PR
head. On `main` push CI, it is the pushed commit. That is the build that
matters for release probes.
