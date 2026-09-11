#!/usr/bin/env bash

set -u

TARGET="${1:-/opt/worm/grapheneos}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATCH="$HERE/patches/decrypt-keys-pkcs8.patch"

echo "=== PATCH-004 RELEASE SIGNING APPLY ==="
echo "TARGET=$TARGET"

if [ ! -f "$TARGET/script/decrypt-keys" ]; then
    echo "ERROR: $TARGET/script/decrypt-keys not found"
    exit 1
fi

if [ ! -f "$PATCH" ]; then
    echo "ERROR: patch missing: $PATCH"
    exit 1
fi

cd "$TARGET" || exit 1

echo
echo "=== CHECK PATCH STATE ==="

if patch --dry-run -p1 < "$PATCH" >/dev/null 2>&1; then
    echo "STATE=NEEDS_PATCH"

    patch -p1 < "$PATCH"
    RC=$?

    if [ "$RC" -ne 0 ]; then
        echo "PATCH_RC=$RC"
        exit "$RC"
    fi

    echo "PATCH_RC=0"

elif patch --dry-run -R -p1 < "$PATCH" >/dev/null 2>&1; then
    echo "STATE=ALREADY_APPLIED"
    echo "PATCH_RC=0"

else
    echo "STATE=UNKNOWN"
    echo "Patch does not apply cleanly and does not appear already applied."
    exit 1
fi

echo
echo "=== SYNTAX ==="

bash -n script/decrypt-keys
RC=$?

echo "BASH_N_RC=$RC"

if [ "$RC" -ne 0 ]; then
    exit "$RC"
fi

echo
echo "=== PATCH-004 APPLY PASS ==="
