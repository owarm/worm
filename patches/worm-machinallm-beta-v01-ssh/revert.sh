#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/opt/worm/apps/com.worm.machinallm"
SRC="$PROJECT_DIR/app/src/main/java/com/worm/machinallm"

echo "[INFO] Revert is intentionally non-destructive."
echo "[INFO] To revert this beta patch, restore these tracked edits from your chosen baseline:"
echo "  - $PROJECT_DIR/app/src/main/AndroidManifest.xml"
echo "  - $PROJECT_DIR/app/build.gradle.kts"
echo "  - $PROJECT_DIR/gradle/libs.versions.toml"
echo "  - $SRC/MainActivity.kt"
echo "  - remove $SRC/ssh"
echo "  - remove $SRC/ui/terminal"
echo "[INFO] Existing user work in this dirty workspace was not overwritten."
