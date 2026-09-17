# worm-machinallm-v001

Patch v001 for MachinaLLM.

## Audit

- JDK: OpenJDK 21.0.12.1 runtime, Java toolchain set to 17 by Gradle convention
- Gradle: wrapper Gradle 9.6.1 copied from `/opt/worm/apps/AppStore`
- Android SDK: `/opt/android-sdk`
- build-tools: 36.1.0
- compileSdk: 36
- targetSdk: 36
- minSdk: 31

## Project

- Path: `/opt/worm/apps/com.worm.machinallm`
- Package/applicationId: `com.worm.machinallm`
- Version: `0.1.0` (`versionCode = 1`)
- Stack: Kotlin, Jetpack Compose, Material 3
- Dynamic Colors: enabled on Android 12+ using Material 3 dynamic color schemes
- Network/OpenAI/secrets/WebView/TermLLM: not included

## Build

- Command: `./gradlew assembleDebug`
- Status: success
- APK: `/opt/worm/apps/com.worm.machinallm/app/build/outputs/apk/debug/app-debug.apk`
- SHA256: `23f4bd43546e76c99b2038723db08b58ebb75ba47be3c0af4ab3c75e0783b4a8`
