#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="/opt/worm/terminallm/config/env"

ok() { printf '[OK] %s\n' "$1"; }
info() { printf '[INFO] %s\n' "$1"; }
warn() { printf '[WARN] %s\n' "$1"; }

configured() {
  [[ -f "${ENV_FILE}" ]] && grep -Eq '^[[:space:]]*OPENAI_API_KEY=.+$' "${ENV_FILE}"
}

mkdir -p "${ENV_FILE%/*}"
if [[ ! -f "${ENV_FILE}" ]]; then
  install -m 0600 /dev/null "${ENV_FILE}"
fi
chmod 0600 "${ENV_FILE}"

if configured; then
  ok "OPENAI_API_KEY configured"
else
  warn "OPENAI_API_KEY is not configured"
fi

if [[ ! -t 0 ]]; then
  info "configure OPENAI_API_KEY manually in:"
  printf '       %s\n' "${ENV_FILE}"
  exit 0
fi

printf 'Enter OPENAI_API_KEY (input hidden, empty keeps current value): '
IFS= read -r -s key
printf '\n'

if [[ -z "${key}" ]]; then
  info "no change"
  exit 0
fi

tmp="$(mktemp)"
trap 'rm -f "${tmp}"' EXIT
printf 'OPENAI_API_KEY=%s\n' "${key}" >"${tmp}"
install -m 0600 "${tmp}" "${ENV_FILE}"
ok "OPENAI_API_KEY configured"
