#!/usr/bin/env sh
set -eu

BASE_DIR="${WORM_NETWORK_BASE:-/opt/worm/network}"
PATCH_DIR="$BASE_DIR/patches/worm-network-v004-dedicated-vlan"
BACKUP_ROOT="$BASE_DIR/backup"
TS="$(TZ=Europe/Rome date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$BACKUP_ROOT/network-$TS"

PUBLIC_INTERFACE="enp9s0"
PUBLIC_IPV4="162.55.6.173"
PUBLIC_GATEWAY="162.55.6.129"
VLAN_ID="4000"
PRIVATE_INTERFACE="$PUBLIC_INTERFACE.$VLAN_ID"
PRIVATE_IPV4="10.20.1.2/24"
MTU="1400"

need_root() {
  if [ "$(id -u)" -ne 0 ]; then
    echo "ERROR: run as root" >&2
    exit 1
  fi
}

copy_if_exists() {
  src="$1"
  dst="$2"
  if [ -e "$src" ]; then
    cp -a "$src" "$dst"
  fi
}

detect_stack() {
  systemd_networkd="$(systemctl is-active systemd-networkd 2>/dev/null || true)"
  networkmanager="$(systemctl is-active NetworkManager 2>/dev/null || true)"
  ifupdown="$(systemctl is-active networking 2>/dev/null || true)"
  netplan="absent"
  if command -v netplan >/dev/null 2>&1 || [ -d /etc/netplan ]; then
    netplan="present"
  fi

  printf 'systemd-networkd=%s\n' "${systemd_networkd:-inactive}"
  printf 'NetworkManager=%s\n' "${networkmanager:-inactive}"
  printf 'ifupdown=%s\n' "${ifupdown:-inactive}"
  printf 'netplan=%s\n' "$netplan"

  if [ "$ifupdown" != "active" ]; then
    echo "ERROR: native active stack is not ifupdown; refusing to apply this patch." >&2
    exit 2
  fi
}

verify_public_unchanged() {
  ip -4 addr show dev "$PUBLIC_INTERFACE" | grep -q "$PUBLIC_IPV4" || {
    echo "ERROR: public IP $PUBLIC_IPV4 not present on $PUBLIC_INTERFACE" >&2
    exit 3
  }
  ip route show default | grep -q "via $PUBLIC_GATEWAY dev $PUBLIC_INTERFACE" || {
    echo "ERROR: default route via $PUBLIC_GATEWAY dev $PUBLIC_INTERFACE not found" >&2
    exit 3
  }
}

need_root
mkdir -p "$BACKUP_DIR"
copy_if_exists /etc/network "$BACKUP_DIR/network"
ip -br addr > "$BACKUP_DIR/ip-br-addr.before"
ip route show table main > "$BACKUP_DIR/ip-route.before"
ip -d link show > "$BACKUP_DIR/ip-link.before"
systemctl is-active systemd-networkd NetworkManager networking > "$BACKUP_DIR/network-stack.before" 2>&1 || true

detect_stack | tee "$BACKUP_DIR/detected-stack.txt"
verify_public_unchanged

install -m 0644 "$PATCH_DIR/files/worm-vswitch" /etc/network/interfaces.d/worm-vswitch

ip link show "$PRIVATE_INTERFACE" >/dev/null 2>&1 || ip link add link "$PUBLIC_INTERFACE" name "$PRIVATE_INTERFACE" type vlan id "$VLAN_ID"
ip link set dev "$PRIVATE_INTERFACE" mtu "$MTU"
ip addr flush dev "$PRIVATE_INTERFACE"
ip addr add "$PRIVATE_IPV4" dev "$PRIVATE_INTERFACE"
ip link set dev "$PRIVATE_INTERFACE" up
ip route del 10.90.0.0/16 via 10.90.20.1 dev "$PRIVATE_INTERFACE" 2>/dev/null || true

verify_public_unchanged
ip -br addr > "$BACKUP_DIR/ip-br-addr.after"
ip route show table main > "$BACKUP_DIR/ip-route.after"

printf '=== WORM NETWORK V004 ===\n\n'
printf 'PUBLIC:\n%s\n%s/32\nUNCHANGED\n\n' "$PUBLIC_INTERFACE" "$PUBLIC_IPV4"
printf 'PRIVATE:\ninterface=%s\nip=%s\nmtu=%s\n\n' "$PRIVATE_INTERFACE" "$PRIVATE_IPV4" "$MTU"
printf 'DEFAULT ROUTE:\nUNCHANGED\n\n'
if ip -4 addr show dev "$PRIVATE_INTERFACE" | grep -q "$PRIVATE_IPV4" && ip route show default | grep -q "via $PUBLIC_GATEWAY dev $PUBLIC_INTERFACE"; then
  printf 'STATUS:\nREADY_FOR_OPNSENSE_ROUTING=YES\n'
else
  printf 'STATUS:\nREADY_FOR_OPNSENSE_ROUTING=NO\n'
fi
printf '\nBACKUP=%s\n' "$BACKUP_DIR"
