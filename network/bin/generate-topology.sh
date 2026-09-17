#!/usr/bin/env sh
set -eu

BASE_DIR="${WORM_NETWORK_BASE:-/opt/worm/network}"
# shellcheck disable=SC1091
. "$BASE_DIR/bin/common.sh"

OUT="$GENERATED_DIR/topology.txt"
CLOUD="$GENERATED_DIR/cloud.json"
ROBOT="$GENERATED_DIR/robot.json"

SUBNET="subnet"
VSWITCH_ID="id"
VLAN_ID="id"

if have jq && [ -f "$CLOUD" ]; then
  SUBNET="$(jq -r '[.networks[]?.subnets[]?.ip_range // .networks[]?.subnets[]?.network_zone // empty] | first // "subnet"' "$CLOUD" 2>/dev/null || printf 'subnet')"
  VSWITCH_ID="$(jq -r '[.networks[]?.vswitch_ids[]?] | first // "id"' "$CLOUD" 2>/dev/null || printf 'id')"
fi
if have jq && [ -f "$ROBOT" ]; then
  VLAN_ID="$(jq -r '[.vswitches[]?.vlan] | first // "id"' "$ROBOT" 2>/dev/null || printf 'id')"
fi

cat > "$OUT" <<EOF
INTERNET
 |
 +-- VPS OPNsense
 |    +-- WAN
 |    +-- private NIC
 |
 +-- Hetzner Cloud Network
      |
      +-- $SUBNET
      |
      +-- vSwitch link
           |
           +-- Robot vSwitch ${VSWITCH_ID}
                |
                +-- VLAN ${VLAN_ID}
                     |
                     +-- Dedicated
                          +-- enp9s0 PUBLIC
                          +-- enp9s0.${VLAN_ID} PRIVATE
EOF

echo "TOPOLOGY generated: $OUT"

