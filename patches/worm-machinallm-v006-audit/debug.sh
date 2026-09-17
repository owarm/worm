#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/opt/worm/apps/com.worm.machinallm"
APP_BUILD="$PROJECT_DIR/app/build.gradle.kts"
MANIFEST="$PROJECT_DIR/app/src/main/AndroidManifest.xml"
MERGED_MANIFEST="$PROJECT_DIR/app/build/intermediates/merged_manifest/debug/processDebugMainManifest/AndroidManifest.xml"
APK="$PROJECT_DIR/app/build/outputs/apk/debug/app-debug.apk"
AAPT="/opt/android-sdk/build-tools/36.1.0/aapt"

export ANDROID_HOME="${ANDROID_HOME:-/opt/android-sdk}"
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"
export GRADLE_USER_HOME="${GRADLE_USER_HOME:-$PROJECT_DIR/.gradle}"

echo "[INFO] JDK: $(java -version 2>&1 | head -n 1)"
echo "[INFO] Gradle: $("$PROJECT_DIR/gradlew" --version --quiet | awk '/Gradle / { print $2; exit }')"
echo "[INFO] Android SDK: $ANDROID_HOME"
echo "[INFO] compileSdk: $(awk -F'= *' '/compileSdk/ { print $2; exit }' "$APP_BUILD")"
echo "[INFO] targetSdk: $(awk -F'= *' '/targetSdk/ { print $2; exit }' "$APP_BUILD")"
echo "[INFO] minSdk: $(awk -F'= *' '/minSdk/ { print $2; exit }' "$APP_BUILD")"

grep -q 'applicationId = "com.worm.machinallm"' "$APP_BUILD"
grep -q 'versionName = "0.1.0"' "$APP_BUILD"
grep -q 'android:exported="false"' "$MANIFEST"
grep -q 'android:name="com.worm.machinallm.service.MachinaLlmService"' "$MERGED_MANIFEST"
test -f "$APK"

echo "[OK] manifest/service/package checks passed"
echo "[INFO] APK: $APK"
echo "[INFO] size: $(stat -c '%s bytes' "$APK")"
echo "[INFO] SHA256: $(sha256sum "$APK" | awk '{ print $1 }')"

if [ -x "$AAPT" ]; then
    "$AAPT" dump badging "$APK" | sed -n '1,4p'
    "$AAPT" dump permissions "$APK"
fi
