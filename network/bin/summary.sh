#!/usr/bin/env sh
set -eu

BASE_DIR="${WORM_NETWORK_BASE:-/opt/worm/network}"
# shellcheck disable=SC1091
. "$BASE_DIR/bin/common.sh"

DEDICATED="$GENERATED_DIR/dedicated.json"
CLOUD="$GENERATED_DIR/cloud.json"
ROBOT="$GENERATED_DIR/robot.json"
OPNSENSE="$GENERATED_DIR/opnsense.json"
VERIFY="$GENERATED_DIR/verify.json"

if have jq; then
  dedicated_server="$(jq -r '[.dedicated_servers[]? | (.server_number // .server_ip // .name // .server_name)] | map(select(. != null)) | first // "UNKNOWN"' "$ROBOT" 2>/dev/null || printf 'UNKNOWN')"
  public_interface="$(jq -r '.public_interface // "enp9s0"' "$DEDICATED" 2>/dev/null || printf 'enp9s0')"
  public_ipv4="$(jq -r '(.public_ipv4 | select(. != null and . != "")) // "NONE"' "$DEDICATED" 2>/dev/null || printf 'NONE')"
  gateway="$(jq -r '(.public_gateway | select(. != null and . != "")) // "NONE"' "$DEDICATED" 2>/dev/null || printf 'NONE')"
  opnsense_server="$(jq -r 'if .opnsense_server then ((.opnsense_server.name // "unknown") + "/" + (.opnsense_server.id|tostring)) else "NONE" end' "$CLOUD" 2>/dev/null || printf 'NONE')"
  network="$(jq -r '[.networks[]? | ((.name // "unknown") + "/" + (.id|tostring))] | first // "NONE"' "$CLOUD" 2>/dev/null || printf 'NONE')"
  private_ip="$(jq -r '.opnsense_private_ip // "NONE"' "$CLOUD" 2>/dev/null || printf 'NONE')"
  vswitch="$(jq -r '[.vswitches[]? | (((.name // "unnamed")|tostring) + "/" + ((.id // "unknown")|tostring))] | first // "NONE"' "$ROBOT" 2>/dev/null || printf 'NONE')"
  vlan="$(jq -r '[.vswitches[]?.vlan] | first // "NONE"' "$ROBOT" 2>/dev/null || printf 'NONE')"
  opn_api="$(jq -r '.api_status // "unknown"' "$OPNSENSE" 2>/dev/null || printf 'unknown')"
  opn_wan="UNKNOWN"
  opn_private="$private_ip"
  topology="$(jq -r '.status // "PARTIAL"' "$VERIFY" 2>/dev/null || printf 'PARTIAL')"
else
  dedicated_server="UNKNOWN"
  public_interface="enp9s0"
  public_ipv4="NONE"
  gateway="NONE"
  opnsense_server="NONE"
  network="NONE"
  private_ip="NONE"
  vswitch="NONE"
  vlan="NONE"
  opn_api="unknown"
  opn_wan="UNKNOWN"
  opn_private="NONE"
  topology="PARTIAL"
fi

cat <<EOF
=== WORM NETWORK V001 AUDIT ===

DEDICATED:
server=$dedicated_server
public_interface=$public_interface
public_ipv4=$public_ipv4
gateway=$gateway

CLOUD:
opnsense_server=$opnsense_server
network=$network
private_ip=$private_ip

ROBOT:
vswitch=$vswitch
vlan=$vlan

OPNSENSE:
api=$opn_api
wan=$opn_wan
private=$opn_private

TOPOLOGY:
$topology
EOF
