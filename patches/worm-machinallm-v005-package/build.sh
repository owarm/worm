#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/opt/worm/apps/com.worm.machinallm"
APK="$PROJECT_DIR/app/build/outputs/apk/debug/app-debug.apk"

export ANDROID_HOME="${ANDROID_HOME:-/opt/android-sdk}"
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"
export GRADLE_USER_HOME="${GRADLE_USER_HOME:-$PROJECT_DIR/.gradle}"

cd "$PROJECT_DIR"
./gradlew clean assembleDebug

echo "[OK] build successful"
echo "[INFO] APK: $APK"
echo "[INFO] size: $(stat -c '%s bytes' "$APK")"
echo "[INFO] SHA256: $(sha256sum "$APK" | awk '{ print $1 }')"
ls -lh "$APK"
