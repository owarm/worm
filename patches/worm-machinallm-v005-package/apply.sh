#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/opt/worm/apps/com.worm.machinallm"
PATCH_DIR="/opt/worm/patches/worm-machinallm-v005-package"

test -f "$PROJECT_DIR/app/build.gradle.kts"
test -f "$PROJECT_DIR/app/src/main/AndroidManifest.xml"
test -f "$PROJECT_DIR/app/src/main/java/com/worm/machinallm/service/MachinaLlmService.kt"
test -x "$PATCH_DIR/build.sh"
test -x "$PATCH_DIR/install.sh"
test -x "$PATCH_DIR/uninstall.sh"
test -x "$PATCH_DIR/debug.sh"
test -x "$PATCH_DIR/test.sh"

echo "[OK] worm-machinallm-v005-package already applied"
