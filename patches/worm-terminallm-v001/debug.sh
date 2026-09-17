#!/usr/bin/env bash
set -euo pipefail

ROOT="/opt/worm"
BASE_DIR="${ROOT}/terminallm"
WRAPPER="${BASE_DIR}/bin/worm-llm"
CONFIG="${BASE_DIR}/config/config.yaml"
ENV_FILE="${BASE_DIR}/config/env"
XDG_DIR="${BASE_DIR}/xdg"
TERM_LLM_CONFIG="${XDG_DIR}/term-llm/config.yaml"
LOCAL_BIN="/usr/local/bin/worm-llm"

ok() { printf '[OK] %s\n' "$1"; }
warn() { printf '[WARN] %s\n' "$1"; }
fail() { printf '[FAIL] %s\n' "$1"; }

status=0

for dir in "${BASE_DIR}" "${BASE_DIR}/bin" "${BASE_DIR}/config" "${BASE_DIR}/data" "${BASE_DIR}/logs" "${XDG_DIR}"; do
  if [[ -d "${dir}" ]]; then
    ok "directory ${dir}"
  else
    fail "missing directory ${dir}"
    status=1
  fi
done

if [[ -x "${WRAPPER}" ]]; then
  ok "wrapper executable"
else
  fail "wrapper missing or not executable"
  status=1
fi

if bash -n "${WRAPPER}" 2>/dev/null; then
  ok "wrapper syntax"
else
  fail "wrapper syntax error"
  status=1
fi

if [[ -f "${CONFIG}" ]] && grep -q 'OPENAI_API_KEY' "${CONFIG}" && grep -q '/opt/worm/terminallm/data' "${CONFIG}" && grep -q '/opt/worm/terminallm/logs' "${CONFIG}"; then
  ok "config"
else
  fail "config missing required values"
  status=1
fi

if [[ -L "${TERM_LLM_CONFIG}" ]] && [[ "$(readlink "${TERM_LLM_CONFIG}")" == "${CONFIG}" ]]; then
  ok "term-llm config symlink"
elif [[ -e "${TERM_LLM_CONFIG}" ]]; then
  warn "term-llm config exists but is not the expected symlink"
else
  warn "term-llm config symlink not created yet"
fi

if [[ -L "${LOCAL_BIN}" ]] && [[ "$(readlink "${LOCAL_BIN}")" == "${WRAPPER}" ]]; then
  ok "command symlink ${LOCAL_BIN}"
elif [[ -e "${LOCAL_BIN}" ]]; then
  warn "command path exists but is not managed by this patch"
else
  warn "command symlink not installed"
fi

if [[ -f "${ENV_FILE}" ]]; then
  perms="$(stat -c '%a' "${ENV_FILE}" 2>/dev/null || stat -f '%Lp' "${ENV_FILE}")"
  if [[ "${perms}" == "600" ]]; then
    ok "config/env permissions 0600"
  else
    warn "config/env permissions are ${perms}, expected 600"
  fi
else
  ok "config/env absent"
fi

if [[ -n "${OPENAI_API_KEY:-}" ]]; then
  ok "OPENAI_API_KEY configured"
elif [[ -f "${ENV_FILE}" ]] && grep -Eq '^[[:space:]]*OPENAI_API_KEY=.+' "${ENV_FILE}"; then
  ok "OPENAI_API_KEY configured in env file"
else
  warn "OPENAI_API_KEY not configured"
fi

if command -v term-llm >/dev/null 2>&1; then
  ok "term-llm executable installed"
else
  warn "term-llm executable not installed"
fi

if [[ "${XDG_CONFIG_HOME:-}" == "${XDG_DIR}" ]]; then
  ok "XDG_CONFIG_HOME"
else
  warn "XDG_CONFIG_HOME not set to ${XDG_DIR} in current shell"
fi

if [[ -r "${ROOT}" && -x "${ROOT}" ]]; then
  ok "workspace accessible ${ROOT}"
else
  fail "workspace not accessible ${ROOT}"
  status=1
fi

exit "${status}"
