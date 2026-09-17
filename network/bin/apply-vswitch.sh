#!/usr/bin/env sh
set -eu

BASE_DIR="${WORM_NETWORK_BASE:-/opt/worm/network}"
# shellcheck disable=SC1091
. "$BASE_DIR/bin/common.sh"

NETWORK_ENV="$CONFIG_DIR/network.env"
OUT="$GENERATED_DIR/vswitch-v003.json"
ROBOT_API="https://robot-ws.your-server.de"
CLOUD_API="https://api.hetzner.cloud/v1"

if [ -f "$SECRETS_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$SECRETS_FILE"
  set +a
fi

if [ -f "$NETWORK_ENV" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$NETWORK_ENV"
  set +a
else
  write_status_json "$OUT" "missing_config" "config/network.env is not configured."
  echo "ERROR: missing config/network.env" >&2
  exit 2
fi

NETWORK_NAME="${NETWORK_NAME:-worm-private}"
NETWORK_CIDR="${NETWORK_CIDR:-10.20.0.0/16}"
VSWITCH_NAME="${VSWITCH_NAME:-worm-private}"
VSWITCH_SUBNET_CIDR="${VSWITCH_SUBNET_CIDR:-10.20.1.0/24}"
NETWORK_ZONE="${NETWORK_ZONE:-eu-central}"
APPLY_CHANGES="${APPLY_CHANGES:-no}"

DRY_RUN=yes
if [ "$APPLY_CHANGES" = "yes" ]; then
  DRY_RUN=no
fi

need() {
  if ! have "$1"; then
    echo "ERROR: $1 is required." >&2
    exit 1
  fi
}

cloud_get() {
  path="$1"
  curl_json -H "Authorization: Bearer $HETZNER_CLOUD_TOKEN" \
    -H "Content-Type: application/json" \
    "$CLOUD_API$path"
}

cloud_post() {
  path="$1"
  data="$2"
  curl_json -X POST \
    -H "Authorization: Bearer $HETZNER_CLOUD_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$data" \
    "$CLOUD_API$path"
}

robot_get() {
  path="$1"
  curl_json --netrc-file "$NETRC" "$ROBOT_API$path"
}

robot_post_form() {
  path="$1"
  shift
  curl_json --netrc-file "$NETRC" -X POST "$ROBOT_API$path" "$@"
}

wait_cloud_action() {
  action_id="$1"
  tries=0
  while [ "$tries" -lt 30 ]; do
    cloud_get "/actions/$action_id" > "$STATE_DIR/cloud.action.$action_id.v003.json"
    action_status="$(jq -r '.action.status // "unknown"' "$STATE_DIR/cloud.action.$action_id.v003.json")"
    if [ "$action_status" = "success" ]; then
      return 0
    fi
    if [ "$action_status" = "error" ]; then
      return 1
    fi
    tries=$((tries + 1))
    sleep 2
  done
  return 1
}

json_out() {
  status="$1"
  ready="$2"
  message="$3"
  vswitch_id="${4:-}"
  vswitch_name="${5:-$VSWITCH_NAME}"
  vlan_id="${6:-}"
  dedicated_member="${7:-NO}"
  cloud_link="${8:-NO}"
  network_id="${9:-}"
  jq -n \
    --arg status "$status" \
    --arg ready "$ready" \
    --arg message "$message" \
    --arg dry_run "$DRY_RUN" \
    --arg vswitch_id "$vswitch_id" \
    --arg vswitch_name "$vswitch_name" \
    --arg vlan_id "$vlan_id" \
    --arg dedicated_member "$dedicated_member" \
    --arg cloud_link "$cloud_link" \
    --arg network_id "$network_id" \
    --arg subnet "$VSWITCH_SUBNET_CIDR" \
    'def maybe_null: if length > 0 then . else null end;
    {
      status:$status,
      dry_run:($dry_run == "yes"),
      message:$message,
      vswitch_id:($vswitch_id | maybe_null),
      vswitch_name:$vswitch_name,
      vlan_id:($vlan_id | maybe_null),
      dedicated_member:($dedicated_member == "YES"),
      cloud_link:($cloud_link == "YES"),
      cloud_network_id:($network_id | maybe_null),
      vswitch_subnet:$subnet,
      ready_for_dedicated_vlan:($ready == "YES")
    }' > "$OUT"
}

print_summary() {
  vswitch_id="$1"
  vswitch_name="$2"
  vlan_id="$3"
  dedicated_member="$4"
  cloud_link="$5"
  ready="$6"

  printf '=== WORM NETWORK V003 ===\n\n'
  printf 'VSWITCH:\nid=%s\nname=%s\nvlan=%s\n\n' "${vswitch_id:-UNKNOWN}" "${vswitch_name:-$VSWITCH_NAME}" "${vlan_id:-UNKNOWN}"
  printf 'DEDICATED MEMBER:\n%s\n\n' "$dedicated_member"
  printf 'CLOUD LINK:\n%s\n\n' "$cloud_link"
  printf 'VSWITCH SUBNET:\n%s\n\n' "$VSWITCH_SUBNET_CIDR"
  printf 'STATUS:\nREADY_FOR_DEDICATED_VLAN=%s\n' "$ready"
}

cidr_overlaps() {
  python3 - "$1" "$2" <<'PY'
import ipaddress
import sys

a = ipaddress.ip_network(sys.argv[1], strict=False)
b = ipaddress.ip_network(sys.argv[2], strict=False)
raise SystemExit(0 if a.overlaps(b) else 1)
PY
}

validate_config() {
  python3 - "$NETWORK_CIDR" "$VSWITCH_SUBNET_CIDR" <<'PY'
import ipaddress
import sys

network = ipaddress.ip_network(sys.argv[1], strict=False)
vswitch = ipaddress.ip_network(sys.argv[2], strict=False)
if not vswitch.subnet_of(network):
    raise SystemExit("VSWITCH_SUBNET_CIDR is not inside NETWORK_CIDR")
first = next(network.hosts(), None)
if first and first in vswitch:
    raise SystemExit("VSWITCH_SUBNET_CIDR must not contain the first IP of NETWORK_CIDR")
PY
}

detect_default_vlan() {
  if [ -f "$GENERATED_DIR/dedicated.json" ]; then
    jq -r '
      (.raw // "" | capture("(?m)^## ip -br link\n(?<links>(.|\n)*?)(^## |\\z)").links // "") |
      scan("(^|\\n)[^\\n.]+\\.(?<vlan>[0-9]+)@") |
      .vlan
    ' "$GENERATED_DIR/dedicated.json" | sed -n '1p'
  fi
}

need curl
need jq
need python3

if ! validation_error="$(validate_config 2>&1)"; then
  json_out "error" "NO" "$validation_error"
  print_summary "UNKNOWN" "$VSWITCH_NAME" "UNKNOWN" "NO" "NO" "NO"
  exit 2
fi

if [ -z "${HETZNER_ROBOT_USER:-}" ] || [ -z "${HETZNER_ROBOT_PASSWORD:-}" ]; then
  json_out "missing_config" "NO" "Hetzner Robot credentials are not configured."
  print_summary "UNKNOWN" "$VSWITCH_NAME" "UNKNOWN" "NO" "NO" "NO"
  exit 2
fi

if [ -z "${HETZNER_CLOUD_TOKEN:-}" ]; then
  json_out "missing_config" "NO" "HETZNER_CLOUD_TOKEN is not configured."
  print_summary "UNKNOWN" "$VSWITCH_NAME" "UNKNOWN" "NO" "NO" "NO"
  exit 2
fi

NETRC="$(make_netrc robot-ws.your-server.de "$HETZNER_ROBOT_USER" "$HETZNER_ROBOT_PASSWORD")"
trap 'rm -f "$NETRC"' EXIT HUP INT TERM

robot_servers_file="$STATE_DIR/robot.servers.v003.json"
robot_vswitch_file="$STATE_DIR/robot.vswitch.v003.json"
cloud_networks_file="$STATE_DIR/cloud.networks.v003.json"

robot_get "/server" > "$robot_servers_file"
if ! robot_get "/vswitch" > "$robot_vswitch_file"; then
  printf '[]\n' > "$robot_vswitch_file"
fi
cloud_get "/networks?per_page=50" > "$cloud_networks_file"

network_count="$(jq --arg name "$NETWORK_NAME" '[.networks[]? | select(.name == $name)] | length' "$cloud_networks_file")"
if [ "$network_count" -ne 1 ]; then
  json_out "error" "NO" "Cloud Network must exist exactly once before linking vSwitch."
  print_summary "UNKNOWN" "$VSWITCH_NAME" "UNKNOWN" "NO" "NO" "NO"
  exit 1
fi

network_id="$(jq -r --arg name "$NETWORK_NAME" '.networks[]? | select(.name == $name) | .id' "$cloud_networks_file")"
network_cidr="$(jq -r --argjson id "$network_id" '.networks[]? | select(.id == $id) | .ip_range' "$cloud_networks_file")"
if [ "$network_cidr" != "$NETWORK_CIDR" ]; then
  json_out "error" "NO" "Cloud Network CIDR does not match NETWORK_CIDR." "" "$VSWITCH_NAME" "" "NO" "NO" "$network_id"
  print_summary "UNKNOWN" "$VSWITCH_NAME" "UNKNOWN" "NO" "NO" "NO"
  exit 1
fi

dedicated_ip="$(jq -r '.public_ipv4 // "" | split("/") | .[0]' "$GENERATED_DIR/dedicated.json" 2>/dev/null || true)"
dedicated_number="$(jq -r --arg ip "$dedicated_ip" '
  [.[]? | (.server // .) | select((.server_ip // .main_ip // "") == $ip) | (.server_number // .number // empty)] |
  first // empty
' "$robot_servers_file")"
if [ -z "$dedicated_number" ]; then
  dedicated_number="$(jq -r '[.[]? | (.server // .) | (.server_number // .number // empty)] | first // empty' "$robot_servers_file")"
fi
if [ -z "$dedicated_number" ]; then
  json_out "error" "NO" "Could not identify current Robot Dedicated server." "" "$VSWITCH_NAME" "" "NO" "NO" "$network_id"
  print_summary "UNKNOWN" "$VSWITCH_NAME" "UNKNOWN" "NO" "NO" "NO"
  exit 1
fi

vswitch_count="$(jq --arg name "$VSWITCH_NAME" '[.[]? | (.vswitch // .) | select((.name // "") == $name and (.cancelled // false | not))] | length' "$robot_vswitch_file")"
if [ "$vswitch_count" -gt 1 ]; then
  json_out "error" "NO" "Multiple active Robot vSwitches match VSWITCH_NAME." "" "$VSWITCH_NAME" "" "NO" "NO" "$network_id"
  print_summary "UNKNOWN" "$VSWITCH_NAME" "UNKNOWN" "NO" "NO" "NO"
  exit 1
fi

vswitch_id="$(jq -r --arg name "$VSWITCH_NAME" '.[]? | (.vswitch // .) | select((.name // "") == $name and (.cancelled // false | not)) | .id' "$robot_vswitch_file")"
vlan_id="$(jq -r --arg name "$VSWITCH_NAME" '.[]? | (.vswitch // .) | select((.name // "") == $name and (.cancelled // false | not)) | .vlan' "$robot_vswitch_file")"

if [ -z "$vswitch_id" ]; then
  vlan_id="${VSWITCH_VLAN:-$(detect_default_vlan)}"
  vlan_id="${vlan_id:-4000}"
  if [ "$DRY_RUN" = "yes" ]; then
    json_out "dry_run" "NO" "Would create Robot vSwitch." "" "$VSWITCH_NAME" "$vlan_id" "NO" "NO" "$network_id"
    print_summary "UNKNOWN" "$VSWITCH_NAME" "$vlan_id" "NO" "NO" "NO"
    exit 0
  fi
  robot_post_form "/vswitch" --data-urlencode "name=$VSWITCH_NAME" --data-urlencode "vlan=$vlan_id" > "$STATE_DIR/robot.vswitch.create.v003.json"
  vswitch_id="$(jq -r '.id // .vswitch.id // empty' "$STATE_DIR/robot.vswitch.create.v003.json")"
  vlan_id="$(jq -r '.vlan // .vswitch.vlan // empty' "$STATE_DIR/robot.vswitch.create.v003.json")"
fi

vswitch_detail_file="$STATE_DIR/robot.vswitch.$vswitch_id.v003.json"
robot_get "/vswitch/$vswitch_id" > "$vswitch_detail_file"
vlan_id="$(jq -r '.vlan // .vswitch.vlan // empty' "$vswitch_detail_file")"

public_subnet_count="$(jq '[((.subnet // .vswitch.subnet // [])[]?)] | length' "$vswitch_detail_file")"
if [ "$public_subnet_count" -gt 0 ]; then
  json_out "error" "NO" "Robot vSwitch has public subnet assignments; refusing Cloud Network link." "$vswitch_id" "$VSWITCH_NAME" "$vlan_id" "NO" "NO" "$network_id"
  print_summary "$vswitch_id" "$VSWITCH_NAME" "$vlan_id" "NO" "NO" "NO"
  exit 1
fi

dedicated_member="$(jq --arg number "$dedicated_number" --arg ip "$dedicated_ip" '
  [((.server // .vswitch.server // [])[]?) |
    select(((.server_number // "" | tostring) == $number) or (($ip | length) > 0 and (.server_ip // "") == $ip))
  ] | length
' "$vswitch_detail_file")"

if [ "$dedicated_member" -eq 0 ]; then
  if [ "$DRY_RUN" = "yes" ]; then
    json_out "dry_run" "NO" "Would add current Dedicated server to vSwitch." "$vswitch_id" "$VSWITCH_NAME" "$vlan_id" "NO" "NO" "$network_id"
    print_summary "$vswitch_id" "$VSWITCH_NAME" "$vlan_id" "NO" "NO" "NO"
    exit 0
  fi
  robot_post_form "/vswitch/$vswitch_id/server" --data-urlencode "server[]=$dedicated_number" > "$STATE_DIR/robot.vswitch.server-add.v003.json"
  robot_get "/vswitch/$vswitch_id" > "$vswitch_detail_file"
fi

dedicated_member="$(jq --arg number "$dedicated_number" --arg ip "$dedicated_ip" '
  [((.server // .vswitch.server // [])[]?) |
    select(((.server_number // "" | tostring) == $number) or (($ip | length) > 0 and (.server_ip // "") == $ip))
  ] | length
' "$vswitch_detail_file")"
dedicated_member_status=NO
if [ "$dedicated_member" -gt 0 ]; then
  dedicated_member_status=YES
fi

subnets_json="$(jq -c --argjson id "$network_id" '.networks[]? | select(.id == $id) | (.subnets // [])' "$cloud_networks_file")"
cloud_link_count="$(printf '%s\n' "$subnets_json" | jq --arg cidr "$VSWITCH_SUBNET_CIDR" --argjson vswitch_id "$vswitch_id" '
  [.[] | select(.type == "vswitch" and .ip_range == $cidr and .vswitch_id == $vswitch_id)] | length
')"

overlap_count=0
for subnet in $(printf '%s\n' "$subnets_json" | jq -r --arg cidr "$VSWITCH_SUBNET_CIDR" '.[] | select(.ip_range != $cidr) | .ip_range'); do
  if cidr_overlaps "$VSWITCH_SUBNET_CIDR" "$subnet"; then
    overlap_count=$((overlap_count + 1))
  fi
done

if [ "$overlap_count" -gt 0 ]; then
  json_out "error" "NO" "VSWITCH_SUBNET_CIDR overlaps an existing Cloud Network subnet." "$vswitch_id" "$VSWITCH_NAME" "$vlan_id" "$dedicated_member_status" "NO" "$network_id"
  print_summary "$vswitch_id" "$VSWITCH_NAME" "$vlan_id" "$dedicated_member_status" "NO" "NO"
  exit 1
fi

cloud_link_status=NO
if [ "$cloud_link_count" -gt 0 ]; then
  cloud_link_status=YES
else
  if [ "$DRY_RUN" = "yes" ]; then
    json_out "dry_run" "NO" "Would add Cloud Network vSwitch subnet link." "$vswitch_id" "$VSWITCH_NAME" "$vlan_id" "$dedicated_member_status" "NO" "$network_id"
    print_summary "$vswitch_id" "$VSWITCH_NAME" "$vlan_id" "$dedicated_member_status" "NO" "NO"
    exit 0
  fi
  link_payload="$(jq -n --arg type "vswitch" --arg zone "$NETWORK_ZONE" --arg ip_range "$VSWITCH_SUBNET_CIDR" --argjson vswitch_id "$vswitch_id" '{type:$type,network_zone:$zone,ip_range:$ip_range,vswitch_id:$vswitch_id}')"
  cloud_post "/networks/$network_id/actions/add_subnet" "$link_payload" > "$STATE_DIR/cloud.vswitch-subnet.add.v003.json"
  action_id="$(jq -r '.action.id // empty' "$STATE_DIR/cloud.vswitch-subnet.add.v003.json")"
  if [ -n "$action_id" ]; then
    if ! wait_cloud_action "$action_id"; then
      json_out "error" "NO" "Cloud vSwitch subnet link action did not complete successfully." "$vswitch_id" "$VSWITCH_NAME" "$vlan_id" "$dedicated_member_status" "NO" "$network_id"
      print_summary "$vswitch_id" "$VSWITCH_NAME" "$vlan_id" "$dedicated_member_status" "NO" "NO"
      exit 1
    fi
  fi
  cloud_get "/networks?per_page=50" > "$cloud_networks_file"
  cloud_link_count="$(jq --argjson id "$network_id" --arg cidr "$VSWITCH_SUBNET_CIDR" --argjson vswitch_id "$vswitch_id" '
    [.networks[]? | select(.id == $id) | (.subnets // [])[] | select(.type == "vswitch" and .ip_range == $cidr and .vswitch_id == $vswitch_id)] | length
  ' "$cloud_networks_file")"
  if [ "$cloud_link_count" -gt 0 ]; then
    cloud_link_status=YES
  fi
fi

ready=NO
status=partial
message="vSwitch link is incomplete."
if [ "$dedicated_member_status" = "YES" ] && [ "$cloud_link_status" = "YES" ]; then
  ready=YES
  status=ok
  message="Cloud Network, Robot vSwitch, and Dedicated membership are linked."
fi

json_out "$status" "$ready" "$message" "$vswitch_id" "$VSWITCH_NAME" "$vlan_id" "$dedicated_member_status" "$cloud_link_status" "$network_id"
print_summary "$vswitch_id" "$VSWITCH_NAME" "$vlan_id" "$dedicated_member_status" "$cloud_link_status" "$ready"
