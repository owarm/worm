# worm-machinallm-v005-package

Final packaging patch for MachinaLLM `0.1.0`.

## Scope

- Clean debug build
- Install helper
- Uninstall helper
- Debug audit
- Security audit
- Final APK verification

## Artifact

```text
/opt/worm/apps/com.worm.machinallm/app/build/outputs/apk/debug/app-debug.apk
```

## Commands

```sh
/opt/worm/patches/worm-machinallm-v005-package/build.sh
/opt/worm/patches/worm-machinallm-v005-package/install.sh
/opt/worm/patches/worm-machinallm-v005-package/uninstall.sh
/opt/worm/patches/worm-machinallm-v005-package/debug.sh
/opt/worm/patches/worm-machinallm-v005-package/test.sh
```

## Offline Status

MachinaLLM `0.1.0` is packaged as an offline-only debug APK. No OpenAI backend, TermLLM backend, internet permission, voice, image generation, attachments, analytics, telemetry, crash reporting, or database is added by this patch.
