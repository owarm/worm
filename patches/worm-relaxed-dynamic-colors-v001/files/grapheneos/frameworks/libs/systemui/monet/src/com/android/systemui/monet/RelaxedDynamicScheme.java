/*
 * Copyright (C) 2026 Worm OS
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 */

package com.android.systemui.monet;

import com.google.ux.material.libmonet.dynamiccolor.DynamicScheme;
import com.google.ux.material.libmonet.hct.Hct;
import com.google.ux.material.libmonet.palettes.TonalPalette;

import java.util.List;
import java.util.Optional;

/**
 * Worm OS Relaxed identity layer for Material You dynamic colors.
 *
 * <p>The wallpaper seed remains the source color, but palette hue/chroma are pulled toward
 * official Relaxed colors before Material dynamic tokens are resolved.
 */
public final class RelaxedDynamicScheme extends DynamicScheme {
    public static final int RELAXED_BACKGROUND = 0xFF353A44;
    public static final int RELAXED_FOREGROUND = 0xFFD9D9D9;
    public static final int RELAXED_GRAY = 0xFF636363;
    public static final int RELAXED_CYAN = 0xFFACBBD0;
    public static final int RELAXED_BLUE = 0xFF7EAAC7;
    public static final int RELAXED_MAGENTA = 0xFFB06698;

    private static final double ACCENT_RELAXED_WEIGHT = 0.78;
    private static final double NEUTRAL_RELAXED_WEIGHT = 0.88;
    private static final double MIN_ACCENT_CHROMA = 24.0;
    private static final double MAX_ACCENT_CHROMA = 44.0;
    private static final double MAX_NEUTRAL_CHROMA = 10.0;
    private static final double MAX_NEUTRAL_VARIANT_CHROMA = 16.0;

    public RelaxedDynamicScheme(DynamicScheme baseScheme, List<Hct> wallpaperSeedHcts) {
        super(
                wallpaperSeedHcts,
                baseScheme.variant,
                baseScheme.isDark,
                baseScheme.contrastLevel,
                baseScheme.platform,
                baseScheme.specVersion,
                accentPalette(wallpaperSeedHcts.getFirst(), RELAXED_CYAN),
                accentPalette(wallpaperSeedHcts.getFirst(), RELAXED_BLUE),
                accentPalette(wallpaperSeedHcts.getFirst(), RELAXED_MAGENTA),
                neutralPalette(wallpaperSeedHcts.getFirst(), RELAXED_BACKGROUND),
                neutralVariantPalette(wallpaperSeedHcts.getFirst()),
                Optional.of(baseScheme.errorPalette));
    }

    private static TonalPalette accentPalette(Hct wallpaperSeed, int relaxedColor) {
        Hct relaxed = Hct.fromInt(relaxedColor);
        double hue = harmonizedHue(wallpaperSeed.getHue(), relaxed.getHue(),
                ACCENT_RELAXED_WEIGHT);
        double chroma = clamp(
                relaxed.getChroma() * ACCENT_RELAXED_WEIGHT
                        + wallpaperSeed.getChroma() * (1.0 - ACCENT_RELAXED_WEIGHT),
                MIN_ACCENT_CHROMA,
                MAX_ACCENT_CHROMA);
        return TonalPalette.fromHueAndChroma(hue, chroma);
    }

    private static TonalPalette neutralPalette(Hct wallpaperSeed, int relaxedColor) {
        Hct relaxed = Hct.fromInt(relaxedColor);
        double hue = harmonizedHue(wallpaperSeed.getHue(), relaxed.getHue(),
                NEUTRAL_RELAXED_WEIGHT);
        double chroma = clamp(
                relaxed.getChroma() * NEUTRAL_RELAXED_WEIGHT
                        + wallpaperSeed.getChroma() * 0.08,
                4.0,
                MAX_NEUTRAL_CHROMA);
        return TonalPalette.fromHueAndChroma(hue, chroma);
    }

    private static TonalPalette neutralVariantPalette(Hct wallpaperSeed) {
        Hct foreground = Hct.fromInt(RELAXED_FOREGROUND);
        Hct gray = Hct.fromInt(RELAXED_GRAY);
        double relaxedHue = harmonizedHue(gray.getHue(), foreground.getHue(), 0.65);
        double hue = harmonizedHue(wallpaperSeed.getHue(), relaxedHue, NEUTRAL_RELAXED_WEIGHT);
        double relaxedChroma = foreground.getChroma() * 0.6 + gray.getChroma() * 0.4;
        double chroma = clamp(
                relaxedChroma * NEUTRAL_RELAXED_WEIGHT + wallpaperSeed.getChroma() * 0.08,
                4.0,
                MAX_NEUTRAL_VARIANT_CHROMA);
        return TonalPalette.fromHueAndChroma(hue, chroma);
    }

    private static double harmonizedHue(
            double wallpaperHue, double relaxedHue, double relaxedWeight) {
        double delta = ((wallpaperHue - relaxedHue + 540.0) % 360.0) - 180.0;
        double hue = relaxedHue + delta * (1.0 - relaxedWeight);
        return (hue + 360.0) % 360.0;
    }

    private static double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }
}
