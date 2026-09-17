#!/usr/bin/env bash
set -euo pipefail

PORTAL_ROOT="/opt/worm/private-portal"
WEBROOT="/var/www/worm-private"
FILES_DIR="${WEBROOT}/files"
NGINX_SRC="${PORTAL_ROOT}/nginx/worm-private.conf"
NGINX_AVAILABLE="/etc/nginx/sites-available/worm-private.conf"
NGINX_ENABLED="/etc/nginx/sites-enabled/worm-private.conf"
CERT="/etc/letsencrypt/live/coffee.pm/fullchain.pem"
CERT_KEY="/etc/letsencrypt/live/coffee.pm/privkey.pem"

cd "${PORTAL_ROOT}"

node scripts/generate-index.mjs
TZ=Europe/Rome python3 timeline/timeline.py
node -e "JSON.parse(require('fs').readFileSync('public-data/releases.json','utf8')); JSON.parse(require('fs').readFileSync('public-data/ota.json','utf8')); JSON.parse(require('fs').readFileSync('public-data/timeline.json','utf8'))"

if find public-data -type f | grep -Ei 'target_files|\.pk8$|private|auth\.env|id_rsa|id_ed25519|avb.*key' >/dev/null; then
  echo "Refusing deploy: unsafe public-data filename detected" >&2
  exit 1
fi

if grep -RIE 'target_files|/opt/worm/keys|/opt/worm/source|auth\.env|BEGIN (RSA |OPENSSH |EC |PRIVATE )?PRIVATE KEY|WireGuard private' public-data index.html style.css app.js >/dev/null; then
  echo "Refusing deploy: sensitive string detected in portal output" >&2
  exit 1
fi

install -d -m 0755 "${WEBROOT}" "${FILES_DIR}"
install -m 0644 index.html style.css app.js "${WEBROOT}/"
install -d -m 0755 "${WEBROOT}/public-data"
install -m 0644 public-data/releases.json public-data/ota.json public-data/timeline.json "${WEBROOT}/public-data/"

find "${FILES_DIR}" -mindepth 1 -maxdepth 1 -type l -delete
node <<'NODE'
const fs = require("fs");
const path = require("path");
const manifest = JSON.parse(fs.readFileSync("/opt/worm/private-portal/.private-data/manifest.json", "utf8"));
const filesDir = "/var/www/worm-private/files";
const allowed = manifest.roots.map((root) => fs.realpathSync(root)).filter(Boolean);
function inside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}
for (const file of manifest.files) {
  const source = fs.realpathSync(file.sourcePath);
  if (!allowed.some((root) => inside(source, root))) throw new Error(`source outside allowlist: ${file.filename}`);
  if (/target_files|\.pk8$|private|auth\.env|id_rsa|id_ed25519|avb.*key/i.test(file.filename)) throw new Error(`unsafe filename: ${file.filename}`);
  fs.symlinkSync(source, path.join(filesDir, file.linkName));
}
NODE

if [[ ! -f "${CERT}" || ! -f "${CERT_KEY}" ]]; then
  echo "Missing valid worm.coffee.pm or wildcard coffee.pm Let's Encrypt certificate:" >&2
  echo "  ${CERT}" >&2
  echo "  ${CERT_KEY}" >&2
  echo "Create/restore the certificate without publishing the application, then rerun." >&2
  exit 1
fi

tmp_conf="$(mktemp)"
install -m 0644 "${NGINX_SRC}" "${tmp_conf}"
install -m 0644 "${tmp_conf}" "${NGINX_AVAILABLE}.tmp"
mv "${NGINX_AVAILABLE}.tmp" "${NGINX_AVAILABLE}"
ln -sfn "${NGINX_AVAILABLE}" "${NGINX_ENABLED}"
rm -f "${tmp_conf}"

nginx -t
systemctl reload nginx

echo "WORM PRIVATE RELEASE/OTA PORTAL READY"
