#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/opt/worm/apps/com.worm.machinallm"
APK="$PROJECT_DIR/app/build/outputs/apk/debug/app-debug.apk"
AAPT="/opt/android-sdk/build-tools/36.1.0/aapt"

export ANDROID_HOME="${ANDROID_HOME:-/opt/android-sdk}"
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"
export GRADLE_USER_HOME="${GRADLE_USER_HOME:-$PROJECT_DIR/.gradle}"

"/opt/worm/patches/worm-machinallm-v006-audit/audit.sh"

grep -q 'applicationId = "com.worm.machinallm"' "$PROJECT_DIR/app/build.gradle.kts"
grep -q 'android:name=".MainActivity"' "$PROJECT_DIR/app/src/main/AndroidManifest.xml"
grep -q 'android:name=".service.MachinaLlmService"' "$PROJECT_DIR/app/src/main/AndroidManifest.xml"
grep -q 'LocalPlaceholderProvider' "$PROJECT_DIR/app/src/main/java/com/worm/machinallm/provider/LocalPlaceholderProvider.kt"

cd "$PROJECT_DIR"
./gradlew clean assembleDebug
./gradlew lintDebug
./gradlew test

test -f "$APK"
if [ -x "$AAPT" ] && "$AAPT" dump permissions "$APK" | grep -q 'android.permission.INTERNET'; then
    echo "[ERROR] INTERNET permission present in APK" >&2
    exit 1
fi

echo "[OK] v006 audit tests passed"
