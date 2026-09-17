#!/usr/bin/env bash
set -euo pipefail

PROJECT="/opt/worm/apps/com.worm.ai"
APK="$PROJECT/app/build/outputs/apk/debug/app-debug.apk"

export ANDROID_SDK_ROOT="/opt/android-sdk"
export ANDROID_HOME="/opt/android-sdk"
export GRADLE_USER_HOME="$PROJECT/.gradle-user-home"

printf '[INFO] Android SDK: %s\n' "$ANDROID_SDK_ROOT"
printf '[INFO] Project: %s\n' "$PROJECT"

cd "$PROJECT"
./gradlew --no-daemon :app:assembleDebug

if [[ -f "$APK" ]]; then
  printf '[OK] build successful\n'
  printf '[INFO] APK: %s\n' "$APK"
else
  printf '[ERROR] APK not found: %s\n' "$APK" >&2
  exit 1
fi
