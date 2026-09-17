#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/opt/worm/apps/com.worm.machinallm"
APP_BUILD="$PROJECT_DIR/app/build.gradle.kts"
MANIFEST="$PROJECT_DIR/app/src/main/AndroidManifest.xml"
THEME="$PROJECT_DIR/app/src/main/java/com/worm/machinallm/ui/theme/Theme.kt"
APK="$PROJECT_DIR/app/build/outputs/apk/debug/app-debug.apk"

export ANDROID_HOME="${ANDROID_HOME:-/opt/android-sdk}"
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"
export GRADLE_USER_HOME="${GRADLE_USER_HOME:-$PROJECT_DIR/.gradle}"

echo "[INFO] JDK: $(java -version 2>&1 | head -n 1)"
echo "[INFO] Android SDK: $ANDROID_HOME"
echo "[INFO] Gradle: $("$PROJECT_DIR/gradlew" --version --quiet | awk '/Gradle / { print $2; exit }')"
echo "[INFO] build-tools: $(ls "$ANDROID_HOME/build-tools" | sort -V | tail -n 1)"
echo "[INFO] compileSdk: $(awk -F'= *' '/compileSdk/ { print $2; exit }' "$APP_BUILD")"
echo "[INFO] targetSdk: $(awk -F'= *' '/targetSdk/ { print $2; exit }' "$APP_BUILD")"
echo "[INFO] minSdk: $(awk -F'= *' '/minSdk/ { print $2; exit }' "$APP_BUILD")"

grep -q 'applicationId = "com.worm.machinallm"' "$APP_BUILD"
grep -q 'namespace = "com.worm.machinallm"' "$APP_BUILD"
grep -q 'android:name=".MainActivity"' "$MANIFEST"
grep -q 'dynamicDarkColorScheme(context)' "$THEME"
grep -q 'dynamicLightColorScheme(context)' "$THEME"
grep -q 'isSystemInDarkTheme()' "$THEME"

if grep -Eq 'android.permission.(INTERNET|READ_|WRITE_|CAMERA|RECORD_AUDIO|ACCESS_FINE_LOCATION|ACCESS_COARSE_LOCATION)' "$MANIFEST"; then
    echo "[ERROR] Forbidden permission found in manifest" >&2
    exit 1
fi

test -f "$APK"
echo "[OK] package: com.worm.machinallm"
echo "[OK] manifest minimal"
echo "[OK] Dynamic Colors enabled"
echo "[OK] APK: $APK"
sha256sum "$APK"
