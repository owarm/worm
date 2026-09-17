#!/usr/bin/env bash
set -euo pipefail

PATCH="worm-terminallm-v002"
ROOT="/opt/worm"
RUNTIME="${ROOT}/terminallm/runtime"
TARGET="${RUNTIME}/bin/term-llm"
STATE_FILE="${RUNTIME}/install-state"
BACKUP_DIR="${ROOT}/backups/${PATCH}"
SYMLINK="/usr/local/bin/term-llm"

ok() { printf '[OK] %s\n' "$1"; }
warn() { printf '[WARN] %s\n' "$1"; }
err() { printf '[ERROR] %s\n' "$1" >&2; }

restore_previous_command() {
  local latest=""
  if [[ -d "${BACKUP_DIR}" ]]; then
    latest="$(find "${BACKUP_DIR}" -maxdepth 1 -name 'usr-local-bin-term-llm-*' | sort | tail -n 1 || true)"
  fi
  if [[ -n "${latest}" ]]; then
    cp -a "${latest}" "${SYMLINK}"
    ok "restored previous /usr/local/bin/term-llm"
  fi
}

if [[ ! -f "${STATE_FILE}" ]] || ! grep -q "^PATCH=${PATCH}$" "${STATE_FILE}"; then
  warn "state file does not confirm ${PATCH}; keeping runtime binary"
else
  if [[ -L "${SYMLINK}" ]] && [[ "$(readlink "${SYMLINK}")" == "${TARGET}" ]]; then
    rm -f "${SYMLINK}"
    ok "removed symlink ${SYMLINK}"
    restore_previous_command
  elif [[ -e "${SYMLINK}" || -L "${SYMLINK}" ]]; then
    warn "kept unmanaged command path ${SYMLINK}"
  fi

  if [[ -f "${TARGET}" ]]; then
    rm -f "${TARGET}"
    ok "removed binary ${TARGET}"
  fi
  rm -f "${STATE_FILE}"
  ok "removed state file"
fi

rm -f "${RUNTIME}/bin/.term-llm.new" "${RUNTIME}"/*.tmp 2>/dev/null || true
rmdir "${RUNTIME}/bin" "${RUNTIME}/tmp" "${RUNTIME}/releases" "${RUNTIME}" 2>/dev/null || true
ok "uninstall complete; config, data, logs, and v001 were left untouched"
