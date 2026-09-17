#!/usr/bin/env sh
set -eu

BASE_DIR="${WORM_NETWORK_BASE:-/opt/worm/network}"
# shellcheck disable=SC1091
. "$BASE_DIR/bin/common.sh"
load_secrets

OUT="$GENERATED_DIR/robot.json"
API="https://robot-ws.your-server.de"

if [ -z "${HETZNER_ROBOT_USER:-}" ] || [ -z "${HETZNER_ROBOT_PASSWORD:-}" ]; then
  write_status_json "$OUT" "missing_config" "Hetzner Robot credentials are not configured."
  echo "ROBOT audit skipped: missing credentials"
  exit 0
fi

if ! have curl; then
  write_status_json "$OUT" "error" "curl is required."
  echo "ROBOT audit error: curl missing"
  exit 1
fi

NETRC="$(make_netrc robot-ws.your-server.de "$HETZNER_ROBOT_USER" "$HETZNER_ROBOT_PASSWORD")"
trap 'rm -f "$NETRC"' EXIT HUP INT TERM

SERVERS_FILE="$STATE_DIR/robot.servers.json"
VSWITCH_FILE="$STATE_DIR/robot.vswitch.json"

robot_get() {
  path="$1"
  curl_json --netrc-file "$NETRC" "$API$path"
}

robot_get "/server" > "$SERVERS_FILE" || {
  write_status_json "$OUT" "error" "Hetzner Robot server request failed."
  echo "ROBOT audit error: server request failed"
  exit 1
}

if ! robot_get "/vswitch" > "$VSWITCH_FILE"; then
  printf '[]\n' > "$VSWITCH_FILE"
fi

if have jq; then
  jq -n \
    --slurpfile servers "$SERVERS_FILE" \
    --slurpfile vswitch "$VSWITCH_FILE" '
    ($servers[0] // []) as $server_list |
    ($vswitch[0] // []) as $vswitch_list |
    {
      status:"ok",
      read_only:true,
      dedicated_servers: $server_list | map(.server // .),
      server_numbers: $server_list | map((.server // .).server_number // (.server // .).number // null),
      main_ipv4: $server_list | map((.server // .).server_ip // (.server // .).main_ip // null),
      server_ips: $server_list | map({server_number:((.server // .).server_number // (.server // .).number // null), ips:((.server // .).server_ips // (.server // .).ips // [])}),
      vswitches: $vswitch_list | map(.vswitch // .) | map({
        id:(.id // .vswitch_id // null),
        name:(.name // null),
        vlan:(.vlan // .vlan_id // null),
        server:(.server // .servers // []),
        subnet:(.subnet // .subnets // [])
      })
    }' > "$OUT"
else
  printf '{"status":"ok","read_only":true,"servers_file":"%s","vswitch_file":"%s"}\n' "$SERVERS_FILE" "$VSWITCH_FILE" > "$OUT"
fi

if have jq; then
  server_count="$(jq '.dedicated_servers | length' "$OUT")"
  vswitch_count="$(jq '.vswitches | length' "$OUT")"
  echo "ROBOT audit complete: dedicated=$server_count vswitches=$vswitch_count"
else
  echo "ROBOT audit complete"
fi

