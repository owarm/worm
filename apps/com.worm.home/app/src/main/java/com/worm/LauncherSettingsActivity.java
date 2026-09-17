package com.worm;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Insets;
import android.graphics.Outline;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewOutlineProvider;
import android.view.Window;
import android.view.WindowInsets;
import android.widget.CompoundButton;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.Switch;
import android.widget.TextView;

public final class LauncherSettingsActivity extends Activity {
    private static final String PREFS_NAME = "worm_home_settings";
    private static final String KEY_ANIMATIONS = "animations";
    private static final String KEY_HAPTIC = "haptic";

    private static final int COLOR_TEXT = Color.rgb(248, 248, 248);
    private static final int COLOR_SUBTEXT = Color.argb(210, 235, 235, 235);
    private static final int COLOR_SECTION = Color.argb(168, 21, 21, 21);
    private static final int COLOR_ROW = Color.argb(92, 35, 35, 35);
    private static final int COLOR_EDGE = Color.argb(32, 255, 255, 255);

    private SharedPreferences prefs;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);

        Window window = getWindow();
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        window.setBackgroundDrawableResource(android.R.color.transparent);

        if (Build.VERSION.SDK_INT >= 30) {
            window.setDecorFitsSystemWindows(false);
        } else {
            window.getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            );
        }

        setContentView(buildContent());
    }

    private View buildContent() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.TRANSPARENT);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            int left = dp(22);
            int top = dp(28);
            int right = dp(22);
            int bottom = dp(28);

            if (Build.VERSION.SDK_INT >= 30) {
                Insets bars = insets.getInsets(
                        WindowInsets.Type.navigationBars()
                                | WindowInsets.Type.statusBars()
                                | WindowInsets.Type.displayCutout()
                );
                left += bars.left;
                top += bars.top;
                right += bars.right;
                bottom += bars.bottom;
            } else {
                top += insets.getSystemWindowInsetTop();
                bottom += insets.getSystemWindowInsetBottom();
            }

            view.setPadding(left, top, right, bottom);
            return insets;
        });

        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setGravity(Gravity.CENTER_HORIZONTAL);

        TextView title = label("worm home", 25f, COLOR_TEXT, true);
        TextView subtitle = label("launcher settings", 14f, COLOR_SUBTEXT, false);

        LinearLayout.LayoutParams subtitleLp =
                new LinearLayout.LayoutParams(wrapContent(), wrapContent());
        subtitleLp.topMargin = dp(6);
        subtitleLp.bottomMargin = dp(22);

        content.addView(title);
        content.addView(subtitle, subtitleLp);
        content.addView(section("Wallpaper", infoRow("System wallpaper")));
        content.addView(section(
                "Motion",
                switchRow("Animations", KEY_ANIMATIONS),
                switchRow("Haptic feedback", KEY_HAPTIC)
        ));

        FrameLayout.LayoutParams contentLp = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.WRAP_CONTENT
        );
        contentLp.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
        root.addView(content, contentLp);

        return root;
    }

    private View section(String title, View... rows) {
        LinearLayout section = new LinearLayout(this);
        section.setOrientation(LinearLayout.VERTICAL);
        section.setPadding(dp(16), dp(15), dp(16), dp(12));
        surface(section, COLOR_SECTION, dp(20));

        TextView heading = label(title, 13f, COLOR_SUBTEXT, true);
        LinearLayout.LayoutParams headingLp =
                new LinearLayout.LayoutParams(wrapContent(), wrapContent());
        headingLp.bottomMargin = dp(10);
        section.addView(heading, headingLp);

        for (int i = 0; i < rows.length; i++) {
            LinearLayout.LayoutParams rowLp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    dp(52)
            );
            if (i > 0) {
                rowLp.topMargin = dp(8);
            }
            section.addView(rows[i], rowLp);
        }

        LinearLayout.LayoutParams sectionLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
        );
        sectionLp.bottomMargin = dp(14);
        section.setLayoutParams(sectionLp);

        return section;
    }

    private View infoRow(String value) {
        LinearLayout row = baseRow();
        row.addView(label(value, 16f, COLOR_TEXT, false));
        return row;
    }

    private View switchRow(String label, String key) {
        LinearLayout row = baseRow();

        TextView text = label(label, 16f, COLOR_TEXT, false);
        row.addView(
                text,
                new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        );

        Switch control = new Switch(this);
        control.setChecked(prefs.getBoolean(key, true));
        control.setOnCheckedChangeListener((CompoundButton button, boolean checked) ->
                prefs.edit().putBoolean(key, checked).apply()
        );
        row.addView(control);

        row.setOnClickListener(view -> control.setChecked(!control.isChecked()));
        return row;
    }

    private LinearLayout baseRow() {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(14), 0, dp(10), 0);
        surface(row, COLOR_ROW, dp(15));
        return row;
    }

    private TextView label(String value, float sp, int color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(sp);
        view.setTextColor(color);
        view.setIncludeFontPadding(false);
        if (bold) {
            view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        }
        return view;
    }

    private void surface(View view, int color, int radius) {
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(color);
        bg.setCornerRadius(radius);
        bg.setStroke(Math.max(1, dp(1)), COLOR_EDGE);
        view.setBackground(bg);
        view.setElevation(dp(3));
        view.setOutlineProvider(new RoundedOutline(radius));
        view.setClipToOutline(false);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private int wrapContent() {
        return LinearLayout.LayoutParams.WRAP_CONTENT;
    }

    private static final class RoundedOutline extends ViewOutlineProvider {
        private final int radius;

        RoundedOutline(int radius) {
            this.radius = radius;
        }

        @Override
        public void getOutline(View view, Outline outline) {
            outline.setRoundRect(0, 0, view.getWidth(), view.getHeight(), radius);
            outline.setAlpha(0.9f);
        }
    }
}
