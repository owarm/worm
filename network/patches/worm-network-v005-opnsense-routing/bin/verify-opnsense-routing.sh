#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="${WORM_NETWORK_BASE:-/opt/worm/network}"
CONFIG_DIR="$BASE_DIR/config"
SECRETS_FILE="$CONFIG_DIR/secrets.env"
DEDICATED_PRIVATE_IP="10.20.1.2"

if [ -f "$SECRETS_FILE" ]; then
  set -a
  # shellcheck source=/dev/null
  . "$SECRETS_FILE"
  set +a
fi

echo "=== Dedicated checks ==="
ip -br addr
ip route
ping -c 2 -W 2 "${OPNSENSE_PRIVATE_IP:-10.20.0.2}" || true
getent hosts debian.org || true
curl -fsSI --max-time 8 https://debian.org >/dev/null && echo "HTTPS=PASS" || echo "HTTPS=FAIL"

echo
echo "=== OPNsense route check ==="
if [ -n "${OPNSENSE_SSH_HOST:-}" ]; then
  ssh -o BatchMode=yes -o ConnectTimeout=8 -p "${OPNSENSE_SSH_PORT:-22}" \
    "${OPNSENSE_SSH_USER:-root}@${OPNSENSE_SSH_HOST}" \
    "netstat -rn; ping -c 2 -W 2 $DEDICATED_PRIVATE_IP || true"
else
  echo "OPNSENSE_SSH_HOST=MISSING"
fi
