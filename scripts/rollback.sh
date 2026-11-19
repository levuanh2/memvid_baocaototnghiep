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

# Archive rollback floor (issue #18, migrations 20261118/20261119; owner 2026-11-19).
# Code older than the review-topic archive deletes a regenerated plan, and the cascade
# would take archived topics with their practice history (the database guard refuses
# that too; this is the second layer). Read the facts BEFORE any checkout or build.
# Fail closed: no break-glass path skips it; a failed or unreadable preflight refuses.
target_supports_archive() {
  git -C "$REPO_ROOT" cat-file -e "$1:BE/alembic/versions/20261118_review_item_archive.py" 2>/dev/null \
    && git -C "$REPO_ROOT" cat-file -e "$1:BE/alembic/versions/20261119_review_item_guard.py" 2>/dev/null \
    && git -C "$REPO_ROOT" grep -q archived_at "$1" -- BE/app/domains/review/service.py 2>/dev/null
}
log "archive preflight: reading archive facts from the database (read-only)"
if ! PREFLIGHT="$(compose run --rm -T -e ALEMBIC_ALLOW_PRODUCTION=1 backend \
    python -m scripts.rollback_preflight --moi-truong production 2>&1)"; then
  printf '%s\n' "$PREFLIGHT" | tail -n 5 >&2
  die "rollback refused: the archive preflight could not read the database; nothing was checked out (docs/RUNBOOK_REVIEW_ITEM_ARCHIVE.md)"
fi
FACTS="$(printf '%s\n' "$PREFLIGHT" | grep -E '^archive_schema=[01] archived_topics=[0-9]+ guard=[01]$' | tail -n 1 || true)"
[ -n "$FACTS" ] || die "rollback refused: unreadable archive preflight output; nothing was checked out"
ARCHIVED="$(printf '%s\n' "$FACTS" | sed -E 's/.*archived_topics=([0-9]+).*/\1/')"
if [ "$ARCHIVED" -gt 0 ] && ! target_supports_archive "$SHA"; then
  die "rollback refused: $SHA predates the review-topic archive and $ARCHIVED archived topic(s) exist; its regeneration would delete their practice history. Roll back to a SHA containing migrations 20261118 and 20261119, or roll forward (docs/RUNBOOK_REVIEW_ITEM_ARCHIVE.md)"
fi
log "archive preflight: $FACTS; target $SHA accepted"

if [ -n "$(git -C "$REPO_ROOT" status --porcelain)" ]; then
  git -C "$REPO_ROOT" status --short >&2
  die "uncommitted changes in $REPO_ROOT — commit/stash them before rolling back"
fi

CURRENT="$(git -C "$REPO_ROOT" rev-parse --short HEAD)"
log "rolling back from $CURRENT to $SHA"
git -C "$REPO_ROOT" checkout --detach "$SHA"
refuse_unclean_build_inputs
APP_BUILD_SHA="$(git -C "$REPO_ROOT" rev-parse HEAD)"
export APP_BUILD_SHA
log "repo is now intentionally detached at $APP_BUILD_SHA"

compose build
compose up -d

for _ in $(seq 1 30); do
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
