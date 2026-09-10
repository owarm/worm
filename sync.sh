#!/usr/bin/env bash
set -euo pipefail

ROOT=/opt/worm/stock/android
MANIFEST=/opt/worm/stock/grapheneos-stock/manifest-pinned.xml

mkdir -p "$ROOT"
cd "$ROOT"

repo init \
  -u https://github.com/GrapheneOS/platform_manifest.git \
  -b refs/tags/2026080500

mkdir -p .repo/local_manifests
cp "$MANIFEST" .repo/local_manifests/worm-pinned.xml

repo sync \
  -c \
  --no-tags \
  --no-clone-bundle \
  --force-sync \
  -j8

echo "=== GRAPHENE STOCK SYNC COMPLETE ==="
echo "TAG=2026080500"
echo "DEVICE=frankel"
