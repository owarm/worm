# PATCH-HOME-005-parallel-settings-no-swipe

Adds a separate launcher settings Activity and keeps the Home as a strict single-page launcher.

## Changes

- Adds `LauncherSettingsActivity`.
- Registers the settings Activity as non-exported with label `worm home settings`.
- Opens settings from long-press on an empty Home area.
- Adds `worm_home_settings` SharedPreferences keys:
  - `animations`, default `true`
  - `haptic`, default `true`
- Gates existing entrance and press/stretch animation on `animations`.
- Gates icon tap and empty-area long-press haptics on `haptic`.
- Confirms no horizontal pager/swipe implementation exists in Home source and introduces none.

## Apply

Run from any shell:

```sh
/opt/worm/apps/com.worm.home/patches/PATCH-HOME-005-parallel-settings-no-swipe/apply.sh
```

The script uses `TZ=Europe/Rome`, creates a backup under `backups/PATCH-005-*`, applies files from `files/`, and runs:

```sh
./gradlew clean assembleRelease
```
