#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/opt/worm/apps/com.worm.machinallm"
SRC="$PROJECT_DIR/app/src/main/java/com/worm/machinallm"
APK="$PROJECT_DIR/app/build/outputs/apk/debug/app-debug.apk"
AAPT="${AAPT:-/opt/android-sdk/build-tools/36.1.0/aapt}"

test -f "$APK"
test -d "/opt/worm/patches/worm-machinallm-beta-v01-ssh"

permissions="$("$AAPT" dump permissions "$APK")"
printf '%s\n' "$permissions" | grep -q 'android.permission.INTERNET'
if printf '%s\n' "$permissions" | grep -Eq 'android.permission.(READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE|READ_MEDIA_|MANAGE_EXTERNAL_STORAGE|CAMERA|RECORD_AUDIO|ACCESS_FINE_LOCATION|ACCESS_COARSE_LOCATION)'; then
    echo "$permissions"
    echo "[ERROR] Forbidden broad/mobile permission present" >&2
    exit 1
fi

grep -q 'newSFTPClient' "$SRC/ssh/SshConnectionManager.kt"
grep -q 'fun <T> withSftpClient' "$SRC/ssh/SshConnectionManager.kt"
grep -q 'class SftpManager' "$SRC/ssh/SftpManager.kt"
grep -q 'listDirectory' "$SRC/ssh/SftpManager.kt"
grep -q 'download' "$SRC/ssh/SftpManager.kt"
grep -q 'upload' "$SRC/ssh/SftpManager.kt"
grep -q 'rename' "$SRC/ssh/SftpManager.kt"
grep -q 'mkdir' "$SRC/ssh/SftpManager.kt"
grep -q 'deleteFile' "$SRC/ssh/SftpManager.kt"
grep -q 'deleteDirectory' "$SRC/ssh/SftpManager.kt"
grep -q 'TEXT_FILE_LIMIT_BYTES' "$SRC/ssh/SftpManager.kt"
grep -q 'SftpSaveResult.Conflict' "$SRC/ui/sftp/SftpScreen.kt"
grep -q 'ActivityResultContracts.CreateDocument' "$SRC/ui/sftp/SftpScreen.kt"
grep -q 'ActivityResultContracts.OpenDocument' "$SRC/ui/sftp/SftpScreen.kt"
grep -q 'cacheDir' "$SRC/ssh/SftpManager.kt"
grep -q 'TabRow' "$SRC/ui/terminal/TerminalScreen.kt"
grep -q 'Terminal' "$SRC/ui/terminal/TerminalScreen.kt"
grep -q 'Files' "$SRC/ui/terminal/TerminalScreen.kt"

if grep -R -n -E 'OPENAI_API_KEY|sk-[A-Za-z0-9]|Bearer ' "$PROJECT_DIR/app/src/main" "$PROJECT_DIR/app/build.gradle.kts"; then
    echo "[ERROR] OpenAI/API secret marker found" >&2
    exit 1
fi

badging="$("$AAPT" dump badging "$APK")"
printf '%s\n' "$badging" | grep -q "package: name='com.worm.machinallm'"

echo "[OK] SFTP uses active SSH connection"
echo "[OK] file browser present"
echo "[OK] text viewer/editor with mtime conflict check present"
echo "[OK] SAF upload/download present"
echo "[OK] no broad storage permission"
echo "[INFO] APK: $APK"
