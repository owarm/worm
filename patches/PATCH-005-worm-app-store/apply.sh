#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:-/opt/worm/grapheneos}"
APK="${WORM_APPSTORE_APK:-${2:-}}"

DEST="$TARGET/external/AppStore/prebuilt/app-release.apk"
BACKUP="$DEST.worm-stock.bak"

echo "=== PATCH-005 WORM APP STORE ==="
echo "TARGET=$TARGET"

if [ -z "$APK" ]; then
    echo "ERROR: set WORM_APPSTORE_APK or pass APK as second argument"
    exit 1
fi

if [ ! -f "$APK" ]; then
    echo "ERROR: Worm Apps APK not found: $APK"
    exit 1
fi

if [ ! -f "$DEST" ]; then
    echo "ERROR: GrapheneOS AppStore prebuilt not found: $DEST"
    exit 1
fi

if [ ! -f "$BACKUP" ]; then
    echo "Saving stock GrapheneOS Apps backup"
    cp -a "$DEST" "$BACKUP"
fi

echo "Installing Worm Apps APK"
cp -f "$APK" "$DEST"
chmod 0644 "$DEST"

echo
echo "=== SHA256 ==="
sha256sum "$DEST"

echo
echo "=== ZIP CHECK ==="
unzip -tq "$DEST"

echo
echo "=== PATCH-005 APPLY PASS ==="
