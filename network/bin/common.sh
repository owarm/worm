#!/usr/bin/env sh
set -eu

BASE_DIR="${WORM_NETWORK_BASE:-/opt/worm/network}"
CONFIG_DIR="$BASE_DIR/config"
GENERATED_DIR="$BASE_DIR/generated"
LOG_DIR="$BASE_DIR/logs"
STATE_DIR="$BASE_DIR/state"
SECRETS_FILE="$CONFIG_DIR/secrets.env"

umask 077
mkdir -p "$GENERATED_DIR" "$LOG_DIR" "$STATE_DIR"

load_secrets() {
  if [ -f "$SECRETS_FILE" ]; then
    set -a
    # shellcheck disable=SC1090
    . "$SECRETS_FILE"
    set +a
  fi
  APPLY_CHANGES="${APPLY_CHANGES:-no}"
  if [ "$APPLY_CHANGES" != "no" ]; then
    echo "ERROR: APPLY_CHANGES must remain no for this read-only audit." >&2
    exit 2
  fi
}

have() {
  command -v "$1" >/dev/null 2>&1
}

json_escape() {
  if have jq; then
    jq -Rs .
  else
    sed 's/\\/\\\\/g; s/"/\\"/g; s/$/\\n/' | tr -d '\n' | sed 's/^/"/; s/\\n$/"/'
  fi
}

run_capture() {
  label="$1"
  shift
  printf '## %s\n' "$label"
  if "$@" 2>&1; then
    :
  else
    printf 'command_failed=%s\n' "$label"
  fi
}

write_status_json() {
  file="$1"
  status="$2"
  message="$3"
  if have jq; then
    jq -n --arg status "$status" --arg message "$message" \
      '{status:$status,message:$message,read_only:true}'
  else
    esc_status=$(printf '%s' "$status" | json_escape)
    esc_message=$(printf '%s' "$message" | json_escape)
    printf '{"status":%s,"message":%s,"read_only":true}\n' "$esc_status" "$esc_message"
  fi > "$file"
}

curl_json() {
  curl -fsS "$@"
}

make_netrc() {
  machine="$1"
  login="$2"
  password="$3"
  tmp="${TMPDIR:-/tmp}/worm-network-netrc.$$.$machine"
  umask 077
  {
    printf 'machine %s\n' "$machine"
    printf '  login %s\n' "$login"
    printf '  password %s\n' "$password"
  } > "$tmp"
  printf '%s\n' "$tmp"
}

