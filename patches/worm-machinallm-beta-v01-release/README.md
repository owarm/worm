# MachinaLLM beta.v01

Project: `/opt/worm/apps/com.worm.machinallm`

Patch path: `/opt/worm/patches/worm-machinallm-beta-v01-release`

Artifact directory: `/opt/worm/artifacts/machinallm/beta.v01`

Download URL:

`https://releases.coffee.pm/machinallm/MachinaLLM-beta.v01.apk`

## Version

- `versionName`: `beta.v01`
- `versionCode`: `100`
- package: `com.worm.machinallm`
- app label: `MachinaLLM`

## Features

- SSH terminal
- password authentication
- private key authentication
- SSH host key verification
- SFTP browser
- file viewer
- basic text editor
- AI panel
- AI via remote `term-llm` over the active SSH connection
- terminal context to AI
- file context to AI
- Worm OS Dynamic Colors via Material 3 dynamic color schemes

## Requirements

- VPS reachable via SSH
- `term-llm` installed on the remote VPS
- OpenAI API configured on the VPS
- OpenAI API credits available

## Known Limitations

- terminal ANSI emulation may be incomplete
- no tmux integration yet unless already supported remotely
- no local LLM
- AI depends on remote `term-llm`
- OpenAI usage depends on API billing
- editor is basic
- no Git UI yet

## Test Matrix

- SSH: OK
- SFTP: OK
- AI: OK
- Known hosts: OK
- Secret scan: OK
- Build: OK
- Signature: OK
- HTTPS artifact: OK

## Build

```bash
cd /opt/worm/apps/com.worm.machinallm
./gradlew clean assembleDebug
./gradlew assembleRelease
```

The release artifact is signed with the existing MachinaLLM signing key:

`/opt/worm/keys/machinallm/machinallm-release.jks`
