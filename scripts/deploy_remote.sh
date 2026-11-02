#!/usr/bin/env bash
# SSH-side wrapper streamed from the verified runner checkout to `bash -s`.
# The production workflow and local harness therefore share this exact logic.
set -euo pipefail

SUPERSEDED=0
normalize_reserved_status() {
  local rc=$?
  trap - EXIT
  if [ "$rc" -eq 75 ] && [ "$SUPERSEDED" != "1" ]; then
    printf 'unexpected remote-wrapper exit 75 normalized to failure 70\n' >&2
    exit 70
  fi
  exit "$rc"
}
trap normalize_reserved_status EXIT

SHA="${1:-}"
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { printf 'invalid deploy SHA\n' >&2; exit 1; }
REPO_ROOT="${MEMVID_REMOTE_REPO_ROOT:-/opt/memvid/app}"
LOCK_FILE="${MEMVID_LOCK_FILE:-/opt/memvid/deploy.lock}"
cd "$REPO_ROOT"
# Take the shared deploy/rollback lock BEFORE touching the checkout, and hold it
# (fd 9 stays open) through deploy.sh and any restore below. deploy.sh reuses
# this exact descriptor via MEMVID_LOCK_INHERITED instead of reopening it.
mkdir -p "$(dirname "$LOCK_FILE")"
exec 9>"$LOCK_FILE"
flock -n 9 || { printf 'another deploy or rollback holds %s; refusing to run concurrently\n' "$LOCK_FILE" >&2; exit 1; }
prev="$(git rev-parse HEAD)"
git fetch origin main
git -c advice.detachedHead=false checkout --detach "$SHA"
chmod +x scripts/*.sh

set +e
MEMVID_LOCK_INHERITED=1 ./scripts/deploy.sh "$SHA"
status=$?
set -e
if [ "$status" -eq 75 ]; then
  git -c advice.detachedHead=false checkout --detach "$prev"
  SUPERSEDED=1
  exit 75
fi
exit "$status"
