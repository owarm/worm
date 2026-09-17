#!/usr/bin/env bash
set -euo pipefail

APP_NAME="worm-webusb"
AUTH_USER="worm-webusb-auth"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_DIR="/etc/${APP_NAME}"
ENV_FILE="${ENV_DIR}/auth.env"
SERVICE_FILE="/etc/systemd/system/worm-webusb-auth.service"

die() {
    echo "ERROR: $*" >&2
    exit 1
}

if [[ "${EUID}" -ne 0 ]]; then
    die "Run as root: sudo ./scripts/setup-email-auth.sh"
fi

if ! command -v sendmail >/dev/null 2>&1; then
    die "Local mail transport is not available. Install and configure the server local sendmail-compatible MTA before enabling Email OTP."
fi

echo "Local mail transport found."

if ! id "${AUTH_USER}" >/dev/null 2>&1; then
    useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin "${AUTH_USER}"
fi

install -d -o root -g root -m 0750 "${ENV_DIR}"
get_env_value() {
    local key="$1"
    if [[ -f "${ENV_FILE}" ]]; then
        grep -E "^${key}=" "${ENV_FILE}" | tail -n 1 | cut -d= -f2- || true
    fi
}

authorized_email="$(get_env_value AUTHORIZED_EMAIL)"
mail_from="$(get_env_value MAIL_FROM)"
session_secret="$(get_env_value SESSION_SECRET)"
otp_ttl_seconds="$(get_env_value OTP_TTL_SECONDS)"
session_ttl_seconds="$(get_env_value SESSION_TTL_SECONDS)"

umask 077
tmp_env="$(mktemp "${ENV_DIR}/auth.env.XXXXXX")"
cat > "${tmp_env}" <<EOF
AUTHORIZED_EMAIL=${authorized_email}
MAIL_FROM=${mail_from}
SESSION_SECRET=${session_secret}
OTP_TTL_SECONDS=${otp_ttl_seconds:-600}
SESSION_TTL_SECONDS=${session_ttl_seconds:-3600}
EOF
chown root:root "${tmp_env}"
chmod 0600 "${tmp_env}"
mv "${tmp_env}" "${ENV_FILE}"

install -o root -g root -m 0644 "${REPO_ROOT}/systemd/worm-webusb-auth.service" "${SERVICE_FILE}"
systemctl daemon-reload
systemctl enable worm-webusb-auth.service
