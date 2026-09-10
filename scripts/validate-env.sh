#!/usr/bin/env bash
# Standalone environment validation — the same check deploy.sh runs first,
# available on its own so it can be run ahead of time without triggering a
# build.
#
# Usage: scripts/validate-env.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
source "$SCRIPT_DIR/_lib.sh"

validate_env
