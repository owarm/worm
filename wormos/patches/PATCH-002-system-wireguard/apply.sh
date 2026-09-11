#!/usr/bin/env bash
set -euo pipefail

TREE="${1:-/opt/worm/grapheneos}"
SRC="$(cd "$(dirname "$0")" && pwd)/files/worm_wg"
DST="$TREE/system/worm/worm_wg"

test -f "$TREE/build/envsetup.sh" || {
    echo "STOP: GrapheneOS tree not found: $TREE"
    exit 1
}

mkdir -p "$DST"

install -m 0644 "$SRC/Android.bp" "$DST/Android.bp"
install -m 0644 "$SRC/main.cpp" "$DST/main.cpp"

echo "PATCH-002 applied"
echo "TARGET=$DST"
