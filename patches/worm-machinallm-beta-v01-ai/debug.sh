#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/opt/worm/apps/com.worm.machinallm"
SRC="$PROJECT_DIR/app/src/main/java/com/worm/machinallm"
APK="$PROJECT_DIR/app/build/outputs/apk/debug/app-debug.apk"
AAPT="${AAPT:-/opt/android-sdk/build-tools/36.1.0/aapt}"

test -f "$APK"
test -d "/opt/worm/patches/worm-machinallm-beta-v01-ssh"
test -d "/opt/worm/patches/worm-machinallm-beta-v01-sftp"

permissions="$("$AAPT" dump permissions "$APK")"
printf '%s\n' "$permissions" | grep -q 'android.permission.INTERNET'
if printf '%s\n' "$permissions" | grep -Eq 'android.permission.(READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE|READ_MEDIA_|MANAGE_EXTERNAL_STORAGE|CAMERA|RECORD_AUDIO|ACCESS_FINE_LOCATION|ACCESS_COARSE_LOCATION)'; then
    echo "$permissions"
    echo "[ERROR] Forbidden broad/mobile permission present" >&2
    exit 1
fi

grep -q 'class AiRemoteManager' "$SRC/ssh/AiRemoteManager.kt"
grep -q 'command = "command -v term-llm"' "$SRC/ssh/AiRemoteManager.kt"
grep -q 'command = "term-llm"' "$SRC/ssh/AiRemoteManager.kt"
grep -q 'stdin = prompt' "$SRC/ssh/AiRemoteManager.kt"
grep -q 'runRemoteCommand' "$SRC/ssh/SshConnectionManager.kt"
grep -q 'onStdout' "$SRC/ssh/SshConnectionManager.kt"
grep -q 'OpenAI API credits exhausted' "$SRC/ssh/AiRemoteManager.kt"
grep -q 'OpenAI API authentication failed' "$SRC/ssh/AiRemoteManager.kt"
grep -q 'Sensitive content blocked' "$SRC/ui/ai/AiScreen.kt"
grep -q 'AI("AI")' "$SRC/ui/terminal/TerminalScreen.kt"
grep -q 'Last 1K' "$SRC/ui/terminal/TerminalScreen.kt"
grep -q 'Last 4K' "$SRC/ui/terminal/TerminalScreen.kt"
grep -q 'Explain' "$SRC/ui/sftp/SftpScreen.kt"
grep -q 'Summarize' "$SRC/ui/sftp/SftpScreen.kt"
grep -q 'Fix' "$SRC/ui/sftp/SftpScreen.kt"

if grep -R -n 'OPENAI_API_KEY' "$PROJECT_DIR/app/src/main" "$PROJECT_DIR/app/build.gradle.kts" "$PROJECT_DIR/gradle/libs.versions.toml"; then
    echo "[ERROR] OPENAI_API_KEY literal found in Android app sources" >&2
    exit 1
fi

if grep -R -n -E 'sk-[A-Za-z0-9]|Bearer ' "$PROJECT_DIR/app/src/main" "$PROJECT_DIR/app/build.gradle.kts"; then
    echo "[ERROR] API secret marker found" >&2
    exit 1
fi

badging="$("$AAPT" dump badging "$APK")"
printf '%s\n' "$badging" | grep -q "package: name='com.worm.machinallm'"

echo "[OK] AI panel present"
echo "[OK] term-llm detection present"
echo "[OK] AI invocation uses remote stdin"
echo "[OK] terminal and file context actions present"
echo "[OK] privacy checks present"
echo "[OK] no OPENAI_API_KEY literal in app sources"
echo "[INFO] APK: $APK"
