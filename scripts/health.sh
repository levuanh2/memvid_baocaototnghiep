#!/usr/bin/env bash
# Wait for the backend to become healthy, then confirm it. Frontend lives on
# Render (out of scope — check it via Render's own dashboard/health, not from
# here). Exits non-zero on failure or timeout.
#
# AI-heavy imports (embeddings, LangChain, etc.) push real startup to
# 70-90s — a single immediate check right after `compose up -d` fails the
# deploy on a backend that is merely still starting, not broken. Poll Docker's
# own healthcheck (docker-compose.prod.yml) as the primary signal; fall back
# to a direct /health hit only when Docker reports no health status at all.
# Bail out immediately (no point waiting out the full timeout) if the
# container is actually crashing rather than slow to start.
#
# Usage: scripts/health.sh
# Env:   MEMVID_HEALTH_TIMEOUT_SEC   max seconds to wait (default 300 = 5 min)
#        MEMVID_HEALTH_POLL_SEC      seconds between checks (default 5)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
source "$SCRIPT_DIR/_lib.sh"

require_compose_file
require_env_file

TIMEOUT="${MEMVID_HEALTH_TIMEOUT_SEC:-300}"
POLL="${MEMVID_HEALTH_POLL_SEC:-5}"
CONTAINER="memvid_backend"
# ponytail: 3 restarts observed during one wait window = crash-looping, not
# a slow start. Raise if a legitimately flappy dependency needs more slack.
RESTART_THRESHOLD=3

# One inspect call, three fields tab-separated: container Status (running/
# exited/dead/restarting/...), RestartCount, and Health.Status ("none" when
# the container has no HEALTHCHECK result yet, e.g. still `starting`, or —
# for a container missing entirely — an intentionally blank read via `|| :`.
container_state() {
  docker inspect \
    --format '{{.State.Status}}	{{.RestartCount}}	{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' \
    "$CONTAINER" 2>/dev/null || :
}

http_health() {
  compose exec -T backend curl -fsS http://localhost:8080/health >/dev/null 2>&1
}

dump_diagnostics() {
  log "container status (all):"
  compose ps -a || true
  docker ps -a || true
  log "last 200 lines of backend logs:"
  docker logs --tail=200 "$CONTAINER" 2>&1 || true
}

log "waiting up to ${TIMEOUT}s for backend to become healthy (polling every ${POLL}s)"
echo "Waiting for backend..."

initial_restarts=""
elapsed=0
while [ "$elapsed" -lt "$TIMEOUT" ]; do
  line="$(container_state)"
  if [ -z "$line" ]; then
    # Container not created yet (right after `compose up -d` returns) — not a
    # failure, just not there yet.
    docker_state="missing"; restarts=0; health="none"
  else
    IFS="$(printf '\t')" read -r docker_state restarts health <<<"$line"
  fi

  if [ "$docker_state" != "missing" ] && [ -z "$initial_restarts" ]; then
    initial_restarts="$restarts"
  fi

  # Crash detection: an exited/dead container, or one that has restarted
  # RESTART_THRESHOLD+ times during THIS wait (not counting restarts from
  # before this script started), will never pass — stop now instead of
  # burning the full timeout.
  if [ "$docker_state" = "exited" ] || [ "$docker_state" = "dead" ]; then
    echo "[${elapsed}s] docker=${docker_state} (container ${docker_state})"
    log "backend container ${docker_state} — not a slow start, a crash"
    dump_diagnostics
    die "backend container ${docker_state} during startup"
  fi
  if [ -n "$initial_restarts" ] && [ "$((restarts - initial_restarts))" -ge "$RESTART_THRESHOLD" ]; then
    echo "[${elapsed}s] docker=${docker_state} restarts=${restarts}"
    log "backend restarted ${RESTART_THRESHOLD}+ times during this wait — crash-looping, not starting slowly"
    dump_diagnostics
    die "backend is crash-looping (restart count +$((restarts - initial_restarts)) since wait began)"
  fi

  if [ "$docker_state" = "missing" ]; then
    # Container not created yet — nothing to curl either. Just keep waiting.
    echo "[${elapsed}s] docker=missing"
  else
    case "$health" in
      healthy)
        echo "[${elapsed}s] docker=healthy"
        log "backend healthy after ${elapsed}s"
        compose ps
        log "backend healthy"
        exit 0
        ;;
      unhealthy)
        echo "[${elapsed}s] docker=unhealthy"
        dump_diagnostics
        die "backend reported unhealthy after ${elapsed}s"
        ;;
      starting)
        echo "[${elapsed}s] docker=starting"
        ;;
      *)
        # health == "none": container is up but has no HEALTHCHECK result
        # (no Health object at all) — fall back to a direct HTTP probe for
        # this cycle only.
        if http_health; then
          echo "[${elapsed}s] docker=none http=ok"
          log "backend healthy after ${elapsed}s (via HTTP fallback, docker health unavailable)"
          compose ps
          log "backend healthy"
          exit 0
        fi
        echo "[${elapsed}s] docker=none http=fail"
        ;;
    esac
  fi

  sleep "$POLL"
  elapsed=$((elapsed + POLL))
done

dump_diagnostics
die "backend did not become healthy within ${TIMEOUT}s"
