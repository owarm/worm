#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:-/opt/worm/grapheneos}"
DEST="$TARGET/external/AppStore/prebuilt/app-release.apk"

echo "=== PATCH-005 VERIFY ==="

test -f "$DEST"

grep -q 'apk: "prebuilt/app-release.apk"' \
    "$TARGET/external/AppStore/Android.bp"

unzip -tq "$DEST"

echo
sha256sum "$DEST"

echo
echo "PATCH-005 VERIFY PASS"
