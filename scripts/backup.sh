#!/usr/bin/env bash
# Archive /opt/memvid/data (index, memory/sqlite, checkpoints, input_docs)
# into a timestamped tarball under /opt/memvid/backups. Business data lives
# in Supabase (Postgres + Storage) and is backed up there separately — this
# script only covers this instance's local bind-mounted state.
#
# Usage: scripts/backup.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
source "$SCRIPT_DIR/_lib.sh"

[ -d "$DATA_DIR" ] || die "data directory not found: $DATA_DIR"

mkdir -p "$BACKUP_DIR"
STAMP="$(date '+%Y%m%d-%H%M%S')"
ARCHIVE="$BACKUP_DIR/memvid-data-${STAMP}.tar.gz"

log "archiving $DATA_DIR -> $ARCHIVE"
tar -czf "$ARCHIVE" -C "$(dirname "$DATA_DIR")" "$(basename "$DATA_DIR")"

log "backup complete: $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"
