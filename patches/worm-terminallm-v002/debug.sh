#!/usr/bin/env bash
set -euo pipefail

PATCH="worm-terminallm-v002"
ROOT="/opt/worm"
PATCH_DIR="${ROOT}/patches/${PATCH}"
VERSION_FILE="${PATCH_DIR}/VERSION"
RUNTIME="${ROOT}/terminallm/runtime"
TARGET="${RUNTIME}/bin/term-llm"
STATE_FILE="${RUNTIME}/install-state"
BACKUP_DIR="${ROOT}/backups/${PATCH}"
SYMLINK="/usr/local/bin/term-llm"
WRAPPER_V001="${ROOT}/terminallm/bin/worm-llm"
CONFIG_V001="${ROOT}/terminallm/config/config.yaml"
API_ROOT="https://api.github.com/repos/samsaffron/term-llm"

ok() { printf '[OK] %s\n' "$1"; }
info() { printf '[INFO] %s\n' "$1"; }
warn() { printf '[WARN] %s\n' "$1"; }
err() { printf '[ERROR] %s\n' "$1"; }

download_stdout() {
  local url="$1"
  if command -v curl >/dev/null 2>&1; then
    curl --fail --location --show-error --silent -H "User-Agent: ${PATCH}" "${url}"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- "${url}"
  else
    return 1
  fi
}

normalize_os() {
  case "$1" in
    Linux) printf 'linux\n' ;;
    *) return 1 ;;
  esac
}

normalize_arch() {
  case "$1" in
    x86_64|amd64) printf 'amd64\n' ;;
    aarch64|arm64) printf 'arm64\n' ;;
    *) return 1 ;;
  esac
}

version_of() {
  local bin="$1"
  local out=""
  [[ -x "${bin}" ]] || return 1
  out="$("${bin}" version 2>/dev/null || true)"
  [[ -n "${out}" ]] || out="$("${bin}" --version 2>/dev/null || true)"
  if [[ "${out}" =~ v?[0-9]+(\.[0-9]+)+ ]]; then
    printf '%s\n' "${BASH_REMATCH[0]}"
  else
    printf 'unknown\n'
  fi
}

resolve_release() {
  local requested="$1"
  local meta tag
  if [[ "${requested}" == "latest" ]]; then
    meta="$(download_stdout "${API_ROOT}/releases/latest")" || return 1
  else
    case "${requested}" in
      v*) tag="${requested}" ;;
      *) tag="v${requested}" ;;
    esac
    meta="$(download_stdout "${API_ROOT}/releases/tags/${tag}")" || return 1
  fi
  printf '%s\n' "${meta}" | grep -q '"draft":[[:space:]]*false' || return 1
  printf '%s\n' "${meta}" | grep -q '"prerelease":[[:space:]]*false' || return 1
  printf '%s\n' "${meta}" | sed -n 's/.*"tag_name":[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1
}

status=0
raw_os="$(uname -s)"
raw_arch="$(uname -m)"
info "uname -s: ${raw_os}"
info "uname -m: ${raw_arch}"
if os="$(normalize_os "${raw_os}")" && arch="$(normalize_arch "${raw_arch}")"; then
  ok "platform ${os}/${arch}"
else
  err "unsupported platform"
  status=1
fi

if download_stdout "${API_ROOT}" >/dev/null 2>&1; then
  ok "GitHub connectivity"
else
  warn "GitHub connectivity unavailable"
fi

if [[ -f "${VERSION_FILE}" ]]; then
  # shellcheck disable=SC1090
  source "${VERSION_FILE}"
  info "VERSION TERM_LLM_VERSION=${TERM_LLM_VERSION:-}"
  if resolved="$(resolve_release "${TERM_LLM_VERSION:-}")"; then
    ok "release resolved ${resolved}"
  else
    warn "release resolution failed"
  fi
else
  err "missing VERSION file"
  status=1
fi

for dir in "${RUNTIME}" "${RUNTIME}/bin" "${RUNTIME}/releases" "${RUNTIME}/tmp"; do
  if [[ -d "${dir}" ]]; then ok "runtime directory ${dir}"; else err "missing runtime directory ${dir}"; status=1; fi
done
if [[ -d "${BACKUP_DIR}" ]]; then ok "backup directory ${BACKUP_DIR}"; else warn "backup directory missing ${BACKUP_DIR}"; fi

if [[ -f "${TARGET}" ]]; then
  ok "binary present ${TARGET}"
  if [[ -x "${TARGET}" ]]; then ok "binary executable"; else err "binary not executable"; status=1; fi
  size="$(stat -c '%s' "${TARGET}" 2>/dev/null || stat -f '%z' "${TARGET}")"
  info "binary size: ${size}"
  info "installed version: $(version_of "${TARGET}" || printf unknown)"
else
  warn "binary not installed"
fi

if [[ -L "${SYMLINK}" ]]; then
  target="$(readlink "${SYMLINK}")"
  if [[ "${target}" == "${TARGET}" ]]; then ok "symlink ${SYMLINK}"; else warn "symlink points elsewhere: ${target}"; fi
  if command -v readlink >/dev/null 2>&1; then info "symlink resolved target: $(readlink -f "${SYMLINK}" 2>/dev/null || printf unknown)"; fi
elif [[ -e "${SYMLINK}" ]]; then
  warn "command path exists but is not a symlink"
else
  warn "symlink missing ${SYMLINK}"
fi

if [[ -x "${WRAPPER_V001}" ]]; then ok "wrapper v001 present"; else warn "wrapper v001 missing"; fi
if [[ -f "${STATE_FILE}" ]]; then ok "state file"; else warn "state file missing"; fi
if [[ -f "${CONFIG_V001}" ]]; then ok "config"; else warn "v001 config missing"; fi

if [[ -n "${OPENAI_API_KEY:-}" ]]; then
  ok "OPENAI_API_KEY configured"
elif [[ -f "${ROOT}/terminallm/config/env" ]] && grep -Eq '^[[:space:]]*OPENAI_API_KEY=.+' "${ROOT}/terminallm/config/env"; then
  ok "OPENAI_API_KEY configured"
else
  warn "OPENAI_API_KEY not configured"
fi

exit "${status}"
