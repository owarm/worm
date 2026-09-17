#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/opt/worm/apps/com.worm.machinallm"
SRC="$PROJECT_DIR/app/src/main/java/com/worm/machinallm"
MAIN="$SRC/MainActivity.kt"

test -f "$SRC/model/Message.kt"
test -f "$SRC/core/AiResult.kt"
test -f "$SRC/core/ProviderType.kt"
test -f "$SRC/provider/AiProvider.kt"
test -f "$SRC/provider/LocalPlaceholderProvider.kt"
test -f "$SRC/repository/MachinaRepository.kt"
grep -q 'MachinaCore.createRepository' "$MAIN"
grep -q 'ProviderType.LOCAL_PLACEHOLDER' "$SRC/core/MachinaCore.kt"

echo "[OK] worm-machinallm-v003-core already applied"
