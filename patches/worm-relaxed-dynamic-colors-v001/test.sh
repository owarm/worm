#!/usr/bin/env bash
set -euo pipefail

ROOT="${ROOT:-/opt/worm}"
TREE="$ROOT/grapheneos"

echo "== Source checks =="
for file in \
  "$TREE/frameworks/libs/systemui/monet/src/com/android/systemui/monet/ColorScheme.java" \
  "$TREE/frameworks/libs/systemui/monet/src/com/android/systemui/monet/RelaxedDynamicScheme.java" \
  "$TREE/frameworks/base/packages/SystemUI/src/com/android/systemui/theme/ThemeOverlayController.java"; do
  test -f "$file"
  echo "present: ${file#$TREE/}"
done

echo
echo "== Token path checks =="
rg -n "new ColorScheme\\(color, true|new ColorScheme\\(color, false|WORM_RELAXED_DYNAMIC_COLORS|RelaxedDynamicScheme|system_accent1|system_neutral1" \
  "$TREE/frameworks/libs/systemui/monet/src/com/android/systemui/monet" \
  "$TREE/frameworks/base/packages/SystemUI/src/com/android/systemui/theme/ThemeOverlayController.java"

echo
echo "== Soong target hints =="
if [ -f "$TREE/build/soong/soong_ui.bash" ]; then
  echo "Smallest useful compile target to run manually:"
  echo "  cd $TREE && source build/envsetup.sh && lunch <worm_target>-userdebug && m monet SystemUI"
else
  echo "Soong entrypoint not found; run the tree-specific SystemUI/monet build target."
fi
