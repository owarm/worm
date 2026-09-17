#!/usr/bin/env sh
set -eu

BASE_DIR="${WORM_NETWORK_BASE:-/opt/worm/network}"
# shellcheck disable=SC1091
. "$BASE_DIR/bin/common.sh"

OUT="$GENERATED_DIR/dedicated.json"
RAW="$STATE_DIR/dedicated.raw.txt"
PUBLIC_INTERFACE="${PUBLIC_INTERFACE:-enp9s0}"

{
  run_capture hostname hostname
  run_capture "uname -a" uname -a
  run_capture "/etc/os-release" cat /etc/os-release
  run_capture "ip -br link" ip -br link
  run_capture "ip -br addr" ip -br addr
  run_capture "ip -4 route" ip -4 route
  run_capture "ip -6 route" ip -6 route
  run_capture "ip rule" ip rule
  run_capture "bridge link" bridge link
  run_capture "bridge vlan" bridge vlan
  run_capture "ls /sys/class/net" ls /sys/class/net
} > "$RAW"

PUBLIC_IPV4="$(ip -4 -o addr show dev "$PUBLIC_INTERFACE" 2>/dev/null | awk '{print $4}' | head -n 1 || true)"
PUBLIC_PREFIX="${PUBLIC_IPV4#*/}"
if [ "$PUBLIC_PREFIX" = "$PUBLIC_IPV4" ]; then
  PUBLIC_PREFIX=""
fi
PUBLIC_GATEWAY="$(ip -4 route show default dev "$PUBLIC_INTERFACE" 2>/dev/null | awk '{for (i=1;i<=NF;i++) if ($i=="via") print $(i+1)}' | head -n 1 || true)"
if [ -z "$PUBLIC_GATEWAY" ]; then
  PUBLIC_GATEWAY="$(ip -4 route 2>/dev/null | awk '/default/ {for (i=1;i<=NF;i++) if ($i=="via") print $(i+1)}' | head -n 1 || true)"
fi
PUBLIC_MAC="$(cat "/sys/class/net/$PUBLIC_INTERFACE/address" 2>/dev/null || true)"
PUBLIC_MTU="$(cat "/sys/class/net/$PUBLIC_INTERFACE/mtu" 2>/dev/null || true)"
HAS_EXPECTED_IP="no"
HAS_EXPECTED_GW="no"
[ "$PUBLIC_IPV4" = "162.55.6.173/32" ] && HAS_EXPECTED_IP="yes"
[ "$PUBLIC_GATEWAY" = "162.55.6.129" ] && HAS_EXPECTED_GW="yes"

if have jq; then
  jq -n \
    --arg hostname "$(hostname 2>/dev/null || true)" \
    --arg public_interface "$PUBLIC_INTERFACE" \
    --arg public_ipv4 "$PUBLIC_IPV4" \
    --arg public_prefix "$PUBLIC_PREFIX" \
    --arg public_gateway "$PUBLIC_GATEWAY" \
    --arg public_mac "$PUBLIC_MAC" \
    --arg public_mtu "$PUBLIC_MTU" \
    --arg expected_ip "$HAS_EXPECTED_IP" \
    --arg expected_gateway "$HAS_EXPECTED_GW" \
    --rawfile raw "$RAW" \
    '{status:"ok",read_only:true,hostname:$hostname,public_interface:$public_interface,public_ipv4:$public_ipv4,public_prefix:$public_prefix,public_gateway:$public_gateway,public_mac:$public_mac,public_mtu:$public_mtu,expected:{ip_162_55_6_173_32:$expected_ip,gateway_162_55_6_129:$expected_gateway},raw:$raw}' > "$OUT"
else
  printf '{\n"status":"ok","read_only":true,"public_interface":"%s","public_ipv4":"%s","public_prefix":"%s","public_gateway":"%s","public_mac":"%s","public_mtu":"%s","expected_ip":"%s","expected_gateway":"%s"\n}\n' \
    "$PUBLIC_INTERFACE" "$PUBLIC_IPV4" "$PUBLIC_PREFIX" "$PUBLIC_GATEWAY" "$PUBLIC_MAC" "$PUBLIC_MTU" "$HAS_EXPECTED_IP" "$HAS_EXPECTED_GW" > "$OUT"
fi

printf 'DEDICATED audit complete: interface=%s ipv4=%s gateway=%s\n' "$PUBLIC_INTERFACE" "${PUBLIC_IPV4:-NONE}" "${PUBLIC_GATEWAY:-NONE}"

