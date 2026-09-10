#!/usr/bin/env bash
# Deploy or update the production stack (backend only — frontend stays on
# Render), in order:
#   validate env -> ensure data layout -> sync code to origin/main -> build
#   -> migrate (safe to re-run) -> start -> health check -> success.
#
# Fails fast at the first broken step. Fails the whole deploy (non-zero
# exit) if the backend is unhealthy after start — never reports success on
# a broken stack.
#
# Usage: scripts/deploy.sh
# Env:   MEMVID_FORCE_RESET=1  discard uncommitted local changes in the repo
#        clone and force it to match origin/main (needed after a rollback
#        left the repo on a detached HEAD with no uncommitted changes — that
#        case proceeds automatically; this flag is only for the rarer case
#        of real uncommitted edits sitting in the server's clone).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
source "$SCRIPT_DIR/_lib.sh"

require_compose_file
require_env_file

log "step 1/7: validating environment"
validate_env

log "step 2/7: ensuring data directory layout"
ensure_data_layout

if [ -d "$REPO_ROOT/.git" ]; then
  log "step 3/7: syncing code to origin/main"
  CURRENT_REF="$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  if [ -n "$(git -C "$REPO_ROOT" status --porcelain)" ] && [ "${MEMVID_FORCE_RESET:-}" != "1" ]; then
    git -C "$REPO_ROOT" status --short >&2
    die "uncommitted changes in $REPO_ROOT — commit/stash them, or re-run with MEMVID_FORCE_RESET=1 to discard and deploy origin/main anyway"
  fi
  # Deliberately unconditional: works whether the repo is currently on main,
  # on another branch, or (e.g. right after rollback.sh) on a detached HEAD.
  # Always lands on local `main` tracking origin/main exactly — this is what
  # makes rollback safe to run: whatever state it leaves the repo in, the
  # next deploy always restores main correctly rather than staying detached.
  git -C "$REPO_ROOT" fetch origin main
  git -C "$REPO_ROOT" checkout -B main origin/main
  git -C "$REPO_ROOT" reset --hard origin/main
  log "now at $(git -C "$REPO_ROOT" rev-parse --short HEAD) (was $CURRENT_REF)"
else
  log "step 3/7: no .git directory at $REPO_ROOT — skipping code sync"
fi

log "step 4/7: building backend image"
compose build

log "step 5/7: running database migration (alembic upgrade head — no-ops if already current)"
compose run --rm backend alembic upgrade head

log "step 6/7: starting backend"
compose up -d

log "step 7/7: health check"
if ! "$SCRIPT_DIR/health.sh"; then
  die "backend failed its health check — deploy did NOT complete successfully"
fi

log "deploy complete"
compose ps
