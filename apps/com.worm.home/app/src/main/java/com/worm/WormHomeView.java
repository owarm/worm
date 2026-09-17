package com.worm;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Color;
import android.graphics.Insets;
import android.graphics.Outline;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.view.Gravity;
import android.view.HapticFeedbackConstants;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewOutlineProvider;
import android.view.WindowInsets;
import android.view.animation.OvershootInterpolator;
import android.view.animation.PathInterpolator;
import android.widget.FrameLayout;
import android.widget.GridLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

public final class WormHomeView extends FrameLayout {

    /*
     * home-target.png reference canvas: 691 x 1536
     *
     * Original measured geometry:
     * MAIN:   x=67  y=639   w=557 h=713
     * BANNER: x=86  y=663   w=519 h=125
     * GRID 1: x=87  y=807   w=518 h=250
     * GRID 2: x=87  y=1076  w=518 h=250
     * DOCK:   x=68  y=1378  w=555 h=132
     *
     * Original gaps:
     * outer top -> Fav. apps    = 24 px
     * Fav. apps -> grid 1       = 19 px
     * grid 1 -> grid 2          = 19 px
     * grid 2 -> outer bottom    = 26 px
     * outer -> dock             = 26 px
     * dock -> bottom            = 26 px
     *
     * PATCH-003:
     * - keep bottom/display gaps stable
     * - place dock above navigation bar with the same target gap
     * - derive main container from dock + target gap
     * - add subtle shadow + thin translucent line to P1 and P2
     * - keep system wallpaper only
     */

    private static final float REF_W = 691f;

    private static final float MAIN_X = 67f;
    private static final float MAIN_W = 557f;
    private static final float MAIN_H = 713f;

    private static final float BANNER_X_IN = 19f;
    private static final float BANNER_Y_IN = 24f;
    private static final float BANNER_W = 519f;
    private static final float BANNER_H = 125f;

    private static final float GRID_X_IN = 20f;
    private static final float GRID1_Y_IN = 168f;
    private static final float GRID2_Y_IN = 437f;
    private static final float GRID_W = 518f;
    private static final float GRID_H = 250f;

    private static final float DOCK_X = 68f;
    private static final float DOCK_W = 555f;
    private static final float DOCK_H = 132f;

    private static final float GAP_GRID2_TO_OUTER_BOTTOM = 26f;
    private static final float GAP_OUTER_TO_DOCK = 26f;
    private static final float GAP_DOCK_TO_BOTTOM = 26f;

    private static final int COLOR_OUTER = Color.rgb(21, 21, 21);
    private static final int COLOR_PANEL = Color.rgb(35, 35, 35);
    private static final int COLOR_DOCK = Color.rgb(21, 21, 21);
    private static final int COLOR_BANNER = Color.rgb(95, 103, 106);
    private static final int COLOR_TEXT = Color.rgb(248, 248, 248);
    private static final int COLOR_SUBTEXT = Color.rgb(235, 235, 235);
    private static final int COLOR_EDGE = Color.argb(18, 255, 255, 255);
    private static final int COLOR_PANEL_EDGE = Color.argb(30, 255, 255, 255);
    private static final String PREFS_NAME = "worm_home_settings";
    private static final String KEY_ANIMATIONS = "animations";
    private static final String KEY_HAPTIC = "haptic";

    private final Context context;
    private final PackageManager pm;
    private final SharedPreferences prefs;

    private final PathInterpolator emphasized =
            new PathInterpolator(0.05f, 0.7f, 0.1f, 1f);

    private final List<View> entrance = new ArrayList<>();
    private View dock;
    private int insetBottom;
    private int insetTop;
    private int lastWidth = -1;
    private int lastHeight = -1;
    private int lastInsetBottom = -1;

    public WormHomeView(Context context) {
        super(context);
        this.context = context;
        this.pm = context.getPackageManager();
        this.prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);

        setBackgroundColor(Color.TRANSPARENT);
        setClickable(true);
        setLongClickable(true);
        setHapticFeedbackEnabled(false);
        setOnLongClickListener(v -> {
            if (hapticEnabled()) {
                performHapticFeedback(
                        HapticFeedbackConstants.LONG_PRESS,
                        HapticFeedbackConstants.FLAG_IGNORE_VIEW_SETTING
                );
            }
            Intent intent = new Intent(context, LauncherSettingsActivity.class);
            context.startActivity(intent);
            return true;
        });

        setOnApplyWindowInsetsListener((v, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                Insets bars = insets.getInsets(
                        WindowInsets.Type.navigationBars()
                                | WindowInsets.Type.statusBars()
                                | WindowInsets.Type.displayCutout()
                );
                insetBottom = bars.bottom;
                insetTop = bars.top;
            } else {
                insetBottom = insets.getSystemWindowInsetBottom();
                insetTop = insets.getSystemWindowInsetTop();
            }
            post(this::rebuild);
            return insets;
        });

        post(this::rebuild);
    }

    private void rebuild() {
        if (getWidth() <= 0 || getHeight() <= 0) {
            post(this::rebuild);
            return;
        }

        if (getWidth() == lastWidth
                && getHeight() == lastHeight
                && insetBottom == lastInsetBottom
                && getChildCount() > 0) {
            return;
        }

        lastWidth = getWidth();
        lastHeight = getHeight();
        lastInsetBottom = insetBottom;

        removeAllViews();
        entrance.clear();
        dock = null;

        addTargetHome();
        if (animationsEnabled()) {
            post(this::animateIn);
        } else {
            showWithoutAnimation();
        }
    }

    private void addTargetHome() {
        final float scale = getWidth() / REF_W;

        final int mainX = px(MAIN_X, scale);
        final int mainW = px(MAIN_W, scale);
        final int mainH = px(MAIN_H, scale);

        final int dockX = px(DOCK_X, scale);
        final int dockW = px(DOCK_W, scale);
        final int dockH = px(DOCK_H, scale);

        final int gapOuterToDock = px(GAP_OUTER_TO_DOCK, scale);
        final int gapDockToBottom = px(GAP_DOCK_TO_BOTTOM, scale);

        final int dockBottom = insetBottom + gapDockToBottom;
        final int mainBottom = dockBottom + dockH + gapOuterToDock;

        List<AppEntry> apps = loadApps();

        FrameLayout main = new FrameLayout(context);
        styleSurface(main, COLOR_OUTER, px(29f, scale), px(3f, scale), COLOR_EDGE, true);

        LayoutParams mainLp = new LayoutParams(mainW, mainH);
        mainLp.gravity = Gravity.BOTTOM | Gravity.START;
        mainLp.leftMargin = mainX;
        mainLp.bottomMargin = mainBottom;

        View banner = buildBanner(scale);
        FrameLayout.LayoutParams bannerLp =
                new FrameLayout.LayoutParams(px(BANNER_W, scale), px(BANNER_H, scale));
        bannerLp.leftMargin = px(BANNER_X_IN, scale);
        bannerLp.topMargin = px(BANNER_Y_IN, scale);
        main.addView(banner, bannerLp);

        View grid1 = buildGrid(apps, 0, 8, scale);
        FrameLayout.LayoutParams grid1Lp =
                new FrameLayout.LayoutParams(px(GRID_W, scale), px(GRID_H, scale));
        grid1Lp.leftMargin = px(GRID_X_IN, scale);
        grid1Lp.topMargin = px(GRID1_Y_IN, scale);
        main.addView(grid1, grid1Lp);

        View grid2 = buildGrid(apps, 8, 16, scale);
        FrameLayout.LayoutParams grid2Lp =
                new FrameLayout.LayoutParams(px(GRID_W, scale), px(GRID_H, scale));
        grid2Lp.leftMargin = px(GRID_X_IN, scale);
        grid2Lp.topMargin = px(GRID2_Y_IN, scale);
        main.addView(grid2, grid2Lp);

        prepare(main, px(16f, scale));
        entrance.add(main);
        addView(main, mainLp);

        dock = buildDock(apps, scale);

        LayoutParams dockLp = new LayoutParams(dockW, dockH);
        dockLp.gravity = Gravity.BOTTOM | Gravity.START;
        dockLp.leftMargin = dockX;
        dockLp.bottomMargin = dockBottom;

        dock.setAlpha(0f);
        dock.setTranslationY(px(14f, scale));
        dock.setScaleX(0.985f);
        dock.setScaleY(0.985f);

        addView(dock, dockLp);
    }

    private View buildBanner(float scale) {
        LinearLayout banner = new LinearLayout(context);
        banner.setOrientation(LinearLayout.VERTICAL);
        banner.setGravity(Gravity.CENTER_VERTICAL);
        banner.setPadding(px(28f, scale), 0, px(20f, scale), 0);

        styleSurface(banner, COLOR_BANNER, px(23f, scale), px(2f, scale), COLOR_EDGE, false);

        banner.addView(text("Fav. apps", spFromRef(22f, scale), COLOR_TEXT));

        TextView subtitle = text(
                "There are 13 Favorite Apps.",
                spFromRef(13f, scale),
                COLOR_SUBTEXT
        );

        LinearLayout.LayoutParams subLp =
                new LinearLayout.LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT);
        subLp.topMargin = px(4f, scale);
        banner.addView(subtitle, subLp);

        return banner;
    }

    private View buildGrid(List<AppEntry> apps, int start, int end, float scale) {
        FrameLayout panel = new FrameLayout(context);

        panel.setPadding(
                px(18f, scale),
                px(15f, scale),
                px(18f, scale),
                px(15f, scale)
        );

        styleSurface(
                panel,
                COLOR_PANEL,
                px(22f, scale),
                px(5f, scale),
                COLOR_PANEL_EDGE,
                true
        );

        GridLayout grid = new GridLayout(context);
        grid.setColumnCount(4);
        grid.setRowCount(2);
        grid.setAlignmentMode(GridLayout.ALIGN_BOUNDS);

        int max = Math.min(end, apps.size());
        final int iconPx = px(78f, scale);

        for (int i = start; i < max; i++) {
            grid.addView(appCell(apps.get(i), iconPx), gridCellParams(scale));
        }

        panel.addView(
                grid,
                new FrameLayout.LayoutParams(
                        LayoutParams.MATCH_PARENT,
                        LayoutParams.MATCH_PARENT
                )
        );

        return panel;
    }

    private View buildDock(List<AppEntry> apps, float scale) {
        LinearLayout row = new LinearLayout(context);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER);
        row.setPadding(
                px(15f, scale),
                px(10f, scale),
                px(15f, scale),
                px(10f, scale)
        );

        styleSurface(row, COLOR_DOCK, px(25f, scale), px(3f, scale), COLOR_EDGE, true);

        int count = Math.min(5, apps.size());
        int iconPx = px(72f, scale);

        for (int i = 0; i < count; i++) {
            AppEntry app = apps.get(i);

            FrameLayout cell = new FrameLayout(context);

            ImageView icon = new ImageView(context);
            icon.setImageDrawable(
                    WormIconRenderer.renderPx(
                            context,
                            app.icon,
                            iconPx
                    )
            );
            icon.setScaleType(ImageView.ScaleType.FIT_CENTER);
            icon.setContentDescription(app.label);

            FrameLayout.LayoutParams iconLp = new FrameLayout.LayoutParams(iconPx, iconPx);
            iconLp.gravity = Gravity.CENTER;

            cell.addView(icon, iconLp);

            installInteraction(cell);
            cell.setOnClickListener(v -> launch(app.component));

            row.addView(
                    cell,
                    new LinearLayout.LayoutParams(
                            0,
                            LayoutParams.MATCH_PARENT,
                            1f
                    )
            );
        }

        return row;
    }

    private View appCell(AppEntry app, int iconPx) {
        FrameLayout cell = new FrameLayout(context);

        ImageView icon = new ImageView(context);
        icon.setImageDrawable(
                    WormIconRenderer.renderPx(
                            context,
                            app.icon,
                            iconPx
                    )
            );
        icon.setScaleType(ImageView.ScaleType.FIT_CENTER);
        icon.setContentDescription(app.label);

        FrameLayout.LayoutParams iconLp = new FrameLayout.LayoutParams(iconPx, iconPx);
        iconLp.gravity = Gravity.CENTER;

        cell.addView(icon, iconLp);

        installInteraction(cell);
        cell.setOnClickListener(v -> launch(app.component));

        return cell;
    }

    private GridLayout.LayoutParams gridCellParams(float scale) {
        GridLayout.LayoutParams lp = new GridLayout.LayoutParams();

        lp.width = 0;
        lp.height = 0;
        lp.columnSpec = GridLayout.spec(GridLayout.UNDEFINED, 1f);
        lp.rowSpec = GridLayout.spec(GridLayout.UNDEFINED, 1f);

        int margin = px(4f, scale);
        lp.setMargins(margin, margin, margin, margin);

        return lp;
    }

    private void styleSurface(
            View view,
            int color,
            int radius,
            int elevation,
            int strokeColor,
            boolean shadow
    ) {
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(color);
        bg.setCornerRadius(radius);
        bg.setStroke(Math.max(1, dp(1)), strokeColor);

        view.setBackground(bg);
        view.setElevation(elevation);
        view.setOutlineProvider(new RoundedOutline(radius));
        view.setClipToOutline(false);

        if (shadow) {
            view.setTranslationZ(dp(1));
        }
    }

    private void installInteraction(View view) {
        view.setClickable(true);
        view.setHapticFeedbackEnabled(false);

        view.setOnTouchListener((v, event) -> {
            switch (event.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    if (hapticEnabled()) {
                        v.performHapticFeedback(
                                HapticFeedbackConstants.VIRTUAL_KEY,
                                HapticFeedbackConstants.FLAG_IGNORE_VIEW_SETTING
                        );
                    }
                    if (!animationsEnabled()) {
                        return false;
                    }
                    v.animate()
                            .scaleX(1.018f)
                            .scaleY(0.95f)
                            .setDuration(95L)
                            .setInterpolator(emphasized)
                            .start();
                    break;

                case MotionEvent.ACTION_UP:
                case MotionEvent.ACTION_CANCEL:
                    if (!animationsEnabled()) {
                        v.setScaleX(1f);
                        v.setScaleY(1f);
                        return false;
                    }
                    v.animate()
                            .scaleX(0.995f)
                            .scaleY(1.015f)
                            .setDuration(105L)
                            .setInterpolator(new OvershootInterpolator(0.32f))
                            .withEndAction(() ->
                                    v.animate()
                                            .scaleX(1f)
                                            .scaleY(1f)
                                            .setDuration(115L)
                                            .setInterpolator(emphasized)
                                            .start()
                            )
                            .start();
                    break;
            }
            return false;
        });
    }

    private void animateIn() {
        long delay = 45L;

        for (View view : entrance) {
            view.animate()
                    .alpha(1f)
                    .translationY(0f)
                    .setStartDelay(delay)
                    .setDuration(320L)
                    .setInterpolator(emphasized)
                    .start();
            delay += 60L;
        }

        if (dock != null) {
            dock.animate()
                    .alpha(1f)
                    .translationY(0f)
                    .scaleX(1f)
                    .scaleY(1f)
                    .setStartDelay(delay)
                    .setDuration(350L)
                    .setInterpolator(new OvershootInterpolator(0.35f))
                    .start();
        }
    }

    private void prepare(View view, int offset) {
        if (!animationsEnabled()) {
            view.setAlpha(1f);
            view.setTranslationY(0f);
            return;
        }
        view.setAlpha(0f);
        view.setTranslationY(offset);
    }

    private void showWithoutAnimation() {
        for (View view : entrance) {
            view.setAlpha(1f);
            view.setTranslationY(0f);
            view.setScaleX(1f);
            view.setScaleY(1f);
        }

        if (dock != null) {
            dock.setAlpha(1f);
            dock.setTranslationY(0f);
            dock.setScaleX(1f);
            dock.setScaleY(1f);
        }
    }

    private boolean animationsEnabled() {
        return prefs.getBoolean(KEY_ANIMATIONS, true);
    }

    private boolean hapticEnabled() {
        return prefs.getBoolean(KEY_HAPTIC, true);
    }

    private List<AppEntry> loadApps() {
        List<AppEntry> result = new ArrayList<>();

        Intent query = new Intent(Intent.ACTION_MAIN);
        query.addCategory(Intent.CATEGORY_LAUNCHER);

        List<ResolveInfo> infos;

        if (Build.VERSION.SDK_INT >= 33) {
            infos = pm.queryIntentActivities(
                    query,
                    PackageManager.ResolveInfoFlags.of(0)
            );
        } else {
            infos = pm.queryIntentActivities(query, 0);
        }

        for (ResolveInfo info : infos) {
            if (info.activityInfo == null) {
                continue;
            }

            String pkg = info.activityInfo.packageName;

            if (context.getPackageName().equals(pkg)) {
                continue;
            }

            ComponentName component = new ComponentName(pkg, info.activityInfo.name);

            result.add(
                    new AppEntry(
                            info.loadLabel(pm).toString(),
                            component,
                            info.loadIcon(pm)
                    )
            );
        }

        result.sort(Comparator.comparing(
                app -> app.label.toLowerCase(Locale.ROOT)
        ));

        return result;
    }

    private void launch(ComponentName component) {
        Intent intent = new Intent(Intent.ACTION_MAIN);
        intent.addCategory(Intent.CATEGORY_LAUNCHER);
        intent.setComponent(component);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

        try {
            context.startActivity(intent);
        } catch (Exception ignored) {
        }
    }

    private TextView text(String value, float sp, int color) {
        TextView view = new TextView(context);
        view.setText(value);
        view.setTextSize(sp);
        view.setTextColor(color);
        view.setIncludeFontPadding(false);
        return view;
    }

    private int px(float referencePx, float scale) {
        return Math.round(referencePx * scale);
    }

    private float spFromRef(float referencePx, float scale) {
        float scaledDensity = getResources().getDisplayMetrics().scaledDensity;
        return (referencePx * scale) / scaledDensity;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private static final class RoundedOutline extends ViewOutlineProvider {
        private final int radius;

        RoundedOutline(int radius) {
            this.radius = radius;
        }

        @Override
        public void getOutline(View view, Outline outline) {
            outline.setRoundRect(0, 0, view.getWidth(), view.getHeight(), radius);
            outline.setAlpha(0.96f);
        }
    }

    private static final class AppEntry {
        final String label;
        final ComponentName component;
        final Drawable icon;

        AppEntry(String label, ComponentName component, Drawable icon) {
            this.label = label;
            this.component = component;
            this.icon = icon;
        }
    }
}
