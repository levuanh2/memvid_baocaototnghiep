#!/usr/bin/env bash
# Stop the production stack without removing containers/volumes — data under
# /opt/memvid/data is untouched either way (bind mounts), but `stop` keeps
# container state so `restart.sh` / `docker compose start` is a fast resume.
#
# Usage: scripts/stop.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
source "$SCRIPT_DIR/_lib.sh"

require_compose_file
require_env_file

log "stopping all services"
compose stop

log "stopped"
compose ps
