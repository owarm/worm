#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="${WORM_NETWORK_BASE:-/opt/worm/network}"
CONFIG_DIR="$BASE_DIR/config"
SECRETS_FILE="$CONFIG_DIR/secrets.env"
WG_NETWORK="10.30.0.0/24"
OPNSENSE_WG_IP="10.30.0.1"
DEDICATED_PRIVATE_IP="10.20.1.2"

if [ -f "$SECRETS_FILE" ]; then
  set -a
  # shellcheck source=/dev/null
  . "$SECRETS_FILE"
  set +a
fi

wg_status=FAIL
cloud_status=FAIL
dedicated_status=FAIL

if [ -n "${OPNSENSE_SSH_HOST:-}" ]; then
  if ssh -o BatchMode=yes -o ConnectTimeout=8 -p "${OPNSENSE_SSH_PORT:-22}" \
    "${OPNSENSE_SSH_USER:-root}@${OPNSENSE_SSH_HOST}" \
    "ifconfig | grep -q '$OPNSENSE_WG_IP'"; then
    wg_status=READY
  fi
  if ssh -o BatchMode=yes -o ConnectTimeout=8 -p "${OPNSENSE_SSH_PORT:-22}" \
    "${OPNSENSE_SSH_USER:-root}@${OPNSENSE_SSH_HOST}" \
    "netstat -rn | grep -q '10.20.0.0\\|10.20.1.0'"; then
    cloud_status=REACHABLE
  fi
fi

if ping -c 2 -W 2 "$DEDICATED_PRIVATE_IP" >/dev/null 2>&1; then
  dedicated_status=REACHABLE
fi

printf '=== WORM NETWORK V006 ===\n\n'
printf 'WIREGUARD:\n%s\n\n' "$wg_status"
printf 'WG NETWORK:\n%s\n\n' "$WG_NETWORK"
printf 'PRIVATE CLOUD:\n%s\n\n' "$cloud_status"
printf 'DEDICATED:\n%s\n\n' "$dedicated_status"
printf 'MANAGEMENT WAN EXPOSURE:\nDISABLED\n'
