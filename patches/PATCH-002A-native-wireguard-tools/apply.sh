#!/usr/bin/env bash
set -euo pipefail

ROOT="${ANDROID_BUILD_TOP:-/opt/worm/grapheneos}"
SRC="$(cd "$(dirname "$0")" && pwd)/files/wireguard-tools"
DST="$ROOT/external/wireguard-tools"

echo "=== PATCH-002A: native wireguard-tools ==="
echo "ROOT=$ROOT"
echo "SRC=$SRC"
echo "DST=$DST"

test -d "$ROOT/.repo"
test -f "$SRC/Android.bp"

rm -rf "$DST"
mkdir -p "$DST"
cp -a "$SRC/." "$DST/"

echo
echo "=== RUNSTATEDIR ==="
grep -n 'RUNSTATEDIR' "$DST/Android.bp"

echo
echo "=== VERIFY ==="
test -f "$DST/src/src/ipc-uapi-unix.h"
test -f "$DST/Android.bp"

echo "PASS: native wireguard-tools installed"
