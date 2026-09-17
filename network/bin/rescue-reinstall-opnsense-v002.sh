#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="${WORM_NETWORK_BASE:-/opt/worm/network}"
CONFIG_DIR="$BASE_DIR/config"
SECRETS_FILE="$CONFIG_DIR/secrets.env"
BACKUP_DIR="$BASE_DIR/backup"
GENERATED_DIR="$BASE_DIR/generated"
STATE_DIR="$BASE_DIR/state"
LOG_DIR="$BASE_DIR/logs"
BOOTSTRAP_DIR="$GENERATED_DIR/opnsense-bootstrap"
BOOTSTRAP_CONFIG="$BOOTSTRAP_DIR/config.xml"
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
SERVER_STATUS="UNKNOWN"
SERVER_LOCATION="UNKNOWN"
SERVER_TYPE="UNKNOWN"
SERVER_DISK_GB=""
PRIMARY_IPV4=""
PRIMARY_IPV6=""
ISO_NAME=""
ISO_MOUNTED="NO"
CONFIG_VOLUME_ID=""
CONFIG_VOLUME_DEVICE="UNKNOWN"
MAIN_DISK="UNKNOWN"
MAIN_DISK_SIZE="UNKNOWN"
RESCUE_STATUS="FAIL"
CONFIG_XML_VALID="NO"
FAT32_STATUS="FAIL"
CONFIG_ON_VOLUME="FAIL"
MAIN_DISK_WIPE="FAIL"
INSTALL_STATUS="MANUAL_CONSOLE_REQUIRED"
FIRST_BOOT="PENDING"
PRIVATE_NETWORK_STATUS="NOT CONFIGURED YET"
VSWITCH_STATUS="NOT CONFIGURED YET"
CONFIG_VOLUME_READY="NO"

mkdir -p "$BACKUP_DIR" "$GENERATED_DIR" "$STATE_DIR" "$LOG_DIR" "$BOOTSTRAP_DIR"
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
  curl -fsS --connect-timeout 10 --max-time 30 \
    -H "Authorization: Bearer $HETZNER_CLOUD_TOKEN" \
    -H "Content-Type: application/json" \
    "$API$1"
}

cloud_post() {
  local path="$1"
  local data="$2"
  curl -fsS -X POST --connect-timeout 10 --max-time 30 \
    -H "Authorization: Bearer $HETZNER_CLOUD_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$data" \
    "$API$path"
}

print_summary() {
  printf '=== WORM OPNsense RESCUE REINSTALL ===\n\n'
  printf 'SERVER:\n%s\n\n' "$SERVER_NAME"
  printf 'SERVER ID:\n%s\n\n' "${SERVER_ID:-UNKNOWN}"
  printf 'RESCUE:\n%s\n\n' "$RESCUE_STATUS"
  printf 'PUBLIC:\n%s/%s\n\n' "$EXPECTED_IPV4" "$PUBLIC_PREFIX"
  printf 'CONFIG VOLUME:\n%s\ndevice=%s\nFAT32=%s\n/conf/config.xml=%s\n\n' "${CONFIG_VOLUME_ID:-UNKNOWN}" "$CONFIG_VOLUME_DEVICE" "$FAT32_STATUS" "$CONFIG_ON_VOLUME"
  printf 'MAIN DISK:\n%s\n\n' "$MAIN_DISK"
  printf 'MAIN DISK WIPE:\n%s\n\n' "$MAIN_DISK_WIPE"
  printf 'ISO:\n%s\n\n' "${ISO_NAME:-UNKNOWN}"
  printf 'INSTALL:\n%s\n\n' "$INSTALL_STATUS"
  printf 'FIRST BOOT:\n%s\n\n' "$FIRST_BOOT"
  printf 'WAN:\n%s\n\n' "$WAN_IF"
  printf 'IPv4:\n%s/%s\n\n' "$EXPECTED_IPV4" "$PUBLIC_PREFIX"
  printf 'GATEWAY:\n%s\n\n' "$PUBLIC_GATEWAY"
  printf 'LAN:\nNONE\n\n'
  printf 'OPT:\nNONE\n\n'
  printf 'PRIVATE NETWORK:\n%s\n\n' "$PRIVATE_NETWORK_STATUS"
  printf 'VSWITCH:\n%s\n' "$VSWITCH_STATUS"
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

discover_server() {
  local servers_file="$STATE_DIR/cloud.servers.reinstall-v002.json"
  local server_json="$STATE_DIR/cloud.server.$SERVER_NAME.reinstall-v002.json"
  cloud_get "/servers?per_page=50" > "$servers_file"
  local count
  count="$(jq --arg name "$SERVER_NAME" '[.servers[]? | select(.name == $name)] | length' "$servers_file")"
  [ "$count" -eq 1 ] || fail "expected exactly one server named $SERVER_NAME, found $count"
  jq --arg name "$SERVER_NAME" '.servers[] | select(.name == $name)' "$servers_file" > "$server_json"

  SERVER_ID="$(jq -r '.id' "$server_json")"
  SERVER_STATUS="$(jq -r '.status // empty' "$server_json")"
  SERVER_LOCATION="$(jq -r '.location.name // .datacenter.location.name // empty' "$server_json")"
  SERVER_TYPE="$(jq -r '.server_type.name // empty' "$server_json")"
  SERVER_DISK_GB="$(jq -r '.server_type.disk // empty' "$server_json")"
  PRIMARY_IPV4="$(jq -r '.public_net.ipv4.ip // empty' "$server_json")"
  PRIMARY_IPV6="$(jq -r '.public_net.ipv6.ip // empty' "$server_json")"
  ISO_NAME="$(jq -r '.iso.name // empty' "$server_json")"
  if [ -n "$ISO_NAME" ] && printf '%s' "$ISO_NAME" | grep -Eiq 'opnsense'; then
    ISO_MOUNTED="YES"
  else
    ISO_MOUNTED="NO"
  fi

  [ "$PRIMARY_IPV4" = "$EXPECTED_IPV4" ] || fail "PRIMARY_IPV4 mismatch: expected $EXPECTED_IPV4 got ${PRIMARY_IPV4:-NONE}"
}

write_metadata_backup() {
  local backup_file="$BACKUP_DIR/worm-opnsense-prewipe-$TS.json"
  jq '{
    server_id:.id,
    server_name:.name,
    server_type:.server_type,
    location:(.location // .datacenter.location),
    primary_ipv4:.public_net.ipv4,
    primary_ipv6:.public_net.ipv6,
    iso_attachment:.iso,
    network_attachments:.private_net,
    volume_attachments:.volumes
  }' "$STATE_DIR/cloud.server.$SERVER_NAME.reinstall-v002.json" > "$backup_file"
  chmod 600 "$backup_file"
}

ensure_config_volume() {
  local volumes_file="$STATE_DIR/cloud.volumes.reinstall-v002.json"
  cloud_get "/volumes?per_page=50" > "$volumes_file"
  local count
  count="$(jq --arg name "$VOLUME_NAME" '[.volumes[]? | select(.name == $name)] | length' "$volumes_file")"
  if [ "$count" -eq 0 ]; then
    [ -n "$SERVER_LOCATION" ] || fail "server location is not known"
    local payload
    payload="$(jq -n --arg name "$VOLUME_NAME" --arg location "$SERVER_LOCATION" --argjson size "$VOLUME_SIZE_GB" \
      '{name:$name,size:$size,location:$location,automount:false,format:null}')"
    cloud_post "/volumes" "$payload" > "$STATE_DIR/cloud.volume-create.reinstall-v002.json"
    CONFIG_VOLUME_ID="$(jq -r '.volume.id' "$STATE_DIR/cloud.volume-create.reinstall-v002.json")"
  elif [ "$count" -eq 1 ]; then
    CONFIG_VOLUME_ID="$(jq -r --arg name "$VOLUME_NAME" '.volumes[] | select(.name == $name) | .id' "$volumes_file")"
    local size
    size="$(jq -r --arg name "$VOLUME_NAME" '.volumes[] | select(.name == $name) | .size' "$volumes_file")"
    [ "$size" -ge "$VOLUME_SIZE_GB" ] || fail "existing volume is smaller than ${VOLUME_SIZE_GB}GB"
  else
    fail "more than one volume named $VOLUME_NAME"
  fi

  [ -n "$CONFIG_VOLUME_ID" ] || fail "config volume id not available"
  cloud_get "/volumes/$CONFIG_VOLUME_ID" > "$STATE_DIR/cloud.volume.$CONFIG_VOLUME_ID.before-attach-v002.json"
  local attached
  attached="$(jq -r '.volume.server // empty' "$STATE_DIR/cloud.volume.$CONFIG_VOLUME_ID.before-attach-v002.json")"
  if [ -z "$attached" ] || [ "$attached" = "null" ]; then
    local payload
    payload="$(jq -n --argjson server "$SERVER_ID" '{server:$server,automount:false}')"
    cloud_post "/volumes/$CONFIG_VOLUME_ID/actions/attach" "$payload" > "$STATE_DIR/cloud.volume-attach.$CONFIG_VOLUME_ID.v002.json"
  elif [ "$attached" != "$SERVER_ID" ]; then
    fail "volume $VOLUME_NAME is attached to server $attached, not $SERVER_ID"
  fi

  for _ in $(seq 1 90); do
    cloud_get "/volumes/$CONFIG_VOLUME_ID" > "$STATE_DIR/cloud.volume.$CONFIG_VOLUME_ID.after-attach-v002.json"
    attached="$(jq -r '.volume.server // empty' "$STATE_DIR/cloud.volume.$CONFIG_VOLUME_ID.after-attach-v002.json")"
    [ "$attached" = "$SERVER_ID" ] && return 0
    sleep 2
  done
  fail "config volume did not become attached"
}

enable_rescue_and_power_cycle() {
  local keys_file="$STATE_DIR/cloud.ssh-keys.reinstall-v002.json"
  local key_args
  key_args='[]'
  if cloud_get "/ssh_keys?per_page=50" > "$keys_file"; then
    key_args="$(jq '[.ssh_keys[]?.id]' "$keys_file")"
  fi

  local payload
  payload="$(jq -n --arg type "linux64" --argjson ssh_keys "$key_args" \
    '{type:$type, ssh_keys:$ssh_keys}')"
  cloud_post "/servers/$SERVER_ID/actions/enable_rescue" "$payload" > "$STATE_DIR/cloud.enable-rescue.$SERVER_ID.v002.json"

  if [ "$SERVER_STATUS" = "off" ]; then
    cloud_post "/servers/$SERVER_ID/actions/poweron" '{}' > "$STATE_DIR/cloud.poweron.$SERVER_ID.v002.json"
  else
    cloud_post "/servers/$SERVER_ID/actions/reset" '{}' > "$STATE_DIR/cloud.reset.$SERVER_ID.v002.json"
  fi

  for _ in $(seq 1 120); do
    cloud_get "/servers/$SERVER_ID" > "$STATE_DIR/cloud.server.$SERVER_NAME.rescue-wait-v002.json"
    SERVER_STATUS="$(jq -r '.server.status // empty' "$STATE_DIR/cloud.server.$SERVER_NAME.rescue-wait-v002.json")"
    [ "$SERVER_STATUS" = "running" ] && break
    sleep 2
  done
  [ "$SERVER_STATUS" = "running" ] || fail "server did not reach running state after rescue power cycle"

  for _ in $(seq 1 120); do
    if ssh_rescue 'true' >/dev/null 2>&1; then
      RESCUE_STATUS="PASS"
      return 0
    fi
    sleep 3
  done
  fail "SSH to Rescue did not become available with configured Hetzner SSH keys"
}

ssh_rescue() {
  if ssh -o BatchMode=yes \
    -o ConnectTimeout=8 \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    -o LogLevel=ERROR \
    "root@$EXPECTED_IPV4" "$@" 2>/dev/null; then
    return 0
  fi

  local rescue_password
  rescue_password="$(jq -r '.root_password // empty' "$STATE_DIR/cloud.enable-rescue.$SERVER_ID.v002.json" 2>/dev/null || true)"
  [ -n "$rescue_password" ] || return 1
  SSHPASS="$rescue_password" sshpass -e ssh \
    -o PreferredAuthentications=password \
    -o PubkeyAuthentication=no \
    -o ConnectTimeout=8 \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    -o LogLevel=ERROR \
    "root@$EXPECTED_IPV4" "$@"
}

scp_to_rescue() {
  if scp -q \
    -o BatchMode=yes \
    -o ConnectTimeout=8 \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    -o LogLevel=ERROR \
    "$1" "root@$EXPECTED_IPV4:$2" 2>/dev/null; then
    return 0
  fi

  local rescue_password
  rescue_password="$(jq -r '.root_password // empty' "$STATE_DIR/cloud.enable-rescue.$SERVER_ID.v002.json" 2>/dev/null || true)"
  [ -n "$rescue_password" ] || return 1
  SSHPASS="$rescue_password" sshpass -e scp -q \
    -o PreferredAuthentications=password \
    -o PubkeyAuthentication=no \
    -o ConnectTimeout=8 \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    -o LogLevel=ERROR \
    "$1" "root@$EXPECTED_IPV4:$2"
}

write_remote_rescue_script() {
  local script="$STATE_DIR/rescue-prepare-and-wipe-v002.sh"
  cat > "$script" <<'REMOTE'
#!/usr/bin/env bash
set -euo pipefail

ACTION="$1"
EXPECTED_IPV4="$2"
CONFIG_VOLUME_ID="$3"
SERVER_DISK_GB="$4"
CONFIG_VOLUME_GB="$5"
REMOTE_CONFIG="/tmp/opnsense-bootstrap-config.xml"
MOUNTPOINT="/mnt/opnsense-config"
DISK_STATE="/tmp/opnsense-rescue-disks.env"

fail() {
  printf 'REMOTE_ERROR: %s\n' "$*" >&2
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required in Rescue"
}

need awk
need blkid
need findmnt
need lsblk
need mkfs.vfat
need mount
need readlink
need sha256sum
need umount
need wipefs

if command -v parted >/dev/null 2>&1; then
  PARTITIONER="parted"
elif command -v sgdisk >/dev/null 2>&1; then
  PARTITIONER="sgdisk"
else
  fail "parted or sgdisk is required in Rescue"
fi

grep -qiE 'hetzner.*rescue|rescue.*hetzner|debian|ubuntu' /etc/os-release || fail "could not confirm a Linux Rescue-like environment"

write_audit() {
  {
    echo "=== /etc/os-release ==="
    cat /etc/os-release
    echo
    echo "=== uname -a ==="
    uname -a
    echo
    echo "=== lsblk ==="
    lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINT,MODEL,SERIAL
    echo
    echo "=== blkid ==="
    blkid || true
    echo
    echo "=== findmnt ==="
    findmnt || true
    echo
    echo "=== by-id ==="
    find /dev/disk/by-id -maxdepth 1 -type l -printf '%f -> %l\n' 2>/dev/null | sort || true
  } > /tmp/opnsense-rescue-disk-audit.log
}

identify_disks() {
  volume_link="/dev/disk/by-id/scsi-0HC_Volume_${CONFIG_VOLUME_ID}"
  [ -e "$volume_link" ] || fail "config volume by-id link not found: $volume_link"
  config_disk="$(readlink -f "$volume_link")"
  [ -b "$config_disk" ] || fail "config volume link does not resolve to block device"

  config_size_bytes="$(lsblk -bdno SIZE "$config_disk" | awk 'NR==1{print $1}')"
  config_min=$((CONFIG_VOLUME_GB * 1000000000 - 1000000000))
  config_max=$((CONFIG_VOLUME_GB * 1000000000 + 1000000000))
  [ "$config_size_bytes" -ge "$config_min" ] && [ "$config_size_bytes" -le "$config_max" ] || fail "config volume size mismatch"

  main_min=$((SERVER_DISK_GB * 1000000000 - 3000000000))
  main_max=$((SERVER_DISK_GB * 1000000000 + 3000000000))
  main_disk=""
  matches=0
  while read -r name size type; do
    [ "$type" = "disk" ] || continue
    dev="/dev/$name"
    [ "$dev" != "$config_disk" ] || continue
    case "$dev" in
      /dev/loop*|/dev/ram*|/dev/sr*) continue ;;
    esac
    if [ "$size" -ge "$main_min" ] && [ "$size" -le "$main_max" ]; then
      main_disk="$dev"
      matches=$((matches + 1))
    fi
  done <<EOF
$(lsblk -bdno NAME,SIZE,TYPE)
EOF

  [ "$matches" -eq 1 ] || {
    echo "DISK_IDENTIFICATION=AMBIGUOUS"
    fail "expected exactly one main disk candidate, found $matches"
  }
  [ "$main_disk" != "$config_disk" ] || fail "main disk equals config volume disk"

  main_size_bytes="$(lsblk -bdno SIZE "$main_disk" | awk 'NR==1{print $1}')"
  echo "MAIN_DISK=$main_disk"
  echo "MAIN_DISK_SIZE=$main_size_bytes"
  echo "CONFIG_VOLUME_DISK=$config_disk"
  echo "CONFIG_VOLUME_SIZE=$config_size_bytes"
}

unmount_tree() {
  disk="$1"
  for dev in $(lsblk -nrpo NAME "$disk"); do
    while read -r target; do
      [ -n "$target" ] || continue
      umount "$target" || fail "could not unmount $target"
    done <<EOF
$(findmnt -nr -S "$dev" -o TARGET || true)
EOF
  done
}

prepare_config_volume() {
  [ -s "$REMOTE_CONFIG" ] || fail "bootstrap config missing"
  unmount_tree "$config_disk"

  wipefs -a "$config_disk"
  if [ "$PARTITIONER" = "parted" ]; then
    parted -s "$config_disk" mklabel gpt
    parted -s "$config_disk" mkpart primary fat32 1MiB 100%
  else
    sgdisk --zap-all "$config_disk"
    sgdisk -n 1:2048:0 -t 1:0700 -c 1:OPNSENSECFG "$config_disk"
  fi
  partprobe "$config_disk" 2>/dev/null || true
  sleep 2
  config_part="$(lsblk -nrpo NAME,TYPE "$config_disk" | awk '$2 == "part" {print $1; exit}')"
  [ -n "$config_part" ] || fail "config volume partition was not created"
  mkfs.vfat -F 32 -n OPNSENSECFG "$config_part"

  mkdir -p "$MOUNTPOINT"
  mount "$config_part" "$MOUNTPOINT"
  mkdir -p "$MOUNTPOINT/conf"
  cp "$REMOTE_CONFIG" "$MOUNTPOINT/conf/config.xml"
  sync
  src_sha="$(sha256sum "$REMOTE_CONFIG" | awk '{print $1}')"
  dst_sha="$(sha256sum "$MOUNTPOINT/conf/config.xml" | awk '{print $1}')"
  [ "$src_sha" = "$dst_sha" ] || fail "config checksum mismatch before unmount"
  umount "$MOUNTPOINT"

  mount -o ro "$config_part" "$MOUNTPOINT"
  [ -s "$MOUNTPOINT/conf/config.xml" ] || fail "/conf/config.xml missing after read-only remount"
  ro_sha="$(sha256sum "$MOUNTPOINT/conf/config.xml" | awk '{print $1}')"
  [ "$src_sha" = "$ro_sha" ] || fail "config checksum mismatch after read-only remount"
  umount "$MOUNTPOINT"

  {
    printf 'MAIN_DISK=%s\n' "$main_disk"
    printf 'MAIN_DISK_SIZE=%s\n' "$main_size_bytes"
    printf 'CONFIG_VOLUME_DISK=%s\n' "$config_disk"
    printf 'CONFIG_VOLUME_SIZE=%s\n' "$config_size_bytes"
    printf 'CONFIG_VOLUME_PARTITION=%s\n' "$config_part"
    printf 'CONFIG_XML_SHA256=%s\n' "$src_sha"
    printf 'CONFIG_VOLUME_READY=YES\n'
  } > "$DISK_STATE"
  echo "CONFIG_VOLUME_READY=YES"
  echo "CONFIG_VOLUME_PARTITION=$config_part"
  echo "CONFIG_XML_SHA256=$src_sha"
}

wipe_main_disk() {
  [ -f "$DISK_STATE" ] || fail "disk state file missing before wipe"
  # shellcheck source=/dev/null
  . "$DISK_STATE"
  [ "${CONFIG_VOLUME_READY:-NO}" = "YES" ] || fail "config volume is not ready before wipe"
  identify_disks >/tmp/opnsense-disk-recheck-before-wipe.log
  [ "$main_disk" = "$MAIN_DISK" ] || fail "main disk changed before wipe"
  [ "$config_disk" = "$CONFIG_VOLUME_DISK" ] || fail "config volume disk changed before wipe"
  [ "$main_disk" != "$config_disk" ] || fail "main disk equals config volume disk before wipe"

  unmount_tree "$main_disk"
  wipefs -a "$main_disk"
  if command -v sgdisk >/dev/null 2>&1; then
    sgdisk --zap-all "$main_disk" || true
  fi
  dd if=/dev/zero of="$main_disk" bs=1M count=32 conv=fsync status=none
  blockdev --rereadpt "$main_disk" 2>/dev/null || true
  if blkid "$main_disk" >/tmp/opnsense-main-disk-blkid-after.txt 2>&1; then
    fail "main disk still has a blkid signature"
  fi
  if lsblk -nrpo NAME,TYPE "$main_disk" | awk '$2 == "part" {found=1} END {exit found ? 0 : 1}'; then
    fail "main disk still has partitions"
  fi
  echo "MAIN_DISK_CLEAN=YES"
}

write_audit
identify_disks
case "$ACTION" in
  prepare)
    prepare_config_volume
    ;;
  wipe)
    wipe_main_disk
    ;;
  *)
    fail "unknown action: $ACTION"
    ;;
esac
REMOTE
  chmod 700 "$script"
  printf '%s\n' "$script"
}

prewipe_api_check() {
  local expected_server_id="$SERVER_ID"
  local expected_volume_id="$CONFIG_VOLUME_ID"
  discover_server
  [ "$SERVER_ID" = "$expected_server_id" ] || fail "server id changed"
  [ "$PRIMARY_IPV4" = "$EXPECTED_IPV4" ] || fail "primary IPv4 changed"
  [ "$ISO_MOUNTED" = "YES" ] || fail "OPNsense ISO is not mounted"
  [ "$CONFIG_VOLUME_ID" = "$expected_volume_id" ] || fail "config volume id changed"
  cloud_get "/volumes/$CONFIG_VOLUME_ID" > "$STATE_DIR/cloud.volume.$CONFIG_VOLUME_ID.prewipe-v002.json"
  local attached
  attached="$(jq -r '.volume.server // empty' "$STATE_DIR/cloud.volume.$CONFIG_VOLUME_ID.prewipe-v002.json")"
  [ "$attached" = "$SERVER_ID" ] || fail "config volume is not attached to target before wipe"
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

write_bootstrap_config
if "$BASE_DIR/bin/validate-opnsense-bootstrap.sh" "$BOOTSTRAP_CONFIG" >/dev/null; then
  CONFIG_XML_VALID="YES"
else
  fail "config.xml validation failed"
fi

discover_server
write_metadata_backup
ensure_config_volume

[ "$ISO_MOUNTED" = "YES" ] || fail "no OPNsense ISO mounted before Rescue"
enable_rescue_and_power_cycle

remote_script="$(write_remote_rescue_script)"
scp_to_rescue "$BOOTSTRAP_CONFIG" /tmp/opnsense-bootstrap-config.xml
scp_to_rescue "$remote_script" /tmp/rescue-prepare-and-wipe-v002.sh
ssh_rescue "bash /tmp/rescue-prepare-and-wipe-v002.sh prepare '$EXPECTED_IPV4' '$CONFIG_VOLUME_ID' '$SERVER_DISK_GB' '$VOLUME_SIZE_GB'" \
  > "$STATE_DIR/rescue-prepare-v002.$TS.log"
scp -q \
  -o BatchMode=yes \
  -o ConnectTimeout=8 \
  -o StrictHostKeyChecking=no \
  -o UserKnownHostsFile=/dev/null \
  -o LogLevel=ERROR \
  "root@$EXPECTED_IPV4:/tmp/opnsense-rescue-disk-audit.log" \
  "$LOG_DIR/opnsense-rescue-disk-audit-$TS.log"
chmod 600 "$LOG_DIR/opnsense-rescue-disk-audit-$TS.log"

MAIN_DISK="$(awk -F= '/^MAIN_DISK=/{print $2}' "$STATE_DIR/rescue-prepare-v002.$TS.log" | tail -1)"
MAIN_DISK_SIZE="$(awk -F= '/^MAIN_DISK_SIZE=/{print $2}' "$STATE_DIR/rescue-prepare-v002.$TS.log" | tail -1)"
CONFIG_VOLUME_DEVICE="$(awk -F= '/^CONFIG_VOLUME_DISK=/{print $2}' "$STATE_DIR/rescue-prepare-v002.$TS.log" | tail -1)"
CONFIG_VOLUME_SIZE="$(awk -F= '/^CONFIG_VOLUME_SIZE=/{print $2}' "$STATE_DIR/rescue-prepare-v002.$TS.log" | tail -1)"

if grep -q '^CONFIG_VOLUME_READY=YES$' "$STATE_DIR/rescue-prepare-v002.$TS.log"; then
  CONFIG_VOLUME_READY="YES"
  FAT32_STATUS="PASS"
  CONFIG_ON_VOLUME="PASS"
else
  fail "config volume was not prepared"
fi

prewipe_api_check
[ "$CONFIG_VOLUME_READY" = "YES" ] || fail "config volume is not ready before wipe"
[ -n "$MAIN_DISK" ] && [ "$MAIN_DISK" != "UNKNOWN" ] || fail "main disk not identified before wipe"
[ -n "$CONFIG_VOLUME_DEVICE" ] && [ "$CONFIG_VOLUME_DEVICE" != "UNKNOWN" ] || fail "config volume disk not identified before wipe"
[ "$MAIN_DISK" != "$CONFIG_VOLUME_DEVICE" ] || fail "main disk equals config volume disk before wipe"

ssh_rescue "bash /tmp/rescue-prepare-and-wipe-v002.sh wipe '$EXPECTED_IPV4' '$CONFIG_VOLUME_ID' '$SERVER_DISK_GB' '$VOLUME_SIZE_GB'" \
  > "$STATE_DIR/rescue-wipe-v002.$TS.log"

if grep -q '^MAIN_DISK_CLEAN=YES$' "$STATE_DIR/rescue-wipe-v002.$TS.log"; then
  MAIN_DISK_WIPE="PASS"
else
  fail "main disk wipe did not verify clean"
fi

discover_server
[ "$ISO_MOUNTED" = "YES" ] || fail "OPNsense ISO is no longer mounted before reboot"

cloud_post "/servers/$SERVER_ID/actions/reboot" '{}' > "$STATE_DIR/cloud.reboot-to-iso.$SERVER_ID.v002.json"
INSTALL_STATUS="MANUAL_CONSOLE_REQUIRED"
FIRST_BOOT="PENDING"
print_summary
