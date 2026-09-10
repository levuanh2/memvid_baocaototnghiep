#!/usr/bin/env bash
# Tail production logs. No args = all services.
#
# Usage: scripts/logs.sh [service] [-- extra docker compose logs args]
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
source "$SCRIPT_DIR/_lib.sh"

require_compose_file
require_env_file

SERVICE="${1:-}"
if [ -n "$SERVICE" ]; then
  shift || true
  log "tailing logs: $SERVICE"
  compose logs -f --tail=200 "$SERVICE" "$@"
else
  log "tailing logs: all services"
  compose logs -f --tail=200
fi
