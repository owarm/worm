#!/usr/bin/env bash
set -euo pipefail

PATCH="worm-terminallm-v003"
ROOT="/opt/worm"
PATCH_V001="${ROOT}/patches/worm-terminallm-v001"
PATCH_V002="${ROOT}/patches/worm-terminallm-v002"
CONFIG_DIR="${ROOT}/terminallm/config"
XDG_DIR="${ROOT}/terminallm/xdg"
CONFIG_FILE="${CONFIG_DIR}/config.yaml"
ENV_FILE="${CONFIG_DIR}/env"
WRAPPER="${ROOT}/terminallm/bin/worm-llm"
RUNTIME_BIN="${ROOT}/terminallm/runtime/bin/term-llm"
BACKUP_DIR="${ROOT}/backups/${PATCH}"

ok() { printf '[OK] %s\n' "$1"; }
info() { printf '[INFO] %s\n' "$1"; }
warn() { printf '[WARN] %s\n' "$1"; }
error() { printf '[ERROR] %s\n' "$1" >&2; }
die() { error "$1"; exit 1; }

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

backup_config() {
  local stamp
  stamp="$(date +%Y%m%d%H%M%S)"
  if [[ -f "${CONFIG_FILE}" ]]; then
    mkdir -p "${BACKUP_DIR}"
    cp -a "${CONFIG_FILE}" "${BACKUP_DIR}/config.yaml.${stamp}"
    ok "backup config ${BACKUP_DIR}/config.yaml.${stamp}"
  fi
}

write_config() {
  local tmp
  tmp="$(mktemp)"
  cat >"${tmp}" <<'EOF_CONFIG'
default_provider: openai

providers:
  openai:
    model: gpt-5.6-sol
    fast_model: gpt-5.6-luna
    use_websocket: false

ask:
  provider: openai
  model: gpt-5.6-sol

chat:
  provider: openai
  model: gpt-5.6-sol

diagnostics:
  enabled: false

debug_logs:
  enabled: false
EOF_CONFIG

  if [[ -f "${CONFIG_FILE}" ]] && cmp -s "${tmp}" "${CONFIG_FILE}"; then
    chmod 0644 "${CONFIG_FILE}"
    rm -f "${tmp}"
    return
  fi

  backup_config
  install -m 0644 "${tmp}" "${CONFIG_FILE}"
  rm -f "${tmp}"
}

main() {
  command -v term-llm >/dev/null 2>&1 || die "term-llm not installed"
  [[ -x "${RUNTIME_BIN}" ]] || die "v002 runtime binary missing: ${RUNTIME_BIN}"
  [[ -d "${PATCH_V001}" ]] || die "v001 patch missing: ${PATCH_V001}"
  [[ -d "${PATCH_V002}" ]] || die "v002 patch missing: ${PATCH_V002}"
  [[ -x "${WRAPPER}" ]] || die "v001 wrapper missing or not executable: ${WRAPPER}"

  local version
  version="$(version_of)"
  info "term-llm version: ${version}"
  ok "runtime detected"
  ok "wrapper detected"

  mkdir -p "${CONFIG_DIR}" "${XDG_DIR}/term-llm"
  if [[ ! -f "${ENV_FILE}" ]]; then
    install -m 0600 /dev/null "${ENV_FILE}"
    ok "secret file created"
  else
    chmod 0600 "${ENV_FILE}"
    ok "secret file mode enforced"
  fi

  write_config
  ln -sfn "${CONFIG_FILE}" "${XDG_DIR}/term-llm/config.yaml"

  XDG_CONFIG_HOME="${XDG_DIR}" term-llm config >/dev/null
  ok "configuration installed"

  if secret_configured; then
    ok "OPENAI_API_KEY configured"
  else
    warn "OPENAI_API_KEY not configured"
  fi
}

main "$@"
