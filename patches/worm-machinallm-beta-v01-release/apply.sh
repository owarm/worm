#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/opt/worm/apps/com.worm.machinallm"

test -d "/opt/worm/patches/worm-machinallm-beta-v01-ssh"
test -d "/opt/worm/patches/worm-machinallm-beta-v01-sftp"
test -d "/opt/worm/patches/worm-machinallm-beta-v01-ai"
grep -q 'versionCode = 100' "$PROJECT_DIR/app/build.gradle.kts"
grep -q 'versionName = "beta.v01"' "$PROJECT_DIR/app/build.gradle.kts"
grep -q '<string name="app_name">MachinaLLM</string>' "$PROJECT_DIR/app/src/main/res/values/strings.xml"

echo "[OK] worm-machinallm-beta-v01-release already applied"
