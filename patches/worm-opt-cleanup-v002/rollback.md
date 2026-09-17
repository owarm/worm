# Rollback mapping

Restore directory mappings by copying the Storage Box path back to the original
path after removing the local symlink or recreated directory. Entries ending in
`.tar.gz` must be extracted so the archived top-level directory lands at the
listed original path. Entries under `/opt/worm/keys/worm-os` are local-only
secret moves and were intentionally not placed on Storage Box.

- /mnt/storage-box-smb/worm/backups -> /opt/worm/backups
- /mnt/storage-box-smb/worm/releases/grapheneos -> /opt/worm/grapheneos/releases
- /mnt/storage-box-smb/worm/releases/webusb-public -> /opt/worm/webusb/public/releases
- /mnt/storage-box-smb/worm/releases/webusb-dist -> /opt/worm/webusb/dist/releases
- /mnt/storage-box-smb/worm/old-projects/apps-repo-src -> /opt/worm/apps-repo-src
- /mnt/storage-box-smb/worm/old-projects/terminallm -> /opt/worm/terminallm
- /opt/worm/keys/worm-os/keys -> /opt/worm/worm-os/keys
- /opt/worm/keys/worm-os/keystore.properties -> /opt/worm/worm-os/worm-store-src/keystore.properties
- /mnt/storage-box-smb/worm/old-projects/worm-os.tar.gz -> /opt/worm/worm-os
- /mnt/storage-box-smb/worm/old-projects/wormos.tar.gz -> /opt/worm/wormos
- /mnt/storage-box-smb/worm/old-projects/local-assets.tar.gz -> /opt/worm/local-assets
- /mnt/storage-box-smb/worm/legacy/tar/audit.tar.gz -> /opt/worm/audit
- /mnt/storage-box-smb/worm/legacy/tar/docs.tar.gz -> /opt/worm/docs
- /mnt/storage-box-smb/worm/legacy/tar/reports.tar.gz -> /opt/worm/reports
- /mnt/storage-box-smb/worm/legacy/root-files/BASELINE.env -> /opt/worm/BASELINE.env
- /mnt/storage-box-smb/worm/legacy/root-files/README-WORM.md -> /opt/worm/README-WORM.md
- /mnt/storage-box-smb/worm/legacy/root-files/SHA256SUMS -> /opt/worm/SHA256SUMS
- /mnt/storage-box-smb/worm/legacy/root-files/manifest-pinned.xml -> /opt/worm/manifest-pinned.xml
- /mnt/storage-box-smb/worm/legacy/root-files/prepare-frankel.sh -> /opt/worm/prepare-frankel.sh
- /mnt/storage-box-smb/worm/legacy/root-files/sync.sh -> /opt/worm/sync.sh
