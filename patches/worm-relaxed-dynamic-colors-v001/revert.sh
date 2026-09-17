#!/usr/bin/env bash
set -euo pipefail

ROOT="${ROOT:-/opt/worm}"
BACKUP_ROOT="$ROOT/backups/worm-relaxed-dynamic-colors-v001"
BACKUP_DIR="${1:-}"

if [ -z "$BACKUP_DIR" ]; then
  if [ ! -f "$BACKUP_ROOT/latest" ]; then
    echo "No latest backup marker found in $BACKUP_ROOT" >&2
    exit 1
  fi
  BACKUP_DIR="$(cat "$BACKUP_ROOT/latest")"
fi

FILES=(
  "grapheneos/frameworks/libs/systemui/monet/src/com/android/systemui/monet/ColorScheme.java"
  "grapheneos/frameworks/libs/systemui/monet/src/com/android/systemui/monet/RelaxedDynamicScheme.java"
  "grapheneos/frameworks/base/packages/SystemUI/src/com/android/systemui/theme/ThemeOverlayController.java"
)

for rel in "${FILES[@]}"; do
  dst="$ROOT/$rel"
  bak="$BACKUP_DIR/$rel"

  if [ -f "$bak.absent" ]; then
    rm -f "$dst"
    echo "Removed newly-created file: $rel"
  elif [ -f "$bak" ]; then
    cp -a "$bak" "$dst"
    echo "Restored: $rel"
  else
    echo "Missing backup for $rel in $BACKUP_DIR" >&2
    exit 1
  fi
done
