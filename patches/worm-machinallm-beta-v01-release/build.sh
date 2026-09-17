#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/opt/worm/apps/com.worm.machinallm"
ARTIFACT_DIR="/opt/worm/artifacts/machinallm/beta.v01"
APK="$ARTIFACT_DIR/MachinaLLM-beta.v01.apk"
UNSIGNED="$PROJECT_DIR/app/build/outputs/apk/release/app-release-unsigned.apk"
RELEASE="$PROJECT_DIR/app/build/outputs/apk/release/app-release.apk"
KEYSTORE="/opt/worm/keys/machinallm/machinallm-release.jks"
ENV_FILE="/opt/worm/keys/machinallm/signing.env"
APKSIGNER="${APKSIGNER:-/opt/android-sdk/build-tools/36.1.0/apksigner}"

export ANDROID_HOME="${ANDROID_HOME:-/opt/android-sdk}"
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"

test -f "$KEYSTORE"
test -f "$ENV_FILE"
mkdir -p "$ARTIFACT_DIR"

cd "$PROJECT_DIR"
./gradlew clean assembleDebug
./gradlew assembleRelease

if [ -f "$UNSIGNED" ]; then
    cp "$UNSIGNED" "$APK"
elif [ -f "$RELEASE" ]; then
    cp "$RELEASE" "$APK"
else
    echo "[ERROR] release APK not found" >&2
    exit 1
fi

set -a
. "$ENV_FILE"
set +a

"$APKSIGNER" sign \
    --ks "$KEYSTORE" \
    --ks-key-alias "${MACHINALLM_KEY_ALIAS:-machinallm}" \
    --ks-pass env:MACHINALLM_KEYSTORE_PASSWORD \
    --key-pass env:MACHINALLM_KEY_PASSWORD \
    --v4-signing-enabled false \
    --out "$APK.signed" \
    "$APK"
mv "$APK.signed" "$APK"

"$APKSIGNER" verify --verbose --print-certs "$APK" > "$ARTIFACT_DIR/apksigner-verify.txt"
(
    cd "$ARTIFACT_DIR"
    sha256sum MachinaLLM-beta.v01.apk > SHA256SUMS
)

echo "[OK] APK: $APK"
echo "[INFO] size: $(stat -c '%s bytes' "$APK")"
echo "[INFO] SHA256: $(awk '{print $1}' "$ARTIFACT_DIR/SHA256SUMS")"
