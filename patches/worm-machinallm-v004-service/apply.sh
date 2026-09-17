#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/opt/worm/apps/com.worm.machinallm"
SERVICE="$PROJECT_DIR/app/src/main/java/com/worm/machinallm/service/MachinaLlmService.kt"
MANIFEST="$PROJECT_DIR/app/src/main/AndroidManifest.xml"
README="$PROJECT_DIR/README.md"

test -f "$SERVICE"
grep -q 'class MachinaLlmService : Service()' "$SERVICE"
grep -q 'android:name=".service.MachinaLlmService"' "$MANIFEST"
grep -q 'android:exported="false"' "$MANIFEST"
grep -q 'MachinaLLM Service' "$README"

echo "[OK] worm-machinallm-v004-service already applied"
