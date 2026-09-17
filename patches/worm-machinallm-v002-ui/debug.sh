#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/opt/worm/apps/com.worm.machinallm"
MAIN="$PROJECT_DIR/app/src/main/java/com/worm/machinallm/MainActivity.kt"
MODEL="$PROJECT_DIR/app/src/main/java/com/worm/machinallm/Message.kt"
MANIFEST="$PROJECT_DIR/app/src/main/AndroidManifest.xml"
APK="$PROJECT_DIR/app/build/outputs/apk/debug/app-debug.apk"

export ANDROID_HOME="${ANDROID_HOME:-/opt/android-sdk}"
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"
export GRADLE_USER_HOME="${GRADLE_USER_HOME:-$PROJECT_DIR/.gradle}"

echo "[INFO] JDK: $(java -version 2>&1 | head -n 1)"
echo "[INFO] Android SDK: $ANDROID_HOME"
echo "[INFO] Gradle: $("$PROJECT_DIR/gradlew" --version --quiet | awk '/Gradle / { print $2; exit }')"

grep -q 'data class Message' "$MODEL"
grep -q 'enum class MessageRole' "$MODEL"
grep -q 'LazyColumn' "$MAIN"
grep -q 'TopAppBar' "$MAIN"
grep -q 'OutlinedTextField' "$MAIN"
grep -q 'rememberSaveable' "$MAIN"
grep -q 'MachinaLLM backend is not configured yet.' "$MAIN"
grep -q 'enableEdgeToEdge()' "$MAIN"

if grep -Eq 'android.permission.(INTERNET|READ_|WRITE_|CAMERA|RECORD_AUDIO|ACCESS_FINE_LOCATION|ACCESS_COARSE_LOCATION)' "$MANIFEST"; then
    echo "[ERROR] Forbidden permission found in manifest" >&2
    exit 1
fi

if grep -R -Eq 'OpenAI|OkHttp|Retrofit|WebView|INTERNET' "$PROJECT_DIR/app/src/main" "$PROJECT_DIR/app/build.gradle.kts"; then
    echo "[ERROR] Forbidden network/provider symbol found" >&2
    exit 1
fi

test -f "$APK"
echo "[OK] local chat UI present"
echo "[OK] no forbidden permissions"
echo "[OK] APK: $APK"
sha256sum "$APK"
