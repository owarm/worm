#!/usr/bin/env bash
set -euo pipefail

failures=0

check() {
  local name="$1"
  shift
  if "$@"; then
    printf 'PASS %s\n' "$name"
  else
    printf 'FAIL %s\n' "$name"
    failures=$((failures + 1))
  fi
}

check_url() {
  local name="$1"
  local url="$2"
  if command -v curl >/dev/null 2>&1; then
    local code
    code="$(curl -sS -o /dev/null -I --max-time 10 -w '%{http_code}' "$url" || true)"
    if [[ "$code" =~ ^[23][0-9][0-9]$ ]]; then
      printf 'PASS %s HTTP %s\n' "$name" "$code"
    else
      printf 'FAIL %s HTTP %s\n' "$name" "${code:-none}"
      failures=$((failures + 1))
    fi
  else
    printf 'SKIP %s curl not available\n' "$name"
  fi
}

echo '=== Worm OS Health Check ==='

check '/opt/worm mount exists' findmnt /opt/worm

avail_kb="$(df -Pk /opt/worm | awk 'NR==2 {print $4}')"
if [[ -z "${avail_kb:-}" ]]; then
  printf 'FAIL /opt/worm free space unknown\n'
  failures=$((failures + 1))
elif [[ "$avail_kb" -lt 20971520 ]]; then
  printf 'FAIL /opt/worm free space %s KiB\n' "$avail_kb"
  failures=$((failures + 1))
elif [[ "$avail_kb" -lt 52428800 ]]; then
  printf 'WARN /opt/worm free space %s KiB\n' "$avail_kb"
else
  printf 'PASS /opt/worm free space %s KiB\n' "$avail_kb"
fi

check '/opt/worm/grapheneos exists' test -d /opt/worm/grapheneos
check '/opt/worm/build/out exists' test -d /opt/worm/build/out

worm_out="$(readlink -f /opt/worm/grapheneos/worm-out 2>/dev/null || true)"
if [[ "$worm_out" == '/opt/worm/build/out' ]]; then
  printf 'PASS worm-out resolves to %s\n' "$worm_out"
else
  printf 'FAIL worm-out resolves to %s\n' "${worm_out:-missing}"
  failures=$((failures + 1))
fi

frankel_keys="$(readlink -f /opt/worm/grapheneos/keys/frankel 2>/dev/null || true)"
if [[ "$frankel_keys" == /opt/worm-release-keys/* ]]; then
  printf 'PASS frankel keys resolve under /opt/worm-release-keys: %s\n' "$frankel_keys"
else
  printf 'FAIL frankel keys resolve to %s\n' "${frankel_keys:-missing}"
  failures=$((failures + 1))
fi

check '/opt/worm-apps-keys exists' test -d /opt/worm-apps-keys

check_url 'apps.coffee.pm metadata endpoint' https://apps.coffee.pm/metadata.1.0.sjson
check_url 'releases.coffee.pm frankel-stable endpoint' https://releases.coffee.pm/frankel-stable

if find /opt/worm/grapheneos/worm-out /opt/worm/grapheneos/keys/frankel -xtype l -print 2>/dev/null | grep -q .; then
  printf 'FAIL broken critical symlink detected\n'
  failures=$((failures + 1))
else
  printf 'PASS no broken critical symlinks\n'
fi

echo "RESULT failures=$failures"
exit "$failures"
