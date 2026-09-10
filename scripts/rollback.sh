#!/usr/bin/env bash
# Roll back to a specific git ref (commit sha or tag), rebuild, restart.
# Requires an explicit ref — no "previous commit" guessing.
#
# Usage: scripts/rollback.sh <git-ref>
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
source "$SCRIPT_DIR/_lib.sh"

REF="${1:-}"
[ -n "$REF" ] || die "usage: scripts/rollback.sh <git-ref>"

require_compose_file
require_env_file
[ -d "$REPO_ROOT/.git" ] || die "no .git directory at $REPO_ROOT — cannot rollback by ref"

git -C "$REPO_ROOT" rev-parse --verify "$REF" >/dev/null 2>&1 \
  || die "unknown git ref: $REF"

CURRENT="$(git -C "$REPO_ROOT" rev-parse --short HEAD)"
log "rolling back from $CURRENT to $REF"

git -C "$REPO_ROOT" checkout "$REF"

log "rebuilding images at $REF"
compose build

log "restarting services"
compose up -d

log "waiting for backend health"
for i in $(seq 1 30); do
  if compose exec -T backend curl -fsS http://localhost:8080/health >/dev/null 2>&1; then
    log "backend healthy after ${i} tries"
    log "rollback complete: now at $(git -C "$REPO_ROOT" rev-parse --short HEAD) (was $CURRENT)"
    exit 0
  fi
  sleep 2
done

die "backend did not become healthy after rollback to $REF — was at $CURRENT"
