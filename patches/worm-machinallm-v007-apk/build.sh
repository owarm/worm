#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/opt/worm/apps/com.worm.machinallm"
ARTIFACT_DIR="/opt/worm/artifacts/machinallm/0.1.0"
FINAL_APK="$ARTIFACT_DIR/MachinaLLM-0.1.0.apk"
DEBUG_SRC="$PROJECT_DIR/app/build/outputs/apk/debug/app-debug.apk"
UNSIGNED_APK="$PROJECT_DIR/app/build/outputs/apk/release/app-release-unsigned.apk"
GRADLE_RELEASE_APK="$PROJECT_DIR/app/build/outputs/apk/release/app-release.apk"
KEY_DIR="/opt/worm/keys/machinallm"
KEYSTORE="$KEY_DIR/machinallm-release.jks"
ENV_FILE="$KEY_DIR/signing.env"
ALIAS="machinallm"
APKSIGNER="${APKSIGNER:-/opt/android-sdk/build-tools/36.1.0/apksigner}"

export ANDROID_HOME="${ANDROID_HOME:-/opt/android-sdk}"
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"
export GRADLE_USER_HOME="${GRADLE_USER_HOME:-$PROJECT_DIR/.gradle}"

mkdir -p "$ARTIFACT_DIR" "$KEY_DIR"
chmod 700 "$KEY_DIR"
rm -f "$ARTIFACT_DIR/MachinaLLM-0.1.0-debug.apk"
rm -f "$ARTIFACT_DIR/MachinaLLM-0.1.0-release.apk"
rm -f "$ARTIFACT_DIR/MachinaLLM-0.1.0-release.apk.signed.idsig"

cd "$PROJECT_DIR"
./gradlew clean assembleDebug
test -f "$DEBUG_SRC"
echo "[OK] debug APK built"

./gradlew assembleRelease
if [ -f "$UNSIGNED_APK" ]; then
    cp "$UNSIGNED_APK" "$FINAL_APK"
elif [ -f "$GRADLE_RELEASE_APK" ]; then
    cp "$GRADLE_RELEASE_APK" "$FINAL_APK"
else
    echo "[ERROR] release APK not found" >&2
    exit 1
fi
echo "[OK] release APK built"

if [ ! -f "$ENV_FILE" ]; then
    password="$(dd if=/dev/urandom bs=32 count=1 2>/dev/null | base64 | tr -d '\n')"
    {
        printf 'MACHINALLM_KEYSTORE_PASSWORD=%q\n' "$password"
        printf 'MACHINALLM_KEY_PASSWORD=%q\n' "$password"
        printf 'MACHINALLM_KEY_ALIAS=%q\n' "$ALIAS"
    } > "$ENV_FILE"
    chmod 600 "$ENV_FILE"
fi

set -a
. "$ENV_FILE"
set +a

if [ ! -f "$KEYSTORE" ]; then
    keytool -genkeypair \
        -keystore "$KEYSTORE" \
        -storepass "$MACHINALLM_KEYSTORE_PASSWORD" \
        -keypass "$MACHINALLM_KEY_PASSWORD" \
        -alias "${MACHINALLM_KEY_ALIAS:-$ALIAS}" \
        -keyalg RSA \
        -keysize 4096 \
        -validity 10000 \
        -dname "CN=MachinaLLM, OU=Worm OS, O=Worm, L=Local, ST=Local, C=US" >/dev/null
    chmod 600 "$KEYSTORE"
fi

if ! "$APKSIGNER" verify --verbose "$FINAL_APK" >/dev/null 2>&1; then
    "$APKSIGNER" sign \
        --ks "$KEYSTORE" \
        --ks-key-alias "${MACHINALLM_KEY_ALIAS:-$ALIAS}" \
        --ks-pass env:MACHINALLM_KEYSTORE_PASSWORD \
        --key-pass env:MACHINALLM_KEY_PASSWORD \
        --v4-signing-enabled false \
        --out "$FINAL_APK.signed" \
        "$FINAL_APK"
    mv "$FINAL_APK.signed" "$FINAL_APK"
fi

"$APKSIGNER" verify --verbose --print-certs "$FINAL_APK" >/dev/null
echo "[OK] APK signature verified"

(
    cd "$ARTIFACT_DIR"
    sha256sum MachinaLLM-0.1.0.apk > SHA256SUMS
)

echo "[INFO] APK: $FINAL_APK"
echo "[INFO] size: $(stat -c '%s bytes' "$FINAL_APK")"
echo "[INFO] SHA256: $(awk '{ print $1 }' "$ARTIFACT_DIR/SHA256SUMS")"
