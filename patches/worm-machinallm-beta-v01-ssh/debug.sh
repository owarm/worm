#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/opt/worm/apps/com.worm.machinallm"
SRC="$PROJECT_DIR/app/src/main/java/com/worm/machinallm"
APK="$PROJECT_DIR/app/build/outputs/apk/debug/app-debug.apk"
AAPT="${AAPT:-/opt/android-sdk/build-tools/36.1.0/aapt}"

test -f "$APK"

permissions="$("$AAPT" dump permissions "$APK")"
printf '%s\n' "$permissions" | grep -q 'android.permission.INTERNET'
if printf '%s\n' "$permissions" | grep -Eq 'android.permission.(CAMERA|RECORD_AUDIO|ACCESS_FINE_LOCATION|ACCESS_COARSE_LOCATION|READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE|READ_MEDIA_|MANAGE_EXTERNAL_STORAGE)'; then
    echo "$permissions"
    echo "[ERROR] Forbidden broad/mobile permission present" >&2
    exit 1
fi

grep -q 'sshj = "0.40.0"' "$PROJECT_DIR/gradle/libs.versions.toml"
grep -q 'AndroidKeyStore' "$SRC/ssh/SecureSecretStore.kt"
grep -q 'AES/GCM/NoPadding' "$SRC/ssh/SecureSecretStore.kt"
grep -q 'machinallm_ssh_known_hosts' "$SRC/ssh/KnownHostsStore.kt"
grep -q 'HostKeyVerifier' "$SRC/ssh/SshConnectionManager.kt"
grep -q 'PendingHostKey' "$SRC/ssh/SshConnectionManager.kt"
grep -q 'Host key changed. Connection blocked.' "$SRC/ssh/SshConnectionManager.kt"
grep -q 'xterm-256color' "$SRC/ssh/SshConnectionManager.kt"
grep -q 'startShell' "$SRC/ssh/SshConnectionManager.kt"
grep -q 'TerminalScreen' "$SRC/ui/terminal/TerminalScreen.kt"
grep -q 'Reconnect' "$SRC/ui/terminal/TerminalScreen.kt"
grep -q 'PRIVATE_KEY' "$SRC/ssh/SshHostProfile.kt"
grep -q 'PASSWORD' "$SRC/ssh/SshHostProfile.kt"

if grep -R -n -E 'OPENAI_API_KEY|sk-[A-Za-z0-9]|Bearer ' "$PROJECT_DIR/app/src/main" "$PROJECT_DIR/app/build.gradle.kts"; then
    echo "[ERROR] OpenAI/API secret marker found" >&2
    exit 1
fi

badging="$("$AAPT" dump badging "$APK")"
printf '%s\n' "$badging" | grep -q "package: name='com.worm.machinallm'"
printf '%s\n' "$badging" | grep -q "sdkVersion:'31'"
printf '%s\n' "$badging" | grep -q "targetSdkVersion:'36'"

echo "[OK] INTERNET permission present and no forbidden mobile permissions found"
echo "[OK] SSHJ dependency present"
echo "[OK] Android Keystore encrypted secret storage present"
echo "[OK] known_hosts fingerprint verification present"
echo "[OK] terminal shell UI present"
echo "[OK] package/minSdk/targetSdk verified"
echo "[INFO] APK: $APK"
