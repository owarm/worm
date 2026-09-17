#!/usr/bin/env bash
set -u
export TZ=Europe/Rome

ROOT=/opt/worm/apps/com.worm.home
REF="$ROOT/reference/home-target.png"
JAVA="$ROOT/app/src/main/java/com/worm"
PATCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAMP="$(date '+%Y%m%d-%H%M%S')"
BACKUP="$ROOT/backups/PATCH-003-$STAMP"

echo "=== PATCH-003 FIXED GAPS + SHADOW + DOCK NAV INSET ==="
echo "time=$(date '+%Y-%m-%d %H:%M:%S %Z')"

if [ ! -f "$REF" ]; then
  echo "ERROR: missing reference: $REF"
else
  mkdir -p "$BACKUP"

  [ -f "$JAVA/WormHomeView.java" ] && cp -a "$JAVA/WormHomeView.java" "$BACKUP/"

  cp -f "$PATCH_DIR/files/WormHomeView.java" "$JAVA/WormHomeView.java"

  cd "$ROOT"
  export ANDROID_HOME=/opt/android-sdk
  export ANDROID_SDK_ROOT=/opt/android-sdk

  ./gradlew assembleRelease

  echo
  echo "=== PATCH-003 DONE ==="
  echo "backup=$BACKUP"
fi
