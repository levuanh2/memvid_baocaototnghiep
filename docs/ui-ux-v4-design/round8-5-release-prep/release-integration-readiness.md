# Release integration readiness: PR #101 and PR #102

| Item | Value |
|---|---|
| Checked | 2026-11-02, by Claude, read-only |
| `origin/main` | `2479a32a1c020c31be83fd2eacbaee7836b19fde`; unchanged since PR #100 |
| Authority | **No merge, deploy or production-setting change has been authorised.** This document only prepares for them |

## 1. Pull-request state

| | PR #101 (8.4A deploy safety) | PR #102 (8.4B QA hardening) |
|---|---|---|
| Head | `57f77f643b042e64fdb42d361b28196c172ebdd7` | `87717c0` |
| Draft / state | Draft, OPEN | Draft, OPEN |
| Mergeable | MERGEABLE, CLEAN | MERGEABLE, CLEAN |
| Base | Current `main` (`2479a32` is an ancestor) | Current `main` |
| Changed files | 22 | 30 |
| CI on head | 11/11 green (run 41464759805): Deploy script tests (13/13 scenarios, 22/22 mutations), Critical E2E 41/41 open + 41/41 protected | 11/11 green (run 41428891606), including Fixture Smoke |
| Independent review | Codex2, not an author: round 1 BLOCK, round 2 BLOCK, **round 3 APPROVE** (in evidence files) | Codex2: REQUEST CHANGES, then **round 2 APPROVE** (in evidence files) |
| GitHub review decision | **None.** The reviews are agent reviews recorded as evidence, not GitHub approvals | **None** |
| Conflict between #101 and #102 | `git merge-tree` is clean. They merge in either order | |

**Finding (process risk): `main` has no branch protection.** The GitHub API
returns `404 Branch not protected`. `CI / required` and the new
`fixture-smoke` and `Deploy script tests` jobs are therefore **not enforced by
GitHub**: anyone with write access can merge with red CI. The deploy workflow
still refuses to deploy a red CI run, but a red merge still lands on `main`
and, under today's Render setting, deploys the frontend.

- **Recommendation (needs the owner's approval; repository setting):**
  1. Protect `main` and require the status check `CI / required`.
  2. Optionally require one approving review.

## 2. EC2 preflight (human operator, read-only)

The script is pinned to PR #101's immutable head. It is **not** fetched from a
branch name. Expected SHA-256, computed by Claude from both the git blob and
the raw download at that commit:

`2a58aed3ac02c4dbc90bc4697cfcdaa711651589dbc7e62e20f204e6379d2588`

Run these on EC2, as the same user the deploy workflow uses (`EC2_USER`):

```bash
set -u
PIN=57f77f643b042e64fdb42d361b28196c172ebdd7
TMP="$(mktemp -d)"
curl -fsSL -o "$TMP/deploy_preflight.sh" \
  "https://raw.githubusercontent.com/levuanh2/memvid_baocaototnghiep/$PIN/scripts/deploy_preflight.sh"

# 1. The file must be exactly the reviewed one.
echo "2a58aed3ac02c4dbc90bc4697cfcdaa711651589dbc7e62e20f204e6379d2588  $TMP/deploy_preflight.sh" | sha256sum -c -

# 2. Read it before running it (about 70 lines; no git pull/reset/checkout,
#    no docker build/up/run, no migration, no writes, no lock).
less "$TMP/deploy_preflight.sh"

# 3. Record the current checkout (read-only).
cd /opt/memvid/app && git rev-parse HEAD && git status --short --ignored -- BE docker-compose.prod.yml

# 4. Run it (read-only). It exits 1 if anything fails.
MEMVID_APP_DIR=/opt/memvid/app bash "$TMP/deploy_preflight.sh"; echo "exit=$?"
```

What it checks, and what to do if a check fails. Every fix is a human
decision; nothing is removed automatically.

| Check | If it fails: likely cause | Safe correction |
|---|---|---|
| `flock` installed | The `util-linux` lock tool is missing | Install `util-linux` with the OS package manager |
| `curl`, `python3`, `git` | Tools are missing | Install them with the OS package manager |
| `docker compose` available | Compose v2 plugin missing, or the user is not in the `docker` group | Install the compose plugin, or run as the deploy user |
| Repo is a git checkout at `/opt/memvid/app` | Wrong path or user | Use the deploy user and path |
| `origin` points at github.com | Remote changed | Inspect `git remote -v`; do not rewrite without review |
| Env file `/opt/memvid/env/.env` exists | Path differs | Point `MEMVID_ENV_FILE` at the real path, or fix the path |
| Lock `/opt/memvid/deploy.lock` writable | `/opt/memvid` is owned by root | Create the file and hand it to the deploy user: `sudo install -o <deploy-user> -m 644 /dev/null /opt/memvid/deploy.lock` |
| Ledger `/opt/memvid/deployments.log` writable | Same as above | `sudo install -o <deploy-user> -m 644 /dev/null /opt/memvid/deployments.log` |
| Working tree clean | Hand edits on the server | Show `git status` and `git diff` to the owner; keep the edits, or deliberately stash or commit them. **Never `git clean`/`reset` without review** |
| No modified, untracked or ignored build inputs under `BE/` | Stray files such as `__pycache__`, `*.so` or old outputs under `BE/` | List them with `git status --ignored -- BE`, review, then move them out of `BE/` (keep a copy) |
| `api.github.com` reachable | Outbound HTTPS blocked, or rate-limited | Open egress to `api.github.com:443`. Retry after the rate-limit reset |

The preflight also prints a `WARN` while the ledger is empty. That is
expected before the first pinned deploy, and means a rollback would need
`MEMVID_BREAK_GLASS=1` plus a reason.

**Status: NOT VERIFIED.** Claude has no SSH access. Paste the exact output
into `human-acceptance-tests.md` section E1.

## 3. Render: live settings vs the proposed YAML

Read live with the Render API (GET only, 2026-11-02):

| Service | Type | Live `autoDeployTrigger` | Live state | After #101 (YAML) |
|---|---|---|---|---|
| `studymap-web` | static site | **`commit`**: deploys every `main` commit immediately, without waiting for CI | active | `checksPass` |
| `studymap-api` | web service | `commit` | **suspended** | `checksPass` |

Blueprint `membaocaototnghiep`: `autoSync: true`, `in_sync`, last sync
2026-09-21. That matches the last `render.yaml` change on `main` (`d75210b`).

**The proposed YAML is NOT active yet.** It becomes active only when a commit
that contains it reaches `main` and the Blueprint auto-sync applies it.

### Transition window

1. **Merging #101 deploys the frontend under the old `commit` trigger.**
   Render can start building the merge commit before CI finishes and before
   the Blueprint sync applies `checksPass`. Risk for this specific merge:
   **low**. #101 changes only frontend test files (`FE/e2e/*`,
   `FE/playwright.config.js`), so the built bundle is identical to the running
   one.
2. **Blueprint sync and the suspended `studymap-api`.** It is not confirmed
   whether a sync changes or resumes a suspended service. If that service
   resumed, its `buildCommand` runs production migrations from Render.
   **Verify right after the sync that `studymap-api` is still suspended.**
3. **Option to close the window completely (needs explicit approval; a
   production setting change):** before merging #101, set `studymap-web` to
   "After CI Checks Pass" in the dashboard, or via the Render API with
   `autoDeployTrigger=checksPass`. Claude has **not** done this.

## 4. Recommended integration order (each step needs the owner)

| # | Step | Owner | Gate |
|---|---|---|---|
| 1 | Run the EC2 preflight (§2) and paste the output | Human operator | All PASS (the empty-ledger WARN is fine) |
| 2 | Decide on closing the Render window early (§3), and on branch protection (§1) | Release owner | Explicit decision |
| 3 | **Explicitly authorise merging #101** | Release owner | — |
| 4 | Merge #101 (squash is not needed; a merge commit keeps the history) | Release owner | — |
| 5 | Watch the CI on the merge commit; it must be green | Claude or operator | CI / required success |
| 6 | Watch the Deploy run: the gate decision, "pinned to `<sha>`", "activation SHA verified" | Claude or operator | Deploy success **and** the log shows the CI SHA |
| 7 | On EC2: `git -C /opt/memvid/app rev-parse HEAD` = the merge SHA; `tail -2 /opt/memvid/deployments.log` shows `<sha> deploy`; `/health` is `ok` | Operator | Matches |
| 8 | Render: Blueprint synced; both services show "After CI Checks Pass"; `studymap-api` still suspended | Operator | Matches |
| 9 | Re-check #102 against the new `main` (rebase only if it conflicts; it merged cleanly in a dry run) and re-run its CI | Claude | Green |
| 10 | **Explicitly authorise merging #102** | Release owner | — |
| 11 | Merge #102; watch CI, the pinned deploy, and the Render deploy after checks pass | Claude or operator | Green |
| 12 | Runtime revision probe (`human-acceptance-tests.md` E5): EC2 HEAD = deploy log SHA = `/health` `revision` = frontend `studymap-build` meta = the merge SHA; production Library flag still OFF | Operator | All equal |

Do not claim a deployment succeeded from the workflow status alone; steps 7,
8 and 12 are the evidence. Rollback stays available through
`scripts/rollback.sh <ledgered-sha>`. Until the first pinned deploy is
recorded, it needs `MEMVID_BREAK_GLASS=1` plus a reason. **Never** use break
glass automatically.
