#!/usr/bin/env bash
set -euo pipefail

PATCH_DIR="/opt/worm/patches/worm-terminallm-v002"

mkdir -p \
  /opt/worm/terminallm/runtime/bin \
  /opt/worm/terminallm/runtime/releases \
  /opt/worm/terminallm/runtime/tmp \
  /opt/worm/backups/worm-terminallm-v002

exec "${PATCH_DIR}/update.sh" "$@"
