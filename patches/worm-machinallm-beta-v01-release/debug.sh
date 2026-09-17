#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/opt/worm/apps/com.worm.machinallm"
SRC="$PROJECT_DIR/app/src/main/java/com/worm/machinallm"
ARTIFACT_DIR="/opt/worm/artifacts/machinallm/beta.v01"
APK="$ARTIFACT_DIR/MachinaLLM-beta.v01.apk"
AAPT="${AAPT:-/opt/android-sdk/build-tools/36.1.0/aapt}"
APKSIGNER="${APKSIGNER:-/opt/android-sdk/build-tools/36.1.0/apksigner}"

test -f "$APK"
test -d "/opt/worm/patches/worm-machinallm-beta-v01-ssh"
test -d "/opt/worm/patches/worm-machinallm-beta-v01-sftp"
test -d "/opt/worm/patches/worm-machinallm-beta-v01-ai"

badging="$("$AAPT" dump badging "$APK")"
printf '%s\n' "$badging" | grep -q "package: name='com.worm.machinallm'"
printf '%s\n' "$badging" | grep -q "versionCode='100'"
printf '%s\n' "$badging" | grep -q "versionName='beta.v01'"
printf '%s\n' "$badging" | grep -q "application-label:'MachinaLLM'"

permissions="$("$AAPT" dump permissions "$APK")"
printf '%s\n' "$permissions" | grep -q 'android.permission.INTERNET'
if printf '%s\n' "$permissions" | grep -Eq 'android.permission.(CAMERA|RECORD_AUDIO|ACCESS_FINE_LOCATION|ACCESS_COARSE_LOCATION|READ_CONTACTS|WRITE_CONTACTS|READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE|READ_MEDIA_|MANAGE_EXTERNAL_STORAGE)'; then
    echo "$permissions"
    echo "[ERROR] forbidden permission present" >&2
    exit 1
fi

"$APKSIGNER" verify --verbose --print-certs "$APK" > "$ARTIFACT_DIR/apksigner-verify.txt"

grep -q 'HostKeyVerifier' "$SRC/ssh/SshConnectionManager.kt"
grep -q 'newSFTPClient' "$SRC/ssh/SshConnectionManager.kt"
grep -q 'command = "command -v term-llm"' "$SRC/ssh/AiRemoteManager.kt"
grep -q 'command = "term-llm"' "$SRC/ssh/AiRemoteManager.kt"
grep -q 'stdin = prompt' "$SRC/ssh/AiRemoteManager.kt"
grep -q 'dynamicDarkColorScheme(context)' "$SRC/ui/theme/Theme.kt"
grep -q 'dynamicLightColorScheme(context)' "$SRC/ui/theme/Theme.kt"
grep -q 'android:exported="false"' "$PROJECT_DIR/app/src/main/AndroidManifest.xml"

if grep -R -n 'OPENAI_API_KEY' "$PROJECT_DIR/app/src/main" "$PROJECT_DIR/app/build.gradle.kts" "$PROJECT_DIR/gradle/libs.versions.toml" >/tmp/machinallm-release-secret-scan.txt; then
    sed 's/:.*/: [REDACTED]/' /tmp/machinallm-release-secret-scan.txt
    echo "[ERROR] forbidden OPENAI_API_KEY literal in app source" >&2
    exit 1
fi

if grep -a -q 'OPENAI_API_KEY' "$APK" || grep -a -q 'https://api.openai.com' "$APK" || grep -a -q 'Bearer ' "$APK"; then
    echo "[ERROR] forbidden AI secret/API marker in APK" >&2
    exit 1
fi

(
    cd "$ARTIFACT_DIR"
    sha256sum -c SHA256SUMS >/dev/null
)

echo "[OK] SSH: OK"
echo "[OK] SFTP: OK"
echo "[OK] AI: OK"
echo "[OK] Known hosts: OK"
echo "[OK] Secret scan: OK"
echo "[OK] Build artifact: OK"
echo "[OK] Signature: OK"
echo "[INFO] APK: $APK"
