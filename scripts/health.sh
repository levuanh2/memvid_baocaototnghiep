#!/usr/bin/env bash
# Check backend health. Frontend lives on Render (out of scope — check it
# via Render's own dashboard/health, not from here). Exits non-zero on failure.
#
# Usage: scripts/health.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
source "$SCRIPT_DIR/_lib.sh"

require_compose_file
require_env_file

FAILED=0

check() {
  local name="$1"; shift
  if "$@" >/dev/null 2>&1; then
    log "OK   $name"
  else
    log "FAIL $name"
    FAILED=1
  fi
}

check "backend (/health)"  compose exec -T backend curl -fsS http://localhost:8080/health

log "container status:"
compose ps

if [ "$FAILED" -ne 0 ]; then
  die "backend health check failed"
fi

log "backend healthy"
