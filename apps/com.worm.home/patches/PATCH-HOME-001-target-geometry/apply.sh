#!/usr/bin/env bash
set -euo pipefail

export TZ=Europe/Rome

ROOT=/opt/com.worm
REF="$ROOT/reference/home-target.png"
JAVA="$ROOT/app/src/main/java/com/worm"
PATCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAMP="$(date '+%Y%m%d-%H%M%S')"
BACKUP="$ROOT/backups/PATCH-001-$STAMP"

echo "=== PATCH-001 TARGET GEOMETRY ==="
echo "time=$(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "reference=$REF"

test -f "$REF" || {
    echo "ERROR: reference missing: $REF"
    exit 1
}

test -f "$JAVA/WormHomeView.java" || {
    echo "ERROR: WormHomeView.java missing"
    exit 1
}

mkdir -p "$BACKUP"

cp -a "$JAVA/WormHomeView.java" \
      "$BACKUP/WormHomeView.java"

cp -f "$PATCH_DIR/files/WormHomeView.java" \
      "$JAVA/WormHomeView.java"

cat > "$BACKUP/patch-info.txt" <<INFO
patch=PATCH-001
timezone=Europe/Rome
timestamp=$(date '+%Y-%m-%d %H:%M:%S %Z')
reference=$REF
reference_canvas=691x1536
INFO

echo
echo "=== BUILD CHECK ==="

cd "$ROOT"

export ANDROID_HOME=/opt/android-sdk
export ANDROID_SDK_ROOT=/opt/android-sdk

./gradlew assembleRelease

echo
echo "=== PATCH-001 OK ==="
echo "backup=$BACKUP"
