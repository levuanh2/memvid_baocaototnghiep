#!/usr/bin/env bash
# Deploy or update the production stack: pull latest code, build images,
# bring services up, wait for health. Safe to re-run — idempotent.
#
# Usage: scripts/deploy.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
source "$SCRIPT_DIR/_lib.sh"

require_compose_file
require_env_file

if [ -d "$REPO_ROOT/.git" ]; then
  log "pulling latest code (origin/main)"
  git -C "$REPO_ROOT" pull --ff-only origin main
else
  log "no .git directory at $REPO_ROOT — skipping git pull"
fi

log "building images"
compose build

log "starting services"
compose up -d

log "waiting for backend health"
for i in $(seq 1 30); do
  if compose exec -T backend curl -fsS http://localhost:8080/health >/dev/null 2>&1; then
    log "backend healthy after ${i} tries"
    break
  fi
  [ "$i" -eq 30 ] && die "backend did not become healthy in time"
  sleep 2
done

log "deploy complete"
compose ps
