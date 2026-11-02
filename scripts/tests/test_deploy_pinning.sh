#!/usr/bin/env bash
# No network or real Docker. Exercises the production scripts against local Git
# repos and command shims. Set MEMVID_TEST_ROOT to test a mutated temporary copy.
set -euo pipefail

ROOT="${MEMVID_TEST_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
ORIGIN="$TMP/example/studymap.git"
SOURCE="$TMP/source"
SERVER="$TMP/server"
SHIM_DIR="$TMP/bin"
DOCKER_LOG="$TMP/docker.log"
OUTPUT="$TMP/output.log"
ENV_FILE="$TMP/deploy.env"
DATA_DIR="$TMP/data"
BACKUP_DIR="$TMP/backups"
LOCK_FILE="$TMP/deploy.lock"
LEDGER_FILE="$TMP/deployments.log"
HOOK_MARKER="$TMP/hook.done"
CURL_LOG="$TMP/curl.log"

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
pass() { printf 'PASS: %s\n' "$*"; }

expect_status() {
  local expected="$1"; shift
  local actual
  set +e
  "$@" >"$OUTPUT" 2>&1
  actual=$?
  set -e
  if [ "$actual" -ne "$expected" ]; then
    cat "$OUTPUT" >&2
    fail "expected exit $expected, got $actual: $*"
  fi
}

assert_head() {
  local expected="$1" actual
  actual="$(git -C "$SERVER" rev-parse HEAD)"
  [ "$actual" = "$expected" ] || fail "HEAD $actual != $expected"
}

assert_called() {
  grep -Eq "$1" "$DOCKER_LOG" || { cat "$DOCKER_LOG" >&2; fail "missing docker call: $1"; }
}

assert_not_called() {
  if grep -Eq "$1" "$DOCKER_LOG"; then
    cat "$DOCKER_LOG" >&2
    fail "unexpected docker call: $1"
  fi
}

assert_ledger() {
  local sha="$1" action="$2"
  awk -v sha="$sha" -v action="$action" '$2 == sha && $3 == action { found=1 } END { exit !found }' "$LEDGER_FILE" \
    || { cat "$LEDGER_FILE" >&2; fail "missing ledger entry $sha $action"; }
}

base_env() {
  env PATH="$SHIM_DIR:$PATH" DOCKER_LOG="$DOCKER_LOG" CURL_LOG="$CURL_LOG" \
    CI_SUCCESS_SHAS="${CI_SUCCESS_SHAS-${A_SHA:-} ${B_SHA:-} ${C_SHA:-}}" CI_MODE="${CI_MODE:-}" \
    MEMVID_BREAK_GLASS_REASON="${MEMVID_BREAK_GLASS_REASON-harness-incident}" \
    MEMVID_ENV_FILE="$ENV_FILE" MEMVID_DATA_DIR="$DATA_DIR" MEMVID_BACKUP_DIR="$BACKUP_DIR" \
    MEMVID_LOCK_FILE="$LOCK_FILE" MEMVID_DEPLOY_LEDGER="$LEDGER_FILE" \
    MEMVID_HEALTH_TIMEOUT_SEC=1 MEMVID_HEALTH_POLL_SEC=1 \
    TEST_SOURCE="$SOURCE" TEST_SERVER="$SERVER" TEST_ORIGIN="$ORIGIN" \
    TEST_HOOK_PHASE="${TEST_HOOK_PHASE:-}" TEST_HOOK_ACTION="${TEST_HOOK_ACTION:-}" \
    TEST_HOOK_MARKER="$HOOK_MARKER" TEST_MOVE_SHA="${TEST_MOVE_SHA:-}" \
    TEST_FAIL_PHASE="${TEST_FAIL_PHASE:-}" TEST_FAIL_CODE="${TEST_FAIL_CODE:-75}" "$@"
}

reset_controls() {
  : >"$DOCKER_LOG"
  rm -f "$HOOK_MARKER"
  : >"$CURL_LOG"
  unset CI_SUCCESS_SHAS CI_MODE TEST_HOOK_PHASE TEST_HOOK_ACTION TEST_MOVE_SHA TEST_FAIL_PHASE TEST_FAIL_CODE
}

run_deploy() {
  local expected="$1" sha="${2-}"
  if [ -n "$sha" ]; then
    expect_status "$expected" base_env bash "$SERVER/scripts/deploy.sh" "$sha"
  else
    expect_status "$expected" base_env bash "$SERVER/scripts/deploy.sh"
  fi
}

run_remote() {
  local expected="$1" sha="$2"
  expect_status "$expected" base_env env MEMVID_REMOTE_REPO_ROOT="$SERVER" \
    bash -s -- "$sha" <"$ROOT/scripts/deploy_remote.sh"
}

run_rollback() {
  local expected="$1" sha="$2"
  expect_status "$expected" base_env bash "$SERVER/scripts/rollback.sh" "$sha"
}

gate_expect() {
  local expected_status="$1" expected_decision="$2"; shift 2
  local result status
  set +e
  result="$(env RUN_SHA="$B_SHA" RUN_CONCLUSION=success RUN_EVENT=push RUN_BRANCH=main \
    RUN_REPO=example/studymap RUN_HEAD_REPO=example/studymap \
    RUN_WORKFLOW_PATH=.github/workflows/ci.yml EXPECTED_REPO=example/studymap \
    REMOTE_MAIN_SHA="$B_SHA" "$@" bash "$ROOT/scripts/deploy_gate.sh")"
  status=$?
  set -e
  [ "$status" -eq "$expected_status" ] || fail "gate exit $status != $expected_status ($result)"
  [[ "$result" == "decision=${expected_decision} reason="* ]] || fail "unexpected gate output: $result"
}

mkdir -p "$ORIGIN" "$SOURCE" "$SHIM_DIR" "$DATA_DIR" "$BACKUP_DIR"
git init --bare "$ORIGIN" >/dev/null
git init "$SOURCE" >/dev/null
git -C "$SOURCE" config user.name "Deploy Test"
git -C "$SOURCE" config user.email "deploy-test@example.test"
cp -R "$ROOT/scripts" "$SOURCE/scripts"
mkdir -p "$SOURCE/BE"
cp "$ROOT/docker-compose.prod.yml" "$SOURCE/docker-compose.prod.yml"
printf '*.sh text eol=lf\n' >"$SOURCE/.gitattributes"
printf '*.so\n' >"$SOURCE/.gitignore"
printf 'OLD\n' >"$SOURCE/revision.txt"
printf 'tracked\n' >"$SOURCE/BE/tracked.txt"
git -C "$SOURCE" add .
git -C "$SOURCE" commit -m OLD >/dev/null
OLD_SHA="$(git -C "$SOURCE" rev-parse HEAD)"
printf 'A\n' >"$SOURCE/revision.txt"
git -C "$SOURCE" add revision.txt
git -C "$SOURCE" commit -m A >/dev/null
git -C "$SOURCE" branch -M main
git -C "$SOURCE" remote add origin "$ORIGIN"
git -C "$SOURCE" push -u origin main >/dev/null
A_SHA="$(git -C "$SOURCE" rev-parse HEAD)"
git --git-dir="$ORIGIN" symbolic-ref HEAD refs/heads/main
git clone "$ORIGIN" "$SERVER" >/dev/null

cat >"$SHIM_DIR/curl" <<'SHIM'
#!/usr/bin/env bash
# Models GitHub's workflow-runs API: total_count is 1 only for the EXACT
# provenance query (ci.yml, head_sha, main, push, success) of a SHA listed in
# CI_SUCCESS_SHAS; any missing or altered filter gets 0, like the real filter.
url=""
for arg in "$@"; do case "$arg" in https://api.github.com/*) url="$arg" ;; esac; done
printf '%s\n' "$url" >>"$CURL_LOG"
case "${CI_MODE:-}" in
  curl-fail) exit 22 ;;
  bad-json) printf 'not json'; exit 0 ;;
  no-count) printf '{"workflow_runs":[]}'; exit 0 ;;
  string-count) printf '{"total_count":"1"}'; exit 0 ;;
esac
count=0
for sha in ${CI_SUCCESS_SHAS:-}; do
  [ "$url" = "https://api.github.com/repos/example/studymap/actions/workflows/ci.yml/runs?head_sha=${sha}&branch=main&event=push&status=success&per_page=1" ] && count=1
done
printf '{"total_count":%s,"workflow_runs":[]}' "$count"
SHIM
chmod +x "$SHIM_DIR/curl"

cat >"$SHIM_DIR/docker" <<'SHIM'
#!/usr/bin/env bash
printf 'sha=%s args=%s\n' "${APP_BUILD_SHA:-unset}" "$*" >>"$DOCKER_LOG"
args="$*"
phase=""
[[ "$args" =~ compose.*build$ ]] && phase=build
[[ "$args" =~ compose.*run.*scripts.run_migrations ]] && phase=migration
[[ "$args" =~ compose.*up\ -d$ ]] && phase=up

if [ -n "$phase" ] && [ "$phase" = "${TEST_HOOK_PHASE:-}" ] && [ ! -e "$TEST_HOOK_MARKER" ]; then
  : >"$TEST_HOOK_MARKER"
  case "${TEST_HOOK_ACTION:-}" in
    advance)
      printf 'advance-%s\n' "$phase" >>"$TEST_SOURCE/revision.txt"
      git -C "$TEST_SOURCE" add revision.txt
      git -C "$TEST_SOURCE" commit -m "advance during $phase" >/dev/null
      git -C "$TEST_SOURCE" push origin main >/dev/null
      ;;
    move-head)
      git -C "$TEST_SERVER" -c advice.detachedHead=false checkout --detach "$TEST_MOVE_SHA" >/dev/null
      ;;
    health75)
      printf '#!/usr/bin/env bash\nexit 75\n' >"$TEST_SERVER/scripts/health.sh"
      chmod +x "$TEST_SERVER/scripts/health.sh"
      ;;
  esac
fi
if [ -n "$phase" ] && [ "$phase" = "${TEST_FAIL_PHASE:-}" ]; then
  exit "${TEST_FAIL_CODE:-75}"
fi
if [ "${1:-}" = inspect ]; then
  printf 'running\t0\thealthy\n'
fi
exit 0
SHIM
chmod +x "$SHIM_DIR/docker"

cat >"$ENV_FILE" <<'ENV'
DATABASE_URL=dummy
SUPABASE_URL=dummy
SUPABASE_SECRET_KEY=dummy
SUPABASE_STORAGE_BUCKET=dummy
AUTH_SECRET=dummy
GEMINI_API_KEY=dummy
FPT_AI_API_KEY=dummy
ALEMBIC_PRODUCTION_HOST=dummy
ALEMBIC_PRODUCTION_DB=dummy
ENV

# A: current, CI-verified SHA deploys and is ledgered.
B_SHA="$A_SHA"
gate_expect 0 deploy
reset_controls
run_deploy 0 "$A_SHA"
assert_head "$A_SHA"
assert_called 'compose .* up -d$'
assert_called "^sha=$A_SHA args=compose .* build$"
assert_ledger "$A_SHA" deploy
pass "A current CI-verified commit deploys"

# Advance main to B.
printf 'B\n' >"$SOURCE/revision.txt"
git -C "$SOURCE" add revision.txt
git -C "$SOURCE" commit -m B >/dev/null
git -C "$SOURCE" push origin main >/dev/null
B_SHA="$(git -C "$SOURCE" rev-parse HEAD)"

# B/E: the real remote wrapper restores its previous checkout on genuine 75.
gate_expect 10 skip RUN_SHA="$A_SHA"
git -C "$SERVER" fetch origin main >/dev/null
git -C "$SERVER" -c advice.detachedHead=false checkout --detach "$B_SHA" >/dev/null
reset_controls
run_remote 75 "$A_SHA"
assert_head "$B_SHA"
assert_not_called 'compose .* (build|up -d)$'
pass "B/E superseded remote deploy restores previous HEAD without activation"

# C and provenance gate mismatch cases.
gate_expect 1 reject RUN_CONCLUSION=failure
gate_expect 1 reject RUN_REPO=other/repo
gate_expect 1 reject RUN_HEAD_REPO=other/repo
gate_expect 1 reject RUN_EVENT=pull_request
gate_expect 1 reject RUN_BRANCH=feature
gate_expect 1 reject RUN_WORKFLOW_PATH=.github/workflows/other.yml
gate_expect 1 reject REMOTE_MAIN_SHA=bad
pass "C gate rejects failed CI and provenance mismatches"

# D/G/H: an empty ledger trusts nothing it did not record itself. B deploys and
# is recorded; the previously checked-out A is NOT inherited, so rolling back to
# A needs break glass (with a reason); older OLD stays barred; B re-runs cleanly.
rm -f "$LEDGER_FILE"
git -C "$SERVER" -c advice.detachedHead=false checkout --detach "$A_SHA" >/dev/null
reset_controls
run_remote 0 "$B_SHA"
assert_head "$B_SHA"
assert_ledger "$B_SHA" deploy
grep -q "inherited" "$LEDGER_FILE" && fail "ledger must not inherit an unverified previous HEAD"
grep -q "$A_SHA" "$LEDGER_FILE" && fail "A was never deployed by this ledger and must not appear"
reset_controls
run_rollback 1 "$A_SHA"
assert_head "$B_SHA"
reset_controls
MEMVID_BREAK_GLASS_REASON=""
expect_status 1 base_env env MEMVID_BREAK_GLASS=1 bash "$SERVER/scripts/rollback.sh" "$A_SHA"
unset MEMVID_BREAK_GLASS_REASON
reset_controls
run_rollback 1 "$OLD_SHA"
reset_controls
run_deploy 0 "$B_SHA"
reset_controls
run_deploy 0 "$B_SHA"
assert_head "$B_SHA"
pass "D/G/H empty ledger records only what it deployed; unrecorded rollback needs break glass + reason; B re-run is idempotent"

# F: malformed/missing/unknown SHAs and absent CI evidence fail closed.
reset_controls
run_deploy 1 bad
run_deploy 1
CI_SUCCESS_SHAS=""
run_deploy 1 "$B_SHA"
assert_not_called 'compose .* build$'
for mode in curl-fail bad-json no-count string-count; do
  reset_controls
  CI_MODE="$mode"
  run_deploy 1 "$B_SHA"
  assert_not_called 'compose .* build$'
done
reset_controls
run_deploy 0 "$B_SHA"
grep -qx "https://api.github.com/repos/example/studymap/actions/workflows/ci.yml/runs?head_sha=${B_SHA}&branch=main&event=push&status=success&per_page=1" "$CURL_LOG" \
  || { cat "$CURL_LOG" >&2; fail "CI verification did not send the exact provenance query"; }
pass "F invalid/missing SHA, missing CI evidence and every CI-API failure mode fail closed; exact query sent"

# Reserved status: ordinary child 75 is always workflow-visible failure.
for phase in build migration up; do
  reset_controls
  TEST_FAIL_PHASE="$phase"
  run_remote 70 "$B_SHA"
done
reset_controls
TEST_HOOK_PHASE=build TEST_HOOK_ACTION=health75
run_remote 1 "$B_SHA"
git -C "$SERVER" checkout -- scripts/health.sh
pass "build/migration/up/health exit 75 cannot masquerade as superseded"

# Remote main advancing during build is caught before migration.
reset_controls
TEST_HOOK_PHASE=build TEST_HOOK_ACTION=advance
run_remote 75 "$B_SHA"
assert_head "$B_SHA"
assert_not_called 'scripts.run_migrations'
assert_not_called 'compose .* up -d$'
C_SHA="$(git -C "$SOURCE" rev-parse HEAD)"
git -C "$SOURCE" reset --hard "$B_SHA" >/dev/null
git -C "$SOURCE" push --force origin main >/dev/null
pass "main advance during build exits 75 before migration and activation"

# Remote main advancing during migration is caught before activation.
reset_controls
TEST_HOOK_PHASE=migration TEST_HOOK_ACTION=advance
run_remote 75 "$B_SHA"
assert_head "$B_SHA"
assert_not_called 'compose .* up -d$'
git -C "$SOURCE" reset --hard "$B_SHA" >/dev/null
git -C "$SOURCE" push --force origin main >/dev/null
pass "main advance during migration exits 75 before activation"

# Local HEAD moving during build is refused even while main stays B.
reset_controls
TEST_HOOK_PHASE=build TEST_HOOK_ACTION=move-head TEST_MOVE_SHA="$A_SHA"
run_remote 1 "$B_SHA"
assert_not_called 'compose .* up -d$'
git -C "$SERVER" reset --hard "$B_SHA" >/dev/null
pass "local HEAD movement during build is refused"

# Untracked build context is refused even with force-reset.
reset_controls
printf 'untracked\n' >"$SERVER/BE/untracked.txt"
expect_status 1 base_env env MEMVID_FORCE_RESET=1 bash "$SERVER/scripts/deploy.sh" "$B_SHA"
assert_not_called 'compose .* build$'
rm -f "$SERVER/BE/untracked.txt"
reset_controls
printf 'stale\n' >"$SERVER/BE/stale.so"
run_deploy 1 "$B_SHA"
assert_not_called 'compose .* build$'
reset_controls
run_rollback 1 "$B_SHA"
assert_not_called 'compose .* build$'
rm -f "$SERVER/BE/stale.so"
pass "untracked and git-ignored BE build inputs are refused (deploy and rollback)"

# Shared lock makes a concurrent deploy fail fast.
reset_controls
exec 8>"$LOCK_FILE"
flock -n 8
run_deploy 1 "$B_SHA"
reset_controls
run_rollback 1 "$B_SHA"
git -C "$SERVER" -c advice.detachedHead=false checkout --detach "$A_SHA" >/dev/null
reset_controls
run_remote 1 "$B_SHA"
assert_head "$A_SHA"
[ ! -s "$DOCKER_LOG" ] || fail "remote wrapper ran docker while another operation held the lock"
reset_controls
expect_status 1 base_env bash -c 'exec 9>"$1"; MEMVID_LOCK_INHERITED=1 bash "$2" "$3"' _ "$TMP/not-the-lock" "$SERVER/scripts/deploy.sh" "$B_SHA"
flock -u 8
git -C "$SERVER" reset --hard "$B_SHA" >/dev/null
pass "shared lock refuses concurrent deploy, rollback and remote wrapper (wrapper leaves HEAD untouched); spoofed inherited fd is refused"

# G: unledgered A needs break glass (attempt + success recorded); once recorded,
# a normal rollback to A is accepted and ledgered as "rollback".
reset_controls
expect_status 0 base_env env MEMVID_BREAK_GLASS=1 bash "$SERVER/scripts/rollback.sh" "$A_SHA"
assert_ledger "$A_SHA" break-glass-attempt
assert_ledger "$A_SHA" break-glass
reset_controls
run_rollback 0 "$A_SHA"
assert_head "$A_SHA"
assert_ledger "$A_SHA" rollback
reset_controls
run_deploy 0 "$B_SHA"

git -C "$SOURCE" reset --hard "$C_SHA" >/dev/null
git -C "$SOURCE" push --force origin main >/dev/null
git -C "$SERVER" fetch origin main >/dev/null
reset_controls
run_rollback 1 "$C_SHA"
reset_controls
expect_status 0 base_env env MEMVID_BREAK_GLASS=1 bash "$SERVER/scripts/rollback.sh" "$C_SHA"
assert_ledger "$C_SHA" break-glass
reset_controls
run_rollback 0 "$C_SHA"
pass "G rollback ledger accepts recorded SHAs and gates unrecorded SHA"

# Break-glass pinned CI bypass and unpinned deploy are explicit and ledgered.
git -C "$SOURCE" reset --hard "$B_SHA" >/dev/null
git -C "$SOURCE" push --force origin main >/dev/null
git -C "$SERVER" reset --hard "$B_SHA" >/dev/null
reset_controls
CI_SUCCESS_SHAS=""
MEMVID_BREAK_GLASS_REASON=""
expect_status 1 base_env env MEMVID_BREAK_GLASS=1 bash "$SERVER/scripts/deploy.sh" "$B_SHA"
assert_not_called 'compose .* build$'
unset MEMVID_BREAK_GLASS_REASON
reset_controls
CI_SUCCESS_SHAS=""
expect_status 0 base_env env MEMVID_BREAK_GLASS=1 bash "$SERVER/scripts/deploy.sh" "$B_SHA"
assert_ledger "$B_SHA" break-glass-attempt
assert_ledger "$B_SHA" break-glass
reset_controls
CI_SUCCESS_SHAS=""
TEST_FAIL_PHASE=up TEST_FAIL_CODE=1
expect_status 1 base_env env MEMVID_BREAK_GLASS=1 bash "$SERVER/scripts/deploy.sh" "$B_SHA"
assert_ledger "$B_SHA" break-glass-failed
reset_controls
expect_status 0 base_env env MEMVID_BREAK_GLASS=1 bash "$SERVER/scripts/deploy.sh"
assert_ledger "$B_SHA" break-glass
pass "break-glass pinned and unpinned paths warn, succeed, and are ledgered"

printf 'All deploy pinning scenarios passed.\n'
