#!/usr/bin/env bash
set -euo pipefail

ADB="/opt/android-sdk/platform-tools/adb"

if [[ -x "$ADB" ]] && "$ADB" devices | awk 'NR > 1 && $2 == "device" { found = 1 } END { exit found ? 0 : 1 }'; then
  "$ADB" uninstall com.worm.ai || true
  printf '[OK] uninstall requested for com.worm.ai\n'
else
  printf '[INFO] No adb device connected\n'
  printf '[INFO] adb uninstall com.worm.ai\n'
fi
