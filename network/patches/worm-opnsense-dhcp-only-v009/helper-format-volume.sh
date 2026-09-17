#!/usr/bin/env bash
set -euo pipefail

VOLUME_ID="106875524"
REMOTE_CONFIG="/root/opnsense-dhcp-config.xml"
MOUNTPOINT="/mnt/opnsense-config"
LABEL="OPNSENSECFG"

fail() {
  printf 'HELPER_ERROR=%s\n' "$*" >&2
  exit 1
}

if ! command -v mkfs.vfat >/dev/null 2>&1 || ! command -v parted >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y dosfstools parted util-linux udev
fi

for cmd in lsblk readlink wipefs mkfs.vfat mount umount sha256sum findmnt partprobe udevadm; do
  command -v "$cmd" >/dev/null 2>&1 || fail "$cmd missing"
done

[ -s "$REMOTE_CONFIG" ] || fail "missing config $REMOTE_CONFIG"

volume_link="/dev/disk/by-id/scsi-0HC_Volume_${VOLUME_ID}"
for _ in $(seq 1 30); do
  [ -e "$volume_link" ] && break
  udevadm settle || true
  sleep 1
done

[ -e "$volume_link" ] || fail "missing volume link $volume_link"
config_disk="$(readlink -f "$volume_link")"
[ -b "$config_disk" ] || fail "volume link does not resolve to block device"

size="$(lsblk -bdno SIZE "$config_disk" | awk 'NR==1{print $1}')"
serial="$(udevadm info --query=property --name="$config_disk" | awk -F= '$1=="ID_SERIAL"{print $2; exit}')"
printf 'CONFIG_VOLUME_DISK=%s\n' "$config_disk"
printf 'CONFIG_VOLUME_SIZE=%s\n' "$size"
printf 'CONFIG_VOLUME_SERIAL=%s\n' "${serial:-UNKNOWN}"

case "${serial:-}" in
  *HC_Volume_${VOLUME_ID}*|*Volume_${VOLUME_ID}*) ;;
  "") printf 'CONFIG_VOLUME_SERIAL_WARNING=missing\n' ;;
  *) fail "serial does not match expected volume id: $serial" ;;
esac

if [ "$size" -lt 9000000000 ] || [ "$size" -gt 11000000000 ]; then
  fail "unexpected volume size: $size"
fi

for dev in $(lsblk -nrpo NAME "$config_disk"); do
  while read -r target; do
    [ -n "$target" ] || continue
    umount "$target" || fail "could not unmount $target"
  done <<EOF
$(findmnt -nr -S "$dev" -o TARGET || true)
EOF
done

wipefs -a "$config_disk"
parted -s "$config_disk" mklabel gpt
parted -s "$config_disk" mkpart primary fat32 1MiB 100%
partprobe "$config_disk" || true
udevadm settle || true
sleep 2

config_part="$(lsblk -nrpo NAME,TYPE "$config_disk" | awk '$2 == "part" {print $1; exit}')"
[ -n "$config_part" ] || fail "partition not found"

mkfs.vfat -F 32 -n "$LABEL" "$config_part"
mkdir -p "$MOUNTPOINT"
mount "$config_part" "$MOUNTPOINT"
mkdir -p "$MOUNTPOINT/conf"
cp "$REMOTE_CONFIG" "$MOUNTPOINT/conf/config.xml"
sync

src_sha="$(sha256sum "$REMOTE_CONFIG" | awk '{print $1}')"
dst_sha="$(sha256sum "$MOUNTPOINT/conf/config.xml" | awk '{print $1}')"
[ "$src_sha" = "$dst_sha" ] || fail "checksum mismatch after copy"
umount "$MOUNTPOINT"

mount -o ro "$config_part" "$MOUNTPOINT"
[ -s "$MOUNTPOINT/conf/config.xml" ] || fail "read-only verification missing /conf/config.xml"
ro_sha="$(sha256sum "$MOUNTPOINT/conf/config.xml" | awk '{print $1}')"
[ "$src_sha" = "$ro_sha" ] || fail "checksum mismatch after read-only remount"
umount "$MOUNTPOINT"

blkid "$config_part" || true
printf 'CONFIG_XML_SHA256=%s\n' "$src_sha"
printf 'CONFIG_VOLUME_PARTITION=%s\n' "$config_part"
printf 'CONFIG_VOLUME_READY=YES\n'
