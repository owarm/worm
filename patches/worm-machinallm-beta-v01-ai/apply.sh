#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/opt/worm/apps/com.worm.machinallm"
SRC="$PROJECT_DIR/app/src/main/java/com/worm/machinallm"

test -d "/opt/worm/patches/worm-machinallm-beta-v01-ssh"
test -d "/opt/worm/patches/worm-machinallm-beta-v01-sftp"
test -f "$SRC/ssh/AiRemoteManager.kt"
test -f "$SRC/ui/ai/AiScreen.kt"
grep -q 'runRemoteCommand' "$SRC/ssh/SshConnectionManager.kt"
grep -q 'command = "command -v term-llm"' "$SRC/ssh/AiRemoteManager.kt"
grep -q 'command = "term-llm"' "$SRC/ssh/AiRemoteManager.kt"
grep -q 'stdin = prompt' "$SRC/ssh/AiRemoteManager.kt"
grep -q 'AI("AI")' "$SRC/ui/terminal/TerminalScreen.kt"
grep -q 'TerminalAiActions' "$SRC/ui/terminal/TerminalScreen.kt"
grep -q 'Explain' "$SRC/ui/sftp/SftpScreen.kt"
grep -q 'Summarize' "$SRC/ui/sftp/SftpScreen.kt"
grep -q 'Fix' "$SRC/ui/sftp/SftpScreen.kt"

echo "[OK] worm-machinallm-beta-v01-ai already applied"
