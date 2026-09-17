#!/usr/bin/env bash
set -euo pipefail

PACKAGE="com.worm.machinallm"

find_adb() {
    if command -v adb >/dev/null 2>&1; then
        command -v adb
    elif [ -x "/opt/android-sdk/platform-tools/adb" ]; then
        printf '%s\n' "/opt/android-sdk/platform-tools/adb"
    fi
}

ADB="$(find_adb || true)"
DEVICE_LIST=""
if [ -n "${ADB:-}" ]; then
    DEVICE_LIST="$("$ADB" devices 2>/dev/null || true)"
fi

if [ -n "$DEVICE_LIST" ] && printf '%s\n' "$DEVICE_LIST" | awk 'NR > 1 && $2 == "device" { found = 1 } END { exit found ? 0 : 1 }'; then
    "$ADB" uninstall "$PACKAGE" || true
    echo "[OK] uninstall requested for $PACKAGE"
else
    echo "[INFO] no connected adb device; nothing uninstalled"
fi
