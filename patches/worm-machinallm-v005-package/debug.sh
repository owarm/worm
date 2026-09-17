#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/opt/worm/apps/com.worm.machinallm"
APP_BUILD="$PROJECT_DIR/app/build.gradle.kts"
SRC="$PROJECT_DIR/app/src/main"
KOTLIN_SRC="$SRC/java/com/worm/machinallm"
MANIFEST="$SRC/AndroidManifest.xml"
THEME="$KOTLIN_SRC/ui/theme/Theme.kt"
PROVIDER="$KOTLIN_SRC/provider/LocalPlaceholderProvider.kt"
SERVICE="$KOTLIN_SRC/service/MachinaLlmService.kt"
MERGED_MANIFEST="$PROJECT_DIR/app/build/intermediates/merged_manifest/debug/processDebugMainManifest/AndroidManifest.xml"
APK="$PROJECT_DIR/app/build/outputs/apk/debug/app-debug.apk"

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
grep -q 'dynamicDarkColorScheme(context)' "$THEME"
grep -q 'dynamicLightColorScheme(context)' "$THEME"
grep -q 'LocalPlaceholderProvider' "$PROVIDER"
grep -q 'class MachinaLlmService : Service()' "$SERVICE"
grep -q 'android:name="com.worm.machinallm.service.MachinaLlmService"' "$MERGED_MANIFEST"
grep -q 'android:exported="false"' "$MERGED_MANIFEST"
test -f "$APK"

if grep -Eq 'android.permission.INTERNET' "$MANIFEST" "$MERGED_MANIFEST"; then
    echo "[ERROR] INTERNET permission found" >&2
    exit 1
fi

if grep -R -n -E 'OPENAI_API_KEY|api[_-]?key[[:space:]]*=|secret[[:space:]]*=|token[[:space:]]*=' "$SRC" "$PROJECT_DIR/app/build.gradle.kts" "$PROJECT_DIR/gradle.properties" "$PROJECT_DIR/local.properties"; then
    echo "[ERROR] secret-like value found" >&2
    exit 1
fi

if grep -R -n -E 'OkHttp|Retrofit|WebView|com\.openai|openai-java|analytics|telemetry|crashlytics|sentry|datadog|bugsnag' "$SRC" "$PROJECT_DIR/app/build.gradle.kts"; then
    echo "[ERROR] forbidden network/analytics/crash reporting symbol found" >&2
    exit 1
fi

echo "[OK] package = com.worm.machinallm"
echo "[OK] version = 0.1.0"
echo "[OK] Dynamic Colors"
echo "[OK] LocalPlaceholderProvider"
echo "[OK] service exported=false"
echo "[OK] no secrets"
echo "[OK] no network permission"
echo "[OK] no analytics"
echo "[OK] offline-only v0.1.0"
echo "[OK] APK: $APK"
echo "[INFO] size: $(stat -c '%s bytes' "$APK")"
echo "[INFO] SHA256: $(sha256sum "$APK" | awk '{ print $1 }')"
ls -lh "$APK"
