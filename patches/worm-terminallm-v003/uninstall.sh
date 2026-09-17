#!/usr/bin/env bash
set -euo pipefail

PATCH="worm-terminallm-v003"
ROOT="/opt/worm"
CONFIG_FILE="${ROOT}/terminallm/config/config.yaml"
ENV_FILE="${ROOT}/terminallm/config/env"
BACKUP_DIR="${ROOT}/backups/${PATCH}"

ok() { printf '[OK] %s\n' "$1"; }
info() { printf '[INFO] %s\n' "$1"; }
warn() { printf '[WARN] %s\n' "$1"; }

latest_backup() {
  find "${BACKUP_DIR}" -maxdepth 1 -name 'config.yaml.*' 2>/dev/null | sort | tail -n 1 || true
}

if [[ -f "${ENV_FILE}" ]]; then
  chmod 0600 "${ENV_FILE}"
  info "keeping user secret file:"
  printf '       %s\n' "${ENV_FILE}"
fi

backup="$(latest_backup)"
if [[ -n "${backup}" ]]; then
  cp -a "${backup}" "${CONFIG_FILE}"
  ok "restored previous config"
else
  warn "no v003 config backup found; keeping current config"
fi

ok "uninstall complete; v001, v002, runtime, data, and logs were left untouched"
