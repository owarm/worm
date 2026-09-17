# worm-opt-cleanup-v002

Timestamp: 20260915 Europe/Rome

Storage target used: `/mnt/storage-box-smb/worm`

## Summary

Cleaned `/opt/worm` to keep the operational tree local and move historical
releases, backups, old projects, legacy docs, and old reports to the existing
Storage Box.

## Kept Local

- `/opt/worm/grapheneos`
- `/opt/worm/build`
- `/opt/worm/apps`
- `/opt/worm/patches`
- `/opt/worm/artifacts`
- `/opt/worm/webusb`
- `/opt/worm/logs`
- `/opt/worm/keys`
- `/opt/worm/config`
- `/opt/worm/scripts`
- `/opt/worm/services`
- `/opt/worm/private-portal`
- `/opt/worm/network`

`/opt/worm/services` was kept because `worm-logs.service` actively runs from it.
`/opt/worm/config` and `/opt/worm/scripts` were kept because they reference the
GrapheneOS source tree and build output. `worm-os` signing material was moved
locally into `/opt/worm/keys/worm-os` and was not stored on the Storage Box.

## Symlinked

- `/opt/worm/releases -> /mnt/storage-box-smb/worm/releases/root`
- `/opt/worm/backups -> /mnt/storage-box-smb/worm/backups`
- `/opt/worm/grapheneos/releases -> /mnt/storage-box-smb/worm/releases/grapheneos`
- `/opt/worm/webusb/public/releases -> /mnt/storage-box-smb/worm/releases/webusb-public`
- `/opt/worm/webusb/dist/releases -> /mnt/storage-box-smb/worm/releases/webusb-dist`

## Notes

The Storage Box CIFS mount does not support native symlinks or full ext4-style
ownership metadata. A broken symlink inside one backup was represented with a
sidecar `.SYMLINK_BROKEN.txt` file and logged in `duplicates.log`.

See `rollback.md` for exact restore mappings.
