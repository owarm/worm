#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/opt/worm/apps/com.worm.machinallm"
SRC="$PROJECT_DIR/app/src/main/java/com/worm/machinallm"

test -d "/opt/worm/patches/worm-machinallm-beta-v01-ssh"
grep -q 'fun <T> withSftpClient' "$SRC/ssh/SshConnectionManager.kt"
grep -q 'newSFTPClient' "$SRC/ssh/SshConnectionManager.kt"
test -f "$SRC/ssh/SftpManager.kt"
test -f "$SRC/ui/sftp/SftpScreen.kt"
grep -q 'SftpScreen' "$SRC/ui/terminal/TerminalScreen.kt"
grep -q 'FILES("Files")' "$SRC/ui/terminal/TerminalScreen.kt"
grep -q 'ActivityResultContracts.CreateDocument' "$SRC/ui/sftp/SftpScreen.kt"
grep -q 'ActivityResultContracts.OpenDocument' "$SRC/ui/sftp/SftpScreen.kt"

echo "[OK] worm-machinallm-beta-v01-sftp already applied"
