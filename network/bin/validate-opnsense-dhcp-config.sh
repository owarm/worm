#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="${WORM_NETWORK_BASE:-/opt/worm/network}"
CONFIG_FILE="${1:-$BASE_DIR/generated/opnsense-bootstrap/config.xml}"

fail() {
  printf 'CONFIG_VALID=NO\n'
  printf 'ERROR=%s\n' "$*"
  exit 1
}

[ -f "$CONFIG_FILE" ] || fail "config.xml not found"
command -v python3 >/dev/null 2>&1 || fail "python3 is required"

python3 - "$CONFIG_FILE" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET

path = sys.argv[1]

def fail(message):
    print("CONFIG_VALID=NO")
    print(f"ERROR={message}")
    sys.exit(1)

try:
    root = ET.parse(path).getroot()
except ET.ParseError as exc:
    fail(f"XML is not well-formed: {exc}")

if root.tag != "opnsense":
    fail(f"unexpected root element: {root.tag}")

interfaces = root.find("interfaces")
if interfaces is None:
    fail("interfaces section missing")

wan = interfaces.find("wan")
if wan is None:
    fail("wan section missing")

if wan.findtext("if") != "vtnet0":
    fail("wan if must be vtnet0")

if wan.findtext("ipaddr") != "dhcp":
    fail("wan ipaddr must be dhcp")

if interfaces.find("lan") is not None:
    fail("lan must be absent")

for child in list(interfaces):
    if re.fullmatch(r"opt\d*", child.tag or ""):
        fail(f"{child.tag} must be absent")

xml_text = open(path, "r", encoding="utf-8").read()
for pattern in [r"\bTODO\b", r"\bTBD\b", r"\bCHANGEME\b", r"\bPLACEHOLDER\b", r"\{\{", r"\}\}"]:
    if re.search(pattern, xml_text, re.IGNORECASE):
        fail(f"placeholder pattern found: {pattern}")

for pattern in [r"token", r"secret", r"password", r"api[_-]?key", r"api[_-]?secret", r"private[_-]?key", r"hetzner"]:
    if re.search(pattern, xml_text, re.IGNORECASE):
        fail(f"secret-like pattern found: {pattern}")

print("CONFIG_VALID=YES")
PY
