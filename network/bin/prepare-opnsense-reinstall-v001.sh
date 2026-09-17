#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="${WORM_NETWORK_BASE:-/opt/worm/network}"
CONFIG_DIR="$BASE_DIR/config"
SECRETS_FILE="$CONFIG_DIR/secrets.env"
BACKUP_DIR="$BASE_DIR/backup"
GENERATED_DIR="$BASE_DIR/generated"
STATE_DIR="$BASE_DIR/state"
BOOTSTRAP_DIR="$GENERATED_DIR/opnsense-bootstrap"
BOOTSTRAP_CONFIG="$BOOTSTRAP_DIR/config.xml"
PLAN_FILE="$GENERATED_DIR/opnsense-reinstall-plan.txt"
API="https://api.hetzner.cloud/v1"
SERVER_NAME="worm-opnsense"
EXPECTED_IPV4="2.28.34.27"
PUBLIC_PREFIX="32"
PUBLIC_GATEWAY="172.31.1.1"
WAN_IF="vtnet0"
VOLUME_NAME="worm-opnsense-config"
VOLUME_SIZE_GB="10"
TS="$(TZ=Europe/Berlin date +%Y%m%d-%H%M%S)"

SERVER_ID=""
ISO_NAME=""
ISO_MOUNTED="NO"
CONFIG_STATUS="FAIL"
VOLUME_ID=""
VOLUME_ATTACHED="NO"
CONFIG_XML_STATUS="FAIL"
REMOTE_TARGET_DISK="UNKNOWN"
REMOTE_MAIN_DISK="UNKNOWN"
READY_FOR_REINSTALL="NO"

mkdir -p "$BACKUP_DIR" "$GENERATED_DIR" "$STATE_DIR" "$BOOTSTRAP_DIR"
umask 077

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  print_summary
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required"
}

cloud_get() {
  curl -fsS \
    --connect-timeout 10 \
    --max-time 30 \
    -H "Authorization: Bearer $HETZNER_CLOUD_TOKEN" \
    -H "Content-Type: application/json" \
    "$API$1"
}

cloud_post() {
  local path="$1"
  local data="$2"
  curl -fsS \
    -X POST \
    --connect-timeout 10 \
    --max-time 30 \
    -H "Authorization: Bearer $HETZNER_CLOUD_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$data" \
    "$API$path"
}

cloud_put() {
  local path="$1"
  local data="$2"
  curl -fsS \
    -X PUT \
    --connect-timeout 10 \
    --max-time 30 \
    -H "Authorization: Bearer $HETZNER_CLOUD_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$data" \
    "$API$path"
}

ssh_opnsense() {
  ssh -o BatchMode=yes -o ConnectTimeout=8 -p "${OPNSENSE_SSH_PORT:-22}" \
    "${OPNSENSE_SSH_USER:-root}@${OPNSENSE_SSH_HOST}" "$@"
}

scp_to_opnsense() {
  scp -q -o BatchMode=yes -o ConnectTimeout=8 -P "${OPNSENSE_SSH_PORT:-22}" "$1" \
    "${OPNSENSE_SSH_USER:-root}@${OPNSENSE_SSH_HOST}:$2"
}

print_summary() {
  printf '=== WORM OPNsense REINSTALL PREP ===\n\n'
  printf 'SERVER:\n%s\nid=%s\n\n' "$SERVER_NAME" "${SERVER_ID:-UNKNOWN}"
  printf 'PUBLIC:\n%s/%s\n\n' "$EXPECTED_IPV4" "$PUBLIC_PREFIX"
  printf 'GATEWAY:\n%s\n\n' "$PUBLIC_GATEWAY"
  printf 'WAN:\n%s\n\n' "$WAN_IF"
  printf 'ISO:\n%s\nMOUNTED=%s\n\n' "${ISO_NAME:-UNKNOWN}" "$ISO_MOUNTED"
  printf 'CONFIG:\n%s\n\n' "$CONFIG_STATUS"
  printf 'CONFIG VOLUME:\nid=%s\nattached=%s\nfilesystem=FAT32\nconfig.xml=%s\n\n' "${VOLUME_ID:-UNKNOWN}" "$VOLUME_ATTACHED" "$CONFIG_XML_STATUS"
  printf 'MAIN DISK:\nUNCHANGED\n'
  if [ "${REMOTE_MAIN_DISK:-UNKNOWN}" != "UNKNOWN" ]; then
    printf 'device=%s\n' "$REMOTE_MAIN_DISK"
  fi
  printf '\nLAN:\nNONE\n\n'
  printf 'OPT:\nNONE\n\n'
  printf 'REINSTALL:\nNOT_STARTED\n\n'
  printf 'READY_FOR_REINSTALL:\n%s\n\n' "$READY_FOR_REINSTALL"
  printf 'NO MAIN DISK ERASED\n'
  printf 'NO REBOOT PERFORMED\n'
}

write_bootstrap_config() {
  cat > "$BOOTSTRAP_CONFIG" <<'XML'
<?xml version="1.0"?>
<opnsense>
  <version>24.7</version>
  <theme>opnsense</theme>
  <system>
    <hostname>worm-opnsense</hostname>
    <domain>localdomain</domain>
    <dnsserver>185.12.64.1</dnsserver>
    <dnsserver>185.12.64.2</dnsserver>
    <dnsallowoverride>0</dnsallowoverride>
    <timezone>Etc/UTC</timezone>
    <webgui>
      <protocol>https</protocol>
      <ssl-certref/>
    </webgui>
  </system>
  <interfaces>
    <wan>
      <enable>1</enable>
      <if>vtnet0</if>
      <ipaddr>2.28.34.27</ipaddr>
      <subnet>32</subnet>
      <gateway>WAN_GW</gateway>
      <blockpriv>0</blockpriv>
      <blockbogons>1</blockbogons>
    </wan>
  </interfaces>
  <gateways>
    <gateway_item>
      <interface>wan</interface>
      <gateway>172.31.1.1</gateway>
      <name>WAN_GW</name>
      <weight>1</weight>
      <ipprotocol>inet</ipprotocol>
      <descr>Public IPv4 gateway</descr>
      <defaultgw>1</defaultgw>
      <fargw>1</fargw>
    </gateway_item>
  </gateways>
  <dhcpd/>
  <dhcpdv6/>
  <filter/>
  <nat/>
  <unbound>
    <enable>0</enable>
  </unbound>
</opnsense>
XML
}

write_plan() {
  local config_volume_device="${REMOTE_TARGET_DISK:-UNKNOWN}"
  local main_disk="${REMOTE_MAIN_DISK:-UNKNOWN}"
  local config_partition="${1:-UNKNOWN}"
  cat > "$PLAN_FILE" <<EOF
SERVER:
$SERVER_NAME

SERVER ID:
$SERVER_ID

PUBLIC IPv4:
$EXPECTED_IPV4/$PUBLIC_PREFIX

PUBLIC GATEWAY:
$PUBLIC_GATEWAY

OPNsense WAN:
$WAN_IF

INSTALL ISO:
$ISO_NAME

MAIN DISK:
$main_disk

CONFIG VOLUME:
$VOLUME_ID
$config_volume_device
FAT32
/conf/config.xml

LAN:
NONE

OPT:
NONE

PRIVATE NETWORK:
LATER

VSWITCH:
LATER

POST-INSTALL ACCESS:
Hetzner Cloud Console is the recovery and initial management path.
Do not rely on WAN WebGUI for first configuration.
Do not open broad WebGUI or SSH access on WAN.

API SNAPSHOT:
${backup_file:-UNKNOWN}

PRIMARY IPv6:
${primary_ipv6:-NONE}

DATACENTER:
${datacenter:-NONE}

LOCATION:
${location:-NONE}

SERVER TYPE:
${server_type:-NONE}

STATUS:
${status:-UNKNOWN}

ISO ID:
${iso_id:-NONE}

CONFIG PARTITION:
$config_partition
EOF
  chmod 600 "$PLAN_FILE"
}

prepare_remote_script() {
  local script="$STATE_DIR/opnsense-format-config-volume.sh"
  cat > "$script" <<'REMOTE'
#!/bin/sh
set -eu

EXPECTED_SIZE_BYTES_MIN=9000000000
EXPECTED_SIZE_BYTES_MAX=11000000000
REMOTE_CONFIG="/tmp/worm-opnsense-bootstrap-config.xml"
MOUNTPOINT="/mnt/worm-config"

fail() {
  echo "REMOTE_ERROR: $*" >&2
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required on OPNsense"
}

need geom
need gpart
need newfs_msdos
need mount_msdosfs
need sha256

[ -s "$REMOTE_CONFIG" ] || fail "remote bootstrap config missing"

root_source="$(mount | awk '$3 == "/" {print $1; exit}')"
[ -n "$root_source" ] || fail "could not identify root filesystem"
root_dev="$(printf '%s\n' "$root_source" | sed 's#^/dev/##; s#/.*##')"

main_disk=""
for disk in $(sysctl -n kern.disks); do
  case "$root_dev" in
    "$disk"|"$disk"p*|"$disk"s*) main_disk="$disk" ;;
  esac
done
[ -n "$main_disk" ] || fail "could not map root filesystem to a main disk"

geom disk list > /tmp/worm-geom-disk-list.txt
camcontrol devlist > /tmp/worm-camcontrol-devlist.txt 2>/dev/null || true
gpart show > /tmp/worm-gpart-show.txt 2>/dev/null || true

target_disk=""
target_size=""
matches=0
for disk in $(sysctl -n kern.disks); do
  [ "$disk" != "$main_disk" ] || continue
  size="$(diskinfo -v "/dev/$disk" 2>/dev/null | awk '/mediasize in bytes/ {print $1; exit}')"
  [ -n "$size" ] || continue
  if [ "$size" -ge "$EXPECTED_SIZE_BYTES_MIN" ] && [ "$size" -le "$EXPECTED_SIZE_BYTES_MAX" ]; then
    target_disk="$disk"
    target_size="$size"
    matches=$((matches + 1))
  fi
done

echo "TARGET_CONFIG_DISK=${target_disk:-UNKNOWN}"
echo "TARGET_SIZE=${target_size:-UNKNOWN}"
echo "MAIN_SYSTEM_DISK=$main_disk"

[ "$matches" -eq 1 ] || fail "expected exactly one non-main 10 GB disk, found $matches"
[ "$target_disk" != "$main_disk" ] || fail "target disk equals main disk"

mount | awk '{print $1}' | grep -Eq "^/dev/${target_disk}([ps][0-9]+)?($|[[:space:]])" && fail "target disk is mounted"

gpart destroy -F "$target_disk" >/dev/null 2>&1 || true
gpart create -s GPT "$target_disk"
gpart add -t ms-basic-data -a 1M "$target_disk"
partition="/dev/${target_disk}p1"
[ -c "$partition" ] || fail "partition was not created: $partition"

newfs_msdos -F 32 -L WORMCONFIG "$partition" >/dev/null
mkdir -p "$MOUNTPOINT"
mount_msdosfs "$partition" "$MOUNTPOINT"
mkdir -p "$MOUNTPOINT/conf"
cp "$REMOTE_CONFIG" "$MOUNTPOINT/conf/config.xml"
sync
umount "$MOUNTPOINT"

mount_msdosfs -o ro "$partition" "$MOUNTPOINT"
[ -s "$MOUNTPOINT/conf/config.xml" ] || fail "config.xml missing after read-only remount"
src_sha="$(sha256 -q "$REMOTE_CONFIG")"
dst_sha="$(sha256 -q "$MOUNTPOINT/conf/config.xml")"
echo "SOURCE_SHA256=$src_sha"
echo "VOLUME_SHA256=$dst_sha"
[ "$src_sha" = "$dst_sha" ] || fail "config.xml checksum mismatch"
umount "$MOUNTPOINT"
echo "CONFIG_VOLUME_READY=YES"
echo "TARGET_CONFIG_PARTITION=$partition"
REMOTE
  chmod 700 "$script"
  printf '%s\n' "$script"
}

need curl
need jq
need python3
need ssh
need scp

if [ -f "$SECRETS_FILE" ]; then
  set -a
  # shellcheck source=/dev/null
  . "$SECRETS_FILE"
  set +a
fi

[ -n "${HETZNER_CLOUD_TOKEN:-}" ] || fail "HETZNER_CLOUD_TOKEN is not configured"
OPNSENSE_SSH_HOST="${OPNSENSE_SSH_HOST:-$EXPECTED_IPV4}"

write_bootstrap_config
if "$BASE_DIR/bin/validate-opnsense-bootstrap.sh" "$BOOTSTRAP_CONFIG" >/dev/null; then
  CONFIG_STATUS="PASS"
else
  CONFIG_STATUS="FAIL"
  fail "bootstrap config validation failed"
fi

servers_file="$STATE_DIR/cloud.servers.reinstall-v001.json"
cloud_get "/servers?per_page=50" > "$servers_file"
server_count="$(jq --arg name "$SERVER_NAME" '[.servers[]? | select(.name == $name)] | length' "$servers_file")"
[ "$server_count" -eq 1 ] || fail "expected exactly one server named $SERVER_NAME, found $server_count"

server_json="$STATE_DIR/cloud.server.$SERVER_NAME.reinstall-v001.json"
jq --arg name "$SERVER_NAME" '.servers[] | select(.name == $name)' "$servers_file" > "$server_json"
SERVER_ID="$(jq -r '.id' "$server_json")"
primary_ipv4="$(jq -r '.public_net.ipv4.ip // empty' "$server_json")"
primary_ipv6="$(jq -r '.public_net.ipv6.ip // empty' "$server_json")"
datacenter="$(jq -r '.datacenter.name // empty' "$server_json")"
location="$(jq -r '.location.name // .datacenter.location.name // empty' "$server_json")"
server_type="$(jq -r '.server_type.name // empty' "$server_json")"
status="$(jq -r '.status // empty' "$server_json")"
ISO_NAME="$(jq -r '.iso.name // empty' "$server_json")"
iso_id="$(jq -r '.iso.id // empty' "$server_json")"
if [ -n "$ISO_NAME" ] && printf '%s' "$ISO_NAME" | grep -Eiq 'opnsense'; then
  ISO_MOUNTED="YES"
else
  ISO_MOUNTED="NO"
fi

[ "$primary_ipv4" = "$EXPECTED_IPV4" ] || fail "PRIMARY_IPV4 mismatch: expected $EXPECTED_IPV4"
[ "$ISO_MOUNTED" = "YES" ] || fail "OPNsense ISO is not mounted according to Hetzner Cloud API"

backup_file="$BACKUP_DIR/opnsense-before-reinstall-$TS.json"
jq '{
  server_id:.id,
  server_name:.name,
  datacenter:.datacenter,
  location:(.location // .datacenter.location),
  server_type:.server_type,
  status:.status,
  primary_ipv4:.public_net.ipv4,
  primary_ipv6:.public_net.ipv6,
  network_attachments:.private_net,
  volumes:.volumes,
  iso:.iso
}' "$server_json" > "$backup_file"
chmod 600 "$backup_file"

volumes_file="$STATE_DIR/cloud.volumes.reinstall-v001.json"
cloud_get "/volumes?per_page=50" > "$volumes_file"
volume_count="$(jq --arg name "$VOLUME_NAME" '[.volumes[]? | select(.name == $name)] | length' "$volumes_file")"
if [ "$volume_count" -eq 0 ]; then
  create_payload="$(jq -n \
    --arg name "$VOLUME_NAME" \
    --arg location "$location" \
    --argjson size "$VOLUME_SIZE_GB" \
    '{name:$name,size:$size,location:$location,automount:false,format:null}')"
  cloud_post "/volumes" "$create_payload" > "$STATE_DIR/cloud.volume-create.reinstall-v001.json"
  VOLUME_ID="$(jq -r '.volume.id' "$STATE_DIR/cloud.volume-create.reinstall-v001.json")"
elif [ "$volume_count" -eq 1 ]; then
  VOLUME_ID="$(jq -r --arg name "$VOLUME_NAME" '.volumes[] | select(.name == $name) | .id' "$volumes_file")"
  existing_size="$(jq -r --arg name "$VOLUME_NAME" '.volumes[] | select(.name == $name) | .size' "$volumes_file")"
  [ "$existing_size" = "$VOLUME_SIZE_GB" ] || fail "existing volume $VOLUME_NAME has size ${existing_size}GB, expected ${VOLUME_SIZE_GB}GB"
else
  fail "more than one volume named $VOLUME_NAME"
fi

[ -n "$VOLUME_ID" ] || fail "volume id not available"
cloud_get "/volumes/$VOLUME_ID" > "$STATE_DIR/cloud.volume.$VOLUME_ID.before-attach.json"
attached_server="$(jq -r '.volume.server // empty' "$STATE_DIR/cloud.volume.$VOLUME_ID.before-attach.json")"
if [ -z "$attached_server" ] || [ "$attached_server" = "null" ]; then
  attach_payload="$(jq -n --argjson server "$SERVER_ID" '{server:$server,automount:false}')"
  cloud_post "/volumes/$VOLUME_ID/actions/attach" "$attach_payload" > "$STATE_DIR/cloud.volume-attach.$VOLUME_ID.json"
elif [ "$attached_server" != "$SERVER_ID" ]; then
  fail "volume $VOLUME_NAME is attached to server $attached_server, not $SERVER_ID"
fi

for _ in $(seq 1 60); do
  cloud_get "/volumes/$VOLUME_ID" > "$STATE_DIR/cloud.volume.$VOLUME_ID.after-attach.json"
  attached_server="$(jq -r '.volume.server // empty' "$STATE_DIR/cloud.volume.$VOLUME_ID.after-attach.json")"
  if [ "$attached_server" = "$SERVER_ID" ]; then
    VOLUME_ATTACHED="YES"
    break
  fi
  sleep 2
done
[ "$VOLUME_ATTACHED" = "YES" ] || fail "volume did not become attached"

if [ "$status" != "running" ]; then
  write_plan "UNKNOWN"
  fail "server status is $status; remote FAT32 preparation requires SSH and was not attempted"
fi

remote_script="$(prepare_remote_script)"
scp_to_opnsense "$BOOTSTRAP_CONFIG" /tmp/worm-opnsense-bootstrap-config.xml
scp_to_opnsense "$remote_script" /tmp/worm-opnsense-format-config-volume.sh
ssh_opnsense "sh /tmp/worm-opnsense-format-config-volume.sh" > "$STATE_DIR/opnsense-config-volume-prepare-$TS.log"

REMOTE_TARGET_DISK="$(awk -F= '/^TARGET_CONFIG_DISK=/{print $2}' "$STATE_DIR/opnsense-config-volume-prepare-$TS.log" | tail -1)"
REMOTE_MAIN_DISK="$(awk -F= '/^MAIN_SYSTEM_DISK=/{print $2}' "$STATE_DIR/opnsense-config-volume-prepare-$TS.log" | tail -1)"
target_partition="$(awk -F= '/^TARGET_CONFIG_PARTITION=/{print $2}' "$STATE_DIR/opnsense-config-volume-prepare-$TS.log" | tail -1)"
if grep -q '^CONFIG_VOLUME_READY=YES$' "$STATE_DIR/opnsense-config-volume-prepare-$TS.log"; then
  CONFIG_XML_STATUS="PASS"
else
  CONFIG_XML_STATUS="FAIL"
  fail "config volume verification failed"
fi

write_plan "$target_partition"

READY_FOR_REINSTALL="YES"
print_summary
