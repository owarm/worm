#!/usr/bin/env bash
set -euo pipefail

VPN_IP="10.90.20.10"
VPN_CIDR="10.90.0.0/16"
CONF="/etc/nginx/sites-enabled/worm-system-vpn-services.conf"
PUBLIC_GUARD_CONF="/etc/nginx/sites-enabled/worm-system-public-guards.conf"
CERT="/etc/letsencrypt/live/coffee.pm/fullchain.pem"

vpn_interface="$(ip -o -4 addr show 2>/dev/null | awk -v ip="${VPN_IP}" '$4 ~ "^" ip "/" { print $2; exit }')"
vpn_ip="$(ip -o -4 addr show 2>/dev/null | awk -v ip="${VPN_IP}" '$4 ~ "^" ip "/" { sub(/\/.*/, "", $4); print $4; exit }')"
vpn_route="$(ip route 2>/dev/null | awk -v cidr="${VPN_CIDR}" '$1 == cidr { print; exit }')"

echo "VPN interface: ${vpn_interface:-not found}"
echo "VPN server IP: ${vpn_ip:-not found}"
echo "VPN CIDR: ${VPN_CIDR}"
echo "VPN route: ${vpn_route:-not found}"
echo

echo "Nginx listeners:"
ss -lntp 2>/dev/null | awk 'NR == 1 || /:80 |:443 |10\.90\.20\.10:443/'
echo

echo "Nginx private vhosts:"
if [[ -r "${CONF}" ]]; then
  awk '
    /^[[:space:]]*server_name / { gsub(";", "", $2); name=$2 }
    /^[[:space:]]*listen / { line=$0; gsub(/^[[:space:]]+|;$/, "", line); print name ": " line }
    /^[[:space:]]*root / { line=$0; gsub(/^[[:space:]]+|;$/, "", line); print name ": " line }
    /^[[:space:]]*allow / { line=$0; gsub(/^[[:space:]]+|;$/, "", line); print name ": " line }
    /^[[:space:]]*deny / { line=$0; gsub(/^[[:space:]]+|;$/, "", line); print name ": " line }
  ' "${CONF}"
else
  echo "not installed: ${CONF}"
fi
echo

echo "Nginx public guard:"
if [[ -r "${PUBLIC_GUARD_CONF}" ]]; then
  awk '
    /^[[:space:]]*server_name / { names=$0; sub(/^[[:space:]]*server_name[[:space:]]+/, "", names); gsub(";", "", names); print "server_name " names }
    /^[[:space:]]*listen / { line=$0; gsub(/^[[:space:]]+|;$/, "", line); print line }
    /^[[:space:]]*return 403/ { print "return 403" }
  ' "${PUBLIC_GUARD_CONF}"
else
  echo "not installed: ${PUBLIC_GUARD_CONF}"
fi
echo

echo "TLS certificate:"
if [[ -r "${CERT}" ]]; then
  openssl x509 -in "${CERT}" -noout -subject -ext subjectAltName
else
  echo "WILDCARD TLS REQUIRED: ${CERT}"
fi
echo

for host in apps.coffee.pm releases.coffee.pm ota.coffee.pm; do
  echo "${host} route:"
  getent ahostsv4 "${host}" 2>/dev/null | awk '{ print "  dns " $1 " " $2 " " $3 }' || true
  printf '  expected private DNS: %s -> %s\n' "${host}" "${VPN_IP}"
  curl -kfsSI --resolve "${host}:443:${VPN_IP}" "https://${host}/" 2>/dev/null | awk '{ line=tolower($0) } NR == 1 || line ~ /^http\// || line ~ /^accept-ranges:/ || line ~ /^content-security-policy:/ || line ~ /^x-content-type-options:/ || line ~ /^x-frame-options:/ || line ~ /^referrer-policy:/ { print "  " $0 }' || echo "  HTTPS check failed"
done
