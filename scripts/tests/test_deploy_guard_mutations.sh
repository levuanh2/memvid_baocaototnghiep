#!/usr/bin/env bash
# Prove each safety scenario is capable of failing by removing one guard in a
# temporary copy outside the worktree, then running the real harness against it.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

run_mutation() { # run_mutation <name> <expression> <replacement> [file under scripts/]
  local name="$1" expression="$2" replacement="$3" target="${4:-deploy.sh}" copy status
  copy="$TMP/$name"
  mkdir -p "$copy"
  cp -R "$ROOT/scripts" "$copy/scripts"
  cp "$ROOT/docker-compose.prod.yml" "$copy/docker-compose.prod.yml"
  python3 -c 'from pathlib import Path
import sys
p=Path(sys.argv[1])
s=p.read_text()
old=sys.argv[2]
new=sys.argv[3]
if old not in s:
    raise SystemExit(f"mutation target absent: {old!r}")
p.write_text(s.replace(old,new,1))' "$copy/scripts/$target" "$expression" "$replacement"
  set +e
  MEMVID_TEST_ROOT="$copy" bash "$copy/scripts/tests/test_deploy_pinning.sh" >"$copy/result.log" 2>&1
  status=$?
  set -e
  if [ "$status" -eq 0 ]; then
    printf 'FAIL: mutation %s escaped the harness\n' "$name" >&2
    exit 1
  fi
  printf 'PASS: mutation %-24s made harness fail (exit %s)\n' "$name" "$status"
}

run_mutation current-main-pre-build '    require_current_main "before build"' '    : # guard removed'
run_mutation current-main-pre-migration '  require_current_main "before migration"' '  : # guard removed'
run_mutation current-main-pre-activation '  require_current_main "before activation"' '  : # guard removed'
run_mutation head-recheck '  [ "$ACTIVE_SHA" = "$DEPLOY_SHA" ] \
    || die "activation refused: HEAD moved after build (expected $DEPLOY_SHA, found $ACTIVE_SHA)"' '  : # guard removed'
run_mutation ci-verification 'verify_ci_success() {' $'verify_ci_success() {\n  return 0'
run_mutation status-75-normalization 'trap normalize_reserved_status EXIT' ': # guard removed'
run_mutation build-input-refusal '    refuse_unclean_build_inputs' '    : # guard removed'
run_mutation ignored-build-inputs '--untracked-files=all --ignored --' '--untracked-files=all --' _lib.sh
run_mutation shared-lock $'\nacquire_deploy_lock "$LOCK_FILE"\n' $'\n: # guard removed\n'
run_mutation inherited-fd-check '      || die "MEMVID_LOCK_INHERITED=1 but fd 9 is not $lock; refusing"' '      || true' _lib.sh
run_mutation rollback-lock 'acquire_deploy_lock "$LOCK_FILE"' ': # guard removed' rollback.sh
run_mutation rollback-ledger-check '$2 == sha && ($3 == "deploy"' '1 || ($3 == "deploy"' rollback.sh
run_mutation wrapper-lock 'flock -n 9 || {' 'true || {' deploy_remote.sh
run_mutation wrapper-restore '  git -c advice.detachedHead=false checkout --detach "$prev"' '  : # guard removed' deploy_remote.sh
run_mutation ci-query-head-sha 'head_sha=${DEPLOY_SHA}&' ''
run_mutation ci-query-branch '&branch=main' ''
run_mutation ci-query-event '&event=push' ''
run_mutation ci-query-status '&status=success' ''
run_mutation ci-query-workflow 'workflows/ci.yml/runs' 'runs'
run_mutation break-glass-reason '[ -n "${MEMVID_BREAK_GLASS_REASON:-}" ]' 'true' _lib.sh
run_mutation break-glass-attempt-record '  ledger_record "$LEDGER_FILE" "${DEPLOY_SHA:-unpinned}" break-glass-attempt' '  :'
run_mutation break-glass-failure-record '    ledger_record "$LEDGER_FILE" "${APP_BUILD_SHA:-${DEPLOY_SHA:-unpinned}}" break-glass-failed || true' '    :'

printf 'All guard mutations were detected by the harness.\n'
