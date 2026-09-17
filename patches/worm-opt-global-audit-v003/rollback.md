# Rollback worm-opt-global-audit-v003

If `/opt/com.worm/dist` must be restored locally:

1. Read `moved.log` and identify the destination path.
2. Remove the symlink:
   `rm /opt/com.worm/dist`
3. Restore with rsync:
   `rsync -a --numeric-ids <destination>/ /opt/com.worm/dist/`
4. Verify size/checksums using the logs in this patch directory.

Deleted cache/build paths are regenerable by Gradle:
- `/opt/com.worm/app/build`
- `/opt/com.worm/build`
- `/opt/com.worm/.gradle`
- `/opt/com.worm/.gradle-codex`

Empty metadata directories removed from `/opt` can be recreated if needed:
- `/opt/.agents`
- `/opt/.codex`
- `/opt/.git`
