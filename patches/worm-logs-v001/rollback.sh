#!/usr/bin/env bash
set -euo pipefail

systemctl disable --now worm-logs.service 2>/dev/null || true
rm -f /etc/systemd/system/worm-logs.service
rm -f /usr/local/bin/worm-run
rm -f /etc/nginx/sites-enabled/worm-logs.conf

latest_vpn_backup="$(ls -1t /etc/nginx/sites-available/worm-system-vpn-services.conf.bak-worm-logs-v001-* 2>/dev/null | head -1 || true)"
latest_guard_backup="$(ls -1t /etc/nginx/sites-available/worm-system-public-guards.conf.bak-worm-logs-v001-* 2>/dev/null | head -1 || true)"

if [[ -n "${latest_vpn_backup}" ]]; then
  cp "${latest_vpn_backup}" /etc/nginx/sites-available/worm-system-vpn-services.conf
fi
if [[ -n "${latest_guard_backup}" ]]; then
  cp "${latest_guard_backup}" /etc/nginx/sites-available/worm-system-public-guards.conf
fi

systemctl daemon-reload
nginx -t && systemctl reload nginx
