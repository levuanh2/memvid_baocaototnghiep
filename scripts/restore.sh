#!/usr/bin/env bash
# Restore /opt/memvid/data from a backup.sh archive. Destructive — stops the
# stack, replaces the data directory, restarts. Requires explicit confirmation.
#
# Usage: scripts/restore.sh <path-to-archive.tar.gz> [--yes]
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
source "$SCRIPT_DIR/_lib.sh"

ARCHIVE="${1:-}"
CONFIRM="${2:-}"

[ -n "$ARCHIVE" ] || die "usage: scripts/restore.sh <path-to-archive.tar.gz> [--yes]"
require_file "$ARCHIVE"
require_compose_file
require_env_file

if [ "$CONFIRM" != "--yes" ]; then
  read -r -p "This REPLACES $DATA_DIR with the contents of $ARCHIVE. Continue? [y/N] " reply
  case "$reply" in
    [yY]|[yY][eE][sS]) ;;
    *) die "aborted" ;;
  esac
fi

log "stopping services"
compose stop

STAMP="$(date '+%Y%m%d-%H%M%S')"
if [ -d "$DATA_DIR" ]; then
  log "moving current data dir aside: ${DATA_DIR}.pre-restore-${STAMP}"
  mv "$DATA_DIR" "${DATA_DIR}.pre-restore-${STAMP}"
fi

mkdir -p "$(dirname "$DATA_DIR")"
log "extracting $ARCHIVE -> $(dirname "$DATA_DIR")"
tar -xzf "$ARCHIVE" -C "$(dirname "$DATA_DIR")"

log "starting services"
compose up -d

log "restore complete — previous data kept at ${DATA_DIR}.pre-restore-${STAMP}"
