#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/opt/worm/apps/com.worm.machinallm"
SRC="$PROJECT_DIR/app/src/main/java/com/worm/machinallm"

grep -q 'android.permission.INTERNET' "$PROJECT_DIR/app/src/main/AndroidManifest.xml"
grep -q 'sshj = "0.40.0"' "$PROJECT_DIR/gradle/libs.versions.toml"
grep -q 'implementation(libs.sshj)' "$PROJECT_DIR/app/build.gradle.kts"
grep -q 'TerminalScreen()' "$SRC/MainActivity.kt"
test -f "$SRC/ssh/SshHostProfile.kt"
test -f "$SRC/ssh/SecureSecretStore.kt"
test -f "$SRC/ssh/KnownHostsStore.kt"
test -f "$SRC/ssh/SshConnectionManager.kt"
test -f "$SRC/ui/terminal/TerminalScreen.kt"

echo "[OK] worm-machinallm-beta-v01-ssh already applied"
