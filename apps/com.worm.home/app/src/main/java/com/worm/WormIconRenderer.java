package com.worm;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Path;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.drawable.AdaptiveIconDrawable;
import android.graphics.drawable.BitmapDrawable;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.Drawable;

import java.util.LinkedHashMap;
import java.util.Map;

public final class WormIconRenderer {

    private static final int CACHE_LIMIT = 96;

    private static final Map<String, Drawable> CACHE =
            new LinkedHashMap<String, Drawable>(CACHE_LIMIT, 0.75f, true) {
                @Override
                protected boolean removeEldestEntry(
                        Map.Entry<String, Drawable> eldest
                ) {
                    return size() > CACHE_LIMIT;
                }
            };

    private WormIconRenderer() {}

    public static synchronized Drawable renderPx(
            Context context,
            Drawable source,
            int px
    ) {
        px = Math.max(1, px);

        String key =
                source.getClass().getName()
                        + ":"
                        + source.getConstantState()
                        + ":"
                        + px;

        Drawable cached = CACHE.get(key);

        if (cached != null) {
            Drawable.ConstantState state =
                    cached.getConstantState();

            return state != null
                    ? state.newDrawable(context.getResources())
                    : cached;
        }

        Drawable rendered = renderInternal(
                context,
                source,
                px
        );

        CACHE.put(key, rendered);

        Drawable.ConstantState state =
                rendered.getConstantState();

        return state != null
                ? state.newDrawable(context.getResources())
                : rendered;
    }

    private static Drawable renderInternal(
            Context context,
            Drawable source,
            int px
    ) {
        Bitmap bitmap = Bitmap.createBitmap(
                px,
                px,
                Bitmap.Config.ARGB_8888
        );

        Canvas canvas = new Canvas(bitmap);

        float radius = px * 0.235f;

        Path clip = new Path();
        clip.addRoundRect(
                new RectF(0, 0, px, px),
                radius,
                radius,
                Path.Direction.CW
        );

        canvas.save();
        canvas.clipPath(clip);

        if (source instanceof AdaptiveIconDrawable) {
            drawAdaptive(
                    canvas,
                    (AdaptiveIconDrawable) source,
                    px
            );
        } else {
            drawLegacy(
                    canvas,
                    source,
                    px
            );
        }

        canvas.restore();

        return new BitmapDrawable(
                context.getResources(),
                bitmap
        );
    }

    private static void drawAdaptive(
            Canvas canvas,
            AdaptiveIconDrawable adaptive,
            int px
    ) {
        Drawable background = adaptive.getBackground();
        Drawable foreground = adaptive.getForeground();

        if (background != null) {
            Rect old = background.getBounds();
            background.setBounds(0, 0, px, px);
            background.draw(canvas);
            background.setBounds(old);
        } else {
            canvas.drawColor(
                    Color.rgb(38, 38, 40)
            );
        }

        if (foreground != null) {
            /*
             * Adaptive foregrounds contain their own safe-zone.
             * Overscan keeps the visual size closer to home-target.png
             * without forcing circular masks or giant white tiles.
             */
            int overscan = Math.round(px * 0.105f);

            Rect old = foreground.getBounds();

            foreground.setBounds(
                    -overscan,
                    -overscan,
                    px + overscan,
                    px + overscan
            );

            foreground.draw(canvas);
            foreground.setBounds(old);
        }
    }

    private static void drawLegacy(
            Canvas canvas,
            Drawable source,
            int px
    ) {
        boolean needsBacking =
                source instanceof ColorDrawable;

        if (needsBacking) {
            canvas.drawColor(
                    Color.rgb(43, 43, 46)
            );
        } else {
            canvas.drawColor(
                    Color.rgb(29, 29, 31)
            );
        }

        if (source == null) {
            return;
        }

        int inset = Math.round(px * 0.105f);

        Rect old = source.getBounds();

        source.setBounds(
                inset,
                inset,
                px - inset,
                px - inset
        );

        source.draw(canvas);
        source.setBounds(old);
    }
}
