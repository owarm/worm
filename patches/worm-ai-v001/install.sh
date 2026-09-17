#!/usr/bin/env bash
set -euo pipefail

PATCH="/opt/worm/patches/worm-ai-v001"
PROJECT="/opt/worm/apps/com.worm.ai"
APK="$PROJECT/app/build/outputs/apk/debug/app-debug.apk"
ADB="/opt/android-sdk/platform-tools/adb"

if [[ ! -f "$APK" ]]; then
  printf '[WARN] APK missing, running build.sh\n'
  "$PATCH/build.sh"
fi

if [[ ! -x "$ADB" ]]; then
  printf '[INFO] adb not found or not executable: %s\n' "$ADB"
  printf '[INFO] APK ready for manual install\n'
  printf '[INFO] APK: %s\n' "$APK"
  exit 0
fi

if "$ADB" devices | awk 'NR > 1 && $2 == "device" { found = 1 } END { exit found ? 0 : 1 }'; then
  "$ADB" install -r "$APK"
  printf '[OK] installed com.worm.ai\n'
else
  printf '[INFO] No adb device connected\n'
  printf '[INFO] APK ready for manual install\n'
  printf '[INFO] APK: %s\n' "$APK"
fi
