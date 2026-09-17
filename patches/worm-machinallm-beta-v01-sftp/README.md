# worm-machinallm-beta-v01-sftp

Project: `/opt/worm/apps/com.worm.machinallm`

Patch path: `/opt/worm/patches/worm-machinallm-beta-v01-sftp`

Prerequisite: `worm-machinallm-beta-v01-ssh`

## Goal

Add an integrated SFTP browser to MachinaLLM using the active SSH connection from the SSH beta patch.

## Implemented

- `SftpManager` uses `SshConnectionManager.withSftpClient`.
- SFTP operations reuse the authenticated SSH connection and open SFTP channels with `SSHClient.newSFTPClient()`.
- No duplicate SSH profile/auth connection is created for file operations.
- Directory listing with name, type, size, and modification time.
- `stat`, `download`, `upload`, `rename`, `mkdir`, delete file, and delete directory.
- Delete directory requires UI confirmation.
- Compose `SftpScreen` with current path, file/folder list, open folder, go up, refresh, mkdir, upload, download, rename, and delete.
- Text viewer/editor for small text files.
- Save checks remote modification time before upload; changed remote files report a conflict instead of overwriting.
- Upload uses the Android system picker.
- Download uses Storage Access Framework create-document flow.
- Temporary text-edit cache uses the app cache directory and is cleaned when possible.
- Main navigation tabs: `Terminal` and `Files`, with the SSH session kept alive while switching.

## Text Viewer

Supported file extensions:

- `txt`
- `md`
- `log`
- `json`
- `yaml`
- `yml`
- `xml`
- `kt`
- `java`
- `py`
- `sh`
- `conf`
- `ini`

Limit: `256 KiB`.

## Security

- No broad storage permission is added.
- No AI panel is implemented.
- No OpenAI API key is added.
- Remote file content is not automatically persisted outside the app cache/editor flow.
- App cache temp files are deleted after editor load and on screen disposal where possible.

## Build

```bash
cd /opt/worm/apps/com.worm.machinallm
./gradlew assembleDebug
```

Debug APK:

`/opt/worm/apps/com.worm.machinallm/app/build/outputs/apk/debug/app-debug.apk`

## Scripts

- `apply.sh`: verifies the patch and prerequisite are present.
- `revert.sh`: non-destructive revert guidance.
- `build.sh`: runs `./gradlew assembleDebug`.
- `debug.sh`: verifies SFTP, SAF upload/download, tabs, no broad storage permission, and APK metadata.
