#!/usr/bin/env bash
set -euo pipefail

TREE="${1:-/opt/worm/grapheneos}"
TARGET="$TREE/vendor/google_devices/frankel/frankel.mk"

test -f "$TARGET" || {
    echo "STOP: frankel.mk non trovato: $TARGET"
    exit 1
}

if grep -q 'debug.sf.nobootanimation=1' "$TARGET"; then
    echo "PATCH-001 already applied"
    exit 0
fi

cat >> "$TARGET" <<'PATCH'

# WORM PATCH-001
# Keep Pixel bootloader Google G; disable Android boot animation.
PRODUCT_SYSTEM_PROPERTIES += \
    debug.sf.nobootanimation=1
PATCH

echo "PATCH-001 applied: $TARGET"
