#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="${WORM_BASE:-/opt/worm}"
PATCH_NAME="wireguard-opnsense-public-v001"
PATCH_DIR="$BASE_DIR/patches/$PATCH_NAME"
NETWORK_CONFIG="$BASE_DIR/network/config/secrets.env"
LOG_DIR="$BASE_DIR/logs"
KEYS_DIR="$BASE_DIR/keys"
STATE_DIR="$PATCH_DIR/state"
BACKUP_DIR="$KEYS_DIR/opnsense-backup/$PATCH_NAME"
TS="$(TZ=Europe/Rome date +%Y%m%d-%H%M%S)"

WAN_IP="${WAN_IP:-162.55.6.173}"
WG_INSTANCE="${WG_INSTANCE:-WORM-WG}"
WG_INTERFACE="${WG_INTERFACE:-WORM_WG}"
WG_PORT="${WG_PORT:-51820}"
WG_TUNNEL="${WG_TUNNEL:-10.66.66.1/24}"
WG_NET="${WG_NET:-10.66.66.0/24}"
WORM_OS_ALLOWED_IP="${WORM_OS_ALLOWED_IP:-10.66.66.2/32}"
WG_MTU="${WG_MTU:-1420}"
WG_MSS="${WG_MSS:-1380}"
WORM_PEER_NAME="${WORM_PEER_NAME:-worm-os}"
WORM_KEEPALIVE="${WORM_KEEPALIVE:-25}"

mkdir -p "$LOG_DIR" "$KEYS_DIR" "$STATE_DIR" "$BACKUP_DIR"
chmod 700 "$KEYS_DIR"
chmod 700 "$BACKUP_DIR"

if [ -f "$NETWORK_CONFIG" ]; then
  set -a
  # shellcheck source=/dev/null
  . "$NETWORK_CONFIG"
  set +a
fi

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required"
}

ssh_opnsense() {
  ssh -o BatchMode=yes -o ConnectTimeout=10 -p "${OPNSENSE_SSH_PORT:-22}" \
    "${OPNSENSE_SSH_USER:-root}@${OPNSENSE_SSH_HOST}" "$@"
}

scp_from_opnsense() {
  scp -q -P "${OPNSENSE_SSH_PORT:-22}" \
    "${OPNSENSE_SSH_USER:-root}@${OPNSENSE_SSH_HOST}:$1" "$2"
}

scp_to_opnsense() {
  scp -q -P "${OPNSENSE_SSH_PORT:-22}" "$1" \
    "${OPNSENSE_SSH_USER:-root}@${OPNSENSE_SSH_HOST}:$2"
}

valid_pubkey() {
  printf '%s' "$1" | grep -Eq '^[A-Za-z0-9+/]{43}=$'
}

need ssh
need scp

[ -n "${OPNSENSE_SSH_HOST:-}" ] || fail "OPNSENSE_SSH_HOST is not configured"
[ -n "${WORM_OS_PUBLIC_KEY:-}" ] || fail "WORM_OS_PUBLIC_KEY is required"
valid_pubkey "$WORM_OS_PUBLIC_KEY" || fail "WORM_OS_PUBLIC_KEY is not a WireGuard public key"

CONFIG_BACKUP="$BACKUP_DIR/opnsense-config-$TS.xml"
REMOTE_DIR="/tmp/$PATCH_NAME.$$"
REMOTE_SCRIPT="$STATE_DIR/opnsense-configure-$TS.py"

scp_from_opnsense /conf/config.xml "$CONFIG_BACKUP"
[ -s "$CONFIG_BACKUP" ] || fail "could not backup /conf/config.xml"
chmod 600 "$CONFIG_BACKUP"

ssh_opnsense "mkdir -p '$REMOTE_DIR' && command -v wg >/dev/null && command -v python3 >/dev/null"

apply_patch_placeholder=unused
cat > "$REMOTE_SCRIPT" <<'PY'
#!/usr/bin/env python3
import base64
import os
import subprocess
import sys
import uuid
import xml.etree.ElementTree as ET

config_path = sys.argv[1]
worm_public_key = sys.argv[2]

params = {
    "wan_ip": os.environ["WAN_IP"],
    "wg_instance": os.environ["WG_INSTANCE"],
    "wg_interface": os.environ["WG_INTERFACE"],
    "wg_port": os.environ["WG_PORT"],
    "wg_tunnel": os.environ["WG_TUNNEL"],
    "wg_net": os.environ["WG_NET"],
    "worm_allowed_ip": os.environ["WORM_OS_ALLOWED_IP"],
    "wg_mtu": os.environ["WG_MTU"],
    "wg_mss": os.environ["WG_MSS"],
    "worm_peer_name": os.environ["WORM_PEER_NAME"],
    "worm_keepalive": os.environ["WORM_KEEPALIVE"],
}

tree = ET.parse(config_path)
root = tree.getroot()

def child(parent, tag):
    found = parent.find(tag)
    if found is None:
        found = ET.SubElement(parent, tag)
    return found

def set_text(parent, tag, value):
    node = child(parent, tag)
    node.text = str(value)
    return node

def find_named(parent, tag, name_tags, name):
    for node in parent.findall(tag):
        for name_tag in name_tags:
            value = node.findtext(name_tag)
            if value == name:
                return node
    node = ET.SubElement(parent, tag)
    node.set("uuid", str(uuid.uuid4()))
    return node

def gen_wg_keypair():
    private = subprocess.check_output(["wg", "genkey"], text=True).strip()
    public = subprocess.check_output(["wg", "pubkey"], input=private + "\n", text=True).strip()
    return private, public

def valid_key(value):
    try:
        return len(base64.b64decode(value, validate=True)) == 32
    except Exception:
        return False

opnsense = root
wireguard = child(opnsense, "wireguard")
set_text(child(wireguard, "general"), "enabled", "1")
servers = child(child(wireguard, "server"), "servers")
clients = child(child(wireguard, "client"), "clients")

server = find_named(servers, "server", ["name", "description"], params["wg_instance"])
if not server.get("uuid"):
    server.set("uuid", str(uuid.uuid4()))
server_uuid = server.get("uuid")

private_key = server.findtext("privkey") or server.findtext("privatekey") or ""
public_key = server.findtext("pubkey") or server.findtext("publickey") or ""
if not valid_key(private_key) or not valid_key(public_key):
    private_key, public_key = gen_wg_keypair()

set_text(server, "enabled", "1")
set_text(server, "name", params["wg_instance"])
set_text(server, "pubkey", public_key)
set_text(server, "privkey", private_key)
set_text(server, "port", params["wg_port"])
set_text(server, "tunneladdress", params["wg_tunnel"])
set_text(server, "mtu", params["wg_mtu"])

peer = find_named(clients, "client", ["name", "description"], params["worm_peer_name"])
if not peer.get("uuid"):
    peer.set("uuid", str(uuid.uuid4()))
peer_uuid = peer.get("uuid")
set_text(peer, "enabled", "1")
set_text(peer, "name", params["worm_peer_name"])
set_text(peer, "pubkey", worm_public_key)
set_text(peer, "tunneladdress", params["worm_allowed_ip"])
set_text(peer, "allowedips", params["worm_allowed_ip"])
set_text(peer, "keepalive", params["worm_keepalive"])

set_text(server, "peers", peer_uuid)

interfaces = child(opnsense, "interfaces")
wg_if = child(interfaces, "opt10")
set_text(wg_if, "if", "wg0")
set_text(wg_if, "descr", params["wg_interface"])
set_text(wg_if, "enable", "1")
set_text(wg_if, "lock", "1")
set_text(wg_if, "ipaddr", "none")
set_text(wg_if, "ipaddrv6", "none")

filter_node = child(opnsense, "filter")

def ensure_rule(descr, interface, proto, source_text, destination_text, dstport=None):
    for rule in filter_node.findall("rule"):
        if rule.findtext("descr") == descr:
            break
    else:
        rule = ET.SubElement(filter_node, "rule")
    set_text(rule, "type", "pass")
    set_text(rule, "interface", interface)
    set_text(rule, "ipprotocol", "inet")
    set_text(rule, "statetype", "keep state")
    set_text(rule, "direction", "in")
    set_text(rule, "protocol", proto)
    src = child(rule, "source")
    src.clear()
    if source_text == "any":
        ET.SubElement(src, "any")
    else:
        set_text(src, "network", source_text)
    dst = child(rule, "destination")
    dst.clear()
    if destination_text == "wanip":
        set_text(dst, "network", "wanip")
    elif destination_text == "any":
        ET.SubElement(dst, "any")
    else:
        set_text(dst, "network", destination_text)
    if dstport:
        set_text(dst, "port", dstport)
    set_text(rule, "descr", descr)

ensure_rule("WORM WireGuard public endpoint", "wan", "udp", "any", "wanip", params["wg_port"])
ensure_rule("Worm OS VPN", params["wg_interface"], "any", params["wg_interface"] + "net", "any")

nat = child(opnsense, "nat")
outbound = child(nat, "outbound")
set_text(outbound, "mode", "hybrid")
for rule in outbound.findall("rule"):
    if rule.findtext("descr") == "WORM WG -> WAN":
        break
else:
    rule = ET.SubElement(outbound, "rule")
set_text(rule, "interface", "wan")
set_text(rule, "ipprotocol", "inet")
src = child(rule, "source")
src.clear()
set_text(src, "network", params["wg_net"])
dst = child(rule, "destination")
dst.clear()
ET.SubElement(dst, "any")
target = child(rule, "target")
target.clear()
set_text(target, "network", "wanip")
set_text(rule, "descr", "WORM WG -> WAN")

unbound = child(opnsense, "unbound")
set_text(unbound, "enable", "1")
active_interfaces = set((unbound.findtext("active_interface") or "").split(","))
active_interfaces.discard("")
active_interfaces.add(params["wg_interface"])
set_text(unbound, "active_interface", ",".join(sorted(active_interfaces)))

system = child(opnsense, "system")
norm = child(child(system, "optimization"), "normalization")
set_text(norm, "maxmss", params["wg_mss"])

ET.indent(tree, space="  ")
tree.write(config_path, encoding="utf-8", xml_declaration=True)
print("OPNSENSE_PUBLIC_KEY=" + public_key)
print("SERVER_UUID=" + server_uuid)
print("PEER_UUID=" + peer_uuid)
PY
chmod 700 "$REMOTE_SCRIPT"

scp_to_opnsense "$REMOTE_SCRIPT" "$REMOTE_DIR/configure.py"
ssh_opnsense "cp /conf/config.xml '$REMOTE_DIR/config.xml'"

OPNSENSE_PUBLIC_KEY="$(
  ssh_opnsense "WAN_IP='$WAN_IP' WG_INSTANCE='$WG_INSTANCE' WG_INTERFACE='$WG_INTERFACE' WG_PORT='$WG_PORT' WG_TUNNEL='$WG_TUNNEL' WG_NET='$WG_NET' WORM_OS_ALLOWED_IP='$WORM_OS_ALLOWED_IP' WG_MTU='$WG_MTU' WG_MSS='$WG_MSS' WORM_PEER_NAME='$WORM_PEER_NAME' WORM_KEEPALIVE='$WORM_KEEPALIVE' python3 '$REMOTE_DIR/configure.py' '$REMOTE_DIR/config.xml' '$WORM_OS_PUBLIC_KEY'" \
    | tee "$STATE_DIR/apply-public-$TS.txt" \
    | awk -F= '/^OPNSENSE_PUBLIC_KEY=/{print $2}'
)"

ssh_opnsense "cp '$REMOTE_DIR/config.xml' /conf/config.xml && configctl interface reconfigure && configctl filter reload && configctl unbound restart || true; configctl wireguard restart || configctl wireguard configure || true"
ssh_opnsense "rm -rf '$REMOTE_DIR'"

chmod 600 "$STATE_DIR/apply-public-$TS.txt"

{
  printf 'PATCH=%s\n' "$PATCH_NAME"
  printf 'TIMESTAMP=%s\n' "$(TZ=Europe/Rome date --iso-8601=seconds)"
  printf 'WAN_IP=%s\n' "$WAN_IP"
  printf 'WG_INSTANCE=%s\n' "$WG_INSTANCE"
  printf 'WG_INTERFACE=%s\n' "$WG_INTERFACE"
  printf 'WG_TUNNEL=%s\n' "$WG_TUNNEL"
  printf 'UDP_LISTEN_PORT=%s\n' "$WG_PORT"
  printf 'WORM_OS_ALLOWED_IP=%s\n' "$WORM_OS_ALLOWED_IP"
  printf 'OPNSENSE_PUBLIC_KEY=%s\n' "$OPNSENSE_PUBLIC_KEY"
  printf 'PRIVATE_KEYS=not printed\n'
} > "$LOG_DIR/$PATCH_NAME.log"

"$PATCH_DIR/audit.sh" >> "$LOG_DIR/$PATCH_NAME.log" || true
printf 'Wrote %s\n' "$LOG_DIR/$PATCH_NAME.log"
