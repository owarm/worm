#!/usr/bin/env sh
set -eu

BASE_DIR="${WORM_NETWORK_BASE:-/opt/worm/network}"
# shellcheck disable=SC1091
. "$BASE_DIR/bin/common.sh"

NETWORK_ENV="$CONFIG_DIR/network.env"
OUT="$GENERATED_DIR/cloud-network-v002.json"
API="https://api.hetzner.cloud/v1"

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
CLOUD_SUBNET_CIDR="${CLOUD_SUBNET_CIDR:-10.20.0.0/24}"
VSWITCH_SUBNET_CIDR="${VSWITCH_SUBNET_CIDR:-10.20.1.0/24}"
NETWORK_ZONE="${NETWORK_ZONE:-eu-central}"
OPNSENSE_PRIVATE_IP="${OPNSENSE_PRIVATE_IP:-10.20.0.2}"
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

api_get() {
  path="$1"
  curl_json -H "Authorization: Bearer $HETZNER_CLOUD_TOKEN" \
    -H "Content-Type: application/json" \
    "$API$path"
}

api_post() {
  path="$1"
  data="$2"
  curl_json -X POST \
    -H "Authorization: Bearer $HETZNER_CLOUD_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$data" \
    "$API$path"
}

wait_action() {
  action_id="$1"
  tries=0
  while [ "$tries" -lt 30 ]; do
    api_get "/actions/$action_id" > "$STATE_DIR/cloud.action.$action_id.v002.json"
    action_status="$(jq -r '.action.status // "unknown"' "$STATE_DIR/cloud.action.$action_id.v002.json")"
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
  network_id="${4:-}"
  network_name="${5:-$NETWORK_NAME}"
  cloud_subnet="${6:-$CLOUD_SUBNET_CIDR}"
  subnet_id="${7:-}"
  server_id="${8:-}"
  private_ip="${9:-}"
  jq -n \
    --arg status "$status" \
    --arg ready "$ready" \
    --arg message "$message" \
    --arg network_id "$network_id" \
    --arg network_name "$network_name" \
    --arg cloud_subnet "$cloud_subnet" \
    --arg subnet_id "$subnet_id" \
    --arg server_id "$server_id" \
    --arg private_ip "$private_ip" \
    --arg dry_run "$DRY_RUN" \
    'def maybe_null: if length > 0 then . else null end;
    {
      status:$status,
      dry_run:($dry_run == "yes"),
      message:$message,
      network_id:($network_id | maybe_null),
      network_name:$network_name,
      cloud_subnet:$cloud_subnet,
      subnet_id:($subnet_id | maybe_null),
      opnsense_server_id:($server_id | maybe_null),
      opnsense_private_ip_actual:($private_ip | maybe_null),
      ready_for_vswitch_link:($ready == "YES")
    }' > "$OUT"
}

print_summary() {
  network_ref="$1"
  subnet_ref="$2"
  server_id="$3"
  private_ip="$4"
  ready="$5"

  printf '=== WORM NETWORK V002 ===\n\n'
  printf 'NETWORK:\n%s\n\n' "$network_ref"
  printf 'CLOUD SUBNET:\n%s\n\n' "$subnet_ref"
  printf 'OPNSENSE:\nserver=%s\nprivate_ip=%s\n\n' "${server_id:-UNKNOWN}" "${private_ip:-UNKNOWN}"
  printf 'STATUS:\nREADY_FOR_VSWITCH_LINK=%s\n' "$ready"
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
  python3 - "$NETWORK_CIDR" "$CLOUD_SUBNET_CIDR" "$VSWITCH_SUBNET_CIDR" "$OPNSENSE_PRIVATE_IP" <<'PY'
import ipaddress
import sys

network = ipaddress.ip_network(sys.argv[1], strict=False)
cloud = ipaddress.ip_network(sys.argv[2], strict=False)
vswitch = ipaddress.ip_network(sys.argv[3], strict=False)
opnsense_ip = ipaddress.ip_address(sys.argv[4])

if not cloud.subnet_of(network):
    raise SystemExit("CLOUD_SUBNET_CIDR is not inside NETWORK_CIDR")
if not vswitch.subnet_of(network):
    raise SystemExit("VSWITCH_SUBNET_CIDR is not inside NETWORK_CIDR")
if cloud.overlaps(vswitch):
    raise SystemExit("CLOUD_SUBNET_CIDR overlaps VSWITCH_SUBNET_CIDR")
if opnsense_ip not in cloud:
    raise SystemExit("OPNSENSE_PRIVATE_IP is not inside CLOUD_SUBNET_CIDR")
PY
}

need curl
need jq
need python3

if ! validation_error="$(validate_config 2>&1)"; then
  json_out "error" "NO" "$validation_error"
  print_summary "$NETWORK_NAME" "$CLOUD_SUBNET_CIDR" "UNKNOWN" "UNKNOWN" "NO"
  exit 2
fi

if [ -z "${HETZNER_CLOUD_TOKEN:-}" ]; then
  json_out "missing_config" "NO" "HETZNER_CLOUD_TOKEN is not configured."
  print_summary "$NETWORK_NAME" "$CLOUD_SUBNET_CIDR" "UNKNOWN" "UNKNOWN" "NO"
  exit 2
fi

networks_file="$STATE_DIR/cloud.networks.v002.json"
servers_file="$STATE_DIR/cloud.servers.v002.json"

api_get "/networks?per_page=50" > "$networks_file"
api_get "/servers?per_page=50" > "$servers_file"

network_count="$(jq --arg name "$NETWORK_NAME" '[.networks[]? | select(.name == $name)] | length' "$networks_file")"
if [ "$network_count" -gt 1 ]; then
  json_out "error" "NO" "Multiple Hetzner Cloud networks match NETWORK_NAME."
  print_summary "$NETWORK_NAME" "$CLOUD_SUBNET_CIDR" "UNKNOWN" "UNKNOWN" "NO"
  exit 1
fi

network_id="$(jq -r --arg name "$NETWORK_NAME" '.networks[]? | select(.name == $name) | .id' "$networks_file")"

if [ -z "$network_id" ]; then
  if [ "$DRY_RUN" = "yes" ]; then
    json_out "dry_run" "NO" "Would create Hetzner Cloud network." "" "$NETWORK_NAME" "$CLOUD_SUBNET_CIDR" "" "" ""
    print_summary "$NETWORK_NAME (would create)" "$CLOUD_SUBNET_CIDR" "UNKNOWN" "UNKNOWN" "NO"
    exit 0
  fi
  create_payload="$(jq -n --arg name "$NETWORK_NAME" --arg ip_range "$NETWORK_CIDR" '{name:$name,ip_range:$ip_range}')"
  api_post "/networks" "$create_payload" > "$STATE_DIR/cloud.network.create.v002.json"
  action_id="$(jq -r '.action.id // empty' "$STATE_DIR/cloud.network.create.v002.json")"
  if [ -n "$action_id" ]; then
    if ! wait_action "$action_id"; then
      json_out "error" "NO" "Network create action did not complete successfully." "$network_id" "$NETWORK_NAME"
      print_summary "${network_id:-$NETWORK_NAME}/$NETWORK_NAME" "$CLOUD_SUBNET_CIDR" "UNKNOWN" "UNKNOWN" "NO"
      exit 1
    fi
  fi
  network_id="$(jq -r '.network.id' "$STATE_DIR/cloud.network.create.v002.json")"
  api_get "/networks?per_page=50" > "$networks_file"
fi

actual_cidr="$(jq -r --argjson id "$network_id" '.networks[]? | select(.id == $id) | .ip_range' "$networks_file")"
if [ "$actual_cidr" != "$NETWORK_CIDR" ]; then
  json_out "error" "NO" "Existing network CIDR does not match NETWORK_CIDR." "$network_id" "$NETWORK_NAME"
  print_summary "$network_id/$NETWORK_NAME" "$CLOUD_SUBNET_CIDR" "UNKNOWN" "UNKNOWN" "NO"
  exit 1
fi

subnets_json="$(jq -c --argjson id "$network_id" '.networks[]? | select(.id == $id) | (.subnets // [])' "$networks_file")"
cloud_subnet_present="$(printf '%s\n' "$subnets_json" | jq --arg cidr "$CLOUD_SUBNET_CIDR" '[.[] | select(.type == "cloud" and .ip_range == $cidr)] | length')"

overlap_count=0
for subnet in $(printf '%s\n' "$subnets_json" | jq -r --arg cidr "$CLOUD_SUBNET_CIDR" '.[] | select(.ip_range != $cidr) | .ip_range'); do
  if cidr_overlaps "$CLOUD_SUBNET_CIDR" "$subnet"; then
    overlap_count=$((overlap_count + 1))
  fi
done

if [ "$overlap_count" -gt 0 ]; then
  json_out "error" "NO" "CLOUD_SUBNET_CIDR overlaps an existing subnet." "$network_id" "$NETWORK_NAME"
  print_summary "$network_id/$NETWORK_NAME" "$CLOUD_SUBNET_CIDR" "UNKNOWN" "UNKNOWN" "NO"
  exit 1
fi

if [ "$cloud_subnet_present" -eq 0 ]; then
  if [ "$DRY_RUN" = "yes" ]; then
    json_out "dry_run" "NO" "Would add cloud subnet." "$network_id" "$NETWORK_NAME" "$CLOUD_SUBNET_CIDR" "$network_id:$CLOUD_SUBNET_CIDR"
    print_summary "$network_id/$NETWORK_NAME" "$CLOUD_SUBNET_CIDR (would add)" "UNKNOWN" "UNKNOWN" "NO"
    exit 0
  fi
  subnet_payload="$(jq -n --arg type "cloud" --arg zone "$NETWORK_ZONE" --arg ip_range "$CLOUD_SUBNET_CIDR" '{type:$type,network_zone:$zone,ip_range:$ip_range}')"
  api_post "/networks/$network_id/actions/add_subnet" "$subnet_payload" > "$STATE_DIR/cloud.subnet.add.v002.json"
  action_id="$(jq -r '.action.id // empty' "$STATE_DIR/cloud.subnet.add.v002.json")"
  if [ -n "$action_id" ]; then
    if ! wait_action "$action_id"; then
      json_out "error" "NO" "Cloud subnet add action did not complete successfully." "$network_id" "$NETWORK_NAME" "$CLOUD_SUBNET_CIDR" "$network_id:$CLOUD_SUBNET_CIDR"
      print_summary "$network_id/$NETWORK_NAME" "$CLOUD_SUBNET_CIDR" "UNKNOWN" "UNKNOWN" "NO"
      exit 1
    fi
  fi
  api_get "/networks?per_page=50" > "$networks_file"
fi

server_id="$(jq -r '
  [.servers[]? | select((.name // "" | test("opn|sense|firewall"; "i")) or ((.labels // {}) | tostring | test("opn|sense|firewall"; "i")))] |
  first |
  .id // empty
' "$servers_file")"

if [ -z "$server_id" ]; then
  json_out "error" "NO" "Could not identify OPNsense server from v001 heuristic." "$network_id" "$NETWORK_NAME" "$CLOUD_SUBNET_CIDR" "$network_id:$CLOUD_SUBNET_CIDR"
  print_summary "$network_id/$NETWORK_NAME" "$CLOUD_SUBNET_CIDR" "UNKNOWN" "UNKNOWN" "NO"
  exit 1
fi

attached="$(jq --argjson server_id "$server_id" --argjson network_id "$network_id" '
  [.servers[]? | select(.id == $server_id) | (.private_net // [])[] | select(.network == $network_id)] | length
' "$servers_file")"

if [ "$attached" -eq 0 ]; then
  if [ "$DRY_RUN" = "yes" ]; then
    json_out "dry_run" "NO" "Would attach OPNsense server to network." "$network_id" "$NETWORK_NAME" "$CLOUD_SUBNET_CIDR" "$network_id:$CLOUD_SUBNET_CIDR" "$server_id" "$OPNSENSE_PRIVATE_IP"
    print_summary "$network_id/$NETWORK_NAME" "$CLOUD_SUBNET_CIDR" "$server_id" "$OPNSENSE_PRIVATE_IP (would request)" "NO"
    exit 0
  fi
  attach_payload="$(jq -n --argjson network "$network_id" --arg ip "$OPNSENSE_PRIVATE_IP" '{network:$network,ip:$ip}')"
  if api_post "/servers/$server_id/actions/attach_to_network" "$attach_payload" > "$STATE_DIR/cloud.attach-opnsense.v002.json"; then
    :
  else
    attach_payload="$(jq -n --argjson network "$network_id" '{network:$network}')"
    api_post "/servers/$server_id/actions/attach_to_network" "$attach_payload" > "$STATE_DIR/cloud.attach-opnsense.v002.json"
  fi
  action_id="$(jq -r '.action.id // empty' "$STATE_DIR/cloud.attach-opnsense.v002.json")"
  if [ -n "$action_id" ]; then
    if ! wait_action "$action_id"; then
      json_out "error" "NO" "OPNsense attach action did not complete successfully." "$network_id" "$NETWORK_NAME" "$CLOUD_SUBNET_CIDR" "$network_id:$CLOUD_SUBNET_CIDR" "$server_id"
      print_summary "$network_id/$NETWORK_NAME" "$CLOUD_SUBNET_CIDR" "$server_id" "UNKNOWN" "NO"
      exit 1
    fi
  fi
  api_get "/servers?per_page=50" > "$servers_file"
fi

private_ip="$(jq -r --argjson server_id "$server_id" --argjson network_id "$network_id" '
  [.servers[]? | select(.id == $server_id) | (.private_net // [])[] | select(.network == $network_id) | .ip] |
  first // empty
' "$servers_file")"

ready=NO
status=partial
message="OPNsense server is not attached to the cloud network."
if [ -n "$private_ip" ]; then
  ready=YES
  status=ok
  message="Cloud network and OPNsense attachment are present."
fi

json_out "$status" "$ready" "$message" "$network_id" "$NETWORK_NAME" "$CLOUD_SUBNET_CIDR" "$network_id:$CLOUD_SUBNET_CIDR" "$server_id" "$private_ip"
print_summary "$network_id/$NETWORK_NAME" "$CLOUD_SUBNET_CIDR" "$server_id" "${private_ip:-UNKNOWN}" "$ready"
