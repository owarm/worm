#!/usr/bin/env bash
set -u
export TZ=Europe/Rome

ROOT=/opt/worm/apps/com.worm.home
REF="$ROOT/reference/home-target.png"
JAVA="$ROOT/app/src/main/java/com/worm"
VALUES="$ROOT/app/src/main/res/values"
PATCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAMP="$(date '+%Y%m%d-%H%M%S')"
BACKUP="$ROOT/backups/PATCH-002-$STAMP"

echo "=== PATCH-002 TARGET GAPS + SYSTEM WALLPAPER ==="
echo "time=$(date '+%Y-%m-%d %H:%M:%S %Z')"

if [ ! -f "$REF" ]; then
  echo "ERROR: missing reference: $REF"
else
  mkdir -p "$BACKUP"

  [ -f "$JAVA/WormHomeView.java" ] &&
    cp -a "$JAVA/WormHomeView.java" "$BACKUP/"

  [ -f "$VALUES/styles.xml" ] &&
    cp -a "$VALUES/styles.xml" "$BACKUP/"

  cp -f "$PATCH_DIR/files/WormHomeView.java" "$JAVA/WormHomeView.java"

  python3 <<'PY'
from pathlib import Path
p = Path("/opt/worm/apps/com.worm.home/app/src/main/res/values/styles.xml")
if not p.exists():
    print("WARNING: styles.xml missing")
else:
    s = p.read_text()

    # Remove opaque window background if present.
    s = s.replace(
        '<item name="android:windowBackground">@android:color/black</item>',
        '<item name="android:windowBackground">@android:color/transparent</item>'
    )

    if 'android:windowShowWallpaper' not in s:
        s = s.replace(
            '</style>',
            '        <item name="android:windowShowWallpaper">true</item>\n'
            '        <item name="android:colorAccent">@android:color/transparent</item>\n'
            '</style>',
            1
        )
    else:
        s = s.replace(
            '<item name="android:windowShowWallpaper">false</item>',
            '<item name="android:windowShowWallpaper">true</item>'
        )

    p.write_text(s)
    print("styles.xml: system wallpaper only")
PY

  cd "$ROOT"
  export ANDROID_HOME=/opt/android-sdk
  export ANDROID_SDK_ROOT=/opt/android-sdk

  ./gradlew assembleRelease

  echo
  echo "=== PATCH-002 DONE ==="
  echo "backup=$BACKUP"
fi
