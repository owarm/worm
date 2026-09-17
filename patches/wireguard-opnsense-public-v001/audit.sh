#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="${WORM_BASE:-/opt/worm}"
PATCH_NAME="wireguard-opnsense-public-v001"
NETWORK_CONFIG="$BASE_DIR/network/config/secrets.env"
LOG_DIR="$BASE_DIR/logs"
KEYS_DIR="$BASE_DIR/keys"

WAN_IP="${WAN_IP:-162.55.6.173}"
WG_INTERFACE="${WG_INTERFACE:-WORM_WG}"
WG_PORT="${WG_PORT:-51820}"
WG_TUNNEL="${WG_TUNNEL:-10.66.66.1/24}"
WG_NET="${WG_NET:-10.66.66.0/24}"
WORM_OS_ALLOWED_IP="${WORM_OS_ALLOWED_IP:-10.66.66.2/32}"
DNS_IP="${DNS_IP:-10.66.66.1}"

mkdir -p "$LOG_DIR" "$KEYS_DIR"
chmod 700 "$KEYS_DIR"

if [ -f "$NETWORK_CONFIG" ]; then
  set -a
  # shellcheck source=/dev/null
  . "$NETWORK_CONFIG"
  set +a
fi

ssh_opnsense() {
  ssh -o BatchMode=yes -o ConnectTimeout=10 -p "${OPNSENSE_SSH_PORT:-22}" \
    "${OPNSENSE_SSH_USER:-root}@${OPNSENSE_SSH_HOST}" "$@"
}

safe_remote_audit='
echo "=== OPNsense WireGuard public audit ==="
date
echo
echo "[wireguard]"
(wg show 2>/dev/null || configctl wireguard status 2>/dev/null || true) | sed -E "s#(private key: ).*#\1[redacted]#"
echo
echo "[interfaces]"
ifconfig wg0 2>/dev/null || true
echo
echo "[routes]"
netstat -rn -f inet 2>/dev/null || netstat -rn 2>/dev/null || true
echo
echo "[listeners]"
sockstat -4 -l 2>/dev/null | grep -E "(:51820|wireguard|wg)" || true
echo
echo "[config markers]"
grep -E "WORM-WG|WORM_WG|worm-os|WORM WireGuard public endpoint|Worm OS VPN|WORM WG -> WAN|10.66.66|51820" /conf/config.xml 2>/dev/null | sed -E "s#<(privkey|privatekey)>[^<]+</#<\1>[redacted]</#g; s#<(psk|presharedkey)>[^<]+</#<\1>[redacted]</#g" || true
echo
echo "[dns]"
configctl unbound status 2>/dev/null || true
sockstat -4 -l 2>/dev/null | grep -E "(:53|unbound)" || true
'

timestamp="$(TZ=Europe/Rome date --iso-8601=seconds)"
keys_mode="$(stat -c '%a' "$KEYS_DIR" 2>/dev/null || stat -f '%Lp' "$KEYS_DIR" 2>/dev/null || printf 'unknown')"

{
  printf 'PATCH=%s\n' "$PATCH_NAME"
  printf 'TIMESTAMP=%s\n' "$timestamp"
  printf 'WAN_IP=%s\n' "$WAN_IP"
  printf 'WG_INTERFACE=%s\n' "$WG_INTERFACE"
  printf 'WG_TUNNEL_ADDRESS=%s\n' "$WG_TUNNEL"
  printf 'UDP_LISTEN_PORT=%s\n' "$WG_PORT"
  printf 'EXPECTED_PEER_ALLOWED_IPS=%s\n' "$WORM_OS_ALLOWED_IP"
  printf 'EXPECTED_NAT_SOURCE=%s\n' "$WG_NET"
  printf 'DNS=%s\n' "$DNS_IP"
  printf 'KEYS_DIR_MODE=%s\n' "$keys_mode"
  printf 'PRIVATE_KEYS=not printed\n'
  printf '\n'
  if [ -z "${OPNSENSE_SSH_HOST:-}" ]; then
    printf 'ERROR=OPNSENSE_SSH_HOST missing\n'
  else
    ssh_opnsense "$safe_remote_audit" 2>&1 || printf 'ERROR=OPNsense SSH audit failed\n'
  fi
} | tee "$LOG_DIR/$PATCH_NAME.log"
