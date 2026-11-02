#!/usr/bin/env bash
# Pure workflow_run deployment gate. No network or repository mutation.
set -u

reject() {
  printf 'decision=reject reason=%s\n' "$1"
  exit 1
}

sha_is_valid() {
  [[ "$1" =~ ^[0-9a-f]{40}$ ]]
}

sha_is_valid "${RUN_SHA:-}" || reject invalid_run_sha
[ "${RUN_CONCLUSION:-}" = "success" ] || reject conclusion_not_success
[ "${RUN_EVENT:-}" = "push" ] || reject event_not_push
[ "${RUN_BRANCH:-}" = "main" ] || reject branch_not_main
[ -n "${EXPECTED_REPO:-}" ] || reject missing_expected_repo
[ "${RUN_REPO:-}" = "$EXPECTED_REPO" ] || reject repository_mismatch
[ "${RUN_HEAD_REPO:-}" = "$EXPECTED_REPO" ] || reject head_repository_mismatch
[ "${RUN_WORKFLOW_PATH:-}" = ".github/workflows/ci.yml" ] || reject workflow_path_mismatch
sha_is_valid "${REMOTE_MAIN_SHA:-}" || reject invalid_remote_main_sha

if [ "$REMOTE_MAIN_SHA" != "$RUN_SHA" ]; then
  printf 'decision=skip reason=main_advanced\n'
  exit 10
fi

printf 'decision=deploy reason=verified_sha_is_current_main\n'
exit 0
