#!/usr/bin/env sh
set -eu

BASE_DIR="${WORM_NETWORK_BASE:-/opt/worm/network}"
# shellcheck disable=SC1091
. "$BASE_DIR/bin/common.sh"
load_secrets

OUT="$GENERATED_DIR/cloud.json"
API="https://api.hetzner.cloud/v1"

if [ -z "${HETZNER_CLOUD_TOKEN:-}" ]; then
  write_status_json "$OUT" "missing_config" "HETZNER_CLOUD_TOKEN is not configured."
  echo "CLOUD audit skipped: missing token"
  exit 0
fi

if ! have curl; then
  write_status_json "$OUT" "error" "curl is required."
  echo "CLOUD audit error: curl missing"
  exit 1
fi

SERVERS_FILE="$STATE_DIR/cloud.servers.json"
NETWORKS_FILE="$STATE_DIR/cloud.networks.json"

cloud_get() {
  path="$1"
  curl_json -H "Authorization: Bearer $HETZNER_CLOUD_TOKEN" -H "Content-Type: application/json" "$API$path"
}

cloud_get "/servers?per_page=50" > "$SERVERS_FILE" || {
  write_status_json "$OUT" "error" "Hetzner Cloud servers request failed."
  echo "CLOUD audit error: servers request failed"
  exit 1
}
cloud_get "/networks?per_page=50" > "$NETWORKS_FILE" || {
  write_status_json "$OUT" "error" "Hetzner Cloud networks request failed."
  echo "CLOUD audit error: networks request failed"
  exit 1
}

if have jq; then
  jq -n \
    --slurpfile servers "$SERVERS_FILE" \
    --slurpfile networks "$NETWORKS_FILE" '
    ($servers[0].servers // []) as $server_list |
    ($networks[0].networks // []) as $network_list |
    ($server_list | map(select((.name // "" | test("opn|sense|firewall"; "i")) or ((.labels // {}) | tostring | test("opn|sense|firewall"; "i")))) | first) as $opn |
    {
      status:"ok",
      read_only:true,
      servers: $server_list | map({
        id,name,status,
        public_ipv4:(.public_net.ipv4.ip // null),
        public_ipv6:(.public_net.ipv6.ip // null),
        private_networks:(.private_net // [])
      }),
      server_names: $server_list | map(.name),
      server_ids: $server_list | map(.id),
      networks: $network_list | map({
        id,name,ip_range,
        subnets:(.subnets // []),
        routes:(.routes // []),
        servers:(.servers // []),
        vswitch_subnets:((.subnets // []) | map(select(.type == "vswitch"))),
        vswitch_ids:((.subnets // []) | map(select(.type == "vswitch") | .vswitch_id) | unique)
      }),
      opnsense_server: (if $opn then {id:$opn.id,name:$opn.name,public_ipv4:($opn.public_net.ipv4.ip // null),private_net:($opn.private_net // [])} else null end),
      opnsense_private_ip: (if $opn then (($opn.private_net // []) | map(.ip) | first) else null end),
      vswitch_links: ($network_list | map({network_id:.id,network_name:.name,subnets:((.subnets // []) | map(select(.type == "vswitch")))}) | map(select((.subnets | length) > 0)))
    }' > "$OUT"
else
  printf '{"status":"ok","read_only":true,"servers_file":"%s","networks_file":"%s"}\n' "$SERVERS_FILE" "$NETWORKS_FILE" > "$OUT"
fi

if have jq; then
  server_count="$(jq '.servers | length' "$OUT")"
  network_count="$(jq '.networks | length' "$OUT")"
  opn_name="$(jq -r '.opnsense_server.name // "NONE"' "$OUT")"
  echo "CLOUD audit complete: servers=$server_count networks=$network_count opnsense=$opn_name"
else
  echo "CLOUD audit complete"
fi

