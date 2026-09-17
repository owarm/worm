worm-os-home-v001

Worm Home native launcher base.

Project:
- /opt/worm/apps/com.worm.home
- Package: com.worm.home
- Android native Kotlin + Jetpack Compose Material 3.
- Edge-to-edge enabled.
- Dynamic color via Material 3 dynamicLightColorScheme/dynamicDarkColorScheme.
- No WebView, no INTERNET permission, no telemetry, no secrets.

Home role:
- MainActivity exports ACTION_MAIN with CATEGORY_HOME and CATEGORY_DEFAULT.
- Worm Home is not forced as default during build.

UI:
- Minimal Worm Home surface using semantic Material color tokens.
- Responsive adaptive app grid.
- Settings entry opens Android Settings.
- App icons loaded from PackageManager; adaptive icon fallback is provided for Worm Home itself.

Build:
- ./gradlew --no-daemon :app:assembleDebug
- APK: /opt/worm/artifacts/com.worm.home/com.worm.home-debug.apk
- SHA256: 3c600589d9299890359a511d46562017f825bad3e86fe8ab1ad5cbc0f9aacf1c

System app integration:
- No Android.bp/Android.mk added in this patch.
- Original Launcher is untouched; Worm Home can be tested in parallel.
