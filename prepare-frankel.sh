#!/usr/bin/env bash
set -euo pipefail

ROOT=/opt/worm/stock/android

cd "$ROOT"

echo "=== CHECK BASELINE ==="
git -C .repo/manifests describe --tags --exact-match

echo
echo "=== CHECK NODE ==="
node -v

echo
echo "=== PREPARE FRANKEL ==="

if [ "$(id -u)" -eq 0 ]; then
    echo "ERROR: adevtool must not run as root"
    exit 1
fi

vendor/adevtool/bin/run generate-all -d frankel

echo
echo "=== VERIFY ==="
test -d vendor/google_devices/frankel
echo "PASS: vendor/google_devices/frankel generated"

echo
echo "=== DONE ==="
