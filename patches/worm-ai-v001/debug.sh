#!/usr/bin/env bash
set -euo pipefail

PROJECT="/opt/worm/apps/com.worm.ai"
PATCH="/opt/worm/patches/worm-ai-v001"
APK="$PROJECT/app/build/outputs/apk/debug/app-debug.apk"

ok() { printf '[OK] %s\n' "$*"; }
info() { printf '[INFO] %s\n' "$*"; }
warn() { printf '[WARN] %s\n' "$*"; }
error() { printf '[ERROR] %s\n' "$*" >&2; }

info "Project: $PROJECT"
info "Patch: $PATCH"

[[ -d "$PROJECT" ]] && ok "project path exists" || { error "project path missing"; exit 1; }
[[ -d "$PATCH" ]] && ok "patch path exists" || { error "patch path missing"; exit 1; }
[[ -x "$PROJECT/gradlew" ]] && ok "Gradle wrapper executable" || { error "Gradle wrapper missing"; exit 1; }
[[ -d /opt/android-sdk ]] && ok "Android SDK: /opt/android-sdk" || { error "Android SDK missing"; exit 1; }

java -version 2>&1 | sed 's/^/[INFO] JDK: /'
grep -E '^distributionUrl=' "$PROJECT/gradle/wrapper/gradle-wrapper.properties" | sed 's/^/[INFO] Gradle: /'

checks=(
  'namespace = "com.worm.ai"'
  'applicationId = "com.worm.ai"'
  'compileSdk = 36'
  'minSdk = 31'
  'targetSdk = 36'
  'versionCode = 1'
  'versionName = "0.1.0"'
  'dynamicDarkColorScheme'
  'dynamicLightColorScheme'
  'isSystemInDarkTheme'
)

for needle in "${checks[@]}"; do
  if grep -R --fixed-strings -q "$needle" "$PROJECT" --exclude-dir=.gradle --exclude-dir=.gradle-user-home --exclude-dir=build; then
    ok "$needle"
  else
    error "missing $needle"
    exit 1
  fi
done

if grep -q 'android.intent.action.MAIN' "$PROJECT/app/src/main/AndroidManifest.xml" &&
   grep -q 'android.intent.category.LAUNCHER' "$PROJECT/app/src/main/AndroidManifest.xml" &&
   grep -q 'android:exported="true"' "$PROJECT/app/src/main/AndroidManifest.xml"; then
  ok "manifest launcher activity"
else
  error "manifest launcher activity invalid"
  exit 1
fi

for forbidden in \
  'android.permission.INTERNET' \
  'OPENAI_API_KEY' \
  'api.openai.com' \
  'OkHttp' \
  'Retrofit' \
  'WebView' \
  'Firebase' \
  'Sentry' \
  'analytics' \
  'telemetry' \
  'tracking'; do
  if grep -R --fixed-strings -q "$forbidden" "$PROJECT" "$PATCH" --exclude-dir=.gradle --exclude-dir=.gradle-user-home --exclude-dir=build --exclude-dir=archive --exclude='debug.sh'; then
    error "forbidden reference found: $forbidden"
    exit 1
  else
    ok "forbidden reference absent: $forbidden"
  fi
done

info "AGP: 9.2.0"
info "Kotlin: 2.3.21"
info "Compose BOM: 2026.06.00"
info "Package: com.worm.ai"
info "Version: 0.1.0"
info "compileSdk: 36"
info "minSdk: 31"
info "targetSdk: 36"
info "Dynamic Colors: dynamic Material 3 color scheme on Android 12+"
info "System dark/light: follows isSystemInDarkTheme()"

if [[ -f "$APK" ]]; then
  ok "APK exists"
  info "APK: $APK"
  info "APK size: $(stat -c '%s' "$APK")"
  info "APK SHA256: $(sha256sum "$APK" | awk '{print $1}')"
else
  warn "APK not built yet: $APK"
fi
