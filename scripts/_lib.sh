#!/usr/bin/env bash
# Shared helpers for scripts/*.sh — sourced, not run directly.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/docker-compose.prod.yml"
ENV_FILE="${MEMVID_ENV_FILE:-/opt/memvid/env/.env}"
DATA_DIR="${MEMVID_DATA_DIR:-/opt/memvid/data}"
BACKUP_DIR="${MEMVID_BACKUP_DIR:-/opt/memvid/backups}"

# Every variable the app cannot run correctly without, checked before build.
# VITE_API_BASE is deliberately absent: the frontend build (and its own
# CORS-facing origin) lives entirely on Render now, not in this compose file.
REQUIRED_ENV_VARS=(
  DATABASE_URL
  SUPABASE_URL
  SUPABASE_SECRET_KEY
  SUPABASE_STORAGE_BUCKET
  AUTH_SECRET
  GEMINI_API_KEY
  FPT_AI_API_KEY
  ALEMBIC_PRODUCTION_HOST
  ALEMBIC_PRODUCTION_DB
)

# Every directory the compose stack bind-mounts.
REQUIRED_DATA_DIRS=(
  "$DATA_DIR/index"
  "$DATA_DIR/memory"
  "$DATA_DIR/input_docs"
  "$BACKUP_DIR"
)

# Every FILE the compose stack bind-mounts (as opposed to a directory) —
# these are the ones Docker will silently auto-create as a directory if
# missing, which breaks whatever expects to open them as a file.
REQUIRED_DATA_FILES=(
  "$DATA_DIR/memory/checkpoints.sqlite"
)

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

# Read one KEY=value line's value out of ENV_FILE. Last match wins (matches
# how a real .env is actually sourced). Empty string if unset or file absent.
env_value() {
  local key="$1"
  [ -f "$ENV_FILE" ] || { printf ''; return 0; }
  grep -E "^${key}=" "$ENV_FILE" | tail -1 | cut -d'=' -f2-
}

# Fail before build/deploy if any critical variable is missing or empty.
validate_env() {
  require_env_file
  local var val missing=()
  for var in "${REQUIRED_ENV_VARS[@]}"; do
    val="$(env_value "$var")"
    [ -n "$val" ] || missing+=("$var")
  done
  if [ "${#missing[@]}" -gt 0 ]; then
    log "missing/empty required variables in $ENV_FILE:"
    printf '  - %s\n' "${missing[@]}" >&2
    die "fix $ENV_FILE before deploying"
  fi
  log "environment validated (${#REQUIRED_ENV_VARS[@]} required vars present)"
}

# Create every bind-mounted directory/file before `compose up` runs, so
# Docker never has to invent a mount target itself. In particular: a
# single-file bind mount whose host source is missing gets auto-created by
# Docker as a DIRECTORY, not a file — this detects and self-heals that
# specific failure mode instead of letting it happen silently.
ensure_data_layout() {
  local d f
  for d in "${REQUIRED_DATA_DIRS[@]}"; do
    mkdir -p "$d"
  done
  for f in "${REQUIRED_DATA_FILES[@]}"; do
    if [ -d "$f" ]; then
      if [ -z "$(ls -A "$f" 2>/dev/null)" ]; then
        log "found an empty directory where a file-mount belongs (Docker likely auto-created it on a prior run) — replacing: $f"
        rmdir "$f"
      else
        die "expected a file at $f but found a non-empty directory — investigate before deploying, refusing to guess"
      fi
    fi
    if [ ! -f "$f" ]; then
      log "creating empty file: $f"
      touch "$f"
    fi
  done
}
