#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/opt/worm/apps/com.worm.machinallm"
export ANDROID_HOME="${ANDROID_HOME:-/opt/android-sdk}"
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"
export GRADLE_USER_HOME="${GRADLE_USER_HOME:-$PROJECT_DIR/.gradle}"

cd "$PROJECT_DIR"
./gradlew assembleDebug

APK="$PROJECT_DIR/app/build/outputs/apk/debug/app-debug.apk"
echo "[OK] build successful"
echo "[INFO] APK: $APK"
sha256sum "$APK"
