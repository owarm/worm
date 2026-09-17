#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/opt/worm/apps/com.worm.machinallm"
MAIN="$PROJECT_DIR/app/src/main/java/com/worm/machinallm/MainActivity.kt"
MODEL="$PROJECT_DIR/app/src/main/java/com/worm/machinallm/Message.kt"
STRINGS="$PROJECT_DIR/app/src/main/res/values/strings.xml"

grep -q 'LazyColumn' "$MAIN"
grep -q 'TopAppBar' "$MAIN"
grep -q 'OutlinedTextField' "$MAIN"
grep -q 'data class Message' "$MODEL"
grep -q 'enum class MessageRole' "$MODEL"
grep -q 'empty_chat_prompt' "$STRINGS"

echo "[OK] worm-machinallm-v002-ui already applied"
