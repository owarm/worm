#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="/opt/worm-opnsense"
LOG_DIR="${BASE_DIR}/logs"
STATE_DIR="${BASE_DIR}/state"
STAMP="$(date +%Y%m%d-%H%M%S)"
LOG_FILE="${LOG_DIR}/audit-${STAMP}.log"

mkdir -p "$LOG_DIR" "$STATE_DIR"
umask 077

section() {
  printf '\n## %s\n' "$1"
}

run_readonly() {
  printf '$ %s\n' "$*"
  "$@" 2>&1 || true
}

{
  printf 'Worm OPNsense host audit\n'
  printf 'Timestamp: %s\n' "$(date -Is)"

  section "Hostname"
  run_readonly hostname
  run_readonly hostnamectl

  section "Operating system"
  if [ -r /etc/os-release ]; then
    run_readonly sed -n '1,40p' /etc/os-release
  fi
  run_readonly uname -a

  section "Hypervisor detection"
  run_readonly systemd-detect-virt
  run_readonly virt-what
  run_readonly dmidecode -s system-product-name

  section "ip -br addr"
  run_readonly ip -br addr

  section "ip route"
  run_readonly ip route
  run_readonly ip -6 route

  section "ip rule"
  run_readonly ip rule
  run_readonly ip -6 rule

  section "NIC and MAC address"
  run_readonly ip -br link
  for iface in /sys/class/net/*; do
    [ -e "$iface" ] || continue
    name="$(basename "$iface")"
    mac="$(cat "$iface/address" 2>/dev/null || true)"
    printf '%s %s\n' "$name" "$mac"
  done

  section "Bridge"
  run_readonly ip -d link show type bridge
  run_readonly bridge link

  section "VLAN"
  run_readonly ip -d link show type vlan

  section "Default gateway"
  run_readonly ip -4 route show default
  run_readonly ip -6 route show default

  section "Candidate public IPv4"
  default_iface="$(ip -4 route show default 2>/dev/null | awk 'NR==1 {for (i=1;i<=NF;i++) if ($i=="dev") print $(i+1)}' || true)"
  if [ -n "${default_iface:-}" ]; then
    run_readonly ip -4 addr show dev "$default_iface"
  fi

  section "IPv6"
  run_readonly ip -6 -br addr

  section "tap/vnet interfaces"
  run_readonly ip -br link show type tun
  ip -br link | awk '$1 ~ /^(tap|vnet|tun|virbr|br)/ {print}' || true

  section "Proxmox"
  run_readonly pveversion
  run_readonly qm list
} > "$LOG_FILE" 2>&1

ln -sfn "$LOG_FILE" "${STATE_DIR}/latest-audit"
printf '%s\n' "$LOG_FILE"
