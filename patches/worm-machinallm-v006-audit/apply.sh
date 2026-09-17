#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/opt/worm/apps/com.worm.machinallm"

grep -q 'rememberSaveable(saver = MessagesSaver)' "$PROJECT_DIR/app/src/main/java/com/worm/machinallm/MainActivity.kt"
grep -q 'CancellationException' "$PROJECT_DIR/app/src/main/java/com/worm/machinallm/repository/MachinaRepository.kt"
grep -q 'android:dataExtractionRules="@xml/data_extraction_rules"' "$PROJECT_DIR/app/src/main/AndroidManifest.xml"
test -f "$PROJECT_DIR/app/src/main/res/xml/backup_rules.xml"
test -f "$PROJECT_DIR/app/src/main/res/xml/data_extraction_rules.xml"

echo "[OK] worm-machinallm-v006-audit fixes already applied"
