#!/usr/bin/env bash
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DST=/opt/com.worm

mkdir -p "$DST"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

[ -d "$DST/keys" ] && cp -a "$DST/keys" "$tmp/keys"
[ -d "$DST/reference" ] && cp -a "$DST/reference" "$tmp/reference"

find "$DST" -mindepth 1 -maxdepth 1     ! -name keys     ! -name reference     -exec rm -rf {} +

cp -a "$SRC"/. "$DST"/

rm -rf "$DST/keys" "$DST/reference"
[ -d "$tmp/keys" ] && cp -a "$tmp/keys" "$DST/keys"
[ -d "$tmp/reference" ] && cp -a "$tmp/reference" "$DST/reference"

echo "Fresh worm home installed into $DST"
