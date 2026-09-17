#!/usr/bin/env bash
set -euo pipefail

TOP=/opt/worm/grapheneos
CANONICAL_OUT=/opt/worm/build/out
LOG_ROOT=/opt/worm/build/logs
PERF_ENV=/opt/worm/build/metadata/performance.env
TMPFS_ROOT=/mnt/worm/build
DEVICE=frankel
RELEASE=cp2a
VARIANT=user

die() {
    echo "ERROR: $*" >&2
    exit 1
}

gib_free() {
    df -BG --output=avail "$1" | awk 'NR == 2 { gsub(/G/, "", $1); print $1 + 0 }'
}

load_perf_env() {
    if [[ -r "$PERF_ENV" ]]; then
        # shellcheck disable=SC1090
        source "$PERF_ENV"
    fi
}

verify_layout() {
    [[ -d "$TOP" ]] || die "$TOP is missing"
    [[ -d "$CANONICAL_OUT" ]] || die "$CANONICAL_OUT is missing"
    [[ -L "$TOP/worm-out" ]] || die "$TOP/worm-out is not a symlink"
    [[ "$(readlink -f "$TOP/worm-out")" == "$CANONICAL_OUT" ]] || die "worm-out does not resolve to $CANONICAL_OUT"
}

write_governor_state() {
    local state="$1"
    : > "$state"
    for gov in /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor; do
        [[ -e "$gov" ]] || continue
        printf '%s %s\n' "$gov" "$(cat "$gov")" >> "$state"
        if [[ -w "$gov" ]] && grep -qw performance "${gov%/*}/scaling_available_governors" 2>/dev/null; then
            printf performance > "$gov" || true
        fi
    done
}

restore_governor_state() {
    local state="$1"
    [[ -s "$state" ]] || return 0
    while read -r gov old; do
        [[ -w "$gov" ]] || continue
        printf '%s' "$old" > "$gov" || true
    done < "$state"
}

set_session_swappiness() {
    local state="$1"
    local requested="${WORM_SESSION_SWAPPINESS:-}"
    [[ -n "$requested" ]] || return 0
    [[ "$requested" =~ ^[0-9]+$ ]] || die "invalid WORM_SESSION_SWAPPINESS=$requested"
    cat /proc/sys/vm/swappiness > "$state"
    sysctl -q "vm.swappiness=$requested" || true
}

restore_session_swappiness() {
    local state="$1"
    [[ -s "$state" ]] || return 0
    sysctl -q "vm.swappiness=$(cat "$state")" || true
}

root_wrapper() {
    load_perf_env
    verify_layout

    local gov_state swap_state rc
    gov_state="$(mktemp /tmp/worm-governors.XXXXXX)"
    swap_state="$(mktemp /tmp/worm-swappiness.XXXXXX)"
    cleanup_root() {
        rc=$?
        restore_session_swappiness "$swap_state"
        restore_governor_state "$gov_state"
        rm -f "$gov_state" "$swap_state"
        exit "$rc"
    }
    trap cleanup_root EXIT INT TERM

    if [[ "${WORM_PERFORMANCE_GOVERNOR:-true}" == "true" ]]; then
        write_governor_state "$gov_state"
    fi
    set_session_swappiness "$swap_state"

    set +e
    if command -v runuser >/dev/null 2>&1; then
        runuser -u wormbuild --whitelist-environment=BUILD_NUMBER,BUILD_DATETIME,OFFICIAL_BUILD,WORM_BUILD_JOBS,WORM_SOONG_INCREMENTAL_ANALYSIS,WORM_SISO_FAST_LOCAL,WORM_PERFORMANCE_GOVERNOR,WORM_SESSION_SWAPPINESS,WORM_TMPDIR -- \
            bash "$0" "$@"
        rc=$?
    else
        sudo --preserve-env=BUILD_NUMBER,BUILD_DATETIME,OFFICIAL_BUILD,WORM_BUILD_JOBS,WORM_SOONG_INCREMENTAL_ANALYSIS,WORM_SISO_FAST_LOCAL,WORM_PERFORMANCE_GOVERNOR,WORM_SESSION_SWAPPINESS,WORM_TMPDIR \
            -u wormbuild -H bash "$0" "$@"
        rc=$?
    fi
    set -e
    trap - EXIT INT TERM
    restore_session_swappiness "$swap_state"
    restore_governor_state "$gov_state"
    rm -f "$gov_state" "$swap_state"
    exit "$rc"
}

sample_metrics() {
    echo "timestamp load1 load5 load15 cpu_pct iowait_pct mem_available_kb swap_used_kb opt_worm_free_gib" >> "$log"
    while :; do
        read -r load1 load5 load15 _ < /proc/loadavg
        mem_available="$(awk '/MemAvailable/ {print $2}' /proc/meminfo)"
        swap_total="$(awk '/SwapTotal/ {print $2}' /proc/meminfo)"
        swap_free="$(awk '/SwapFree/ {print $2}' /proc/meminfo)"
        swap_used=$((swap_total - swap_free))
        if command -v mpstat >/dev/null 2>&1; then
            cpu_line="$(mpstat 1 1 2>/dev/null | awk '/Average:/ && $2 == "all" {print 100 - $NF, $(NF-1)}' | tail -1)"
            cpu_pct="${cpu_line%% *}"
            iowait_pct="${cpu_line##* }"
        else
            cpu_pct=NA
            iowait_pct=NA
            sleep 1
        fi
        printf '%s %s %s %s %s %s %s %s %s\n' \
            "$(date -Is)" "$load1" "$load5" "$load15" "${cpu_pct:-NA}" "${iowait_pct:-NA}" \
            "$mem_available" "$swap_used" "$(gib_free /opt/worm)" >> "$log"
        sleep 4
    done
}

summarize_metrics() {
    awk '
        /^20/ && $5 != "NA" {
            n++
            cpu += $5
            iowait += $6
            used_ram = total_mem - $7
            if (used_ram > peak_ram) peak_ram = used_ram
            if ($8 > peak_swap) peak_swap = $8
        }
        END {
            if (n > 0) {
                printf "peak_ram_kb=%.0f\n", peak_ram
                printf "peak_swap_kb=%.0f\n", peak_swap
                printf "avg_cpu_pct=%.2f\n", cpu / n
                printf "avg_iowait_pct=%.2f\n", iowait / n
            } else {
                print "peak_ram_kb=NA"
                print "peak_swap_kb=NA"
                print "avg_cpu_pct=NA"
                print "avg_iowait_pct=NA"
            }
        }
    ' total_mem="$(awk '/MemTotal/ {print $2}' /proc/meminfo)" "$log"
}

verify_layout
load_perf_env

abort_gib="${WORM_BUILD_SPACE_ABORT_GIB:-40}"
warn_gib="${WORM_BUILD_SPACE_WARN_GIB:-70}"
free_gib="$(gib_free /opt/worm)"
if (( free_gib < abort_gib )); then
    die "/opt/worm has ${free_gib}GiB free; refusing build below ${abort_gib}GiB"
elif (( free_gib < warn_gib )); then
    echo "WARN: /opt/worm has ${free_gib}GiB free; recommended minimum is ${warn_gib}GiB" >&2
fi

if [[ "$(id -un)" != "wormbuild" ]]; then
    [[ "$(id -u)" == "0" ]] || exec sudo --preserve-env=BUILD_NUMBER,BUILD_DATETIME,OFFICIAL_BUILD,WORM_BUILD_JOBS,WORM_SOONG_INCREMENTAL_ANALYSIS,WORM_SISO_FAST_LOCAL,WORM_PERFORMANCE_GOVERNOR,WORM_SESSION_SWAPPINESS,WORM_TMPDIR -u root -H bash "$0" "$@"
    root_wrapper "$@"
fi

jobs="${WORM_BUILD_JOBS:-$(nproc)}"
[[ "$jobs" =~ ^[0-9]+$ ]] || die "invalid WORM_BUILD_JOBS=$jobs"
(( jobs >= 1 )) || die "invalid WORM_BUILD_JOBS=$jobs"

targets=("$@")
if (( ${#targets[@]} == 0 )); then
    targets=(target-files-package otatools-package)
elif [[ "${targets[0]}" == "full" ]]; then
    targets=(target-files-package otatools-package)
fi

export OUT_DIR=worm-out
export SOONG_INCREMENTAL_ANALYSIS="${WORM_SOONG_INCREMENTAL_ANALYSIS:-true}"
tmpdir="${WORM_TMPDIR:-$TMPFS_ROOT/tmp}"
if [[ -d "$tmpdir" && -w "$tmpdir" ]]; then
    export TMPDIR="$tmpdir"
fi

if [[ "${OFFICIAL_BUILD:-}" == "true" ]] || [[ " ${targets[*]} " == *" target-files-package "* ]]; then
    export OFFICIAL_BUILD=true
fi

if [[ "${WORM_SISO_FAST_LOCAL:-false}" == "true" ]]; then
    export NINJA_EXTRA_ARGS="${NINJA_EXTRA_ARGS:-} --batch=false --fast_local"
fi

mkdir -p "$LOG_ROOT"
build_id="${BUILD_NUMBER:-manual-$(date +%Y%m%d-%H%M%S)}"
log="$LOG_ROOT/${build_id}-performance.log"
metrics_pid=""
start_epoch="$(date +%s)"

cleanup() {
    rc=$?
    if [[ -n "$metrics_pid" ]]; then
        kill "$metrics_pid" 2>/dev/null || true
        wait "$metrics_pid" 2>/dev/null || true
    fi
    end_epoch="$(date +%s)"
    {
        echo
        echo "elapsed_seconds=$((end_epoch - start_epoch))"
        echo "exit_code=$rc"
        echo "jobs=$jobs"
        echo "targets=${targets[*]}"
        echo "final_opt_worm_free_gib=$(gib_free /opt/worm)"
        summarize_metrics
    } >> "$log" 2>/dev/null || true
    echo "performance_log=$log"
    exit "$rc"
}
trap cleanup EXIT INT TERM

sample_metrics &
metrics_pid="$!"

cd "$TOP"
source build/envsetup.sh
if [[ -r "vendor/google_devices/$DEVICE/cmds-for-envsetup.sh" ]]; then
    source "vendor/google_devices/$DEVICE/cmds-for-envsetup.sh"
fi
lunch "$DEVICE" "$RELEASE" "$VARIANT"

echo "=== WORM OS FAST BUILD ==="
echo "OUT_DIR=$OUT_DIR"
echo "REAL_OUT=$(readlink -f "$OUT_DIR")"
echo "SOONG_INCREMENTAL_ANALYSIS=$SOONG_INCREMENTAL_ANALYSIS"
echo "OFFICIAL_BUILD=${OFFICIAL_BUILD:-false}"
echo "WORM_BUILD_JOBS=$jobs"
echo "WORM_SISO_FAST_LOCAL=${WORM_SISO_FAST_LOCAL:-false}"
echo "NINJA_EXTRA_ARGS=${NINJA_EXTRA_ARGS:-}"
echo "TMPDIR=${TMPDIR:-}"
echo "TARGETS=${targets[*]}"

m -j"$jobs" "${targets[@]}"
