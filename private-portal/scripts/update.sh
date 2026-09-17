#!/usr/bin/env bash
set -euo pipefail

PORTAL_ROOT="/opt/worm/private-portal"
WEBROOT="/var/www/worm-private"
FILES_DIR="${WEBROOT}/files"

cd "${PORTAL_ROOT}"

node scripts/generate-index.mjs
TZ=Europe/Rome python3 timeline/timeline.py
node -e "JSON.parse(require('fs').readFileSync('public-data/releases.json','utf8')); JSON.parse(require('fs').readFileSync('public-data/ota.json','utf8')); JSON.parse(require('fs').readFileSync('public-data/timeline.json','utf8'))"

if [[ ! -d "${WEBROOT}" ]]; then
  echo "Portal webroot does not exist. Run sudo ./scripts/deploy.sh first." >&2
  exit 1
fi

install -d -m 0755 "${WEBROOT}/public-data" "${FILES_DIR}"
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

echo "Worm private portal indexes updated."
