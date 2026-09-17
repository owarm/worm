#!/usr/bin/env sh
set -eu

BASE_DIR="${WORM_NETWORK_BASE:-/opt/worm/network}"
# shellcheck disable=SC1091
. "$BASE_DIR/bin/common.sh"
load_secrets

OUT="$GENERATED_DIR/opnsense.json"
API_STATUS="not_configured"
SSH_STATUS="not_configured"
API_DIR="$STATE_DIR/opnsense-api"
SSH_RAW="$STATE_DIR/opnsense-ssh.raw.txt"
mkdir -p "$API_DIR"

api_collect() {
  base="${OPNSENSE_URL%/}"
  NETRC="$(make_netrc "$(printf '%s' "$base" | sed 's#^https\?://##; s#/.*##; s#:.*##')" "$OPNSENSE_API_KEY" "$OPNSENSE_API_SECRET")"
  trap 'rm -f "$NETRC"' EXIT HUP INT TERM
  endpoints='
core_firmware_status /api/core/firmware/status
interfaces_overview /api/interfaces/overview/interfacesInfo
routes_search /api/routes/routes/searchRoute
firewall_aliases /api/firewall/alias/searchItem
firewall_rules /api/firewall/filter/searchRule
firewall_nat /api/firewall/nat/searchRule
wireguard_general /api/wireguard/general/get
'
  ok=0
  printf '%s\n' "$endpoints" | while read -r name path; do
    [ -n "${name:-}" ] || continue
    if curl_json --netrc-file "$NETRC" "$base$path" > "$API_DIR/$name.json"; then
      ok=$((ok + 1))
    else
      printf '{"status":"unavailable"}\n' > "$API_DIR/$name.json"
    fi
    printf '%s\n' "$ok" > "$API_DIR/.ok-count"
  done
}

if [ -n "${OPNSENSE_URL:-}" ] && [ -n "${OPNSENSE_API_KEY:-}" ] && [ -n "${OPNSENSE_API_SECRET:-}" ] && have curl; then
  if api_collect; then
    API_OK_COUNT="$(cat "$API_DIR/.ok-count" 2>/dev/null || printf '0')"
    if [ "${API_OK_COUNT:-0}" -gt 0 ]; then
      API_STATUS="ok"
    else
      API_STATUS="unavailable"
    fi
  else
    API_STATUS="error"
  fi
fi

if [ "$API_STATUS" != "ok" ] && [ -n "${OPNSENSE_SSH_HOST:-}" ] && have ssh; then
  SSH_STATUS="attempted"
  if ssh -o BatchMode=yes -o ConnectTimeout=5 -p "${OPNSENSE_SSH_PORT:-22}" "${OPNSENSE_SSH_USER:-root}@${OPNSENSE_SSH_HOST}" \
    'uname -a; opnsense-version; ifconfig; netstat -rn; sockstat -4 -l' > "$SSH_RAW" 2>&1; then
    SSH_STATUS="ok"
  else
    SSH_STATUS="unavailable"
  fi
fi

if have jq; then
  jq -n \
    --arg api "$API_STATUS" \
    --arg ssh "$SSH_STATUS" \
    --slurpfile firmware "$API_DIR/core_firmware_status.json" \
    --slurpfile interfaces "$API_DIR/interfaces_overview.json" \
    --slurpfile routes "$API_DIR/routes_search.json" \
    --slurpfile aliases "$API_DIR/firewall_aliases.json" \
    --slurpfile rules "$API_DIR/firewall_rules.json" \
    --slurpfile nat "$API_DIR/firewall_nat.json" \
    --slurpfile wireguard "$API_DIR/wireguard_general.json" \
    --rawfile ssh_raw "$SSH_RAW" '
    {
      status:(if $api == "ok" or $ssh == "ok" then "ok" else "missing_or_unavailable" end),
      read_only:true,
      api_status:$api,
      ssh_status:$ssh,
      version:($firmware[0] // null),
      interfaces:($interfaces[0] // null),
      routes:($routes[0] // null),
      firewall_aliases:($aliases[0] // null),
      firewall_rules:($rules[0] // null),
      nat:($nat[0] // null),
      wireguard:($wireguard[0] // null),
      ssh_read_only_output:$ssh_raw
    }' > "$OUT" 2>/dev/null || jq -n --arg api "$API_STATUS" --arg ssh "$SSH_STATUS" '{status:"partial",read_only:true,api_status:$api,ssh_status:$ssh}' > "$OUT"
else
  printf '{"status":"%s","read_only":true,"api_status":"%s","ssh_status":"%s"}\n' "partial" "$API_STATUS" "$SSH_STATUS" > "$OUT"
fi

echo "OPNSENSE audit complete: api=$API_STATUS ssh=$SSH_STATUS"

