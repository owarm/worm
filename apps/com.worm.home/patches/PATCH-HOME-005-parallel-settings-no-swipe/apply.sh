#!/usr/bin/env bash
set -u

export TZ=Europe/Rome

fail() {
    printf 'ERROR: %s\n' "$1"
    return 1
}

main() {
    PATCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    PROJECT_DIR="/opt/worm/apps/com.worm.home"
    APP_DIR="$PROJECT_DIR/app/src/main"
    STAMP="$(date '+%Y%m%d-%H%M%S')"
    BACKUP="$PROJECT_DIR/backups/PATCH-005-$STAMP"

    printf 'PATCH-HOME-005-parallel-settings-no-swipe\n'

    if [ ! -d "$PROJECT_DIR" ]; then
        fail "missing project: $PROJECT_DIR"
        return 1
    fi

    if [ ! -d "$APP_DIR" ]; then
        fail "missing app source directory: $APP_DIR"
        return 1
    fi

    if [ ! -d "$PATCH_DIR/files" ]; then
        fail "missing patch files directory: $PATCH_DIR/files"
        return 1
    fi

    mkdir -p "$BACKUP"
    if [ ! -d "$BACKUP" ]; then
        fail "could not create backup: $BACKUP"
        return 1
    fi

    for src in \
        "$APP_DIR/java/com/worm/WormHomeView.java" \
        "$APP_DIR/java/com/worm/MainActivity.java" \
        "$APP_DIR/AndroidManifest.xml" \
        "$APP_DIR/res/values/styles.xml"
    do
        if [ -f "$src" ]; then
            cp "$src" "$BACKUP/"
        fi
    done

    copy_file "$PATCH_DIR/files/WormHomeView.java" "$APP_DIR/java/com/worm/WormHomeView.java" || return 1
    copy_file "$PATCH_DIR/files/LauncherSettingsActivity.java" "$APP_DIR/java/com/worm/LauncherSettingsActivity.java" || return 1
    copy_file "$PATCH_DIR/files/AndroidManifest.xml" "$APP_DIR/AndroidManifest.xml" || return 1
    copy_file "$PATCH_DIR/files/styles.xml" "$APP_DIR/res/values/styles.xml" || return 1

    cd "$PROJECT_DIR" || {
        fail "could not cd to $PROJECT_DIR"
        return 1
    }

    export ANDROID_HOME=/opt/android-sdk
    export ANDROID_SDK_ROOT=/opt/android-sdk

    ./gradlew clean assembleRelease
    BUILD_RC=$?

    APK="$PROJECT_DIR/app/build/outputs/apk/release/app-release-unsigned.apk"
    if [ ! -f "$APK" ]; then
        APK="$PROJECT_DIR/app/build/outputs/apk/release/app-release.apk"
    fi

    printf '\nBACKUP PATH: %s\n' "$BACKUP"
    if [ "$BUILD_RC" -eq 0 ]; then
        printf 'BUILD RESULT: success\n'
        printf 'APK PATH: %s\n' "$APK"
    else
        printf 'BUILD RESULT: failed (%s)\n' "$BUILD_RC"
        printf 'APK PATH: unavailable\n'
    fi

    return "$BUILD_RC"
}

copy_file() {
    local from="$1"
    local to="$2"
    if [ ! -f "$from" ]; then
        fail "missing patch file: $from"
        return 1
    fi
    cp "$from" "$to"
}

main "$@"
PATCH_RC=$?
return "$PATCH_RC" 2>/dev/null || true
