#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="${WORM_NETWORK_BASE:-/opt/worm/network}"
PATCH_DIR="$BASE_DIR/patches/worm-network-v006-wireguard"
CONFIG_DIR="$BASE_DIR/config"
STATE_DIR="$PATCH_DIR/state"
BACKUP_DIR="$BASE_DIR/backup"
SECRETS_FILE="$CONFIG_DIR/secrets.env"

WG_NETWORK="10.30.0.0/24"
OPNSENSE_WG_IP="10.30.0.1/24"
WORM_CLOUD_NET="10.20.0.0/24"
WORM_VSWITCH_NET="10.20.1.0/24"
DEDICATED_PRIVATE_IP="10.20.1.2"
NETWORK_NAME="worm-private"
OPNSENSE_SERVER_NAME="worm-opnsense"
API="https://api.hetzner.cloud/v1"
TS="$(TZ=Europe/Rome date +%Y%m%d-%H%M%S)"
CONFIG_BACKUP="$BACKUP_DIR/opnsense-config-$TS.xml"

mkdir -p "$STATE_DIR" "$BACKUP_DIR"

if [ -f "$SECRETS_FILE" ]; then
  set -a
  # shellcheck source=/dev/null
  . "$SECRETS_FILE"
  set +a
fi

print_result() {
  printf '=== WORM NETWORK V006 ===\n\n'
  printf 'WIREGUARD:\n%s\n\n' "$1"
  printf 'WG NETWORK:\n%s\n\n' "$WG_NETWORK"
  printf 'PRIVATE CLOUD:\n%s\n\n' "$2"
  printf 'DEDICATED:\n%s\n\n' "$3"
  printf 'MANAGEMENT WAN EXPOSURE:\nDISABLED\n'
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  print_result "FAIL" "FAIL" "FAIL"
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required"
}

cloud_get() {
  curl -fsS \
    -H "Authorization: Bearer $HETZNER_CLOUD_TOKEN" \
    -H "Content-Type: application/json" \
    "$API$1"
}

opn_host() {
  printf '%s' "${OPNSENSE_URL:-}" | sed 's#^https\?://##; s#/.*##; s#:.*##'
}

opn_api_get() {
  local host
  host="$(opn_host)"
  local netrc="$STATE_DIR/opnsense-api.netrc"
  umask 077
  {
    printf 'machine %s\n' "$host"
    printf '  login %s\n' "$OPNSENSE_API_KEY"
    printf '  password %s\n' "$OPNSENSE_API_SECRET"
  } > "$netrc"
  curl -fsS --netrc-file "$netrc" "${OPNSENSE_URL%/}$1"
  rm -f "$netrc"
}

ssh_opnsense() {
  ssh -o BatchMode=yes -o ConnectTimeout=8 -p "${OPNSENSE_SSH_PORT:-22}" \
    "${OPNSENSE_SSH_USER:-root}@${OPNSENSE_SSH_HOST}" "$@"
}

scp_from_opnsense() {
  scp -q -P "${OPNSENSE_SSH_PORT:-22}" \
    "${OPNSENSE_SSH_USER:-root}@${OPNSENSE_SSH_HOST}:$1" "$2"
}

need curl
need jq
need ssh
need scp

[ -n "${HETZNER_CLOUD_TOKEN:-}" ] || fail "HETZNER_CLOUD_TOKEN is not configured"

cloud_get "/networks?per_page=50" > "$STATE_DIR/cloud.networks.v006.json"
cloud_get "/servers?per_page=50" > "$STATE_DIR/cloud.servers.v006.json"

network_json="$(jq -c --arg name "$NETWORK_NAME" '.networks[]? | select(.name == $name)' "$STATE_DIR/cloud.networks.v006.json")"
[ -n "$network_json" ] || fail "Cloud Network $NETWORK_NAME not found"

cloud_subnet_ok="$(jq -r --arg cidr "$WORM_CLOUD_NET" '[.subnets[]? | select(.type == "cloud" and .ip_range == $cidr)] | length' <<<"$network_json")"
vswitch_subnet_ok="$(jq -r --arg cidr "$WORM_VSWITCH_NET" '[.subnets[]? | select(.type == "vswitch" and .ip_range == $cidr)] | length' <<<"$network_json")"
[ "$cloud_subnet_ok" -gt 0 ] || fail "Cloud subnet $WORM_CLOUD_NET not present on $NETWORK_NAME"
[ "$vswitch_subnet_ok" -gt 0 ] || fail "vSwitch subnet $WORM_VSWITCH_NET not present on $NETWORK_NAME"

network_id="$(jq -r '.id' <<<"$network_json")"
opnsense_server="$(jq -c --arg name "$OPNSENSE_SERVER_NAME" '.servers[]? | select(.name == $name)' "$STATE_DIR/cloud.servers.v006.json")"
[ -n "$opnsense_server" ] || fail "server $OPNSENSE_SERVER_NAME not found"

opnsense_private_ip="$(jq -r --argjson network_id "$network_id" '.private_net[]? | select(.network == $network_id) | .ip // empty' <<<"$opnsense_server" | head -1)"
[ -n "$opnsense_private_ip" ] || fail "$OPNSENSE_SERVER_NAME is not attached to Cloud Network $NETWORK_NAME"

wireguard_api=unavailable
if [ -n "${OPNSENSE_URL:-}" ] && [ -n "${OPNSENSE_API_KEY:-}" ] && [ -n "${OPNSENSE_API_SECRET:-}" ]; then
  if opn_api_get /api/wireguard/general/get > "$STATE_DIR/opnsense-wireguard-general.json" 2>"$STATE_DIR/opnsense-wireguard-api.err"; then
    wireguard_api=available
  fi
fi

[ -n "${OPNSENSE_SSH_HOST:-}" ] || fail "OPNSENSE_SSH_HOST is not configured"

scp_from_opnsense /conf/config.xml "$CONFIG_BACKUP"
[ -s "$CONFIG_BACKUP" ] || fail "could not backup /conf/config.xml"

ssh_opnsense 'ifconfig -a; netstat -rn; configctl wireguard status 2>/dev/null || true' > "$STATE_DIR/opnsense-wireguard.before.txt"

if [ "$wireguard_api" != "available" ]; then
  fail "WireGuard API is not available/configured; refusing non-API WireGuard configuration"
fi

cat > "$STATE_DIR/README.apply-required-api.txt" <<EOF
WireGuard API is available, but this patch intentionally stops before creating
keys/tunnels without explicit local peer inventory.

Required model:
- local tunnel address: $OPNSENSE_WG_IP
- allowed routed networks: $WORM_CLOUD_NET $WORM_VSWITCH_NET
- management access from: $WG_NETWORK
- WAN management exposure: disabled
EOF

print_result "FAIL" "FAIL" "FAIL"
exit 1
