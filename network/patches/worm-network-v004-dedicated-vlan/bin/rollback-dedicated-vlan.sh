#!/usr/bin/env sh
set -eu

BASE_DIR="${WORM_NETWORK_BASE:-/opt/worm/network}"
PUBLIC_INTERFACE="enp9s0"
VLAN_ID="4000"
PRIVATE_INTERFACE="$PUBLIC_INTERFACE.$VLAN_ID"
PRIVATE_IPV4="10.20.1.2/24"

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: run as root" >&2
  exit 1
fi

BACKUP_DIR="${1:-}"
if [ -z "$BACKUP_DIR" ]; then
  BACKUP_DIR="$(find "$BASE_DIR/backup" -maxdepth 1 -type d -name 'network-*' | sort | tail -1)"
fi

if [ -z "$BACKUP_DIR" ] || [ ! -d "$BACKUP_DIR/network" ]; then
  echo "ERROR: backup directory not found or incomplete" >&2
  exit 2
fi

if ip link show "$PRIVATE_INTERFACE" >/dev/null 2>&1; then
  ip addr del "$PRIVATE_IPV4" dev "$PRIVATE_INTERFACE" 2>/dev/null || true
  ifdown "$PRIVATE_INTERFACE" 2>/dev/null || true
  ip link delete "$PRIVATE_INTERFACE" 2>/dev/null || true
fi

if [ -f "$BACKUP_DIR/network/interfaces" ]; then
  cp -a "$BACKUP_DIR/network/interfaces" /etc/network/interfaces
fi

mkdir -p /etc/network/interfaces.d
if [ -f "$BACKUP_DIR/network/interfaces.d/worm-vswitch" ]; then
  cp -a "$BACKUP_DIR/network/interfaces.d/worm-vswitch" /etc/network/interfaces.d/worm-vswitch
else
  rm -f /etc/network/interfaces.d/worm-vswitch
fi

if grep -Rqs "^auto $PRIVATE_INTERFACE\\|iface $PRIVATE_INTERFACE" /etc/network; then
  ifup "$PRIVATE_INTERFACE" || {
    echo "ERROR: restored previous config but ifup failed" >&2
    exit 3
  }
fi

printf 'Rollback completed using %s\n' "$BACKUP_DIR"
