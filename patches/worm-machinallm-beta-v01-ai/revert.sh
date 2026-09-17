#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/opt/worm/apps/com.worm.machinallm"
SRC="$PROJECT_DIR/app/src/main/java/com/worm/machinallm"

echo "[INFO] Revert is intentionally non-destructive."
echo "[INFO] To revert this beta patch, restore these files from your chosen baseline:"
echo "  - $SRC/ssh/SshConnectionManager.kt"
echo "  - $SRC/ui/terminal/TerminalScreen.kt"
echo "  - $SRC/ui/sftp/SftpScreen.kt"
echo "  - remove $SRC/ssh/AiRemoteManager.kt"
echo "  - remove $SRC/ui/ai/AiScreen.kt"
echo "[INFO] The SSH and SFTP prerequisite patches are left intact."
