#!/usr/bin/env bash
set -euo pipefail

TREE="${1:-/opt/worm/grapheneos}"
PATCH="$(cd "$(dirname "$0")" && pwd)"
ASSETS="/opt/worm/local-assets/fonts"

MONO="$ASSETS/PragmataPro_Mono_R_liga_0903.ttf"
REGULAR="$ASSETS/Essential PragmataPro-R_1.4.ttf"

for f in "$MONO" "$REGULAR"; do
    if [ ! -f "$f" ]; then
        echo "STOP: missing licensed font:"
        echo "$f"
        exit 1
    fi
done

DEST="$TREE/vendor/worm/fonts"
mkdir -p "$DEST"

install -m 0644 "$MONO" \
    "$DEST/PragmataProWormMono.ttf"

install -m 0644 "$REGULAR" \
    "$DEST/PragmataProWormRegular.ttf"

install -m 0644 \
    "$PATCH/config/fonts_customization.xml" \
    "$DEST/fonts_customization.xml"

cat > "$DEST/Android.bp" <<'BP'
prebuilt_font {
    name: "PragmataProWormMono.ttf",
    src: "PragmataProWormMono.ttf",
    product_specific: true,
}

prebuilt_font {
    name: "PragmataProWormRegular.ttf",
    src: "PragmataProWormRegular.ttf",
    product_specific: true,
}

prebuilt_etc {
    name: "worm_fonts_customization.xml",
    src: "fonts_customization.xml",
    filename: "fonts_customization.xml",
    sub_dir: "fonts",
    product_specific: true,
}
BP

echo "PATCH-003 staged:"
echo "  worm-pragmata-mono"
echo "  worm-pragmata-regular"
echo
echo "Android global font families untouched."


FRANKEL="$TREE/vendor/google_devices/frankel/frankel.mk"

if ! grep -q 'WORM PATCH-003' "$FRANKEL"; then
cat >> "$FRANKEL" <<'MK'

# WORM PATCH-003
# Dedicated PragmataPro families; no global Android font replacement.
PRODUCT_PACKAGES += \
    PragmataProWormMono.ttf \
    PragmataProWormRegular.ttf \
    worm_fonts_customization.xml
MK
fi

echo "PATCH-003 product integration complete."
