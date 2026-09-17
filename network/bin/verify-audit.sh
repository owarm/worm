#!/usr/bin/env sh
set -eu

BASE_DIR="${WORM_NETWORK_BASE:-/opt/worm/network}"
# shellcheck disable=SC1091
. "$BASE_DIR/bin/common.sh"

OUT="$GENERATED_DIR/verify.json"
DEDICATED="$GENERATED_DIR/dedicated.json"
CLOUD="$GENERATED_DIR/cloud.json"
ROBOT="$GENERATED_DIR/robot.json"
OPNSENSE="$GENERATED_DIR/opnsense.json"

if ! have jq; then
  write_status_json "$OUT" "PARTIAL" "jq is required for full consistency classification."
  echo "VERIFY complete: PARTIAL"
  exit 0
fi

jq -n \
  --slurpfile dedicated "$DEDICATED" \
  --slurpfile cloud "$CLOUD" \
  --slurpfile robot "$ROBOT" \
  --slurpfile opnsense "$OPNSENSE" '
  ($dedicated[0] // {}) as $d |
  ($cloud[0] // {}) as $c |
  ($robot[0] // {}) as $r |
  ($opnsense[0] // {}) as $o |
  {
    dedicated_found_on_robot: (($r.dedicated_servers // []) | length > 0),
    opnsense_found_on_cloud: ($c.opnsense_server != null),
    cloud_network_present: (($c.networks // []) | length > 0),
    vswitch_present: (($r.vswitches // []) | length > 0),
    network_vswitch_link_present: (($c.vswitch_links // []) | length > 0),
    vlan_id: (($r.vswitches // [] | map(.vlan) | map(select(. != null)) | first) // null),
    opnsense_private_nic_present: (($c.opnsense_private_ip // null) != null),
    private_subnet_present: (($c.networks // [] | map(.subnets // []) | flatten | length) > 0),
    public_interface: ($d.public_interface // null),
    public_ipv4: ($d.public_ipv4 // null),
    public_gateway: ($d.public_gateway // null),
    opnsense_api: ($o.api_status // "unknown")
  } as $checks |
  ($checks | [.dedicated_found_on_robot,.opnsense_found_on_cloud,.cloud_network_present,.vswitch_present,.network_vswitch_link_present,.opnsense_private_nic_present,.private_subnet_present] | map(select(. == true)) | length) as $ok_count |
  ($checks | [.dedicated_found_on_robot,.opnsense_found_on_cloud,.cloud_network_present,.vswitch_present,.network_vswitch_link_present,.opnsense_private_nic_present,.private_subnet_present] | length) as $total |
  {
    status: (
      if (($c.status // "") == "error" or ($r.status // "") == "error" or ($o.status // "") == "error") then "ERROR"
      elif $ok_count == $total then "READY"
      elif $ok_count == 0 then "NOT_CONFIGURED"
      else "PARTIAL"
      end
    ),
    read_only:true,
    checks:$checks
  }' > "$OUT"

echo "VERIFY complete: $(jq -r '.status' "$OUT")"

