#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/opt/worm/apps/com.worm.machinallm"
SRC="$PROJECT_DIR/app/src/main/java/com/worm/machinallm"
SERVICE="$SRC/service/MachinaLlmService.kt"
MANIFEST="$PROJECT_DIR/app/src/main/AndroidManifest.xml"
MERGED_MANIFEST="$PROJECT_DIR/app/build/intermediates/merged_manifest/debug/processDebugMainManifest/AndroidManifest.xml"
APK="$PROJECT_DIR/app/build/outputs/apk/debug/app-debug.apk"

export ANDROID_HOME="${ANDROID_HOME:-/opt/android-sdk}"
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"
export GRADLE_USER_HOME="${GRADLE_USER_HOME:-$PROJECT_DIR/.gradle}"

echo "[INFO] JDK: $(java -version 2>&1 | head -n 1)"
echo "[INFO] Android SDK: $ANDROID_HOME"
echo "[INFO] Gradle: $("$PROJECT_DIR/gradlew" --version --quiet | awk '/Gradle / { print $2; exit }')"

test -f "$SERVICE"
grep -q 'class MachinaLlmService : Service()' "$SERVICE"
grep -q 'LocalBinder' "$SERVICE"
grep -q 'ProviderType.LOCAL_PLACEHOLDER' "$SERVICE"
grep -q 'MachinaRepository' "$SERVICE"

grep -q 'package="com.worm.machinallm"' "$MERGED_MANIFEST"
grep -q 'android:name="com.worm.machinallm.service.MachinaLlmService"' "$MERGED_MANIFEST"
grep -q 'android:exported="false"' "$MERGED_MANIFEST"

if grep -Eq 'android.permission.(INTERNET|BIND_|MANAGE_|READ_|WRITE_|CAMERA|RECORD_AUDIO|ACCESS_FINE_LOCATION|ACCESS_COARSE_LOCATION)' "$MANIFEST" "$MERGED_MANIFEST"; then
    echo "[ERROR] Forbidden permission found in manifest" >&2
    exit 1
fi

if grep -Eq 'sharedUserId|android.uid.system|protectionLevel="signature"' "$MANIFEST"; then
    echo "[ERROR] Privileged/system service marker found" >&2
    exit 1
fi

if grep -Eq 'sharedUserId|android.uid.system|android.permission.BIND_|android.permission.MANAGE_' "$MERGED_MANIFEST"; then
    echo "[ERROR] Privileged/system marker found in merged manifest" >&2
    exit 1
fi

if grep -R -Eq 'OkHttp|Retrofit|WebView|android.permission.INTERNET' "$PROJECT_DIR/app/src/main" "$PROJECT_DIR/app/build.gradle.kts"; then
    echo "[ERROR] Forbidden network implementation found" >&2
    exit 1
fi

test -f "$APK"
echo "[OK] service class present"
echo "[OK] manifest registration present"
echo "[OK] exported=false"
echo "[OK] package: com.worm.machinallm"
echo "[OK] provider: LOCAL_PLACEHOLDER"
echo "[OK] APK: $APK"
sha256sum "$APK"
