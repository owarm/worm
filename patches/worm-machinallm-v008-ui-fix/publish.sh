#!/usr/bin/env bash
set -euo pipefail

ARTIFACT_DIR="/opt/worm/artifacts/machinallm/0.1.1"
APK="$ARTIFACT_DIR/MachinaLLM-0.1.1.apk"
SHA="$ARTIFACT_DIR/SHA256SUMS"
NGINX_CONF="/etc/nginx/sites-enabled/worm-system-vpn-services.conf"
DOCROOT="/var/www/worm-releases"
PUBLIC_DIR="$DOCROOT/machinallm"
URL="https://releases.coffee.pm/machinallm/MachinaLLM-0.1.1.apk"
SHA_URL="https://releases.coffee.pm/machinallm/SHA256SUMS"

test -f "$APK"
test -f "$SHA"
test -f "$NGINX_CONF"
grep -q 'server_name releases.coffee.pm' "$NGINX_CONF"
test -d "$DOCROOT"

mkdir -p "$PUBLIC_DIR"
cp "$APK" "$PUBLIC_DIR/MachinaLLM-0.1.1.apk"
cp "$SHA" "$PUBLIC_DIR/SHA256SUMS"
cat > "$PUBLIC_DIR/index.html" <<'HTML'
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>MachinaLLM 0.1.1</title>
</head>
<body>
  <h1>MachinaLLM</h1>
  <p>Version 0.1.1</p>
  <p><a href="MachinaLLM-0.1.1.apk">Download APK</a></p>
  <p><a href="MachinaLLM-0.1.0.apk">Previous APK 0.1.0</a></p>
  <p><a href="SHA256SUMS">SHA256SUMS</a></p>
</body>
</html>
HTML

curl -fsSI "$URL" | grep -q 'HTTP/.* 200'
curl --fail --location -o /tmp/MachinaLLM-0.1.1-download-test.apk "$URL"
expected="$(sha256sum "$APK" | awk '{ print $1 }')"
actual="$(sha256sum /tmp/MachinaLLM-0.1.1-download-test.apk | awk '{ print $1 }')"
rm -f /tmp/MachinaLLM-0.1.1-download-test.apk
if [ "$expected" != "$actual" ]; then
    echo "[ERROR] downloaded APK SHA256 mismatch" >&2
    exit 1
fi

echo "[OK] HTTPS artifact verified"
echo "[INFO] download URL: $URL"
echo "[INFO] SHA256 URL: $SHA_URL"
