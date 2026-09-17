#!/usr/bin/env sh
set -eu

BASE_DIR="${WORM_NETWORK_BASE:-/opt/worm/network}"
# shellcheck disable=SC1091
. "$BASE_DIR/bin/common.sh"

TS="$(date +%Y%m%d-%H%M%S)"
LOG="$LOG_DIR/audit-$TS.log"

run_all() {
  echo "Starting WORM network read-only audit at $TS"
  "$BASE_DIR/bin/audit-dedicated.sh"
  "$BASE_DIR/bin/audit-cloud.sh"
  "$BASE_DIR/bin/audit-robot.sh"
  "$BASE_DIR/bin/audit-opnsense.sh"
  "$BASE_DIR/bin/generate-topology.sh"
  "$BASE_DIR/bin/verify-audit.sh"
  echo
  "$BASE_DIR/bin/summary.sh"
  echo "NO CHANGES APPLIED"
}

run_all 2>&1 | tee "$LOG"
echo "Log saved: $LOG"

