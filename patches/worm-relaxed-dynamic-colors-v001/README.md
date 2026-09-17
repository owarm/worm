# worm-relaxed-dynamic-colors-v001

Integrates the official Relaxed palette into Worm OS system dynamic colors. The patch changes the Android/GrapheneOS Monet pipeline, not individual app layouts.

## Pipeline Audit

Tree found at `/opt/worm/grapheneos`.

Key files:

- `frameworks/libs/systemui/monet/src/com/android/systemui/monet/ColorScheme.java`
- `frameworks/libs/systemui/monet/src/com/android/systemui/monet/DynamicColors.java`
- `frameworks/libs/systemui/monet/src/com/android/systemui/monet/TonalPalette.java`
- `frameworks/base/packages/SystemUI/src/com/android/systemui/theme/ThemeOverlayController.java`
- `frameworks/base/core/java/android/app/ThemeManager.java`
- `external/libmonet/hct/Hct.java`
- `external/libmonet/palettes/TonalPalette.java`
- `external/libmonet/dynamiccolor/DynamicScheme.java`

`ThemeOverlayController` creates dark and light `ColorScheme` instances, then writes standard fabricated Android color resources through `DynamicColors`: `system_accent1_*`, `system_accent2_*`, `system_accent3_*`, `system_neutral1_*`, `system_neutral2_*`, plus Material dynamic tokens.

## Relaxed Palette

Upstream: `https://github.com/Relaxed-Theme/relaxed-terminal-themes`

License: MIT.

Source file used: `themes/Relaxed` at upstream `master`, also cross-checked against `themes/Relaxed.colorscheme`.

Extracted values:

- background: `#353a44` RGB `53,58,68`
- foreground/cursor: `#d9d9d9` RGB `217,217,217`
- black: `#151515` RGB `21,21,21`
- red: `#bc5653` RGB `188,86,83`
- green: `#909d63` RGB `144,157,99`
- yellow: `#ebc17a` RGB `235,193,122`
- blue: `#6a8799` RGB `106,135,153`
- magenta: `#b06698` RGB `176,102,152`
- cyan: `#c9dfff` RGB `201,223,255`
- white: `#d9d9d9` RGB `217,217,217`
- bright black / gray: `#636363` RGB `99,99,99`
- bright green: `#a0ac77` RGB `160,172,119`
- bright blue: `#7eaac7` RGB `126,170,199`
- bright cyan: `#acbbd0` RGB `172,187,208`
- bright white: `#f7f7f7` RGB `247,247,247`

## Mapping

- `accent1`: Relaxed cyan/teal identity, seeded from `#acbbd0`
- `accent2`: Relaxed blue identity, seeded from `#7eaac7`
- `accent3`: Relaxed magenta identity, seeded from `#b06698`
- `neutral1`: Relaxed background identity, seeded from `#353a44`
- `neutral2`: Relaxed foreground/gray identity, seeded from `#d9d9d9` with gray balance

## Wallpaper Seed

The wallpaper seed is preserved. Worm OS first lets Android extract the wallpaper color, then `RelaxedDynamicScheme` harmonizes palette hue/chroma toward Relaxed using HCT and `TonalPalette.fromHueAndChroma`.

The wallpaper can still influence hue and chroma, but Relaxed has the dominant weight so the result remains recognizable.

## Modes

Persistent flag:

```sh
settings put secure worm_relaxed_dynamic_colors 1
settings put secure worm_relaxed_dynamic_colors 0
```

- `1`: RELAXED, default for Worm OS
- `0`: STANDARD Android dynamic colors

No Settings UI is added in this patch.

## Dark And Light

Dark and light schemes both use Material dynamic token resolution. Dark mode is the primary Relaxed target through the `#353a44` neutral identity. Light mode is generated through Material tonal palettes and is not an RGB inversion.

## Worm Home

Launcher3/Worm Home already references standard dynamic system colors heavily under `res/*-v31`, including `@android:color/system_accent*`, `system_neutral*`, and Material dynamic tokens. Remaining hardcoded Launcher colors found by audit are listed by `audit.sh`; this patch does not rewrite them because the system pipeline now provides the Relaxed dynamic tokens.

## Apply

```sh
/opt/worm/patches/worm-relaxed-dynamic-colors-v001/apply.sh
```

Backups are written under `/opt/worm/backups/worm-relaxed-dynamic-colors-v001/<timestamp>`.

## Revert

```sh
/opt/worm/patches/worm-relaxed-dynamic-colors-v001/revert.sh
```

Pass an explicit backup directory as the first argument to restore a specific snapshot.

## Test

```sh
/opt/worm/patches/worm-relaxed-dynamic-colors-v001/audit.sh
/opt/worm/patches/worm-relaxed-dynamic-colors-v001/test.sh
```

Recommended minimal build after selecting the correct Worm lunch target:

```sh
cd /opt/worm/grapheneos
source build/envsetup.sh
lunch <worm_target>-userdebug
m monet SystemUI
```
