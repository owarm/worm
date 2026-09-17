#!/usr/bin/env bash
set -euo pipefail

PATCH_NAME="worm-terminallm-v001"
ROOT="/opt/worm"
BASE_DIR="${ROOT}/terminallm"
PATCH_DIR="${ROOT}/patches/${PATCH_NAME}"
BACKUP_DIR="${ROOT}/backups/${PATCH_NAME}"
LOCAL_BIN="/usr/local/bin/worm-llm"

backup_path() {
  local target="$1"
  local rel="${target#/}"
  local stamp
  stamp="$(date +%Y%m%d%H%M%S)"

  if [[ -e "${target}" || -L "${target}" ]]; then
    mkdir -p "${BACKUP_DIR}/${rel%/*}"
    cp -a "${target}" "${BACKUP_DIR}/${rel}.${stamp}"
    printf '[OK] backup %s -> %s\n' "${target}" "${BACKUP_DIR}/${rel}.${stamp}"
  fi
}

write_file_if_changed() {
  local target="$1"
  local mode="$2"
  local tmp
  tmp="$(mktemp)"
  cat >"${tmp}"

  if [[ -e "${target}" ]] && cmp -s "${tmp}" "${target}"; then
    chmod "${mode}" "${target}"
    rm -f "${tmp}"
    printf '[OK] unchanged %s\n' "${target}"
    return
  fi

  backup_path "${target}"
  mkdir -p "${target%/*}"
  install -m "${mode}" "${tmp}" "${target}"
  rm -f "${tmp}"
  printf '[OK] installed %s\n' "${target}"
}

mkdir -p \
  "${BASE_DIR}/bin" \
  "${BASE_DIR}/config" \
  "${BASE_DIR}/data" \
  "${BASE_DIR}/logs" \
  "${BASE_DIR}/xdg" \
  "${PATCH_DIR}" \
  "${BACKUP_DIR}"

write_file_if_changed "${BASE_DIR}/config/config.yaml" 0644 <<'EOF_CONFIG'
provider:
  default: openai
  openai:
    api_key_env: OPENAI_API_KEY

workspace: /opt/worm

paths:
  data: /opt/worm/terminallm/data
  logs: /opt/worm/terminallm/logs
EOF_CONFIG

write_file_if_changed "${BASE_DIR}/config/env.example" 0644 <<'EOF_ENV'
OPENAI_API_KEY=
EOF_ENV

if [[ -f "${BASE_DIR}/config/env" ]]; then
  chmod 600 "${BASE_DIR}/config/env"
  printf '[OK] secured %s\n' "${BASE_DIR}/config/env"
fi

write_file_if_changed "${BASE_DIR}/.gitignore" 0644 <<'EOF_GITIGNORE'
config/env
data/*
!data/.keep
logs/*
!logs/.keep
xdg/*
EOF_GITIGNORE

write_file_if_changed "${BASE_DIR}/data/.keep" 0644 <<'EOF_KEEP_DATA'
EOF_KEEP_DATA

write_file_if_changed "${BASE_DIR}/logs/.keep" 0644 <<'EOF_KEEP_LOGS'
EOF_KEEP_LOGS

write_file_if_changed "${BASE_DIR}/bin/worm-llm" 0755 <<'EOF_WRAPPER'
#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="/opt/worm/terminallm"
WORM_WORKSPACE="/opt/worm"
CONFIG_FILE="${BASE_DIR}/config/config.yaml"
ENV_FILE="${BASE_DIR}/config/env"
XDG_DIR="${BASE_DIR}/xdg"
TERM_LLM_CONFIG_DIR="${XDG_DIR}/term-llm"
TERM_LLM_CONFIG="${TERM_LLM_CONFIG_DIR}/config.yaml"

mkdir -p \
  "${BASE_DIR}/data" \
  "${BASE_DIR}/logs" \
  "${XDG_DIR}" \
  "${TERM_LLM_CONFIG_DIR}"

if [[ -f "${ENV_FILE}" ]]; then
  chmod 600 "${ENV_FILE}"
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

export XDG_CONFIG_HOME="${XDG_DIR}"

if [[ ! -f "${CONFIG_FILE}" ]]; then
  printf 'worm-llm: missing config file: %s\n' "${CONFIG_FILE}" >&2
  exit 1
fi

if [[ -L "${TERM_LLM_CONFIG}" || ! -e "${TERM_LLM_CONFIG}" ]]; then
  ln -sfn "${CONFIG_FILE}" "${TERM_LLM_CONFIG}"
else
  printf 'worm-llm: refusing to replace existing non-symlink config: %s\n' "${TERM_LLM_CONFIG}" >&2
  exit 1
fi

if ! command -v term-llm >/dev/null 2>&1; then
  printf 'worm-llm: term-llm executable is not installed or not in PATH.\n' >&2
  printf 'worm-llm: install term-llm in a separate patch, then retry.\n' >&2
  exit 127
fi

cd "${WORM_WORKSPACE}"
exec term-llm "$@"
EOF_WRAPPER

if [[ -d /usr/local/bin ]]; then
  if [[ -L "${LOCAL_BIN}" ]]; then
    current_target="$(readlink "${LOCAL_BIN}")"
    if [[ "${current_target}" == "${BASE_DIR}/bin/worm-llm" ]]; then
      printf '[OK] symlink unchanged %s\n' "${LOCAL_BIN}"
    else
      backup_path "${LOCAL_BIN}"
      ln -sfn "${BASE_DIR}/bin/worm-llm" "${LOCAL_BIN}"
      printf '[OK] symlink updated %s\n' "${LOCAL_BIN}"
    fi
  elif [[ -e "${LOCAL_BIN}" ]]; then
    backup_path "${LOCAL_BIN}"
    mv "${LOCAL_BIN}" "${LOCAL_BIN}.pre-${PATCH_NAME}"
    ln -s "${BASE_DIR}/bin/worm-llm" "${LOCAL_BIN}"
    printf '[OK] existing file moved and symlink installed %s\n' "${LOCAL_BIN}"
  else
    ln -s "${BASE_DIR}/bin/worm-llm" "${LOCAL_BIN}" && printf '[OK] symlink installed %s\n' "${LOCAL_BIN}" || printf '[WARN] cannot create symlink %s\n' "${LOCAL_BIN}"
  fi
else
  printf '[WARN] /usr/local/bin is not available\n'
fi

printf '[OK] %s installed\n' "${PATCH_NAME}"
