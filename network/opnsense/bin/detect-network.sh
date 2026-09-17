#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="/opt/worm-opnsense"
OUT_DIR="${BASE_DIR}/generated"
OUT_FILE="${OUT_DIR}/detected-network.env"

mkdir -p "$OUT_DIR"
umask 077

default_routes="$(ip -4 route show default 2>/dev/null || true)"
route_count="$(printf '%s\n' "$default_routes" | sed '/^[[:space:]]*$/d' | wc -l | tr -d ' ')"

HOST_INTERFACE=""
HETZNER_GATEWAY=""
HOST_MAIN_IPV4=""
HOST_MAIN_PREFIX=""
HOST_MAC=""
STATUS="REVIEW_REQUIRED"

if [ "$route_count" = "1" ]; then
  route="$default_routes"
  HOST_INTERFACE="$(printf '%s\n' "$route" | awk '{for (i=1;i<=NF;i++) if ($i=="dev") print $(i+1)}')"
  HETZNER_GATEWAY="$(printf '%s\n' "$route" | awk '{for (i=1;i<=NF;i++) if ($i=="via") print $(i+1)}')"

  if [ -n "$HOST_INTERFACE" ]; then
    addr_lines="$(ip -4 -o addr show scope global dev "$HOST_INTERFACE" 2>/dev/null || true)"
    addr_count="$(printf '%s\n' "$addr_lines" | sed '/^[[:space:]]*$/d' | wc -l | tr -d ' ')"
    if [ "$addr_count" = "1" ]; then
      cidr="$(printf '%s\n' "$addr_lines" | awk '{print $4}')"
      HOST_MAIN_IPV4="${cidr%/*}"
      HOST_MAIN_PREFIX="${cidr#*/}"
    fi
    HOST_MAC="$(cat "/sys/class/net/${HOST_INTERFACE}/address" 2>/dev/null || true)"
  fi
fi

if [ -n "$HOST_INTERFACE" ] && [ -n "$HOST_MAIN_IPV4" ] && [ -n "$HETZNER_GATEWAY" ]; then
  if python3 - "$HOST_MAIN_IPV4" "$HETZNER_GATEWAY" <<'PY'
import ipaddress
import sys

try:
    host = ipaddress.ip_address(sys.argv[1])
    gateway = ipaddress.ip_address(sys.argv[2])
except ValueError:
    raise SystemExit(1)

if host.version != 4 or gateway.version != 4:
    raise SystemExit(1)
if host.is_loopback or host.is_unspecified or host.is_multicast:
    raise SystemExit(1)
if gateway.is_loopback or gateway.is_unspecified or gateway.is_multicast:
    raise SystemExit(1)
PY
  then
    STATUS="DETECTED"
  fi
fi

{
  printf 'HOST_INTERFACE=%s\n' "$HOST_INTERFACE"
  printf 'HOST_MAIN_IPV4=%s\n' "$HOST_MAIN_IPV4"
  printf 'HOST_MAIN_PREFIX=%s\n' "$HOST_MAIN_PREFIX"
  printf 'HETZNER_GATEWAY=%s\n' "$HETZNER_GATEWAY"
  printf 'HOST_MAC=%s\n' "$HOST_MAC"
  printf 'NETWORK_DETECTION_STATUS=%s\n' "$STATUS"
} > "$OUT_FILE"

printf '%s\n' "$OUT_FILE"

