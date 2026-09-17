#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/opt/worm/apps/com.worm.machinallm"
SERVICE_DIR="$PROJECT_DIR/app/src/main/java/com/worm/machinallm/service"
MANIFEST="$PROJECT_DIR/app/src/main/AndroidManifest.xml"
README="$PROJECT_DIR/README.md"

cat > "$MANIFEST" <<'EOF_MANIFEST'
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <application
        android:allowBackup="false"
        android:label="@string/app_name"
        android:supportsRtl="true"
        android:theme="@android:style/Theme.Material.NoActionBar">
        <activity
            android:name=".MainActivity"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />

                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>

</manifest>
EOF_MANIFEST

cat > "$README" <<'EOF_README'
# MachinaLLM

Native Android base for MachinaLLM on Worm OS.

## Scope

- Kotlin
- Jetpack Compose
- Material 3
- Android Dynamic Colors when available
- No OpenAI integration
- No networking
- No secrets
- No WebView
- No TermLLM dependency
- No Android permissions

## Build

```sh
./gradlew assembleDebug
```
EOF_README

rm -rf "$SERVICE_DIR"
echo "[OK] reverted worm-machinallm-v004-service"
