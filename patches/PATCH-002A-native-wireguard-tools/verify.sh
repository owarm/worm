#!/usr/bin/env bash
set -euo pipefail

ROOT="${ANDROID_BUILD_TOP:-/opt/worm/grapheneos}"
DST="$ROOT/external/wireguard-tools"

test -f "$DST/Android.bp"
test -f "$DST/src/src/ipc-uapi-unix.h"

grep -Fq -- '-DRUNSTATEDIR=\"/dev/worm/wireguard/\"' \
  "$DST/Android.bp"

echo "PASS: PATCH-002A native WireGuard tools"
