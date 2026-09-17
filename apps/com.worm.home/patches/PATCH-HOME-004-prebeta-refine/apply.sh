#!/usr/bin/env bash
set -u
export TZ=Europe/Rome

ROOT=/opt/worm/apps/com.worm.home
REF="$ROOT/reference/home-target.png"
JAVA="$ROOT/app/src/main/java/com/worm"
PATCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAMP="$(date '+%Y%m%d-%H%M%S')"
BACKUP="$ROOT/backups/PATCH-004-$STAMP"

echo "=== PATCH-004 PRE-BETA REFINE ==="
echo "time=$(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "reference=$REF"

if [ ! -f "$REF" ]; then
  echo "ERROR: missing reference: $REF"
else
  mkdir -p "$BACKUP"

  [ -f "$JAVA/WormHomeView.java" ] &&
    cp -a "$JAVA/WormHomeView.java" "$BACKUP/"

  [ -f "$JAVA/WormIconRenderer.java" ] &&
    cp -a "$JAVA/WormIconRenderer.java" "$BACKUP/"

  cp -f "$PATCH_DIR/files/WormHomeView.java" \
        "$JAVA/WormHomeView.java"

  cp -f "$PATCH_DIR/files/WormIconRenderer.java" \
        "$JAVA/WormIconRenderer.java"

  cd "$ROOT"

  export ANDROID_HOME=/opt/android-sdk
  export ANDROID_SDK_ROOT=/opt/android-sdk

  echo
  echo "=== CLEAN BUILD ==="
  ./gradlew clean assembleRelease

  echo
  echo "=== APK OUTPUTS ==="
  find app/build/outputs/apk/release \
    -type f -name '*.apk' -print 2>/dev/null

  echo
  echo "=== PATCH-004 DONE ==="
  echo "backup=$BACKUP"
fi
