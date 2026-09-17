#!/usr/bin/env bash
set -euo pipefail

ROOT="${ROOT:-/opt/worm}"
TREE="$ROOT/grapheneos"
PATCH_DIR="$ROOT/patches/worm-relaxed-dynamic-colors-v001"

echo "== Dynamic color pipeline files =="
find "$TREE/frameworks" "$TREE/packages" -type f \
  \( -name '*ColorScheme*' -o -name '*TonalPalette*' -o -name '*ThemeOverlayController*' \
     -o -name '*DynamicColors*' -o -name '*Monet*' \) 2>/dev/null | sort

echo
echo "== Key pipeline symbols =="
rg -n "class ThemeOverlayController|class ColorScheme|class DynamicColors|class TonalPalette|FabricatedOverlay|system_accent1|system_accent2|system_accent3|system_neutral1|system_neutral2|WORM_RELAXED_DYNAMIC_COLORS|RelaxedDynamicScheme" \
  "$TREE/frameworks/libs/systemui/monet" \
  "$TREE/frameworks/base/packages/SystemUI/src/com/android/systemui/theme" \
  "$TREE/frameworks/base/core/java/android/app/ThemeManager.java" \
  "$TREE/packages/apps/Launcher3/res" \
  "$TREE/packages/apps/Launcher3/src" \
  "$TREE/packages/apps/Settings" \
  --glob '!out/**' --glob '!**/.git/**' || true

echo
echo "== Relaxed upstream palette =="
sed -n '/^## Relaxed Palette$/,/^## /p' "$PATCH_DIR/README.md" | sed '$d'

echo
echo "== Modified files =="
git --git-dir="$TREE/.repo/projects/frameworks/libs/systemui.git" \
  --work-tree="$TREE/frameworks/libs/systemui" status --short -- \
  monet/src/com/android/systemui/monet/ColorScheme.java \
  monet/src/com/android/systemui/monet/RelaxedDynamicScheme.java || true
git --git-dir="$TREE/.repo/projects/frameworks/base.git" \
  --work-tree="$TREE/frameworks/base" status --short -- \
  packages/SystemUI/src/com/android/systemui/theme/ThemeOverlayController.java || true
git -C "$ROOT" status --short -- patches/worm-relaxed-dynamic-colors-v001 || true

git --git-dir="$TREE/.repo/projects/frameworks/libs/systemui.git" \
  --work-tree="$TREE/frameworks/libs/systemui" diff --stat -- \
  monet/src/com/android/systemui/monet/ColorScheme.java \
  monet/src/com/android/systemui/monet/RelaxedDynamicScheme.java || true
git --git-dir="$TREE/.repo/projects/frameworks/base.git" \
  --work-tree="$TREE/frameworks/base" diff --stat -- \
  packages/SystemUI/src/com/android/systemui/theme/ThemeOverlayController.java || true
