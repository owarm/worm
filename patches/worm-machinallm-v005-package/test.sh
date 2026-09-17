#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/opt/worm/apps/com.worm.machinallm"
APP_BUILD="$PROJECT_DIR/app/build.gradle.kts"
SRC="$PROJECT_DIR/app/src/main"
KOTLIN_SRC="$SRC/java/com/worm/machinallm"
MANIFEST="$SRC/AndroidManifest.xml"
APK="$PROJECT_DIR/app/build/outputs/apk/debug/app-debug.apk"

test -f "$PROJECT_DIR/settings.gradle.kts"
test -f "$PROJECT_DIR/build.gradle.kts"
test -f "$APP_BUILD"
test -f "$MANIFEST"
grep -q 'applicationId = "com.worm.machinallm"' "$APP_BUILD"
grep -q 'android:name=".MainActivity"' "$MANIFEST"
grep -q 'android:name=".service.MachinaLlmService"' "$MANIFEST"
test -f "$KOTLIN_SRC/MainActivity.kt"
test -f "$KOTLIN_SRC/service/MachinaLlmService.kt"
test -f "$KOTLIN_SRC/provider/LocalPlaceholderProvider.kt"
test -f "$APK"

echo "[OK] Gradle project valid"
echo "[OK] manifest valid"
echo "[OK] package correct"
echo "[OK] MainActivity present"
echo "[OK] service present"
echo "[OK] provider local present"
echo "[OK] APK compiled"
