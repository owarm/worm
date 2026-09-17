# worm-opt-global-audit-v003

Global `/opt/*` audit and conservative cleanup.

Policy used:
- keep active service paths local
- keep mountpoints local
- keep Android SDK and Worm OS local
- keep key/secret/keystore directories local
- move legacy release artifacts to the configured Storage Box
- delete only regenerable caches/build outputs and empty directories

Main action:
- moved `/opt/com.worm/dist` to Storage Box releases and left a compatibility symlink
- removed regenerable `/opt/com.worm` Gradle/build caches
- removed empty `/opt/.agents`, `/opt/.codex`, `/opt/.git` if empty
