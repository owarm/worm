#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/opt/worm/apps/com.worm.machinallm"
APP_BUILD="$PROJECT_DIR/app/build.gradle.kts"
MANIFEST="$PROJECT_DIR/app/src/main/AndroidManifest.xml"
ARTIFACT_DIR="/opt/worm/artifacts/machinallm/0.1.0"
APK="$ARTIFACT_DIR/MachinaLLM-0.1.0.apk"
URL="https://releases.coffee.pm/machinallm/MachinaLLM-0.1.0.apk"

export ANDROID_HOME="${ANDROID_HOME:-/opt/android-sdk}"
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"
export GRADLE_USER_HOME="${GRADLE_USER_HOME:-$PROJECT_DIR/.gradle}"

echo "[INFO] JDK: $(java -version 2>&1 | head -n 1)"
echo "[INFO] Gradle: $("$PROJECT_DIR/gradlew" --version --quiet | awk '/Gradle / { print $2; exit }')"
echo "[INFO] Android SDK: $ANDROID_HOME"
echo "[INFO] build-tools: $(ls "$ANDROID_HOME/build-tools" | sort -V | tail -n 1)"
echo "[INFO] aapt2: $ANDROID_HOME/build-tools/36.1.0/aapt2"
echo "[INFO] apksigner: $ANDROID_HOME/build-tools/36.1.0/apksigner"
echo "[INFO] compileSdk: $(awk -F'= *' '/compileSdk/ { print $2; exit }' "$APP_BUILD")"
echo "[INFO] targetSdk: $(awk -F'= *' '/targetSdk/ { print $2; exit }' "$APP_BUILD")"
echo "[INFO] minSdk: $(awk -F'= *' '/minSdk/ { print $2; exit }' "$APP_BUILD")"

grep -q 'applicationId = "com.worm.machinallm"' "$APP_BUILD"
grep -q 'namespace = "com.worm.machinallm"' "$APP_BUILD"
grep -q 'versionCode = 1' "$APP_BUILD"
grep -q 'versionName = "0.1.0"' "$APP_BUILD"
grep -q '<string name="app_name">MachinaLLM</string>' "$PROJECT_DIR/app/src/main/res/values/strings.xml"
grep -q 'android:name=".MainActivity"' "$MANIFEST"
grep -q 'android:name=".service.MachinaLlmService"' "$MANIFEST"
grep -q 'android:exported="false"' "$MANIFEST"
grep -q 'dynamicDarkColorScheme(context)' "$PROJECT_DIR/app/src/main/java/com/worm/machinallm/ui/theme/Theme.kt"
grep -q 'dynamicLightColorScheme(context)' "$PROJECT_DIR/app/src/main/java/com/worm/machinallm/ui/theme/Theme.kt"

test -f "$APK"
echo "[OK] APK"
"/opt/android-sdk/build-tools/36.1.0/apksigner" verify --verbose --print-certs "$APK" >/dev/null
echo "[OK] signature"
echo "[INFO] package: com.worm.machinallm"
echo "[INFO] version: 0.1.0"
(cd "$ARTIFACT_DIR" && sha256sum -c SHA256SUMS)
echo "[OK] SHA256"
curl -fsSI "$URL" | grep -q 'HTTP/.* 200'
echo "[OK] HTTPS"
echo "[INFO] download URL: $URL"
