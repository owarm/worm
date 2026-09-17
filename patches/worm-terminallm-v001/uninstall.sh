#!/usr/bin/env bash
set -euo pipefail

PATCH_NAME="worm-terminallm-v001"
ROOT="/opt/worm"
BASE_DIR="${ROOT}/terminallm"
BACKUP_DIR="${ROOT}/backups/${PATCH_NAME}"
LOCAL_BIN="/usr/local/bin/worm-llm"

remove_if_matches() {
  local target="$1"
  local expected="$2"

  if [[ -f "${target}" ]] && cmp -s "${target}" "${expected}"; then
    rm -f "${target}"
    printf '[OK] removed %s\n' "${target}"
  else
    printf '[WARN] kept modified or missing file %s\n' "${target}"
  fi
}

restore_latest_backup() {
  local rel="$1"
  local dest="/${rel}"
  local latest
  latest="$(find "${BACKUP_DIR}/${rel%/*}" -maxdepth 1 -name "$(basename "${rel}").*" -type f -o -name "$(basename "${rel}").*" -type l 2>/dev/null | sort | tail -n 1 || true)"

  if [[ -n "${latest}" ]]; then
    mkdir -p "${dest%/*}"
    cp -a "${latest}" "${dest}"
    printf '[OK] restored backup %s\n' "${dest}"
  fi
}

if [[ -L "${LOCAL_BIN}" ]] && [[ "$(readlink "${LOCAL_BIN}")" == "${BASE_DIR}/bin/worm-llm" ]]; then
  rm -f "${LOCAL_BIN}"
  printf '[OK] removed symlink %s\n' "${LOCAL_BIN}"
  restore_latest_backup "usr/local/bin/worm-llm"
elif [[ -e "${LOCAL_BIN}.pre-${PATCH_NAME}" ]]; then
  if [[ ! -e "${LOCAL_BIN}" && ! -L "${LOCAL_BIN}" ]]; then
    mv "${LOCAL_BIN}.pre-${PATCH_NAME}" "${LOCAL_BIN}"
    printf '[OK] restored %s\n' "${LOCAL_BIN}"
  else
    printf '[WARN] kept backup beside existing %s\n' "${LOCAL_BIN}"
  fi
fi

if [[ -d "${BASE_DIR}/xdg/term-llm" ]]; then
  if [[ -L "${BASE_DIR}/xdg/term-llm/config.yaml" ]] && [[ "$(readlink "${BASE_DIR}/xdg/term-llm/config.yaml")" == "${BASE_DIR}/config/config.yaml" ]]; then
    rm -f "${BASE_DIR}/xdg/term-llm/config.yaml"
    rmdir "${BASE_DIR}/xdg/term-llm" 2>/dev/null || true
  fi
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

cat >"${tmp_dir}/config.yaml" <<'EOF_CONFIG'
provider:
  default: openai
  openai:
    api_key_env: OPENAI_API_KEY

workspace: /opt/worm

paths:
  data: /opt/worm/terminallm/data
  logs: /opt/worm/terminallm/logs
EOF_CONFIG

cat >"${tmp_dir}/env.example" <<'EOF_ENV'
OPENAI_API_KEY=
EOF_ENV

cat >"${tmp_dir}/gitignore" <<'EOF_GITIGNORE'
config/env
data/*
!data/.keep
logs/*
!logs/.keep
xdg/*
EOF_GITIGNORE

remove_if_matches "${BASE_DIR}/config/config.yaml" "${tmp_dir}/config.yaml"
remove_if_matches "${BASE_DIR}/config/env.example" "${tmp_dir}/env.example"
remove_if_matches "${BASE_DIR}/.gitignore" "${tmp_dir}/gitignore"
rm -f "${BASE_DIR}/bin/worm-llm" "${BASE_DIR}/data/.keep" "${BASE_DIR}/logs/.keep"

if [[ -f "${BASE_DIR}/config/env" ]]; then
  chmod 600 "${BASE_DIR}/config/env"
  printf '[WARN] kept user credentials %s\n' "${BASE_DIR}/config/env"
fi

rmdir "${BASE_DIR}/bin" "${BASE_DIR}/config" "${BASE_DIR}/xdg" "${BASE_DIR}" 2>/dev/null || true
printf '[OK] %s uninstalled; user data/logs were left in place\n' "${PATCH_NAME}"
