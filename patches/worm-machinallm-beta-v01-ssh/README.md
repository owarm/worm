# worm-machinallm-beta-v01-ssh

Project: `/opt/worm/apps/com.worm.machinallm`

Patch path: `/opt/worm/patches/worm-machinallm-beta-v01-ssh`

## Goal

Convert MachinaLLM from a local chat demo into a beta SSH client for Worm OS.

This patch implements:

- SSH host profiles with `SshHostProfile`
- password authentication
- private-key authentication with locally imported key material
- encrypted credential storage using Android Keystore + AES/GCM
- `known_hosts` fingerprint storage and verification
- first-connect host key confirmation
- changed host-key blocking
- `SshConnectionManager` with connect, disconnect, reconnect, auth, host-key verification, and session state
- interactive shell sessions using `xterm-256color`
- basic Compose terminal UI with top bar, output, command input, disconnect, and reconnect
- local in-session command history

It intentionally does not implement SFTP, ChatGPT panel support, or any `OPENAI_API_KEY`.

## Project Audit

- Stack: Android app, Kotlin, Gradle Kotlin DSL.
- UI: Jetpack Compose.
- Components: Material 3.
- Dynamic colors: enabled through `dynamicDarkColorScheme`, `dynamicLightColorScheme`, and `isSystemInDarkTheme`.
- Package/applicationId: `com.worm.machinallm`.
- minSdk: `31`.
- targetSdk: `36`.
- compileSdk: `36`.
- Existing provider classes remain in place for compatibility, but `MainActivity` now opens `TerminalScreen`.

## SSH Library

Selected library: SSHJ `0.40.0`.

Reason:

- SSHJ is a maintained JVM SSHv2 client library with compact client APIs for auth, shell sessions, PTY, and host-key verification.
- SSHJ `0.40.0` is the current Maven Central/GitHub release and is above the `0.38.0` line noted by the project for the Terrapin CVE fix.
- Apache MINA SSHD is also maintained and current, but it is a broader SSH framework. SSHJ is the smaller and more direct fit for this mobile beta client.

References:

- https://github.com/hierynomus/sshj
- https://central.sonatype.com/artifact/com.hierynomus/sshj
- https://mina.apache.org/sshd-project/downloads.html

## Security Notes

- The only new Android permission is `android.permission.INTERNET`.
- Passwords and private keys are encrypted before persistence.
- Secrets are not saved in plain SharedPreferences.
- Private key content is imported locally and encrypted.
- Passwords, private keys, commands, terminal output, and tokens are not logged.
- The app does not use accept-all host keys.
- Unknown host keys require explicit user confirmation.
- Changed host keys block connection and show a warning.

## Files

- `app/src/main/java/com/worm/machinallm/ssh/SshHostProfile.kt`
- `app/src/main/java/com/worm/machinallm/ssh/SecureSecretStore.kt`
- `app/src/main/java/com/worm/machinallm/ssh/SshProfileRepository.kt`
- `app/src/main/java/com/worm/machinallm/ssh/KnownHostsStore.kt`
- `app/src/main/java/com/worm/machinallm/ssh/SshConnectionManager.kt`
- `app/src/main/java/com/worm/machinallm/ui/terminal/TerminalScreen.kt`

## Build

```bash
cd /opt/worm/apps/com.worm.machinallm
./gradlew clean assembleDebug
```

Debug APK:

`/opt/worm/apps/com.worm.machinallm/app/build/outputs/apk/debug/app-debug.apk`

## Scripts

- `apply.sh`: verifies the patch is present.
- `revert.sh`: non-destructive revert guidance for this dirty workspace.
- `build.sh`: runs `./gradlew clean assembleDebug`.
- `debug.sh`: verifies permission, SSH dependency, Keystore usage, known_hosts, terminal UI, package, and APK metadata.
