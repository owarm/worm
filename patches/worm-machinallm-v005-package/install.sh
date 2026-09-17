#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/opt/worm/apps/com.worm.machinallm"
APK="$PROJECT_DIR/app/build/outputs/apk/debug/app-debug.apk"

find_adb() {
    if command -v adb >/dev/null 2>&1; then
        command -v adb
    elif [ -x "/opt/android-sdk/platform-tools/adb" ]; then
        printf '%s\n' "/opt/android-sdk/platform-tools/adb"
    fi
}

if [ ! -f "$APK" ]; then
    echo "[INFO] APK not found, building first"
    /opt/worm/patches/worm-machinallm-v005-package/build.sh
fi

ADB="$(find_adb || true)"
DEVICE_LIST=""
if [ -n "${ADB:-}" ]; then
    DEVICE_LIST="$("$ADB" devices 2>/dev/null || true)"
fi

if [ -n "$DEVICE_LIST" ] && printf '%s\n' "$DEVICE_LIST" | awk 'NR > 1 && $2 == "device" { found = 1 } END { exit found ? 0 : 1 }'; then
    "$ADB" install -r "$APK"
    echo "[OK] installed com.worm.machinallm"
else
    echo "[INFO] APK ready for manual installation"
    echo "[INFO] APK: $APK"
fi
