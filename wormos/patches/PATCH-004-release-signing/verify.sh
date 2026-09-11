#!/bin/bash
set -euo pipefail

KEYDIR="${1:-/opt/worm-release-keys/frankel}"
IDENTITY="/opt/worm-identity/signing-key-hashes.sha256"
AVB_IDENTITY="/opt/worm-identity/avb-key.sha256"

required=(
    releasekey.pk8 releasekey.x509.pem
    platform.pk8 platform.x509.pem
    shared.pk8 shared.x509.pem
    media.pk8 media.x509.pem
    networkstack.pk8 networkstack.x509.pem
    bluetooth.pk8 bluetooth.x509.pem
    sdk_sandbox.pk8 sdk_sandbox.x509.pem
    gmscompat_lib.pk8 gmscompat_lib.x509.pem
    nfc.pk8 nfc.x509.pem
    avb.pem
)

echo "=== PATCH-004 RELEASE SIGNING VERIFY ==="

for f in "${required[@]}"; do
    test -f "$KEYDIR/$f" || {
        echo "MISSING: $f"
        exit 1
    }
done

# releasekey is the historical testkey identity
for ext in pk8 x509.pem; do
    hash=$(sha256sum "$KEYDIR/releasekey.$ext" | awk '{print $1}')
    grep -q "^$hash " "$IDENTITY" || {
        echo "IDENTITY FAILURE: releasekey.$ext"
        exit 1
    }
    echo "MATCH releasekey.$ext"
done

for name in platform shared media networkstack bluetooth sdk_sandbox gmscompat_lib nfc; do
    for ext in pk8 x509.pem; do
        hash=$(sha256sum "$KEYDIR/$name.$ext" | awk '{print $1}')
        grep -q "^$hash " "$IDENTITY" || {
            echo "IDENTITY FAILURE: $name.$ext"
            exit 1
        }
        echo "MATCH $name.$ext"
    done
done

avb_hash=$(sha256sum "$KEYDIR/avb.pem" | awk '{print $1}')

grep -q "^$avb_hash " "$AVB_IDENTITY" || {
    echo "IDENTITY FAILURE: avb.pem"
    exit 1
}

echo "MATCH avb.pem"
echo
echo "PATCH-004 VERIFY: PASS"
