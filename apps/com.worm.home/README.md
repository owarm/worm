# worm home — clean rebuild

Fresh `com.worm` launcher implementation created from scratch around the target composition.

Included:
- full-screen system wallpaper
- no clock
- main lower container
- Fav. apps banner
- two 4x2 app grids (16 apps)
- separate 5-icon dock
- no labels under Home icons
- target-style charcoal surfaces
- display adaptation with WindowInsets
- adaptive-icon-preserving renderer
- subtle stretch + haptic

Intentionally not included:
- settings
- old patches
- old Relaxed palette
- signing keys

Build:
```bash
cd /opt/com.worm
export ANDROID_HOME=/opt/android-sdk
export ANDROID_SDK_ROOT=/opt/android-sdk
gradle wrapper   # only if the fresh project has no wrapper yet
./gradlew clean assembleRelease
```

Reuse the EXISTING worm home signing identity. Do not generate a new key.
