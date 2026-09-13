#!/usr/bin/env bash
set -euo pipefail

APP_NAME="worm-webusb"
WEB_ROOT="/var/www/${APP_NAME}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="${REPO_ROOT}/dist"

die() {
    echo "ERROR: $*" >&2
    exit 1
}

info() {
    echo "==> $*"
}

if [[ "${EUID}" -ne 0 ]]; then
    die "Run as root: sudo ./scripts/update-production.sh"
fi

[[ -f "${DIST_DIR}/index.html" ]] || die "dist/index.html missing. Run npm run build first."
[[ -d "${WEB_ROOT}" ]] || die "${WEB_ROOT} does not exist. Run deploy-production.sh first."

if find "${DIST_DIR}" -type l -print -quit | grep -q .; then
    die "dist/ contains symlinks. Refusing to publish files that may point outside dist/."
fi

if find "${DIST_DIR}" \( -path '*/keys' -o -path '*/keys/*' -o -path '*/source' -o -path '*/source/*' \) -print -quit | grep -q .; then
    die "dist/ contains forbidden keys/source paths. Publish only static build output."
fi

tmp_dir="$(mktemp -d "${WEB_ROOT}.update.XXXXXX")"
trap 'rm -rf "${tmp_dir:-}"' EXIT

info "Staging dist/ update"
if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete --exclude '.git' "${DIST_DIR}/" "${tmp_dir}/"
else
    cp -a "${DIST_DIR}/." "${tmp_dir}/"
fi

chown -R root:root "${tmp_dir}"
find "${tmp_dir}" -type d -exec chmod 0755 {} +
find "${tmp_dir}" -type f -exec chmod 0644 {} +

info "Updating ${WEB_ROOT}"
if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete "${tmp_dir}/" "${WEB_ROOT}/"
else
    find "${WEB_ROOT}" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
    cp -a "${tmp_dir}/." "${WEB_ROOT}/"
fi

chown -R root:root "${WEB_ROOT}"
find "${WEB_ROOT}" -type d -exec chmod 0755 {} +
find "${WEB_ROOT}" -type f -exec chmod 0644 {} +

info "Testing nginx configuration"
nginx -t

info "Reloading nginx"
if command -v systemctl >/dev/null 2>&1; then
    systemctl reload nginx
else
    service nginx reload || nginx -s reload
fi

echo "Production update complete."
