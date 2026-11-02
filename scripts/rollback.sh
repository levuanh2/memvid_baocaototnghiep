#!/usr/bin/env bash
# Roll back to an exact, previously ledgered deployment SHA. An unledgered SHA
# requires the same explicit, audited break-glass flag as deploy.sh, plus
# MEMVID_BREAK_GLASS_REASON. The ledger starts empty: until the first pinned
# deploy is recorded, every rollback is a break-glass rollback.
# Usage: scripts/rollback.sh <full-sha>
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
source "$SCRIPT_DIR/_lib.sh"

REF="${1:-}"
LOCK_FILE="${MEMVID_LOCK_FILE:-/opt/memvid/deploy.lock}"
LEDGER_FILE="${MEMVID_DEPLOY_LEDGER:-/opt/memvid/deployments.log}"
BREAK_GLASS=0

[[ "$REF" =~ ^[0-9a-f]{40}$ ]] || die "usage: scripts/rollback.sh <full-40-character-lowercase-sha>"
acquire_deploy_lock "$LOCK_FILE"

require_compose_file
require_env_file
[ -d "$REPO_ROOT/.git" ] || die "no .git directory at $REPO_ROOT — cannot rollback"
SHA="$(git -C "$REPO_ROOT" rev-parse --verify "$REF^{commit}" 2>/dev/null)" \
  || die "unknown commit SHA: $REF"
[ "$SHA" = "$REF" ] || die "rollback requires the exact full commit SHA"

if ! awk -v sha="$SHA" '$2 == sha && ($3 == "deploy" || $3 == "rollback" || $3 == "break-glass") { found=1 } END { exit !found }' "$LEDGER_FILE" 2>/dev/null; then
  if [ "${MEMVID_BREAK_GLASS:-}" = "1" ]; then
    require_break_glass_reason
    BREAK_GLASS=1
    ledger_record "$LEDGER_FILE" "$SHA" break-glass-attempt
    log "WARNING: BREAK GLASS ROLLBACK authorized by $(whoami) at $(date -u '+%Y-%m-%dT%H:%M:%SZ'); $SHA is not in $LEDGER_FILE"
  else
    die "rollback SHA $SHA is not in the deployment ledger; use MEMVID_BREAK_GLASS=1 only for an audited emergency"
  fi
fi

if [ -n "$(git -C "$REPO_ROOT" status --porcelain)" ]; then
  git -C "$REPO_ROOT" status --short >&2
  die "uncommitted changes in $REPO_ROOT — commit/stash them before rolling back"
fi

CURRENT="$(git -C "$REPO_ROOT" rev-parse --short HEAD)"
log "rolling back from $CURRENT to $SHA"
git -C "$REPO_ROOT" checkout --detach "$SHA"
refuse_unclean_build_inputs
export APP_BUILD_SHA="$(git -C "$REPO_ROOT" rev-parse HEAD)"
log "repo is now intentionally detached at $APP_BUILD_SHA"

compose build
compose up -d

for i in $(seq 1 30); do
  if compose exec -T backend curl -fsS http://localhost:8080/health >/dev/null 2>&1; then
    action=rollback
    [ "$BREAK_GLASS" = "1" ] && action=break-glass
    ledger_record "$LEDGER_FILE" "$APP_BUILD_SHA" "$action"
    log "backend healthy; rollback complete and recorded in $LEDGER_FILE"
    exit 0
  fi
  sleep 2
done

[ "$BREAK_GLASS" = "1" ] && ledger_record "$LEDGER_FILE" "$SHA" break-glass-failed
die "backend did not become healthy after rollback to $SHA — was at $CURRENT"
