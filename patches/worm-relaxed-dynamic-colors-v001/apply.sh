#!/usr/bin/env bash
set -euo pipefail

ROOT="${ROOT:-/opt/worm}"
PATCH_DIR="$ROOT/patches/worm-relaxed-dynamic-colors-v001"
BACKUP_ROOT="$ROOT/backups/worm-relaxed-dynamic-colors-v001"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$BACKUP_ROOT/$STAMP"

FILES=(
  "grapheneos/frameworks/libs/systemui/monet/src/com/android/systemui/monet/ColorScheme.java"
  "grapheneos/frameworks/libs/systemui/monet/src/com/android/systemui/monet/RelaxedDynamicScheme.java"
  "grapheneos/frameworks/base/packages/SystemUI/src/com/android/systemui/theme/ThemeOverlayController.java"
)

changes_needed=0
for rel in "${FILES[@]}"; do
  src="$PATCH_DIR/files/$rel"
  dst="$ROOT/$rel"

  if [ ! -f "$src" ]; then
    echo "Missing patch file: $src" >&2
    exit 1
  fi

  if [ ! -f "$dst" ] || ! cmp -s "$src" "$dst"; then
    changes_needed=1
  fi
done

if [ "$changes_needed" -eq 0 ]; then
  for rel in "${FILES[@]}"; do
    echo "Already applied: $rel"
  done
  exit 0
fi

mkdir -p "$BACKUP_DIR"

for rel in "${FILES[@]}"; do
  src="$PATCH_DIR/files/$rel"
  dst="$ROOT/$rel"
  bak="$BACKUP_DIR/$rel"

  if [ ! -f "$src" ]; then
    echo "Missing patch file: $src" >&2
    exit 1
  fi

  mkdir -p "$(dirname "$bak")" "$(dirname "$dst")"
  if [ -e "$dst" ]; then
    cp -a "$dst" "$bak"
  else
    : > "$bak.absent"
  fi

  if [ -f "$dst" ] && cmp -s "$src" "$dst"; then
    echo "Already applied: $rel"
  else
    cp -a "$src" "$dst"
    echo "Applied: $rel"
  fi
done

echo "$BACKUP_DIR" > "$BACKUP_ROOT/latest"
echo "Backup written to $BACKUP_DIR"
