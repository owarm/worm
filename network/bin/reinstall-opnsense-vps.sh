#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="${WORM_NETWORK_BASE:-/opt/worm/network}"
APPROVAL_FILE="$BASE_DIR/state/REINSTALL_APPROVED"
EXPECTED_APPROVAL="YES-I-UNDERSTAND-DISK-WILL-BE-ERASED"

if [ ! -f "$APPROVAL_FILE" ] || [ "$(cat "$APPROVAL_FILE")" != "$EXPECTED_APPROVAL" ]; then
  printf 'REINSTALL=REFUSED\n' >&2
  printf 'Missing approval file with exact content: %s\n' "$EXPECTED_APPROVAL" >&2
  exit 1
fi

cat <<'EOF'
MANUAL_CONSOLE_STEP_REQUIRED=YES
Reached guarded reinstall entrypoint only.

Future execution checklist:
1. Recheck SERVER_ID for worm-opnsense.
2. Recheck public IPv4 2.28.34.27.
3. Recheck OPNsense ISO is mounted.
4. Recheck worm-opnsense-config volume is attached.
5. Recheck config.xml checksum on FAT32 config volume.
6. Power-cycle or reboot to ISO.
7. Let OPNsense Importer read /conf/config.xml from the config volume.
8. Install OPNsense on the MAIN DISK only.
9. Do not install on the config volume.
10. Reboot from main disk.
11. Verify WAN.
12. Verify 2.28.34.27/32.
13. Verify gateway 172.31.1.1.

No blind installer input is implemented here.
EOF
