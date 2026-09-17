#!/usr/bin/env bash
set -euo pipefail

PATCH="worm-terminallm-v002"
ROOT="/opt/worm"
PATCH_DIR="${ROOT}/patches/${PATCH}"
VERSION_FILE="${PATCH_DIR}/VERSION"
RUNTIME="${ROOT}/terminallm/runtime"
BIN_DIR="${RUNTIME}/bin"
RELEASES_DIR="${RUNTIME}/releases"
TMP_ROOT="${RUNTIME}/tmp"
TARGET="${BIN_DIR}/term-llm"
STAGED="${BIN_DIR}/.term-llm.new"
STATE_FILE="${RUNTIME}/install-state"
BACKUP_DIR="${ROOT}/backups/${PATCH}"
SYMLINK="/usr/local/bin/term-llm"
REPO_OWNER="samsaffron"
REPO_NAME="term-llm"
API_ROOT="https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}"
OLD_BINARY_BACKUP=""
SYMLINK_BACKUP=""
TMP_DIR=""
TARGET_REPLACED=0
SYMLINK_CHANGED=0

info() { printf '[INFO] %s\n' "$1"; }
ok() { printf '[OK] %s\n' "$1"; }
warn() { printf '[WARN] %s\n' "$1"; }
error() { printf '[ERROR] %s\n' "$1" >&2; }
die() { error "$1"; exit 1; }

cleanup() {
  rm -f "${STAGED}" 2>/dev/null || true
  if [[ -n "${TMP_DIR}" ]]; then
    rm -rf "${TMP_DIR}" 2>/dev/null || true
  fi
}

rollback() {
  local rc=$?
  if [[ ${rc} -ne 0 ]]; then
    error "operation failed; rolling back"
    if [[ ${TARGET_REPLACED} -eq 1 && -n "${OLD_BINARY_BACKUP}" && -f "${OLD_BINARY_BACKUP}" ]]; then
      cp -a "${OLD_BINARY_BACKUP}" "${TARGET}"
      chmod 0755 "${TARGET}"
      warn "restored previous binary"
    fi
    if [[ ${SYMLINK_CHANGED} -eq 1 ]]; then
      rm -f "${SYMLINK}" 2>/dev/null || true
      if [[ -n "${SYMLINK_BACKUP}" && ( -e "${SYMLINK_BACKUP}" || -L "${SYMLINK_BACKUP}" ) ]]; then
        cp -a "${SYMLINK_BACKUP}" "${SYMLINK}"
        warn "restored previous symlink/file"
      elif [[ -f "${TARGET}" ]]; then
        ln -s "${TARGET}" "${SYMLINK}" 2>/dev/null || true
      fi
    fi
  fi
  cleanup
  exit "${rc}"
}
trap rollback EXIT

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

download() {
  local url="$1"
  local dest="$2"
  if command -v curl >/dev/null 2>&1; then
    curl --fail --location --show-error --silent -H "User-Agent: ${PATCH}" -o "${dest}" "${url}"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "${dest}" "${url}"
  else
    die "curl or wget is required"
  fi
}

normalize_os() {
  case "$1" in
    Linux) printf 'linux\n' ;;
    *) die "unsupported platform" ;;
  esac
}

normalize_arch() {
  case "$1" in
    x86_64|amd64) printf 'amd64\n' ;;
    aarch64|arm64) printf 'arm64\n' ;;
    *) die "unsupported platform" ;;
  esac
}

read_requested_version() {
  [[ -f "${VERSION_FILE}" ]] || die "missing VERSION file: ${VERSION_FILE}"
  # shellcheck disable=SC1090
  source "${VERSION_FILE}"
  [[ -n "${TERM_LLM_VERSION:-}" ]] || die "TERM_LLM_VERSION is empty"
  printf '%s\n' "${TERM_LLM_VERSION}"
}

resolve_latest() {
  local meta tag
  meta="${TMP_DIR}/latest.json"
  download "${API_ROOT}/releases/latest" "${meta}"
  grep -q '"draft":[[:space:]]*false' "${meta}" || die "latest release is draft"
  grep -q '"prerelease":[[:space:]]*false' "${meta}" || die "latest release is prerelease"
  tag="$(sed -n 's/.*"tag_name":[[:space:]]*"\([^"]*\)".*/\1/p' "${meta}" | head -n 1)"
  [[ -n "${tag}" ]] || die "unable to resolve latest release"
  printf '%s\n' "${tag}"
}

resolve_specific() {
  local requested="$1"
  local tag meta
  case "${requested}" in
    v*) tag="${requested}" ;;
    *) tag="v${requested}" ;;
  esac
  meta="${TMP_DIR}/release-${tag}.json"
  download "${API_ROOT}/releases/tags/${tag}" "${meta}" || die "release does not exist: ${tag}"
  grep -q '"draft":[[:space:]]*false' "${meta}" || die "release is draft: ${tag}"
  grep -q '"prerelease":[[:space:]]*false' "${meta}" || die "release is prerelease: ${tag}"
  printf '%s\n' "${tag}"
}

release_meta_path() {
  local tag="$1"
  local meta="${TMP_DIR}/release-${tag}.json"
  if [[ ! -f "${meta}" ]]; then
    download "${API_ROOT}/releases/tags/${tag}" "${meta}"
  fi
  printf '%s\n' "${meta}"
}

asset_url_from_meta() {
  local meta="$1"
  local name="$2"
  sed -n 's/.*"browser_download_url":[[:space:]]*"\([^"]*\/'"${name}"'\)".*/\1/p' "${meta}" | head -n 1
}

installed_version() {
  local bin="$1"
  local out=""
  [[ -x "${bin}" ]] || return 1
  out="$("${bin}" version 2>/dev/null || true)"
  if [[ -z "${out}" ]]; then
    out="$("${bin}" --version 2>/dev/null || true)"
  fi
  if [[ "${out}" =~ v?[0-9]+(\.[0-9]+)+ ]]; then
    printf '%s\n' "${BASH_REMATCH[0]}"
  else
    printf 'unknown\n'
  fi
}

validate_binary() {
  local bin="$1"
  [[ -f "${bin}" ]] || die "validated binary is missing"
  [[ -s "${bin}" ]] || die "validated binary is empty"
  chmod 0755 "${bin}"
  [[ -x "${bin}" ]] || die "validated binary is not executable"
  if command -v file >/dev/null 2>&1; then
    file "${bin}" | grep -Eq 'ELF|Mach-O|executable' || die "binary format is not plausible"
  fi
  if "${bin}" version >/dev/null 2>&1; then
    ok "executable validation passed"
    return
  fi
  if "${bin}" --version >/dev/null 2>&1; then
    ok "executable validation passed"
    return
  fi
  if "${bin}" --help >/dev/null 2>&1; then
    ok "executable validation passed"
    return
  fi
  die "binary validation failed"
}

backup_file_or_link() {
  local src="$1"
  local name="$2"
  local stamp="$3"
  local dest="${BACKUP_DIR}/${name}-${stamp}"
  if [[ -e "${src}" || -L "${src}" ]]; then
    mkdir -p "${BACKUP_DIR}"
    cp -a "${src}" "${dest}"
    printf '%s\n' "${dest}"
  fi
}

install_symlink() {
  local stamp="$1"
  if [[ -L "${SYMLINK}" ]] && [[ "$(readlink "${SYMLINK}")" == "${TARGET}" ]]; then
    ok "symlink unchanged ${SYMLINK}"
    return
  fi
  if [[ -e "${SYMLINK}" || -L "${SYMLINK}" ]]; then
    SYMLINK_BACKUP="$(backup_file_or_link "${SYMLINK}" "usr-local-bin-term-llm" "${stamp}")"
    ok "backup symlink/file ${SYMLINK}"
    SYMLINK_CHANGED=1
    rm -f "${SYMLINK}"
  fi
  ln -s "${TARGET}" "${SYMLINK}"
  SYMLINK_CHANGED=1
  ok "symlink installed ${SYMLINK}"
}

write_state() {
  local version="$1"
  local artifact="$2"
  local checksum_status="$3"
  local tmp_state="${STATE_FILE}.tmp"
  cat >"${tmp_state}" <<EOF_STATE
PATCH=${PATCH}
VERSION=${version}
INSTALLED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
BINARY=${TARGET}
SYMLINK=${SYMLINK}
ARTIFACT=${artifact}
CHECKSUM_STATUS=${checksum_status}
EOF_STATE
  mv "${tmp_state}" "${STATE_FILE}"
  chmod 0644 "${STATE_FILE}"
}

main() {
  need_cmd tar
  need_cmd sha256sum
  need_cmd mktemp

  mkdir -p "${BIN_DIR}" "${RELEASES_DIR}" "${TMP_ROOT}" "${BACKUP_DIR}"
  TMP_DIR="$(mktemp -d "${TMP_ROOT}/term-llm.XXXXXX")"

  local requested os arch resolved asset_version artifact meta artifact_url archive checksum_url checksum_file checksum checksum_status extract_dir candidate current installed stamp release_copy
  requested="$(read_requested_version)"
  os="$(normalize_os "$(uname -s)")"
  arch="$(normalize_arch "$(uname -m)")"
  info "requested version: ${requested}"
  if [[ "${requested}" == "latest" ]]; then
    resolved="$(resolve_latest)"
  else
    resolved="$(resolve_specific "${requested}")"
  fi
  info "resolved version: ${resolved}"
  info "os: ${os}"
  info "architecture: ${arch}"
  asset_version="${resolved#v}"
  artifact="${REPO_NAME}_${asset_version}_${os}_${arch}.tar.gz"

  installed="$(installed_version "${TARGET}" || true)"
  info "installed: ${installed:-none}"
  info "requested: ${resolved}"
  if [[ -n "${installed}" && "${installed}" != "unknown" ]]; then
    case "${installed}" in
      v*) current="${installed}" ;;
      *) current="v${installed}" ;;
    esac
    if [[ "${current}" == "${resolved}" ]]; then
      ok "already up to date"
      install_symlink "$(date +%Y%m%d%H%M%S)"
      checksum_status="not-needed"
      release_copy="${RELEASES_DIR}/${artifact}"
      if [[ -f "${release_copy}" ]]; then
        meta="$(release_meta_path "${resolved}")"
        checksum_url="$(asset_url_from_meta "${meta}" "checksums.txt")"
        if [[ -z "${checksum_url}" ]]; then
          checksum_url="$(asset_url_from_meta "${meta}" "SHA256SUMS")"
        fi
        if [[ -z "${checksum_url}" ]]; then
          checksum_url="$(asset_url_from_meta "${meta}" "sha256sums.txt")"
        fi
        if [[ -n "${checksum_url}" ]]; then
          checksum_file="${TMP_DIR}/checksums.txt"
          download "${checksum_url}" "${checksum_file}"
          checksum="$(awk -v file="${artifact}" '$2 == file { print $1; exit }' "${checksum_file}")"
          [[ -n "${checksum}" ]] || die "checksum not found for ${artifact}"
          (cd "${RELEASES_DIR}" && printf '%s  %s\n' "${checksum}" "${artifact}" | sha256sum -c - >/dev/null)
          checksum_status="verified"
          ok "checksum verified"
        else
          warn "upstream checksum not available"
          checksum_status="unavailable"
        fi
      fi
      if [[ ! -f "${STATE_FILE}" ]] || ! grep -q "^ARTIFACT=${artifact}$" "${STATE_FILE}" || ! grep -q "^CHECKSUM_STATUS=${checksum_status}$" "${STATE_FILE}"; then
        write_state "${resolved}" "${artifact}" "${checksum_status}"
      fi
      return
    fi
  fi

  meta="$(release_meta_path "${resolved}")"
  grep -q "\"name\":[[:space:]]*\"${artifact}\"" "${meta}" || die "artifact not found in release metadata: ${artifact}"
  artifact_url="$(asset_url_from_meta "${meta}" "${artifact}")"
  [[ -n "${artifact_url}" ]] || artifact_url="https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${resolved}/${artifact}"
  info "artifact: ${artifact}"

  archive="${TMP_DIR}/${artifact}"
  download "${artifact_url}" "${archive}"
  [[ -s "${archive}" ]] || die "downloaded artifact is empty"
  release_copy="${RELEASES_DIR}/${artifact}"
  cp -a "${archive}" "${release_copy}"

  checksum_status="unavailable"
  checksum_url="$(asset_url_from_meta "${meta}" "checksums.txt")"
  if [[ -z "${checksum_url}" ]]; then
    checksum_url="$(asset_url_from_meta "${meta}" "SHA256SUMS")"
  fi
  if [[ -z "${checksum_url}" ]]; then
    checksum_url="$(asset_url_from_meta "${meta}" "sha256sums.txt")"
  fi
  if [[ -n "${checksum_url}" ]]; then
    checksum_file="${TMP_DIR}/checksums.txt"
    download "${checksum_url}" "${checksum_file}"
    checksum="$(awk -v file="${artifact}" '$2 == file { print $1; exit }' "${checksum_file}")"
    [[ -n "${checksum}" ]] || die "checksum not found for ${artifact}"
    (cd "${TMP_DIR}" && printf '%s  %s\n' "${checksum}" "${artifact}" | sha256sum -c - >/dev/null)
    checksum_status="verified"
    ok "checksum verified"
  else
    warn "upstream checksum not available"
  fi

  extract_dir="${TMP_DIR}/extract"
  mkdir -p "${extract_dir}"
  tar -xzf "${archive}" -C "${extract_dir}" || die "extraction failure"
  candidate="$(find "${extract_dir}" -type f -name term-llm | head -n 1 || true)"
  [[ -n "${candidate}" ]] || die "term-llm binary not found after extraction"

  cp -a "${candidate}" "${STAGED}"
  validate_binary "${STAGED}"
  info "installed version: $(installed_version "${STAGED}" || printf unknown)"

  stamp="$(date +%Y%m%d%H%M%S)"
  if [[ -e "${TARGET}" || -L "${TARGET}" ]]; then
    old_version="$(installed_version "${TARGET}" || printf unknown)"
    OLD_BINARY_BACKUP="$(backup_file_or_link "${TARGET}" "term-llm-${old_version}" "${stamp}")"
    ok "backup binary ${OLD_BINARY_BACKUP}"
  fi

  mv "${STAGED}" "${TARGET}"
  chmod 0755 "${TARGET}"
  TARGET_REPLACED=1
  validate_binary "${TARGET}"
  install_symlink "${stamp}"
  write_state "${resolved}" "${artifact}" "${checksum_status}"
  ok "installed ${resolved} to ${TARGET}"
}

main "$@"
