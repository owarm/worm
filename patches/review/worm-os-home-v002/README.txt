PATCH: worm-os-home-v002

Status: no-op rebased patch for current Worm Home project.

worm-os-home-v001 described an older Kotlin/Compose project with inconsistent git-diff filenames. The real project is a Java Android launcher at /opt/worm/apps/com.worm.home using package/application id com.worm, a HOME intent, launcher icon resources, and a custom WormHomeView/WormIconRenderer implementation.

This v002 represents only the missing delta to reach the desired current state. Because the desired state is already present, changes.diff is intentionally empty and is validated with `git apply --check --allow-empty`.

HOME_V002_PATCH_VALID=YES
HOME_BUILD_CHECK=PASS
