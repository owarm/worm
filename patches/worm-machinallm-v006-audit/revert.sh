#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/opt/worm/apps/com.worm.machinallm"
BACKUP_DIR="/opt/worm/backups/worm-machinallm-v006-audit"

cp "$BACKUP_DIR/app/src/main/java/com/worm/machinallm/MainActivity.kt" "$PROJECT_DIR/app/src/main/java/com/worm/machinallm/MainActivity.kt"
cp "$BACKUP_DIR/app/src/main/java/com/worm/machinallm/repository/MachinaRepository.kt" "$PROJECT_DIR/app/src/main/java/com/worm/machinallm/repository/MachinaRepository.kt"
cp "$BACKUP_DIR/app/src/main/java/com/worm/machinallm/provider/LocalPlaceholderProvider.kt" "$PROJECT_DIR/app/src/main/java/com/worm/machinallm/provider/LocalPlaceholderProvider.kt"
cp "$BACKUP_DIR/app/src/main/java/com/worm/machinallm/service/MachinaLlmService.kt" "$PROJECT_DIR/app/src/main/java/com/worm/machinallm/service/MachinaLlmService.kt"
cp "$BACKUP_DIR/app/src/main/java/com/worm/machinallm/ui/theme/Theme.kt" "$PROJECT_DIR/app/src/main/java/com/worm/machinallm/ui/theme/Theme.kt"
cp "$BACKUP_DIR/app/src/main/res/values/strings.xml" "$PROJECT_DIR/app/src/main/res/values/strings.xml"
cp "$BACKUP_DIR/app/src/main/AndroidManifest.xml" "$PROJECT_DIR/app/src/main/AndroidManifest.xml"
rm -f "$PROJECT_DIR/app/src/main/res/xml/backup_rules.xml"
rm -f "$PROJECT_DIR/app/src/main/res/xml/data_extraction_rules.xml"
rmdir "$PROJECT_DIR/app/src/main/res/xml" 2>/dev/null || true

echo "[OK] reverted worm-machinallm-v006-audit"
