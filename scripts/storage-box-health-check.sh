#!/usr/bin/env bash
set -euo pipefail

SMB_MOUNT="/mnt/storage-box-smb"
WEBDAV_MOUNT="/mnt/storage-box"
MIRROR_ROOT="${SMB_MOUNT}/worm-sync/opt-worm"
LOCAL_LATEST="/opt/worm/logs/storage-sync-latest.log"
EXPECTED_HOST="u665326.your-storagebox.de"
TIMER="worm-storage-sync.timer"

pass() { printf 'PASS %s\n' "$*"; }
fail() { printf 'FAIL %s\n' "$*"; exit 1; }

mountpoint -q "$SMB_MOUNT" || fail "SMB mounted"
smb_source=$(findmnt -n -o SOURCE "$SMB_MOUNT")
smb_fstype=$(findmnt -n -o FSTYPE "$SMB_MOUNT")
case "$smb_source" in *"$EXPECTED_HOST"*) ;; *) fail "SMB source unexpected" ;; esac
[ "$smb_fstype" = cifs ] || fail "SMB fstype cifs"
pass "SMB mounted"

test -d "$MIRROR_ROOT" || fail "Worm mirror exists"
pass "Worm mirror exists"

if mountpoint -q "$WEBDAV_MOUNT"; then
  pass "WebDAV fallback mounted"
else
  printf 'WARN WebDAV fallback not mounted\n'
fi

test -f "$LOCAL_LATEST" || fail "last sync log exists"
last_start=$(awk -F= '/^timestamp_start=/ {print $2}' "$LOCAL_LATEST" | tail -n1)
last_end=$(awk -F= '/^timestamp_end=/ {print $2}' "$LOCAL_LATEST" | tail -n1)
last_rc=$(awk -F= '/^rsync_exit_code=/ {print $2}' "$LOCAL_LATEST" | tail -n1)
[ -n "${last_start:-}" ] || fail "last sync timestamp"
[ -n "${last_end:-}" ] || fail "last sync completed timestamp"
[ "${last_rc:-}" = 0 ] || fail "last sync successful"
printf 'PASS last sync timestamp %s\n' "$last_end"
pass "last sync successful"

systemctl is-enabled --quiet "$TIMER" || fail "sync timer enabled"
pass "sync timer enabled"
systemctl is-active --quiet "$TIMER" || fail "sync timer active"
pass "sync timer active"
