#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:-/opt/worm/grapheneos}"

CONFIG="$TARGET/packages/apps/Updater/res/values/config.xml"
NETSEC="$TARGET/packages/apps/Updater/res/xml/network_security_config.xml"

echo "=== PATCH-006 VERIFY ==="

grep -q \
  'https://releases.coffee.pm/' \
  "$CONFIG"

grep -q \
  '>releases.coffee.pm<' \
  "$NETSEC"

if grep -q 'releases.grapheneos.org' "$CONFIG" "$NETSEC"; then
    echo "ERROR: GrapheneOS release URL still present"
    exit 1
fi

echo "PATCH-006 VERIFY PASS"
