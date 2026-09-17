#!/usr/bin/env bash
set -euo pipefail

ROOT="/opt/worm"
CONFIG_FILE="${ROOT}/terminallm/config/config.yaml"
ENV_FILE="${ROOT}/terminallm/config/env"
XDG_DIR="${ROOT}/terminallm/xdg"
WRAPPER="${ROOT}/terminallm/bin/worm-llm"
RUNTIME_BIN="${ROOT}/terminallm/runtime/bin/term-llm"

ok() { printf '[OK] %s\n' "$1"; }
info() { printf '[INFO] %s\n' "$1"; }
warn() { printf '[WARN] %s\n' "$1"; }
skip() { printf '[SKIP] %s\n' "$1"; }
error() { printf '[ERROR] %s\n' "$1" >&2; }
die() { error "$1"; exit 1; }

secret_configured() {
  if [[ -n "${OPENAI_API_KEY:-}" ]]; then
    return 0
  fi
  [[ -f "${ENV_FILE}" ]] && grep -Eq '^[[:space:]]*OPENAI_API_KEY=.+$' "${ENV_FILE}"
}

load_env() {
  if [[ -f "${ENV_FILE}" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "${ENV_FILE}"
    set +a
  fi
}

secret_not_staged() {
  ! git -C "${ROOT}" diff --cached --name-only -- terminallm/config/env | grep -q '^terminallm/config/env$'
}

offline() {
  [[ -x "${RUNTIME_BIN}" ]] || die "binary missing"
  "${RUNTIME_BIN}" --help >/dev/null
  ok "binary"

  [[ -x "${WRAPPER}" ]] || die "wrapper missing"
  "${WRAPPER}" --help >/dev/null
  ok "wrapper"

  [[ -f "${CONFIG_FILE}" ]] || die "config missing"
  XDG_CONFIG_HOME="${XDG_DIR}" term-llm config >/dev/null
  grep -q '^default_provider:[[:space:]]*openai' "${CONFIG_FILE}" || die "config default provider missing"
  ok "config"

  [[ -f "${ENV_FILE}" ]] || die "env file missing"
  perms="$(stat -c '%a' "${ENV_FILE}" 2>/dev/null || stat -f '%Lp' "${ENV_FILE}")"
  [[ "${perms}" == "600" ]] || die "env permissions are ${perms}, expected 600"
  if secret_configured; then ok "OPENAI_API_KEY configured"; else warn "OPENAI_API_KEY not configured"; fi
  [[ "${XDG_CONFIG_HOME:-}" != "${XDG_DIR}" ]] || true
  ok "environment"

  git -C "${ROOT}" check-ignore -v "${ENV_FILE}" >/dev/null || die "secret not ignored by git"
  secret_not_staged || die "secret file is staged in git"
  ok "offline test passed"
}

online() {
  load_env
  if ! secret_configured; then
    skip "online test: OPENAI_API_KEY not configured"
    return
  fi

  output="$(XDG_CONFIG_HOME="${XDG_DIR}" term-llm ask --provider openai --text --no-session --no-search --max-turns 1 --max-output-tokens 16 --timeout 60s 'Reply with exactly:
WORM_LLM_OK' 2>/dev/null || true)"
  if printf '%s\n' "${output}" | grep -q 'WORM_LLM_OK'; then
    ok "OpenAI connectivity"
    ok "term-llm online smoke test"
  else
    die "online smoke test failed"
  fi
}

case "${1:-}" in
  "")
    offline
    ;;
  --online)
    online
    ;;
  *)
    die "usage: $0 [--online]"
    ;;
esac
