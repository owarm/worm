#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/opt/worm/apps/com.worm.machinallm"
SRC="$PROJECT_DIR/app/src/main/java/com/worm/machinallm"
MAIN="$SRC/MainActivity.kt"
MANIFEST="$PROJECT_DIR/app/src/main/AndroidManifest.xml"
APK="$PROJECT_DIR/app/build/outputs/apk/debug/app-debug.apk"

export ANDROID_HOME="${ANDROID_HOME:-/opt/android-sdk}"
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"
export GRADLE_USER_HOME="${GRADLE_USER_HOME:-$PROJECT_DIR/.gradle}"

echo "[INFO] JDK: $(java -version 2>&1 | head -n 1)"
echo "[INFO] Android SDK: $ANDROID_HOME"
echo "[INFO] Gradle: $("$PROJECT_DIR/gradlew" --version --quiet | awk '/Gradle / { print $2; exit }')"

test -f "$SRC/model/Message.kt"
test -f "$SRC/core/AiResult.kt"
test -f "$SRC/core/ProviderType.kt"
test -f "$SRC/core/MachinaCore.kt"
test -f "$SRC/provider/AiProvider.kt"
test -f "$SRC/provider/LocalPlaceholderProvider.kt"
test -f "$SRC/repository/MachinaRepository.kt"

grep -q 'sealed interface AiResult' "$SRC/core/AiResult.kt"
grep -q 'enum class ProviderType' "$SRC/core/ProviderType.kt"
grep -q 'LOCAL_PLACEHOLDER' "$SRC/core/ProviderType.kt"
grep -q 'suspend fun sendMessage' "$SRC/provider/AiProvider.kt"
grep -q 'MachinaRepository' "$MAIN"
grep -q 'MachinaCore.createRepository' "$MAIN"
grep -q 'LocalPlaceholderProvider' "$SRC/core/MachinaCore.kt"
grep -q 'MachinaLLM backend is not configured yet.' "$SRC/provider/LocalPlaceholderProvider.kt"

if grep -q 'MachinaLLM backend is not configured yet.' "$MAIN"; then
    echo "[ERROR] UI still contains hardcoded backend response" >&2
    exit 1
fi

if grep -Eq 'android.permission.(INTERNET|READ_|WRITE_|CAMERA|RECORD_AUDIO|ACCESS_FINE_LOCATION|ACCESS_COARSE_LOCATION)' "$MANIFEST"; then
    echo "[ERROR] Forbidden permission found in manifest" >&2
    exit 1
fi

if grep -R -Eq 'OkHttp|Retrofit|WebView|android.permission.INTERNET' "$PROJECT_DIR/app/src/main" "$PROJECT_DIR/app/build.gradle.kts"; then
    echo "[ERROR] Forbidden network/provider implementation found" >&2
    exit 1
fi

test -f "$APK"
echo "[OK] architecture core present"
echo "[OK] active provider: LOCAL_PLACEHOLDER"
echo "[OK] UI routes through repository/provider"
echo "[OK] no forbidden permissions"
echo "[OK] APK: $APK"
sha256sum "$APK"
