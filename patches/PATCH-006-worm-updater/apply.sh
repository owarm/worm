#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:-/opt/worm/grapheneos}"

CONFIG="$TARGET/packages/apps/Updater/res/values/config.xml"
NETSEC="$TARGET/packages/apps/Updater/res/xml/network_security_config.xml"

echo "=== PATCH-006 WORM UPDATER ==="
echo "TARGET=$TARGET"

test -f "$CONFIG"
test -f "$NETSEC"

cp -an "$CONFIG" "$CONFIG.worm-stock.bak"
cp -an "$NETSEC" "$NETSEC.worm-stock.bak"

sed -i \
  's#https://releases\.grapheneos\.org/#https://releases.coffee.pm/#g' \
  "$CONFIG"

sed -i \
  's#releases\.grapheneos\.org#releases.coffee.pm#g' \
  "$NETSEC"

echo
echo "=== CONFIG ==="
grep -n 'name="url"' "$CONFIG"

echo
echo "=== TLS DOMAIN ==="
grep -n '<domain' "$NETSEC"

echo
echo "PATCH-006 APPLY PASS"
