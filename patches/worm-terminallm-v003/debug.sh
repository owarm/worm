#!/usr/bin/env bash
set -euo pipefail

ROOT="/opt/worm"
CONFIG_DIR="${ROOT}/terminallm/config"
CONFIG_FILE="${CONFIG_DIR}/config.yaml"
ENV_FILE="${CONFIG_DIR}/env"
XDG_DIR="${ROOT}/terminallm/xdg"
XDG_CONFIG="${XDG_DIR}/term-llm/config.yaml"
WRAPPER="${ROOT}/terminallm/bin/worm-llm"
RUNTIME_BIN="${ROOT}/terminallm/runtime/bin/term-llm"
STATE_V002="${ROOT}/terminallm/runtime/install-state"
SYMLINK="/usr/local/bin/term-llm"

ok() { printf '[OK] %s\n' "$1"; }
info() { printf '[INFO] %s\n' "$1"; }
warn() { printf '[WARN] %s\n' "$1"; }
error() { printf '[ERROR] %s\n' "$1"; }

status=0

version_of() {
  local out
  out="$(term-llm version 2>/dev/null || true)"
  if [[ "${out}" =~ ([0-9]+(\.[0-9]+)+) ]]; then
    printf '%s\n' "${BASH_REMATCH[1]}"
  else
    printf 'unknown\n'
  fi
}

secret_configured() {
  if [[ -n "${OPENAI_API_KEY:-}" ]]; then
    return 0
  fi
  [[ -f "${ENV_FILE}" ]] && grep -Eq '^[[:space:]]*OPENAI_API_KEY=.+$' "${ENV_FILE}"
}

secret_not_staged() {
  if git -C "${ROOT}" diff --cached --name-only -- terminallm/config/env | grep -q '^terminallm/config/env$'; then
    return 1
  fi
  return 0
}

if command -v term-llm >/dev/null 2>&1; then
  info "term-llm path: $(command -v term-llm)"
  ok "term-llm: $(version_of)"
else
  error "term-llm not found"
  status=1
fi

if [[ -x "${RUNTIME_BIN}" ]]; then ok "runtime"; else error "runtime missing"; status=1; fi
if [[ -x "${WRAPPER}" ]]; then ok "wrapper"; else error "wrapper missing"; status=1; fi

if [[ -f "${CONFIG_FILE}" ]]; then
  info "config location: ${CONFIG_FILE}"
  if XDG_CONFIG_HOME="${XDG_DIR}" term-llm config >/dev/null; then ok "config parsing"; else error "config parsing failed"; status=1; fi
  if grep -q '^default_provider:[[:space:]]*openai' "${CONFIG_FILE}" && grep -q '^[[:space:]]*openai:' "${CONFIG_FILE}"; then
    ok "provider configuration"
  else
    error "provider configuration missing"
    status=1
  fi
else
  error "config missing"
  status=1
fi

if [[ -L "${XDG_CONFIG}" ]] && [[ "$(readlink "${XDG_CONFIG}")" == "${CONFIG_FILE}" ]]; then
  ok "XDG_CONFIG_HOME target"
else
  warn "XDG config symlink missing or unexpected"
fi
info "XDG_CONFIG_HOME: ${XDG_DIR}"

if [[ -f "${ENV_FILE}" ]]; then
  ok "env file"
  perms="$(stat -c '%a' "${ENV_FILE}" 2>/dev/null || stat -f '%Lp' "${ENV_FILE}")"
  if [[ "${perms}" == "600" ]]; then ok "env mode: 600"; else error "env mode: ${perms}"; status=1; fi
else
  warn "env file missing"
fi

if secret_configured; then ok "OPENAI_API_KEY configured"; else warn "OPENAI_API_KEY not configured"; fi

if git -C "${ROOT}" check-ignore -v "${ENV_FILE}" >/dev/null 2>&1; then ok "secret excluded from git"; else error "secret not ignored by git"; status=1; fi
if secret_not_staged; then ok "secret file not staged"; else error "secret file is staged in git"; status=1; fi

if [[ -f "${STATE_V002}" ]] && grep -q '^PATCH=worm-terminallm-v002$' "${STATE_V002}"; then ok "install-state v002"; else warn "install-state v002 missing"; fi
if [[ -L "${SYMLINK}" ]] && [[ "$(readlink -f "${SYMLINK}")" == "${RUNTIME_BIN}" ]]; then ok "symlink"; else warn "symlink missing or unexpected"; fi

exit "${status}"
