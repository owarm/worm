#!/usr/bin/env bash
set -euo pipefail

CONF="/opt/worm/private-portal/nginx/worm-private.conf"

vpn_interface="$(ip -o addr show 2>/dev/null | awk '$4 == "10.90.20.10/24" { print $2; exit }')"
vpn_server_ip="$(ip -o -4 addr show 2>/dev/null | awk '$4 == "10.90.20.10/24" { sub(/\/.*/, "", $4); print $4; exit }')"
vpn_cidr="$(ip route 2>/dev/null | awk '$1 == "10.90.0.0/16" { print $1; exit }')"
listen_address="$(awk '/listen .*ssl/ { gsub(";", "", $0); sub(/^[[:space:]]+/, "", $0); print; exit }' "${CONF}")"
allow_rules="$(awk '/^[[:space:]]*allow / { gsub(";", "", $0); sub(/^[[:space:]]+/, "", $0); print }' "${CONF}")"
webroot="$(awk '/^[[:space:]]*root / { gsub(";", "", $2); print $2; exit }' "${CONF}")"

echo "VPN interface: ${vpn_interface:-not found}"
echo "VPN server IP: ${vpn_server_ip:-not found}"
echo "VPN CIDR: ${vpn_cidr:-not found}"
echo "Nginx listen address: ${listen_address:-not found}"
echo "allow rules:"
if [[ -n "${allow_rules}" ]]; then
  printf '%s\n' "${allow_rules}"
else
  echo "not found"
fi
echo "portal webroot: ${webroot:-not found}"
