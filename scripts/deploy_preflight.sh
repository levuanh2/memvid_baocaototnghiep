#!/usr/bin/env bash
# Read-only readiness check for the pinned deploy (Round 8.4A). Run it on the
# EC2 host, from the app checkout, BEFORE merging 8.4A and before the first
# pinned deploy. It changes nothing: no checkout, no lock, no ledger write, no
# Docker action. Prints one PASS/FAIL line per requirement of scripts/deploy.sh
# and scripts/rollback.sh; exits 1 if any requirement fails.
#
# Usage (on EC2), from the checkout:  bash scripts/deploy_preflight.sh
# Before 8.4A is merged the file is not on the server yet; stream it instead:
#   curl -fsSL https://raw.githubusercontent.com/levuanh2/memvid_baocaototnghiep/<branch-or-sha>/scripts/deploy_preflight.sh \
#     | MEMVID_APP_DIR=/opt/memvid/app bash
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-.}")" && pwd)"
REPO_ROOT="${MEMVID_APP_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
ENV_FILE="${MEMVID_ENV_FILE:-/opt/memvid/env/.env}"
LOCK_FILE="${MEMVID_LOCK_FILE:-/opt/memvid/deploy.lock}"
LEDGER_FILE="${MEMVID_DEPLOY_LEDGER:-/opt/memvid/deployments.log}"

failed=0
check() { # check "<label>" <command...>
  local label="$1"; shift
  if "$@" >/dev/null 2>&1; then printf 'PASS  %s\n' "$label"; else printf 'FAIL  %s\n' "$label"; failed=1; fi
}
writable_target() { # the file is writable, or it does not exist yet and its directory is writable
  if [ -e "$1" ]; then [ -w "$1" ]; else [ -d "$(dirname "$1")" ] && [ -w "$(dirname "$1")" ]; fi
}
# A failing git command must FAIL the check, never read as "no changes".
clean_build_inputs() {
  local out
  out="$(git -C "$REPO_ROOT" status --porcelain --untracked-files=all --ignored -- BE docker-compose.prod.yml)" || return 1
  [ -z "$out" ]
}
clean_tree() {
  local out
  out="$(git -C "$REPO_ROOT" status --porcelain)" || return 1
  [ -z "$out" ]
}
github_api_reachable() {
  local remote repo
  remote="$(git -C "$REPO_ROOT" remote get-url origin)" || return 1
  repo="${remote#*github.com[:/]}"; repo="${repo%.git}"
  curl -fsS --connect-timeout 10 --max-time 30 -H 'Accept: application/vnd.github+json' \
    "https://api.github.com/repos/${repo}/actions/workflows/ci.yml/runs?branch=main&event=push&status=success&per_page=1" \
    | python3 -c 'import json,sys; assert isinstance(json.load(sys.stdin).get("total_count"), int)'
}

check "flock is installed (shared deploy/rollback lock)" command -v flock
check "curl is installed (CI verification)" command -v curl
check "python3 is installed (CI verification JSON)" command -v python3
check "git is installed" command -v git
check "docker compose is available" docker compose version
check "repo is a git checkout at $REPO_ROOT" git -C "$REPO_ROOT" rev-parse --verify HEAD
check "origin remote points at github.com" sh -c "git -C '$REPO_ROOT' remote get-url origin | grep -q github.com"
check "env file exists: $ENV_FILE" test -f "$ENV_FILE"
check "lock file is writable: $LOCK_FILE" writable_target "$LOCK_FILE"
check "deploy ledger is writable: $LEDGER_FILE" writable_target "$LEDGER_FILE"
check "working tree is clean (deploy.sh refuses a dirty tree)" clean_tree
check "no modified, untracked or ignored build inputs under BE/ or docker-compose.prod.yml" clean_build_inputs
check "api.github.com reachable and returns CI run data" github_api_reachable

if [ -s "$LEDGER_FILE" ]; then
  printf 'INFO  ledger has %s entries (rollback accepts only these SHAs)\n' "$(wc -l <"$LEDGER_FILE" | tr -d ' ')"
else
  printf 'WARN  ledger is empty: rollback needs MEMVID_BREAK_GLASS=1 + MEMVID_BREAK_GLASS_REASON until the first pinned deploy is recorded\n'
fi
printf 'INFO  current HEAD %s\n' "$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"

if [ "$failed" -ne 0 ]; then
  printf 'RESULT: NOT READY - fix every FAIL before merging Round 8.4A or deploying.\n'
  exit 1
fi
printf 'RESULT: READY for pinned deploys.\n'
