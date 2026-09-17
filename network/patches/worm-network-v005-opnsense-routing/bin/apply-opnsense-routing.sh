#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="${WORM_NETWORK_BASE:-/opt/worm/network}"
PATCH_DIR="$BASE_DIR/patches/worm-network-v005-opnsense-routing"
CONFIG_DIR="$BASE_DIR/config"
STATE_DIR="$PATCH_DIR/state"
BACKUP_DIR="$BASE_DIR/backup"
SECRETS_FILE="$CONFIG_DIR/secrets.env"
NETWORK_ENV="$CONFIG_DIR/network.env"

NETWORK_NAME="worm-private"
CLOUD_SUBNET_CIDR="10.20.0.0/24"
VSWITCH_SUBNET_CIDR="10.20.1.0/24"
OPNSENSE_SERVER_NAME="worm-opnsense"
DEDICATED_PRIVATE_IP="10.20.1.2"
PRIVATE_MTU="1450"
API="https://api.hetzner.cloud/v1"
TS="$(TZ=Europe/Rome date +%Y%m%d-%H%M%S)"
CONFIG_BACKUP="$BACKUP_DIR/opnsense-config-$TS.xml"

mkdir -p "$STATE_DIR" "$BACKUP_DIR"

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

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  printf '=== WORM NETWORK V005 ===\n\n'
  printf 'OPNSENSE PRIVATE:\nUNKNOWN\n\n'
  printf 'ROUTE TO VSWITCH:\nFAIL\n\n'
  printf 'FIREWALL:\nFAIL\n\n'
  printf 'OUTBOUND NAT:\nFAIL\n\n'
  printf 'DEDICATED PRIVATE:\n%s\n\n' "$DEDICATED_PRIVATE_IP"
  printf 'STATUS:\nPRIVATE_ROUTING_READY=NO\n'
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

cloud_get "/networks?per_page=50" > "$STATE_DIR/cloud.networks.v005.json"
cloud_get "/servers?per_page=50" > "$STATE_DIR/cloud.servers.v005.json"

network_json="$(jq -c --arg name "$NETWORK_NAME" '.networks[]? | select(.name == $name)' "$STATE_DIR/cloud.networks.v005.json")"
[ -n "$network_json" ] || fail "Cloud Network $NETWORK_NAME not found"

network_id="$(jq -r '.id' <<<"$network_json")"
cloud_gateway="$(jq -r --arg cidr "$CLOUD_SUBNET_CIDR" '.subnets[]? | select(.type == "cloud" and .ip_range == $cidr) | .gateway // empty' <<<"$network_json")"
vswitch_gateway="$(jq -r --arg cidr "$VSWITCH_SUBNET_CIDR" '.subnets[]? | select(.type == "vswitch" and .ip_range == $cidr) | .gateway // empty' <<<"$network_json")"

[ -n "$cloud_gateway" ] || fail "Cloud subnet $CLOUD_SUBNET_CIDR not present on $NETWORK_NAME"
[ -n "$vswitch_gateway" ] || fail "vSwitch subnet $VSWITCH_SUBNET_CIDR not present on $NETWORK_NAME"

opnsense_server="$(jq -c --arg name "$OPNSENSE_SERVER_NAME" '.servers[]? | select(.name == $name)' "$STATE_DIR/cloud.servers.v005.json")"
[ -n "$opnsense_server" ] || fail "server $OPNSENSE_SERVER_NAME not found"

opnsense_private_ip="$(jq -r --argjson network_id "$network_id" '.private_net[]? | select(.network == $network_id) | .ip // empty' <<<"$opnsense_server" | head -1)"
[ -n "$opnsense_private_ip" ] || fail "$OPNSENSE_SERVER_NAME is not attached to Cloud Network $NETWORK_NAME"

[ -n "${OPNSENSE_SSH_HOST:-}" ] || fail "OPNSENSE_SSH_HOST is not configured"

scp_from_opnsense /conf/config.xml "$CONFIG_BACKUP"
[ -s "$CONFIG_BACKUP" ] || fail "could not backup /conf/config.xml"

ssh_opnsense 'ifconfig -a; netstat -rn' > "$STATE_DIR/opnsense-ifconfig-routes.before.txt"
private_if="$(awk -v ip="$opnsense_private_ip" '
  /^[a-zA-Z0-9_]+[0-9a-zA-Z_.-]*:/ { iface=$1; sub(/:$/, "", iface) }
  index($0, "inet " ip) { print iface; exit }
' "$STATE_DIR/opnsense-ifconfig-routes.before.txt")"
[ -n "$private_if" ] || fail "could not detect OPNsense private interface for $opnsense_private_ip"

cat > "$STATE_DIR/opnsense-configure-v005.py" <<'PY'
import ipaddress
import sys
import xml.etree.ElementTree as ET

path, private_if, private_ip, cloud_net, vswitch_net, vswitch_gw, mtu = sys.argv[1:]
tree = ET.parse(path)
root = tree.getroot()

def child(parent, name):
    found = parent.find(name)
    if found is None:
        found = ET.SubElement(parent, name)
    return found

def set_text(parent, name, value):
    child(parent, name).text = value

interfaces = child(root, "interfaces")
target = None
for item in list(interfaces):
    if item.findtext("if") == private_if:
        target = item
        break
if target is None:
    nums = [int(i.tag[3:]) for i in list(interfaces) if i.tag.startswith("opt") and i.tag[3:].isdigit()]
    target = ET.SubElement(interfaces, f"opt{max(nums, default=0) + 1}")
set_text(target, "if", private_if)
set_text(target, "descr", "WORM_PRIVATE")
set_text(target, "enable", "1")
set_text(target, "ipaddr", private_ip)
set_text(target, "subnet", str(ipaddress.ip_network(cloud_net, strict=False).prefixlen))
set_text(target, "mtu", mtu)

aliases = child(root, "aliases")
alias_values = {
    "WORM_CLOUD_NET": cloud_net,
    "WORM_VSWITCH_NET": vswitch_net,
    "WORM_PRIVATE_ALL": f"{cloud_net} {vswitch_net}",
}
for name, value in alias_values.items():
    entry = None
    for item in aliases.findall("alias"):
        if item.findtext("name") == name:
            entry = item
            break
    if entry is None:
        entry = ET.SubElement(aliases, "alias")
    set_text(entry, "enabled", "1")
    set_text(entry, "name", name)
    set_text(entry, "type", "network")
    set_text(entry, "content", value)
    set_text(entry, "descr", "WORM private routing")

gateways = child(root, "gateways")
gateway_item = None
for item in gateways.findall("gateway_item"):
    if item.findtext("name") == "WORM_VSWITCH_GW":
        gateway_item = item
        break
if gateway_item is None:
    gateway_item = ET.SubElement(gateways, "gateway_item")
set_text(gateway_item, "interface", target.tag)
set_text(gateway_item, "gateway", vswitch_gw)
set_text(gateway_item, "name", "WORM_VSWITCH_GW")
set_text(gateway_item, "descr", "Hetzner Cloud gateway to WORM vSwitch")

staticroutes = child(root, "staticroutes")
route = None
for item in staticroutes.findall("route"):
    if item.findtext("network") == vswitch_net:
        route = item
        break
if route is None:
    route = ET.SubElement(staticroutes, "route")
set_text(route, "network", vswitch_net)
set_text(route, "gateway", "WORM_VSWITCH_GW")
set_text(route, "descr", "WORM vSwitch network")

filter_root = child(root, "filter")
existing = {
    item.findtext("descr", "")
    for item in filter_root.findall("rule")
}
for descr in ("WORM private to firewall", "WORM private to Internet"):
    if descr in existing:
        continue
    rule = ET.SubElement(filter_root, "rule")
    set_text(rule, "type", "pass")
    set_text(rule, "interface", target.tag)
    set_text(rule, "ipprotocol", "inet")
    set_text(rule, "descr", descr)
    source = child(rule, "source")
    set_text(source, "network", "WORM_PRIVATE_ALL")
    destination = child(rule, "destination")
    if descr.endswith("firewall"):
        set_text(destination, "network", target.tag)
    else:
        ET.SubElement(destination, "any")

nat = child(root, "nat")
outbound = child(nat, "outbound")
set_text(outbound, "mode", "hybrid")
for cidr in (cloud_net, vswitch_net):
    descr = f"WORM outbound NAT {cidr}"
    if any(item.findtext("descr", "") == descr for item in outbound.findall("rule")):
        continue
    rule = ET.SubElement(outbound, "rule")
    set_text(rule, "interface", "wan")
    set_text(rule, "ipprotocol", "inet")
    set_text(rule, "descr", descr)
    source = child(rule, "source")
    set_text(source, "network", cidr)
    destination = child(rule, "destination")
    ET.SubElement(destination, "any")
    target = child(rule, "target")
    ET.SubElement(target, "any")

tree.write(path, encoding="utf-8", xml_declaration=True)
PY

remote_work="/tmp/worm-opnsense-v005.$$"
ssh_opnsense "mkdir -p '$remote_work' && cp /conf/config.xml '$remote_work/config.xml'"
scp -q -P "${OPNSENSE_SSH_PORT:-22}" "$STATE_DIR/opnsense-configure-v005.py" "${OPNSENSE_SSH_USER:-root}@${OPNSENSE_SSH_HOST}:$remote_work/configure.py"
ssh_opnsense "python3 '$remote_work/configure.py' '$remote_work/config.xml' '$private_if' '$opnsense_private_ip' '$CLOUD_SUBNET_CIDR' '$VSWITCH_SUBNET_CIDR' '$vswitch_gateway' '$PRIVATE_MTU'"
ssh_opnsense "cp '$remote_work/config.xml' /conf/config.xml && configctl interface reconfigure && configctl filter reload && configctl route reload"
ssh_opnsense "ifconfig -a; netstat -rn" > "$STATE_DIR/opnsense-ifconfig-routes.after.txt"

route_status=FAIL
firewall_status=FAIL
nat_status=FAIL

grep -q "$VSWITCH_SUBNET_CIDR" "$STATE_DIR/opnsense-ifconfig-routes.after.txt" && route_status=PASS
ssh_opnsense "grep -q WORM_PRIVATE_ALL /conf/config.xml" && firewall_status=PASS
ssh_opnsense "grep -q 'WORM outbound NAT' /conf/config.xml" && nat_status=PASS

printf '=== WORM NETWORK V005 ===\n\n'
printf 'OPNSENSE PRIVATE:\n%s/%s\n\n' "$opnsense_private_ip" "$private_if"
printf 'ROUTE TO VSWITCH:\n%s\n\n' "$route_status"
printf 'FIREWALL:\n%s\n\n' "$firewall_status"
printf 'OUTBOUND NAT:\n%s\n\n' "$nat_status"
printf 'DEDICATED PRIVATE:\n%s\n\n' "$DEDICATED_PRIVATE_IP"
if [ "$route_status" = PASS ] && [ "$firewall_status" = PASS ] && [ "$nat_status" = PASS ]; then
  printf 'STATUS:\nPRIVATE_ROUTING_READY=YES\n'
else
  printf 'STATUS:\nPRIVATE_ROUTING_READY=NO\n'
fi
printf '\nBACKUP=%s\n' "$CONFIG_BACKUP"
