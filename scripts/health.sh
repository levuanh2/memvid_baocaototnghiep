#!/usr/bin/env bash
# Check health of every production service. Exits non-zero if any check fails.
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
check "frontend (:3000)"   compose exec -T frontend wget -q --spider http://localhost:3000/
check "nginx (/healthz)"   compose exec -T nginx wget -q --spider http://localhost/healthz

log "container status:"
compose ps

if [ "$FAILED" -ne 0 ]; then
  die "one or more health checks failed"
fi

log "all services healthy"
