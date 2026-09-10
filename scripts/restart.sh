#!/usr/bin/env bash
# Restart the production stack (or one service) without rebuilding images.
#
# Usage: scripts/restart.sh [service]
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
source "$SCRIPT_DIR/_lib.sh"

require_compose_file
require_env_file

SERVICE="${1:-}"

if [ -n "$SERVICE" ]; then
  log "restarting service: $SERVICE"
  compose restart "$SERVICE"
else
  log "restarting all services"
  compose restart
fi

log "restart complete"
compose ps
