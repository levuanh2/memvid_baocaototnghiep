#!/usr/bin/env bash
# Deploy the production backend from an exact, current-main commit whose
# successful main/push CI run is independently verified through GitHub's API.
# A human-only break-glass path is available for incidents and is ledgered.
#
# Usage: scripts/deploy.sh <full-main-sha>
# Env:   MEMVID_DEPLOY_SHA=<sha> is equivalent to the positional argument.
#        MEMVID_BREAK_GLASS=1 + MEMVID_BREAK_GLASS_REASON="<why>" allow an
#        unpinned deploy, or a pinned deploy whose CI evidence cannot be
#        verified. The attempt is ledgered before any change, the result after.
#        MEMVID_FORCE_RESET=1 discards tracked local edits before pinning; it
#        never permits modified, untracked or ignored BE/ build inputs.
set -euo pipefail

SUPERSEDED=0
normalize_reserved_status() {
  local rc=$?
  trap - EXIT
  if [ "${BREAK_GLASS:-0}" = "1" ] && [ "$rc" -ne 0 ]; then
    ledger_record "$LEDGER_FILE" "${APP_BUILD_SHA:-${DEPLOY_SHA:-unpinned}}" break-glass-failed || true
  fi
  if [ "$rc" -eq 75 ] && [ "$SUPERSEDED" != "1" ]; then
    printf 'unexpected child exit 75 normalized to deployment failure 70\n' >&2
    exit 70
  fi
  exit "$rc"
}
trap normalize_reserved_status EXIT

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
source "$SCRIPT_DIR/_lib.sh"

LOCK_FILE="${MEMVID_LOCK_FILE:-/opt/memvid/deploy.lock}"
LEDGER_FILE="${MEMVID_DEPLOY_LEDGER:-/opt/memvid/deployments.log}"
DEPLOY_SHA="${1:-${MEMVID_DEPLOY_SHA:-}}"
BREAK_GLASS=0

warn_break_glass() {
  require_break_glass_reason
  BREAK_GLASS=1
  ledger_record "$LEDGER_FILE" "${DEPLOY_SHA:-unpinned}" break-glass-attempt
  log "WARNING: BREAK GLASS DEPLOY authorized by $(whoami) at $(date -u '+%Y-%m-%dT%H:%M:%SZ'); CI-passed invariant is being bypassed"
}

superseded() {
  log "$*"
  SUPERSEDED=1
  exit 75
}

remote_repo_name() {
  local remote path owner repo
  remote="$(git -C "$REPO_ROOT" remote get-url origin 2>/dev/null)" || return 1
  case "$remote" in
    git@github.com:*) path="${remote#git@github.com:}" ;;
    ssh://git@github.com/*) path="${remote#ssh://git@github.com/}" ;;
    https://github.com/*) path="${remote#https://github.com/}" ;;
    http://github.com/*) path="${remote#http://github.com/}" ;;
    *) path="${remote//\\//}" ;;
  esac
  path="${path%.git}"
  repo="${path##*/}"
  path="${path%/*}"
  owner="${path##*/}"
  [[ "$owner" =~ ^[A-Za-z0-9_.-]+$ && "$repo" =~ ^[A-Za-z0-9_.-]+$ ]] || return 1
  printf '%s/%s\n' "$owner" "$repo"
}

verify_ci_success() {
  local repo api response count
  repo="$(remote_repo_name)" || return 1
  api="https://api.github.com/repos/${repo}/actions/workflows/ci.yml/runs?head_sha=${DEPLOY_SHA}&branch=main&event=push&status=success&per_page=1"
  response="$(curl -fsS --connect-timeout 10 --max-time 30 -H 'Accept: application/vnd.github+json' "$api")" \
    || { log "GitHub API request failed (network error, HTTP error or unauthenticated rate limit): $api"; return 1; }
  count="$(printf '%s' "$response" | python3 -c 'import json,sys; value=json.load(sys.stdin).get("total_count"); print(value if isinstance(value,int) else "")' 2>/dev/null)" || return 1
  [[ "$count" =~ ^[0-9]+$ ]] && [ "$count" -ge 1 ]
}

require_current_main() {
  local phase remote_main_sha
  phase="$1"
  git -C "$REPO_ROOT" fetch origin main
  remote_main_sha="$(git -C "$REPO_ROOT" rev-parse origin/main)"
  [ "$remote_main_sha" = "$DEPLOY_SHA" ] \
    || superseded "superseded ${phase}: verified=$DEPLOY_SHA origin/main=$remote_main_sha"
}

if [ -n "$DEPLOY_SHA" ] && [[ ! "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  die "invalid deploy SHA '$DEPLOY_SHA' — expected exactly 40 lowercase hexadecimal characters"
fi
if [ -z "$DEPLOY_SHA" ] && [ "${MEMVID_BREAK_GLASS:-}" != "1" ]; then
  die "usage: scripts/deploy.sh <full-main-sha> (an unpinned deploy requires MEMVID_BREAK_GLASS=1)"
fi

acquire_deploy_lock "$LOCK_FILE"
require_compose_file
require_env_file

log "step 1/7: validating environment"
validate_env
log "step 2/7: ensuring data directory layout"
ensure_data_layout

if [ -d "$REPO_ROOT/.git" ]; then
  CURRENT_REF="$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  if [ -n "$(git -C "$REPO_ROOT" status --porcelain)" ] && [ "${MEMVID_FORCE_RESET:-}" != "1" ]; then
    git -C "$REPO_ROOT" status --short >&2
    die "uncommitted changes in $REPO_ROOT — commit/stash them, or use MEMVID_FORCE_RESET=1 for tracked edits"
  fi
  if [ -n "$(git -C "$REPO_ROOT" status --porcelain)" ] && [ "${MEMVID_FORCE_RESET:-}" = "1" ]; then
    log "MEMVID_FORCE_RESET=1: discarding tracked local edits before pinning"
    git -C "$REPO_ROOT" reset --hard HEAD
  fi
  if [ -n "$DEPLOY_SHA" ]; then
    log "step 3/7: pinning code to $DEPLOY_SHA"
    require_current_main "before build"
    git -C "$REPO_ROOT" merge-base --is-ancestor "$DEPLOY_SHA" origin/main \
      || die "deploy SHA $DEPLOY_SHA is not an ancestor of origin/main"
    if ! verify_ci_success; then
      if [ "${MEMVID_BREAK_GLASS:-}" = "1" ]; then
        warn_break_glass
      else
        die "no successful main/push ci.yml run could be verified for $DEPLOY_SHA (or GitHub API was unreachable); use MEMVID_BREAK_GLASS=1 only for an audited emergency"
      fi
    fi
    git -C "$REPO_ROOT" checkout -B main "$DEPLOY_SHA"
    git -C "$REPO_ROOT" reset --hard "$DEPLOY_SHA"
    refuse_unclean_build_inputs
    APP_BUILD_SHA="$(git -C "$REPO_ROOT" rev-parse HEAD)"
    export APP_BUILD_SHA
    log "pinned to $APP_BUILD_SHA (was $CURRENT_REF)"
  else
    warn_break_glass
    log "step 3/7: syncing unpinned code to current origin/main"
    git -C "$REPO_ROOT" fetch origin main
    git -C "$REPO_ROOT" checkout -B main origin/main
    git -C "$REPO_ROOT" reset --hard origin/main
    refuse_unclean_build_inputs
    APP_BUILD_SHA="$(git -C "$REPO_ROOT" rev-parse HEAD)"
    export APP_BUILD_SHA
    log "unpinned break-glass deploy at $APP_BUILD_SHA (was $CURRENT_REF)"
  fi
else
  die "deployment requires a git clone at $REPO_ROOT"
fi

log "step 4/7: building backend image"
compose build

if [ -n "$DEPLOY_SHA" ]; then
  require_current_main "before migration"
fi
log "step 5/7: running database migration (scripts.run_migrations — the sanctioned production entry point)"
compose run --rm -e ALEMBIC_ALLOW_PRODUCTION=1 backend python -m scripts.run_migrations --moi-truong production

log "step 6/7: starting backend"
if [ -n "$DEPLOY_SHA" ]; then
  require_current_main "before activation"
  ACTIVE_SHA="$(git -C "$REPO_ROOT" rev-parse HEAD)"
  [ "$ACTIVE_SHA" = "$DEPLOY_SHA" ] \
    || die "activation refused: HEAD moved after build (expected $DEPLOY_SHA, found $ACTIVE_SHA)"
  log "activation SHA verified: $ACTIVE_SHA"
fi
compose up -d

log "step 7/7: health check"
if ! "$SCRIPT_DIR/health.sh"; then
  die "backend failed its health check — deploy did NOT complete successfully"
fi

if [ "$BREAK_GLASS" = "1" ]; then
  ledger_record "$LEDGER_FILE" "$APP_BUILD_SHA" break-glass
  BREAK_GLASS=0 # recorded as a success; the EXIT trap must not add a failure line
else
  ledger_record "$LEDGER_FILE" "$APP_BUILD_SHA" deploy
fi
log "deploy complete; recorded $APP_BUILD_SHA in $LEDGER_FILE"
compose ps || log "WARNING: deploy succeeded, but compose ps diagnostics failed"
