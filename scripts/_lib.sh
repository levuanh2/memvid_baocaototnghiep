#!/usr/bin/env bash
# Shared helpers for scripts/*.sh — sourced, not run directly.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/docker-compose.prod.yml"
ENV_FILE="${MEMVID_ENV_FILE:-/opt/memvid/env/.env}"
DATA_DIR="${MEMVID_DATA_DIR:-/opt/memvid/data}"
BACKUP_DIR="${MEMVID_BACKUP_DIR:-/opt/memvid/backups}"

log()  { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
die()  { printf '[%s] ERROR: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >&2; exit 1; }

require_file() {
  [ -f "$1" ] || die "required file not found: $1"
}

require_compose_file() {
  require_file "$COMPOSE_FILE"
}

require_env_file() {
  require_file "$ENV_FILE"
}

compose() {
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
}
