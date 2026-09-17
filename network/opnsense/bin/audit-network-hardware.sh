#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="/opt/worm-opnsense"
LOG_DIR="${BASE_DIR}/logs"
STATE_DIR="${BASE_DIR}/state"
IFACE="${1:-enp9s0}"
STAMP="$(date +%Y%m%d-%H%M%S)"
LOG_FILE="${LOG_DIR}/network-hardware-${STAMP}.log"

mkdir -p "$LOG_DIR" "$STATE_DIR"
umask 077

section() {
  printf '\n## %s\n' "$1"
}

have() {
  command -v "$1" >/dev/null 2>&1
}

run_readonly() {
  printf '$ %s\n' "$*"
  "$@" 2>&1 || true
}

{
  printf 'Worm OPNsense network hardware audit\n'
  printf 'Timestamp: %s\n' "$(date -Is)"
  printf 'Interface: %s\n' "$IFACE"

  section "IP state"
  run_readonly ip -br link
  run_readonly ip -br addr
  run_readonly ip -4 route
  run_readonly ip -6 route
  run_readonly ip rule

  section "Route check"
  run_readonly ip route get 1.1.1.1

  section "Interface facts"
  if [ -e "/sys/class/net/${IFACE}" ]; then
    printf 'MAC=%s\n' "$(cat "/sys/class/net/${IFACE}/address" 2>/dev/null || true)"
    printf 'MTU=%s\n' "$(cat "/sys/class/net/${IFACE}/mtu" 2>/dev/null || true)"
    printf 'OPERSTATE=%s\n' "$(cat "/sys/class/net/${IFACE}/operstate" 2>/dev/null || true)"
    if [ -e "/sys/class/net/${IFACE}/device" ]; then
      printf 'PCI_PATH=%s\n' "$(readlink -f "/sys/class/net/${IFACE}/device" 2>/dev/null || true)"
      printf 'PCI_ADDRESS=%s\n' "$(basename "$(readlink -f "/sys/class/net/${IFACE}/device" 2>/dev/null || printf '')")"
      if [ -r "/sys/class/net/${IFACE}/device/driver/module/drivers" ]; then
        printf 'DRIVER_HINT=%s\n' "$(cat "/sys/class/net/${IFACE}/device/driver/module/drivers" 2>/dev/null || true)"
      fi
      if [ -e "/sys/class/net/${IFACE}/device/driver" ]; then
        printf 'DRIVER=%s\n' "$(basename "$(readlink -f "/sys/class/net/${IFACE}/device/driver" 2>/dev/null || printf '')")"
      fi
    else
      printf '/sys/class/net/%s/device absent\n' "$IFACE"
    fi
  else
    printf '/sys/class/net/%s absent\n' "$IFACE"
  fi

  section "ethtool"
  if have ethtool; then
    run_readonly ethtool -i "$IFACE"
    run_readonly ethtool "$IFACE"
  else
    printf 'ethtool absent\n'
  fi

  section "PCI inventory"
  if have lspci; then
    run_readonly lspci -nnk
  else
    printf 'lspci absent\n'
  fi
} > "$LOG_FILE" 2>&1

ln -sfn "$LOG_FILE" "${STATE_DIR}/latest-network-hardware-audit"
printf '%s\n' "$LOG_FILE"

