#!/usr/bin/env bash
set -euo pipefail

CONF="/opt/worm/private-portal/nginx/worm-private.conf"

echo "VPN host: 10.90.20.10"
echo "VPN CIDR: 10.90.0.0/16"
echo "VPN destination: Private portal"
echo "Public destination: https://worm.estixari.com/"
echo
echo "Configured VPN listen:"
awk '/listen 10\.90\.20\.10:443 ssl;/ { gsub(";", "", $0); sub(/^[[:space:]]+/, "", $0); print }' "${CONF}"
echo
echo "Configured VPN allow rules:"
awk '/allow 10\.90\.0\.0\/16;/ { gsub(";", "", $0); sub(/^[[:space:]]+/, "", $0); print }' "${CONF}"
echo
echo "Configured public redirects:"
awk '/return 302 https:\/\/worm\.estixari\.com\// { gsub(";", "", $0); sub(/^[[:space:]]+/, "", $0); print }' "${CONF}"
