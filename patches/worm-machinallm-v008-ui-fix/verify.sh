#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/opt/worm/apps/com.worm.machinallm"
ARTIFACT_DIR="/opt/worm/artifacts/machinallm/0.1.1"
APK="$ARTIFACT_DIR/MachinaLLM-0.1.1.apk"
AAPT="${AAPT:-/opt/android-sdk/build-tools/36.1.0/aapt}"
APKSIGNER="${APKSIGNER:-/opt/android-sdk/build-tools/36.1.0/apksigner}"

test -f "$APK"
"$APKSIGNER" verify --verbose --print-certs "$APK" >/dev/null
echo "[OK] APK signature verified"

badging="$("$AAPT" dump badging "$APK")"
printf '%s\n' "$badging" | grep -q "package: name='com.worm.machinallm'"
printf '%s\n' "$badging" | grep -q "versionCode='2'"
printf '%s\n' "$badging" | grep -q "versionName='0.1.1'"
printf '%s\n' "$badging" | grep -q "sdkVersion:'31'"
printf '%s\n' "$badging" | grep -q "targetSdkVersion:'36'"

permissions="$("$AAPT" dump permissions "$APK")"
if printf '%s\n' "$permissions" | grep -Eq 'android.permission.(INTERNET|CAMERA|RECORD_AUDIO|ACCESS_FINE_LOCATION|ACCESS_COARSE_LOCATION|READ_CONTACTS|WRITE_CONTACTS|READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE|READ_MEDIA_)'; then
    echo "$permissions"
    echo "[ERROR] forbidden permission present" >&2
    exit 1
fi

if grep -R -n -E 'OPENAI_API_KEY|API_KEY|SECRET|TOKEN|PASSWORD|Bearer|sk-|OkHttp|Retrofit|WebView|analytics|telemetry|crashlytics|firebase' \
    "$PROJECT_DIR/app/src/main" "$PROJECT_DIR/app/build.gradle.kts" "$PROJECT_DIR/gradle.properties" \
    "$PROJECT_DIR/settings.gradle.kts" "$PROJECT_DIR/build.gradle.kts" \
    >/tmp/machinallm-v008-security.txt; then
    sed 's/:.*/: [REDACTED]/' /tmp/machinallm-v008-security.txt
    echo "[ERROR] security marker found" >&2
    exit 1
fi

grep -q 'dynamicDarkColorScheme(context)' "$PROJECT_DIR/app/src/main/java/com/worm/machinallm/ui/theme/Theme.kt"
grep -q 'dynamicLightColorScheme(context)' "$PROJECT_DIR/app/src/main/java/com/worm/machinallm/ui/theme/Theme.kt"
grep -q 'isSystemInDarkTheme()' "$PROJECT_DIR/app/src/main/java/com/worm/machinallm/ui/theme/Theme.kt"
grep -q 'How can I help?' "$PROJECT_DIR/app/src/main/res/values/strings.xml"
grep -q 'MachinaLLM backend is not configured yet.' "$PROJECT_DIR/app/src/main/java/com/worm/machinallm/provider/LocalPlaceholderProvider.kt"
grep -q 'MachinaRepository' "$PROJECT_DIR/app/src/main/java/com/worm/machinallm/ui/chat/MachinaChatScreen.kt"
grep -q 'LocalPlaceholderProvider' "$PROJECT_DIR/app/src/main/java/com/worm/machinallm/core/MachinaCore.kt"
grep -q 'OutlinedTextField' "$PROJECT_DIR/app/src/main/java/com/worm/machinallm/ui/chat/MachinaChatScreen.kt"
grep -q 'onSend' "$PROJECT_DIR/app/src/main/java/com/worm/machinallm/ui/chat/MachinaChatScreen.kt"

if grep -R -n -E 'Relaxed|#[0-9A-Fa-f]{6,8}' "$PROJECT_DIR/app/src/main" >/tmp/machinallm-v008-colors.txt; then
    cat /tmp/machinallm-v008-colors.txt
    echo "[ERROR] hardcoded color marker found" >&2
    exit 1
fi

(
    cd "$ARTIFACT_DIR"
    sha256sum MachinaLLM-0.1.1.apk > SHA256SUMS
)

echo "[INFO] package: com.worm.machinallm"
echo "[INFO] versionCode: 2"
echo "[INFO] versionName: 0.1.1"
echo "[INFO] minSdk: 31"
echo "[INFO] targetSdk: 36"
echo "[INFO] permissions:"
echo "$permissions"
echo "[OK] SHA256"
cat "$ARTIFACT_DIR/SHA256SUMS"
echo "[OK] MachinaLLM APK ready"
