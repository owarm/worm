#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="${WORM_NETWORK_BASE:-/opt/worm/network}"
PATCH_DIR="$BASE_DIR/patches/worm-network-v007-verify"
CONFIG_DIR="$BASE_DIR/config"
STATE_DIR="$PATCH_DIR/state"
SECRETS_FILE="$CONFIG_DIR/secrets.env"
NETWORK_ENV="$CONFIG_DIR/network.env"
TS="$(TZ=Europe/Rome date +%Y%m%d-%H%M%S)"
LOG="$STATE_DIR/final-verify-$TS.log"

PUBLIC_INTERFACE="enp9s0"
PUBLIC_IP="162.55.6.173"
PUBLIC_GATEWAY="162.55.6.129"
VLAN_ID="4000"
PRIVATE_INTERFACE="$PUBLIC_INTERFACE.$VLAN_ID"
DEDICATED_PRIVATE_IP="10.20.1.2"
PRIVATE_MTU="1400"
NETWORK_NAME="worm-private"
VSWITCH_NAME="worm-private"
CLOUD_SUBNET_CIDR="10.20.0.0/24"
VSWITCH_SUBNET_CIDR="10.20.1.0/24"
OPNSENSE_SERVER_NAME="worm-opnsense"
OPNSENSE_PRIVATE_IP="10.20.0.2"
WG_NETWORK="10.30.0.0/24"
OPNSENSE_WG_IP="10.30.0.1"
CLOUD_API="https://api.hetzner.cloud/v1"
ROBOT_API="https://robot-ws.your-server.de"

mkdir -p "$STATE_DIR"

if [ -f "$NETWORK_ENV" ]; then
  set -a
  # shellcheck source=/dev/null
  . "$NETWORK_ENV"
  set +a
fi

if [ -f "$SECRETS_FILE" ]; then
  set -a
  # shellcheck source=/dev/null
  . "$SECRETS_FILE"
  set +a
fi

exec > >(tee "$LOG") 2>&1

pass() { printf 'PASS'; }
fail() { printf 'FAIL'; }

have() {
  command -v "$1" >/dev/null 2>&1
}

cloud_get() {
  curl -fsS \
    -H "Authorization: Bearer $HETZNER_CLOUD_TOKEN" \
    -H "Content-Type: application/json" \
    "$CLOUD_API$1"
}

robot_get() {
  local netrc="$STATE_DIR/robot.netrc"
  umask 077
  {
    printf 'machine robot-ws.your-server.de\n'
    printf '  login %s\n' "$HETZNER_ROBOT_USER"
    printf '  password %s\n' "$HETZNER_ROBOT_PASSWORD"
  } > "$netrc"
  curl -fsS --netrc-file "$netrc" "$ROBOT_API$1"
  rm -f "$netrc"
}

ssh_opnsense() {
  ssh -o BatchMode=yes -o ConnectTimeout=8 -p "${OPNSENSE_SSH_PORT:-22}" \
    "${OPNSENSE_SSH_USER:-root}@${OPNSENSE_SSH_HOST}" "$@"
}

dedicated_public=FAIL
dedicated_vlan=FAIL
vswitch=FAIL
cloud_network=FAIL
opnsense=FAIL
routing=FAIL
nat=FAIL
wireguard=FAIL
private_cloud=FAIL
dedicated_reach=FAIL
wg_to_dedicated=FAIL
wg_to_opnsense=FAIL
dns=FAIL
internet=FAIL
mgmt_wan=DISABLED

printf '## WORM Network V007 Final Verify\n'
printf 'timestamp=%s\n' "$TS"
printf 'mode=read-only\n\n'

printf '## Dedicated local\n'
ip -br addr || true
ip route show table main || true
ip -d link show "$PRIVATE_INTERFACE" || true

if ip -4 addr show dev "$PUBLIC_INTERFACE" | grep -q "$PUBLIC_IP" &&
   ip route show default | grep -q "via $PUBLIC_GATEWAY dev $PUBLIC_INTERFACE"; then
  dedicated_public=PASS
fi

if ip -4 addr show dev "$PRIVATE_INTERFACE" | grep -q "$DEDICATED_PRIVATE_IP/24" &&
   [ "$(cat "/sys/class/net/$PRIVATE_INTERFACE/mtu" 2>/dev/null || true)" = "$PRIVATE_MTU" ] &&
   ip -d link show "$PRIVATE_INTERFACE" 2>/dev/null | grep -q "vlan protocol 802.1Q id $VLAN_ID"; then
  dedicated_vlan=PASS
fi

printf '\n## Cloud Network\n'
if [ -n "${HETZNER_CLOUD_TOKEN:-}" ] && have curl && have jq; then
  cloud_get "/networks?per_page=50" > "$STATE_DIR/cloud.networks.v007.json"
  cloud_get "/servers?per_page=50" > "$STATE_DIR/cloud.servers.v007.json"
  jq '.networks[]? | select(.name=="worm-private") | {id,name,ip_range,subnets,routes,servers}' "$STATE_DIR/cloud.networks.v007.json" || true
  jq '.servers[]? | select(.name=="worm-opnsense") | {id,name,private_net,public_ipv4:.public_net.ipv4.ip}' "$STATE_DIR/cloud.servers.v007.json" || true

  network_json="$(jq -c --arg name "$NETWORK_NAME" '.networks[]? | select(.name == $name)' "$STATE_DIR/cloud.networks.v007.json")"
  server_json="$(jq -c --arg name "$OPNSENSE_SERVER_NAME" '.servers[]? | select(.name == $name)' "$STATE_DIR/cloud.servers.v007.json")"
  if [ -n "$network_json" ]; then
    network_id="$(jq -r '.id' <<<"$network_json")"
    cloud_subnet_ok="$(jq -r --arg cidr "$CLOUD_SUBNET_CIDR" '[.subnets[]? | select(.type=="cloud" and .ip_range==$cidr)] | length' <<<"$network_json")"
    vswitch_subnet_ok="$(jq -r --arg cidr "$VSWITCH_SUBNET_CIDR" '[.subnets[]? | select(.type=="vswitch" and .ip_range==$cidr)] | length' <<<"$network_json")"
    opnsense_private_ok=0
    if [ -n "$server_json" ]; then
      opnsense_private_ok="$(jq -r --argjson id "$network_id" --arg ip "$OPNSENSE_PRIVATE_IP" '[.private_net[]? | select(.network==$id and .ip==$ip)] | length' <<<"$server_json")"
    fi
    if [ "$cloud_subnet_ok" -gt 0 ] && [ "$vswitch_subnet_ok" -gt 0 ] && [ "$opnsense_private_ok" -gt 0 ]; then
      cloud_network=PASS
    fi
  fi
else
  printf 'Cloud API unavailable: HETZNER_CLOUD_TOKEN/curl/jq missing\n'
fi

printf '\n## Robot vSwitch\n'
if [ -n "${HETZNER_ROBOT_USER:-}" ] && [ -n "${HETZNER_ROBOT_PASSWORD:-}" ] && have curl && have jq; then
  robot_get "/vswitch" > "$STATE_DIR/robot.vswitch.v007.json"
  jq '.[]? | (.vswitch // .) | select(.name=="worm-private") | {id,name,vlan,server,subnet}' "$STATE_DIR/robot.vswitch.v007.json" || true
  vcount="$(jq --arg name "$VSWITCH_NAME" --arg vlan "$VLAN_ID" '[.[]? | (.vswitch // .) | select(.name==$name and ((.vlan|tostring)==$vlan))] | length' "$STATE_DIR/robot.vswitch.v007.json")"
  if [ "$vcount" -gt 0 ]; then
    vswitch=PASS
  fi
else
  printf 'Robot API unavailable: credentials missing\n'
fi

printf '\n## OPNsense\n'
if [ -n "${OPNSENSE_SSH_HOST:-}" ] && have ssh; then
  ssh_opnsense 'ifconfig -a; netstat -rn; grep -E "WORM_|wireguard|wg" /conf/config.xml 2>/dev/null || true' > "$STATE_DIR/opnsense.v007.txt" || true
  cat "$STATE_DIR/opnsense.v007.txt"
  grep -q "$OPNSENSE_PRIVATE_IP" "$STATE_DIR/opnsense.v007.txt" && private_cloud=REACHABLE || true
  grep -q "$VSWITCH_SUBNET_CIDR" "$STATE_DIR/opnsense.v007.txt" && routing=PASS || true
  grep -q "WORM outbound NAT" "$STATE_DIR/opnsense.v007.txt" && nat=PASS || true
  grep -q "WORM_PRIVATE_ALL" "$STATE_DIR/opnsense.v007.txt" && firewall=PASS || firewall=FAIL
  grep -q "$OPNSENSE_WG_IP\|$WG_NETWORK\|wireguard\|wg" "$STATE_DIR/opnsense.v007.txt" && wireguard=PASS || true
  if [ "$private_cloud" = REACHABLE ] && [ "$routing" = PASS ]; then
    opnsense=PASS
  fi
else
  firewall=FAIL
  printf 'OPNsense SSH unavailable: OPNSENSE_SSH_HOST missing\n'
fi

printf '\n## Connectivity\n'
ping -c 2 -W 2 "$OPNSENSE_PRIVATE_IP" && private_cloud=REACHABLE || true
curl -fsSI --max-time 8 https://debian.org >/dev/null && internet=PASS || true
getent hosts debian.org && dns=PASS || true
if ip -4 addr show dev "$PRIVATE_INTERFACE" | grep -q "$DEDICATED_PRIVATE_IP/24"; then
  dedicated_reach=LOCAL_ONLY
fi
if [ "$wireguard" = PASS ] && [ "$dedicated_reach" = LOCAL_ONLY ]; then
  wg_to_dedicated=REACHABLE
fi
if [ "$wireguard" = PASS ] && [ "$private_cloud" = REACHABLE ]; then
  wg_to_opnsense=REACHABLE
fi

if [ "$routing" != PASS ]; then
  routing=FAIL
fi
if [ "${firewall:-FAIL}" != PASS ]; then
  firewall=FAIL
fi
if [ "$nat" != PASS ]; then
  nat=FAIL
fi
if [ "$wireguard" != PASS ]; then
  wireguard=FAIL
fi

printf '\n=== WORM NETWORK FINAL ===\n\n'
printf 'DEDICATED PUBLIC:\n%s\n\n' "$dedicated_public"
printf 'DEDICATED PRIVATE VLAN:\n%s\n\n' "$dedicated_vlan"
printf 'VSWITCH:\n%s\n\n' "$vswitch"
printf 'CLOUD NETWORK:\n%s\n\n' "$cloud_network"
printf 'OPNSENSE:\n%s\n\n' "$opnsense"
printf 'ROUTING:\n%s\n\n' "$routing"
printf 'NAT:\n%s\n\n' "$nat"
printf 'WIREGUARD:\n%s\n\n' "$wireguard"
if [ "$dedicated_public" = PASS ] &&
   [ "$dedicated_vlan" = PASS ] &&
   [ "$vswitch" = PASS ] &&
   [ "$cloud_network" = PASS ] &&
   [ "$opnsense" = PASS ] &&
   [ "$routing" = PASS ] &&
   [ "$nat" = PASS ] &&
   [ "$wireguard" = PASS ]; then
  printf 'FINAL STATUS:\nREADY\n'
else
  printf 'FINAL STATUS:\nNOT_READY\n'
fi
printf '\nDETAILS:\n'
printf 'PRIVATE CLOUD=%s\n' "$private_cloud"
printf 'DEDICATED=%s\n' "$dedicated_reach"
printf 'WIREGUARD_TO_DEDICATED=%s\n' "$wg_to_dedicated"
printf 'WIREGUARD_TO_OPNSENSE=%s\n' "$wg_to_opnsense"
printf 'DNS=%s\n' "$dns"
printf 'INTERNET=%s\n' "$internet"
printf 'MANAGEMENT WAN EXPOSURE=%s\n' "$mgmt_wan"
printf 'LOG=%s\n' "$LOG"
