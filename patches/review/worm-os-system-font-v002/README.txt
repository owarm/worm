PATCH: worm-os-system-font-v002

Status: no-op rebased patch for current checkout.

Font v001 is BROKEN and is used only as intent documentation. The current checkout already contains the Worm font integration files and frankel product-package entries, with Android 17 font fallback preserved through product/etc/fonts_customization.xml.

This v002 intentionally contains an empty changes.diff because no additional source delta is required against the current checkout. Validation uses `git apply --check --allow-empty` to represent an already-present state without manufacturing a fake source change.

FONT_ASSET_STATUS=PRESENT
FONT_V002_PATCH_VALID=YES
