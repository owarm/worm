#!/usr/bin/env bash
set -u

ROOT="/opt/worm"
PATCH_DIR="$ROOT/patches/robot-audit-v001"
LOG_DIR="$ROOT/logs/audit"
TS="$(TZ=Europe/Rome date +%Y%m%d-%H%M%S)"
LOG="$LOG_DIR/robot-audit-$TS.log"

mkdir -p "$PATCH_DIR" "$LOG_DIR"

exec >"$LOG" 2>&1

section() {
  printf '\n\n===== %s =====\n' "$1"
}

run() {
  printf '\n$ %s\n' "$*"
  "$@" || printf '[exit %s]\n' "$?"
}

run_sh() {
  printf '\n$ %s\n' "$*"
  sh -c "$*" || printf '[exit %s]\n' "$?"
}

section "Robot audit metadata"
run date
run env TZ=Europe/Rome date
printf 'Root: %s\nPatch dir: %s\nLog: %s\nMode: READ-ONLY audit; no remediation applied.\n' "$ROOT" "$PATCH_DIR" "$LOG"

section "1. sistema"
run hostname
run hostnamectl
run cat /etc/os-release
run uname -a
run uptime
run lscpu
run free -h
run cat /proc/loadavg

section "2. storage"
run lsblk -o NAME,TYPE,SIZE,FSTYPE,FSVER,LABEL,UUID,MOUNTPOINTS,MODEL,SERIAL
run df -hT
run mount
run findmnt -a
run du -sh /opt
run du -sh /opt/worm
run_sh "du -xhd1 /opt 2>/dev/null | sort -h"
run_sh "du -xhd1 /opt/worm 2>/dev/null | sort -h"
run_sh "du -xhd2 /opt/worm 2>/dev/null | sort -h | tail -80"
run_sh "findmnt -a | grep -Ei 'storage|box|sshfs|fuse|cifs|smb|webdav|davfs|rclone|mnt' || true"
run_sh "mount | grep -Ei 'storage|box|sshfs|fuse|cifs|smb|webdav|davfs|rclone|mnt' || true"
run_sh "grep -Eiv '^[[:space:]]*#|^[[:space:]]*$' /etc/fstab || true"

section "3. network"
run ip -br link
run ip -d link
run ip -br addr
run ip addr show
run ip route show table all
run ip -6 route show table all
run ip rule show
run ip neigh show
run bridge link show
run bridge vlan show
run_sh "find /proc/net/vlan -maxdepth 1 -type f -print -exec cat {} \\; 2>/dev/null || true"
run_sh "for i in /sys/class/net/*; do n=\$(basename \"\$i\"); printf '%s mtu=' \"\$n\"; cat \"\$i/mtu\" 2>/dev/null; done"

section "4. servizi"
run systemctl --type=service --state=running --no-pager
run systemctl list-units --state=running --no-pager
run_sh "command -v docker >/dev/null 2>&1 && docker ps -a || true"
run_sh "command -v docker >/dev/null 2>&1 && docker network ls || true"
run_sh "command -v podman >/dev/null 2>&1 && podman ps -a || true"
run_sh "command -v podman >/dev/null 2>&1 && podman network ls || true"
run_sh "ps -eo pid,ppid,user,stat,comm,args | grep -Ei 'qemu|kvm|libvirt|virtqemud|virtlogd' | grep -v grep || true"
run_sh "command -v virsh >/dev/null 2>&1 && virsh list --all || true"

section "5. web"
run_sh "command -v caddy >/dev/null 2>&1 && caddy version || true"
run_sh "systemctl status caddy --no-pager || true"
run_sh "command -v nginx >/dev/null 2>&1 && nginx -v || true"
run_sh "systemctl status nginx --no-pager || true"
run_sh "ss -lntup | awk 'NR==1 || /:(80|443)[[:space:]]/'"
run_sh "find /etc/caddy /etc/nginx /opt/worm -maxdepth 4 \\( -iname '*Caddyfile*' -o -iname '*.caddy' -o -iname '*nginx*.conf' -o -iname '*.conf' \\) -print 2>/dev/null | sort"
run_sh "find /etc/letsencrypt /var/lib/caddy /root/.local/share/caddy /opt/worm -maxdepth 5 \\( -iname '*.crt' -o -iname '*.pem' -o -iname '*.key' \\) -print 2>/dev/null | sort"

section "6. porte"
run ss -lntup
run_sh "ss -lntup | awk 'NR==1 || /LISTEN/ {print}'"
run_sh "ss -lntup | awk 'NR==1 || /0\\.0\\.0\\.0:|\\[::\\]:|:::/'"

section "7. Worm /opt/worm"
run ls -la /opt/worm
run find /opt/worm -maxdepth 2 -mindepth 1 -printf '%M %u %g %s %TY-%Tm-%Td %TH:%TM %p -> %l\n'
run_sh "for d in grapheneos build apps patches artifacts webusb releases backups logs keys services; do if [ -e \"/opt/worm/\$d\" ]; then ls -ld \"/opt/worm/\$d\"; else printf 'MISSING %s\\n' \"/opt/worm/\$d\"; fi; done"
run_sh "find /opt/worm -maxdepth 1 -mindepth 1 -printf '%f\\n' | sort"
run_sh "find /opt/worm -maxdepth 3 \\( -name '.git' -o -name '.gradle' -o -name 'node_modules' -o -name 'build' -o -name 'dist' -o -name 'tmp' -o -name 'download-temp' -o -name 'local.properties' -o -name '*.apk' -o -name '*.zip' -o -name '*.key' -o -name '*.env' \\) -print 2>/dev/null | sort"
run_sh "find /opt/worm -maxdepth 2 -type l -printf '%p -> %l\\n' | sort"
run git -C /opt/worm status --short

section "Riepilogo automatico"
printf '\nProblemi trovati:\n'
run_sh "test -d /opt/worm/releases || echo 'MISSING /opt/worm/releases'; test -d /opt/worm/backups || echo 'MISSING /opt/worm/backups'; test -e /opt/worm/network && echo 'EXTRA top-level directory: /opt/worm/network'; test -e /opt/worm/private-portal && echo 'EXTRA top-level directory: /opt/worm/private-portal'; test -e /opt/worm/worm-os && echo 'EXTRA top-level directory: /opt/worm/worm-os'; test -e /opt/worm/wormos && echo 'EXTRA top-level directory: /opt/worm/wormos'; true"
printf '\nConflitti:\n'
run_sh "find /opt/worm -maxdepth 1 -mindepth 1 -printf '%f\\n' | sort | grep -Ev '^(grapheneos|build|apps|patches|artifacts|webusb|releases|backups|logs|keys|services)$' || true"
printf '\nDirectory sospette:\n'
run_sh "find /opt/worm -maxdepth 3 \\( -name '.gradle' -o -name 'node_modules' -o -name 'download-temp' -o -name 'tmp' -o -name 'local.properties' -o -name '*.apk' -o -name '*.zip' -o -name '*.key' -o -name '*.env' \\) -print 2>/dev/null | sort"
printf '\nPorte pubbliche:\n'
run_sh "ss -lntup | awk 'NR==1 || /0\\.0\\.0\\.0:|\\[::\\]:|:::/'"
printf '\nServizi web attuali:\n'
run_sh "systemctl is-active caddy 2>/dev/null; systemctl is-active nginx 2>/dev/null; ss -lntup | awk '/:(80|443)[[:space:]]/ {print}'"
printf '\nStorage remoto rilevato:\n'
run_sh "findmnt -a | grep -Ei 'storage|box|sshfs|fuse|cifs|smb|webdav|davfs|rclone|mnt' || true; find /opt/worm -maxdepth 1 -type l -printf '%p -> %l\\n' | grep -Ei 'storage|box|mnt|releases|backups' || true"
printf '\nModifiche consigliate:\n'
printf '%s\n' \
  '- Verificare e documentare esplicitamente i mount Storage Box usati da releases/backups.' \
  '- Allineare la root /opt/worm alla struttura desiderata solo in una patch separata con piano di migrazione.' \
  '- Rivedere porte pubbliche e binding 0.0.0.0/:: prima di esporre nuovi servizi.' \
  '- Separare cache/build artifact voluminosi da sorgenti e repository Git.' \
  '- Consolidare configurazioni web Caddy/nginx in services/ o docs/ senza applicarle automaticamente.'

printf '\nLOG_PATH=%s\n' "$LOG"
