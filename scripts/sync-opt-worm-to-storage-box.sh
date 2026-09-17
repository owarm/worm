#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="/opt/worm"
SMB_MOUNT="/mnt/storage-box-smb"
DEST_DIR="${SMB_MOUNT}/worm-sync/opt-worm"
STORAGE_LOG_DIR="${SMB_MOUNT}/worm-sync/logs"
LOCAL_LOG_DIR="${SOURCE_DIR}/logs"
LOCAL_LOG="${LOCAL_LOG_DIR}/storage-sync.log"
LOCK_FILE="/run/worm-storage-sync.lock"
EXPECTED_HOST="u665326.your-storagebox.de"

mkdir -p "$LOCAL_LOG_DIR"

log_line() {
  printf '%s %s\n' "$(date -Is)" "$*" | tee -a "$LOCAL_LOG"
}

rotate_log() {
  if [ -f "$LOCAL_LOG" ]; then
    size=$(wc -c < "$LOCAL_LOG" 2>/dev/null || printf 0)
    if [ "$size" -gt 10485760 ]; then
      ts=$(date +%Y%m%d-%H%M%S)
      mv "$LOCAL_LOG" "${LOCAL_LOG}.${ts}"
    fi
  fi
  find "$LOCAL_LOG_DIR" -maxdepth 1 -type f -name 'storage-sync.log.*' -printf '%T@ %p\n' 2>/dev/null \
    | sort -rn \
    | awk 'NR>30 {print $2}' \
    | xargs -r rm -f --
}

verify_mount() {
  test -d "$SOURCE_DIR"
  mountpoint -q "$SMB_MOUNT"
  source=$(findmnt -n -o SOURCE "$SMB_MOUNT")
  fstype=$(findmnt -n -o FSTYPE "$SMB_MOUNT")
  case "$source" in
    *"$EXPECTED_HOST"*) ;;
    *) echo "ERROR: unexpected Storage Box source: $source" >&2; return 1 ;;
  esac
  [ "$fstype" = "cifs" ] || { echo "ERROR: expected cifs, got $fstype" >&2; return 1; }
  case "$(readlink -f "$SMB_MOUNT")" in
    /|/opt|/opt/worm|/mnt) echo "ERROR: unsafe destination mount path" >&2; return 1 ;;
  esac
}

run_sync() {
  mkdir -p "$DEST_DIR" "$STORAGE_LOG_DIR"
  start_epoch=$(date +%s)
  run_id=$(date +%Y%m%d-%H%M%S)
  run_log="${LOCAL_LOG_DIR}/storage-sync-${run_id}.log"
  storage_run_log="${STORAGE_LOG_DIR}/storage-sync-${run_id}.log"
  tmp_output=$(mktemp)
  rsync_rc=0

  log_line "START run_id=${run_id} source=${SOURCE_DIR}/ destination=${DEST_DIR}/"
  {
    echo "timestamp_start=$(date -Is)"
    echo "source=${SOURCE_DIR}/"
    echo "destination=${DEST_DIR}/"
    echo "storage_mount_status=$(findmnt -n -o SOURCE,FSTYPE,OPTIONS "$SMB_MOUNT" | sed 's/[[:space:]]\+/ /g')"
    echo "local_free_space=$(df -h "$SOURCE_DIR" | tail -n 1)"
    echo "storage_free_space=$(df -h "$SMB_MOUNT" | tail -n 1)"
  } >> "$run_log"

  set +e
  rsync -rltH \
    --delete \
    --delete-delay \
    --partial \
    --partial-dir=.rsync-partial \
    --info=stats2 \
    "$SOURCE_DIR/" \
    "$DEST_DIR/" > "$tmp_output" 2>&1
  rsync_rc=$?
  set -e

  cat "$tmp_output" >> "$run_log"
  end_epoch=$(date +%s)
  elapsed=$((end_epoch - start_epoch))
  transferred_bytes=$(awk -F: '/^Total transferred file size:/ {gsub(/[^0-9]/,"",$2); print $2}' "$tmp_output" | tail -n1)
  total_files=$(awk -F: '/^Number of files:/ {gsub(/[^0-9]/,"",$2); print $2}' "$tmp_output" | tail -n1)
  deleted_files=$(awk '/^\*deleting / {count++} END {print count+0}' "$tmp_output")
  transferred_bytes=${transferred_bytes:-0}
  total_files=${total_files:-0}

  {
    echo "timestamp_end=$(date -Is)"
    echo "elapsed_seconds=${elapsed}"
    echo "transferred_bytes=${transferred_bytes}"
    echo "total_files=${total_files}"
    echo "deleted_files=${deleted_files}"
    echo "rsync_exit_code=${rsync_rc}"
    echo "local_free_space=$(df -h "$SOURCE_DIR" | tail -n 1)"
    echo "storage_mount_status=$(findmnt -n -o SOURCE,FSTYPE,OPTIONS "$SMB_MOUNT" | sed 's/[[:space:]]\+/ /g')"
  } >> "$run_log"

  cp "$run_log" "$storage_run_log" 2>/dev/null || true
  cp "$run_log" "${LOCAL_LOG_DIR}/storage-sync-latest.log"
  cp "$run_log" "${STORAGE_LOG_DIR}/storage-sync-latest.log" 2>/dev/null || true

  log_line "END run_id=${run_id} elapsed_seconds=${elapsed} transferred_bytes=${transferred_bytes} total_files=${total_files} deleted_files=${deleted_files} rsync_exit_code=${rsync_rc}"
  rm -f "$tmp_output"
  return "$rsync_rc"
}

main() {
  rotate_log
  exec 9>"$LOCK_FILE"
  if ! flock -n 9; then
    log_line "ERROR another sync is already running"
    exit 75
  fi
  verify_mount
  run_sync
}

main "$@"
