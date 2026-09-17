#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/opt/worm/apps/com.worm.machinallm"
APK="$PROJECT_DIR/app/build/outputs/apk/debug/app-debug.apk"

files_scanned="$(find "$PROJECT_DIR" -path '*/build/*' -prune -o -path '*/.gradle/*' -prune -o -type f \( -name '*.kt' -o -name '*.kts' -o -name 'AndroidManifest.xml' -o -path '*/res/*' -o -name 'gradle.properties' -o -name 'README.md' -o -name 'settings.gradle.kts' -o -name 'build.gradle.kts' \) -print | wc -l)"
kotlin_files="$(find "$PROJECT_DIR" -path '*/build/*' -prune -o -path '*/.gradle/*' -prune -o -type f -name '*.kt' -print | wc -l)"
resources="$(find "$PROJECT_DIR/app/src/main/res" -type f 2>/dev/null | wc -l)"
build_files="$(find "$PROJECT_DIR" -path '*/build/*' -prune -o -path '*/.gradle/*' -prune -o -type f \( -name '*.gradle.kts' -o -name 'gradle.properties' -o -name 'settings.gradle.kts' \) -print | wc -l)"
kotlin_lines="$(find "$PROJECT_DIR" -path '*/build/*' -prune -o -path '*/.gradle/*' -prune -o -type f -name '*.kt' -print0 | xargs -0 wc -l | awk '/ total$/ { print $1 }')"

echo "[INFO] files scanned: $files_scanned"
echo "[INFO] Kotlin files: $kotlin_files"
echo "[INFO] Kotlin lines: $kotlin_lines"
echo "[INFO] resources: $resources"
echo "[INFO] manifest: $PROJECT_DIR/app/src/main/AndroidManifest.xml"
echo "[INFO] build files: $build_files"

if rg -n --hidden -S 'OPENAI_API_KEY|API_KEY|SECRET|TOKEN|PASSWORD|Bearer|sk-' "$PROJECT_DIR" -g '!**/build/**' -g '!**/.gradle/**' >/tmp/machinallm-v006-secrets.txt; then
    sed 's/:.*/: [REDACTED]/' /tmp/machinallm-v006-secrets.txt
    echo "[ERROR] possible secret pattern found" >&2
    exit 1
fi

if rg -n --hidden -S 'android.permission.INTERNET|OkHttp|Retrofit|WebView|Socket|URLConnection|HttpClient' "$PROJECT_DIR/app/src/main" "$PROJECT_DIR/app/build.gradle.kts" >/tmp/machinallm-v006-network.txt; then
    cat /tmp/machinallm-v006-network.txt
    echo "[ERROR] network marker found" >&2
    exit 1
fi

if rg -n --hidden -S 'analytics|telemetry|crashlytics|firebase|sentry|datadog|bugsnag|advertising' "$PROJECT_DIR/app/src/main" "$PROJECT_DIR/app/build.gradle.kts" >/tmp/machinallm-v006-privacy.txt; then
    cat /tmp/machinallm-v006-privacy.txt
    echo "[ERROR] privacy/analytics marker found" >&2
    exit 1
fi

grep -q 'dynamicDarkColorScheme(context)' "$PROJECT_DIR/app/src/main/java/com/worm/machinallm/ui/theme/Theme.kt"
grep -q 'dynamicLightColorScheme(context)' "$PROJECT_DIR/app/src/main/java/com/worm/machinallm/ui/theme/Theme.kt"
grep -q 'LocalPlaceholderProvider' "$PROJECT_DIR/app/src/main/java/com/worm/machinallm/provider/LocalPlaceholderProvider.kt"
grep -q 'android:exported="false"' "$PROJECT_DIR/app/src/main/AndroidManifest.xml"

echo "[OK] Dynamic Colors inherited from system"
echo "[OK] application remains offline-only"
echo "[OK] no secrets"
echo "[OK] no network permission"
echo "[OK] no analytics"

if [ -f "$APK" ]; then
    echo "[INFO] APK: $APK"
    echo "[INFO] size: $(stat -c '%s bytes' "$APK")"
    echo "[INFO] SHA256: $(sha256sum "$APK" | awk '{ print $1 }')"
fi
