#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/opt/worm/apps/com.worm.machinallm"
APK="$PROJECT_DIR/app/build/outputs/apk/debug/app-debug.apk"

export ANDROID_HOME="${ANDROID_HOME:-/opt/android-sdk}"
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"

cd "$PROJECT_DIR"
./gradlew assembleDebug
test -f "$APK"
echo "[OK] Debug APK: $APK"
echo "[INFO] Size: $(stat -c '%s bytes' "$APK")"
