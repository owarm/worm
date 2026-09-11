# PATCH-004 — WORM release signing

Preserves the signing identity of the previous WORM build.

Private signing material is never stored in Git.

Runtime key directory:

    /opt/worm-release-keys/frankel

Mapping:

    historical testkey -> releasekey
    historical AVB RSA4096 -> avb.pem

Preserved product identities:

    platform
    shared
    media
    networkstack
    bluetooth
    sdk_sandbox
    gmscompat_lib
    nfc

verify.sh refuses release signing if any expected identity differs.
