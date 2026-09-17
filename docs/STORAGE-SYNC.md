# Storage Box Mirror

`/opt/worm` is mirrored to the Hetzner Storage Box over SMB/CIFS.

- Source: `/opt/worm/`
- Destination: `/mnt/storage-box-smb/worm-sync/opt-worm/`
- Primary transport: SMB/CIFS mounted at `/mnt/storage-box-smb`
- WebDAV fallback mount: `/mnt/storage-box`
- Timer: `worm-storage-sync.timer`, every 24 hours after the previous run
- Service: `worm-storage-sync.service`
- Local log: `/opt/worm/logs/storage-sync.log`
- Latest detailed local log: `/opt/worm/logs/storage-sync-latest.log`
- Storage-side logs: `/mnt/storage-box-smb/worm-sync/logs/`

This is a mirror, not a versioned backup. The sync uses `rsync --delete`, so a file deleted from `/opt/worm` is also deleted from the Storage Box on the next successful sync.

Only `/opt/worm` is mirrored. Sibling symlinks and key paths such as `/opt/worm-release-keys`, `/opt/worm-apps-keys`, `/opt/worm-keys`, and `/opt/worm-key-backups` are not separate sync sources.

The sync script verifies that `/mnt/storage-box-smb` is mounted as CIFS and that the mount source contains `u665326.your-storagebox.de` before it writes to the destination. It does not follow symlinks and it does not preserve Unix owner/group/permission metadata on CIFS.
