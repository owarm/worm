#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="${WORM_NETWORK_BASE:-/opt/worm/network}"
CONFIG_FILE="${1:-$BASE_DIR/generated/opnsense-bootstrap/config.xml}"

fail() {
  printf 'BOOTSTRAP_CONFIG=FAIL\n' >&2
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

[ -f "$CONFIG_FILE" ] || fail "config.xml not found: $CONFIG_FILE"
command -v python3 >/dev/null 2>&1 || fail "python3 is required"

python3 - "$CONFIG_FILE" <<'PY' || exit 1
import re
import sys
import xml.etree.ElementTree as ET

path = sys.argv[1]

def fail(message):
    print("BOOTSTRAP_CONFIG=FAIL", file=sys.stderr)
    print(f"ERROR: {message}", file=sys.stderr)
    sys.exit(1)

try:
    tree = ET.parse(path)
except ET.ParseError as exc:
    fail(f"XML is not well-formed: {exc}")

root = tree.getroot()
if root.tag not in {"opnsense", "pfsense"}:
    fail(f"unexpected root element: {root.tag}")

interfaces = root.find("interfaces")
if interfaces is None:
    fail("missing interfaces section")

wan = interfaces.find("wan")
if wan is None:
    fail("missing wan interface")

checks = {
    "wan if": (wan.findtext("if") == "vtnet0"),
    "wan ip": (wan.findtext("ipaddr") == "2.28.34.27"),
    "wan prefix": (wan.findtext("subnet") == "32"),
    "wan gateway ref": (wan.findtext("gateway") == "WAN_GW"),
}
for name, ok in checks.items():
    if not ok:
        fail(f"{name} check failed")

if interfaces.find("lan") is not None:
    fail("lan interface must be absent")
for child in list(interfaces):
    if re.fullmatch(r"opt\d*", child.tag or ""):
        fail(f"{child.tag} interface must be absent")

gateway_ok = False
for item in root.findall("./gateways/gateway_item"):
    if (
        item.findtext("name") == "WAN_GW"
        and item.findtext("interface") == "wan"
        and item.findtext("gateway") == "172.31.1.1"
        and item.findtext("defaultgw") in {"1", "true", "yes"}
        and item.findtext("fargw") in {"1", "true", "yes"}
    ):
        gateway_ok = True
        break
if not gateway_ok:
    fail("WAN_GW gateway is missing or incomplete")

xml_text = open(path, "r", encoding="utf-8").read()
placeholder_patterns = [
    r"\bTODO\b",
    r"\bTBD\b",
    r"\bCHANGEME\b",
    r"\bPLACEHOLDER\b",
    r"\{\{",
    r"\}\}",
]
secret_patterns = [
    r"api[_-]?key",
    r"api[_-]?secret",
    r"private[_-]?key",
    r"hetzner",
    r"token",
]
for pattern in placeholder_patterns:
    if re.search(pattern, xml_text, re.IGNORECASE):
        fail(f"placeholder pattern found: {pattern}")
for pattern in secret_patterns:
    if re.search(pattern, xml_text, re.IGNORECASE):
        fail(f"secret-like pattern found: {pattern}")

if "185.12.64.1" not in xml_text or "185.12.64.2" not in xml_text:
    fail("expected DNS servers are missing")

print("BOOTSTRAP_CONFIG=PASS")
PY
