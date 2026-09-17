# MachinaLLM v006 Code Audit

## Summary

MachinaLLM `0.1.0` was audited as an offline-only native Android app. No critical or high severity issues were found. Six small hardening fixes were applied: message state survives rotation, loading state is no longer restored into a stuck state, send loading is set before launching work, repository calls now handle provider exceptions while preserving coroutine cancellation, backup/data extraction rules are explicit, and dead/obsolete lint findings were cleaned up.

## Environment

- Project: `/opt/worm/apps/com.worm.machinallm`
- Package: `com.worm.machinallm`
- JDK: `openjdk version "21.0.12.1" 2026-08-18`
- Gradle: `9.6.1`
- Android SDK: `/opt/android-sdk`
- compileSdk: `36`
- targetSdk: `36`
- minSdk: `31`
- ktlint: not available
- detekt: not available
- aapt: `/opt/android-sdk/build-tools/36.1.0/aapt`
- apkanalyzer: `/opt/android-sdk/cmdline-tools/latest/bin/apkanalyzer`

## Files Audited

- Files scanned: 19
- Kotlin files: 10
- Kotlin lines: approximately 427
- Resources: 3
- Manifest: `app/src/main/AndroidManifest.xml`
- Build files: 4
- README: `README.md`

## Critical Issues

None.

## High Issues

None.

## Medium Issues

- Severity: MEDIUM
- File: `app/src/main/java/com/worm/machinallm/MainActivity.kt:74`
- Description: Message list was held with `remember`, so chat state was lost on rotation/process recreation of the composable.
- Impact: User-visible local conversation state could disappear on configuration change.
- Fix: Added `rememberSaveable` with a custom `MessagesSaver`.

- Severity: MEDIUM
- File: `app/src/main/java/com/worm/machinallm/repository/MachinaRepository.kt:11`
- Description: Provider exceptions were not contained at the repository boundary.
- Impact: A future provider failure could cancel the UI coroutine instead of returning an `AiResult.Error`.
- Fix: Added exception mapping to `AiResult.Error` and rethrow of `CancellationException`.

## Low Issues

- Severity: LOW
- File: `app/src/main/java/com/worm/machinallm/MainActivity.kt:78`
- Description: Loading state used `rememberSaveable`.
- Impact: A rotation during an in-flight local request could restore `isSending=true` without an active job.
- Fix: Changed loading state to `remember`.

- Severity: LOW
- File: `app/src/main/java/com/worm/machinallm/MainActivity.kt:89`
- Description: Loading state was set inside the launched coroutine.
- Impact: Very fast repeated taps could enqueue work before Compose observed loading.
- Fix: Set `isSending=true` before launching the coroutine.

- Severity: LOW
- File: `app/src/main/AndroidManifest.xml:5`
- Description: Backup/data extraction behavior was not explicitly configured for Android 12+.
- Impact: Privacy posture depended on deprecated/default backup behavior.
- Fix: Added `backup_rules.xml` and `data_extraction_rules.xml` that exclude app data.

- Severity: LOW
- File: `app/src/main/java/com/worm/machinallm/ui/theme/Theme.kt:16`
- Description: `Build.VERSION.SDK_INT >= S` check was obsolete because `minSdk=31`.
- Impact: Lint warning and unnecessary fallback path.
- Fix: Use Dynamic Colors directly; minSdk guarantees availability.

- Severity: LOW
- File: `app/src/main/res/values/strings.xml`
- Description: `app_subtitle` was unused after v002 replaced the temporary UI.
- Impact: Dead resource.
- Fix: Removed unused string.

## Informational

- Severity: INFO
- File: `app/build.gradle.kts:20`
- Description: Lint reports `targetSdk=36` is not the latest available.
- Impact: Compatibility modes may apply on newer Android versions.
- Fix: Not applied; stability over latest per patch policy.

- Severity: INFO
- File: `gradle/wrapper/gradle-wrapper.properties`
- Description: Lint reports Gradle `9.6.1` newer version available.
- Impact: None for current build.
- Fix: Not applied.

- Severity: INFO
- File: `gradle/libs.versions.toml`
- Description: Lint reports newer AGP, Kotlin, Compose BOM, Activity Compose, and Core KTX versions.
- Impact: None confirmed; version drift to review later.
- Fix: Not applied.

- Severity: INFO
- File: `app/src/main/AndroidManifest.xml:3`
- Description: App icon is not explicitly set.
- Impact: Debug APK may use a default/no app icon.
- Fix: Not applied; adding a visual asset is outside audit hardening scope.

## Fixes Applied

- Added save/restore for in-memory message state across rotation.
- Made transient loading state non-saveable.
- Set loading before launching the send coroutine.
- Added repository exception boundary while preserving coroutine cancellation.
- Local provider now returns an error for impossible empty provider calls.
- Converted service provider/repository fields from `var` to `val`.
- Moved accessibility content descriptions into resources.
- Added backup and data extraction exclusion rules.
- Removed obsolete SDK check in Dynamic Colors theme.
- Removed unused `app_subtitle` string.

## Fixes Not Applied

- Dependency/version updates: intentionally deferred for stability.
- App icon: intentionally deferred to avoid introducing design/assets in an audit patch.
- LazyColumn item keys: not applied because messages do not yet have stable IDs; adding IDs is a model/API change better suited for v007.
- Large UI decomposition: not applied to avoid refactor beyond safe hardening.

## Compose Audit

Status: OK with minor remaining risk. `MaterialTheme.colorScheme` is used throughout, no custom palette or HEX colors are present, edge-to-edge uses `WindowInsets.safeDrawing`, IME send action is present, and touch targets are at least 56dp. Applied fixes improve rotation behavior and loading lifecycle. Remaining risk: `LazyColumn` has no stable keys because `Message` has no ID.

## Architecture Audit

Status: OK. The flow remains `UI -> MachinaRepository -> AiProvider -> LocalPlaceholderProvider`. The core/provider/repository layers do not depend on Compose or UI classes. No OpenAI or TermLLM implementation exists.

## Service Audit

Status: OK. `MachinaLlmService` is local, non-exported, minimal, and does not use foreground service, wake locks, background work, or public cross-app Binder API. It remains prepared for future provider selection without implementing public APIs.

## Manifest Audit

Status: OK. `MainActivity` is exported for launcher use, `MachinaLlmService` is `exported=false`, no app-defined dangerous permissions are present, and no system UID/sharedUserId/privileged markers exist. Backup/data extraction exclusions are now explicit.

## Gradle Audit

Status: OK with informational version warnings. AGP/Kotlin/Compose versions are coherent with the existing environment and build successfully. No duplicate or network/backend dependencies were found. Lint reports newer versions but no build-breaking Gradle issue.

## Security Audit

Status: OK. Secret scan found no `OPENAI_API_KEY`, `API_KEY`, `SECRET`, `TOKEN`, `PASSWORD`, `Bearer`, or `sk-` in app sources/config. No WebView, OkHttp, Retrofit, OpenAI SDK, socket, URLConnection, or HttpClient code is present.

## Privacy Audit

Status: OK. No analytics, telemetry, Firebase, crash reporting, advertising ID, location, contacts, call logs, clipboard harvesting, or background collection code was found. Backup/data extraction is explicitly excluded.

## Performance Audit

Status: OK for 0.1.0. No file I/O, network I/O, heavy computation, custom threads, or blocking work in composables. Startup cost is minimal. Remaining risk: future long histories should add stable message IDs and keys.

## APK Audit

- APK: `/opt/worm/apps/com.worm.machinallm/app/build/outputs/apk/debug/app-debug.apk`
- Size: `28904069 bytes`
- SHA256: `8ca8258d4a90405c95c5a894d8664afccdd8a1742adb9005a35d90569f3c2e0e`
- package: `com.worm.machinallm`
- versionCode: `1`
- versionName: `0.1.0`
- minSdk: `31`
- targetSdk: `36`
- APK permissions: `com.worm.machinallm.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`
- INTERNET permission: absent

## Build Results

- `./gradlew clean assembleDebug`: PASS
- `./gradlew lintDebug`: PASS, 0 errors, 9 warnings
- `./gradlew test`: PASS, no unit test sources
- `ktlint`: not available
- `detekt`: not available
- `aapt dump permissions`: PASS, no `android.permission.INTERNET`

## Remaining Risks

- Debug APK has no custom launcher icon.
- Lint reports newer SDK/dependency versions; not updated by policy.
- `Message` has no stable ID, so LazyColumn keys remain positional.
- No automated unit tests exist yet.
- Gradle emits deprecated-feature notices for future Gradle 10 compatibility.
- Gradle daemon startup requires elevated execution in this sandbox due wildcard IP lock handling.

## Recommendation for v007

Add a small UI state holder or ViewModel, stable message IDs, focused unit tests for repository/provider behavior, and a simple launcher icon asset. Keep networking and provider integrations out until explicit backend requirements are defined.
