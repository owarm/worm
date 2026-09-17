#!/usr/bin/env bash
set -euo pipefail

APP_NAME="worm-webusb"
WEB_ROOT="/var/www/${APP_NAME}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="${REPO_ROOT}/dist"

die() {
    echo "ERROR: $*" >&2
    exit 1
}

info() {
    echo "==> $*"
}

require_root() {
    if [[ "${EUID}" -ne 0 ]]; then
        die "Run as root: sudo ./scripts/deploy-production.sh DOMAIN EMAIL"
    fi
}

validate_domain() {
    local domain="$1"
    [[ "${#domain}" -le 253 ]] || return 1
    [[ "${domain}" != *"://"* ]] || return 1
    [[ "${domain}" != */* ]] || return 1
    [[ "${domain}" =~ ^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$ ]] || return 1
}

validate_email() {
    local email="$1"
    [[ "${#email}" -le 254 ]] || return 1
    [[ "${email}" =~ ^[A-Za-z0-9._%+\'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$ ]] || return 1
}

run_as_build_user() {
    local build_user="${SUDO_USER:-root}"
    if [[ "${build_user}" != "root" ]] && id "${build_user}" >/dev/null 2>&1; then
        if command -v runuser >/dev/null 2>&1; then
            runuser -u "${build_user}" -- "$@"
        else
            su -s /bin/sh "${build_user}" -c "$(printf '%q ' "$@")"
        fi
    else
        "$@"
    fi
}

ensure_dist() {
    if [[ -f "${DIST_DIR}/index.html" ]]; then
        validate_dist_contents
        return
    fi

    info "dist/index.html not found; running npm run build"
    [[ -f "${REPO_ROOT}/package.json" ]] || die "package.json not found in ${REPO_ROOT}"
    command -v npm >/dev/null 2>&1 || die "npm is required to build the app"
    if [[ ! -d "${REPO_ROOT}/node_modules" || ! -e "${REPO_ROOT}/node_modules/.bin/vite" ]]; then
        if [[ -f "${REPO_ROOT}/package-lock.json" ]]; then
            info "node_modules or Vite missing; running npm ci"
            (cd "${REPO_ROOT}" && run_as_build_user npm ci)
        else
            info "node_modules or Vite missing; running npm install"
            (cd "${REPO_ROOT}" && run_as_build_user npm install)
        fi
    fi
    (cd "${REPO_ROOT}" && run_as_build_user npm run build)
    [[ -f "${DIST_DIR}/index.html" ]] || die "Build completed but dist/index.html is still missing"
    validate_dist_contents
}

validate_dist_contents() {
    [[ -d "${DIST_DIR}" ]] || die "dist directory is missing"

    if find "${DIST_DIR}" -type l -print -quit | grep -q .; then
        die "dist/ contains symlinks. Refusing to publish files that may point outside dist/."
    fi

    if find "${DIST_DIR}" \( -path '*/keys' -o -path '*/keys/*' -o -path '*/source' -o -path '*/source/*' \) -print -quit | grep -q .; then
        die "dist/ contains forbidden keys/source paths. Publish only static build output."
    fi
}

detect_package_manager() {
    if command -v apt-get >/dev/null 2>&1; then echo apt
    elif command -v dnf >/dev/null 2>&1; then echo dnf
    elif command -v yum >/dev/null 2>&1; then echo yum
    elif command -v zypper >/dev/null 2>&1; then echo zypper
    elif command -v pacman >/dev/null 2>&1; then echo pacman
    elif command -v apk >/dev/null 2>&1; then echo apk
    else return 1
    fi
}

install_packages() {
    local pm="$1"
    shift
    case "${pm}" in
        apt)
            apt-get update
            DEBIAN_FRONTEND=noninteractive apt-get install -y "$@"
            ;;
        dnf) dnf install -y "$@" ;;
        yum) yum install -y "$@" ;;
        zypper) zypper --non-interactive install "$@" ;;
        pacman) pacman -Sy --noconfirm "$@" ;;
        apk) apk add --no-cache "$@" ;;
        *) die "Unsupported package manager: ${pm}" ;;
    esac
}

certbot_has_nginx_plugin() {
    command -v certbot >/dev/null 2>&1 && certbot plugins 2>/dev/null | grep -Eq '(^|[[:space:]])nginx([[:space:]]|$)'
}

ensure_server_packages() {
    local pm packages=()
    pm="$(detect_package_manager)" || die "No supported package manager found"

    if ! command -v nginx >/dev/null 2>&1; then
        packages+=("nginx")
    fi

    if ! command -v certbot >/dev/null 2>&1 || ! certbot_has_nginx_plugin; then
        case "${pm}" in
            apt|dnf|yum|zypper) packages+=("certbot" "python3-certbot-nginx") ;;
            pacman) packages+=("certbot" "certbot-nginx") ;;
            apk) packages+=("certbot" "certbot-nginx") ;;
        esac
    fi

    if ((${#packages[@]} > 0)); then
        info "Installing missing packages: ${packages[*]}"
        install_packages "${pm}" "${packages[@]}"
    fi

    command -v nginx >/dev/null 2>&1 || die "nginx installation failed"
    command -v certbot >/dev/null 2>&1 || die "certbot installation failed"
    certbot_has_nginx_plugin || die "certbot nginx plugin is not available"
}

publish_dist() {
    info "Publishing dist/ to ${WEB_ROOT}"
    install -d -o root -g root -m 0755 "${WEB_ROOT}"

    local tmp_dir
    tmp_dir="$(mktemp -d "${WEB_ROOT}.tmp.XXXXXX")"
    trap 'rm -rf "${tmp_dir:-}"' EXIT

    if command -v rsync >/dev/null 2>&1; then
        rsync -a --delete --exclude '.git' "${DIST_DIR}/" "${tmp_dir}/"
    else
        cp -a "${DIST_DIR}/." "${tmp_dir}/"
    fi

    chown -R root:root "${tmp_dir}"
    find "${tmp_dir}" -type d -exec chmod 0755 {} +
    find "${tmp_dir}" -type f -exec chmod 0644 {} +

    rsync -a --delete "${tmp_dir}/" "${WEB_ROOT}/" 2>/dev/null || {
        find "${WEB_ROOT}" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
        cp -a "${tmp_dir}/." "${WEB_ROOT}/"
    }

    chown -R root:root "${WEB_ROOT}"
    find "${WEB_ROOT}" -type d -exec chmod 0755 {} +
    find "${WEB_ROOT}" -type f -exec chmod 0644 {} +
    rm -rf "${tmp_dir}"
    trap - EXIT
}

nginx_layout() {
    if [[ -d /etc/nginx/sites-available && -d /etc/nginx/sites-enabled ]]; then
        echo debian
    elif [[ -d /etc/nginx/conf.d ]]; then
        echo confd
    else
        die "Unsupported nginx layout: expected sites-available/sites-enabled or conf.d"
    fi
}

write_http_config() {
    local domain="$1"
    local config_path="$2"
    cat > "${config_path}" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${domain};

    root ${WEB_ROOT};
    index index.html;

    server_tokens off;
    autoindex off;

    gzip on;
    gzip_vary on;
    gzip_types text/css application/javascript application/json image/svg+xml;

    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer" always;
    add_header X-Frame-Options "DENY" always;
    add_header Permissions-Policy "usb=(self)" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; worker-src 'self' blob:; base-uri 'self'; frame-ancestors 'none'; form-action 'self'" always;

    location ^~ /.well-known/acme-challenge/ {
        auth_request off;
        try_files \$uri =404;
    }

    location = /auth-verify {
        internal;
        proxy_pass http://127.0.0.1:8787/auth/check;
        proxy_pass_request_body off;
        proxy_set_header Content-Length "";
        proxy_set_header Cookie \$http_cookie;
        proxy_set_header X-Original-URI \$request_uri;
    }

    location ^~ /auth/ {
        auth_request off;
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        add_header Cache-Control "no-store" always;
    }

    location = /manifest.json {
        auth_request /auth-verify;
        add_header X-Content-Type-Options "nosniff" always;
        add_header Referrer-Policy "no-referrer" always;
        add_header X-Frame-Options "DENY" always;
        add_header Permissions-Policy "usb=(self)" always;
        add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; worker-src 'self' blob:; base-uri 'self'; frame-ancestors 'none'; form-action 'self'" always;
        add_header Cache-Control "no-cache" always;
        try_files \$uri =404;
    }

    location = /index.html {
        auth_request /auth-verify;
        add_header X-Content-Type-Options "nosniff" always;
        add_header Referrer-Policy "no-referrer" always;
        add_header X-Frame-Options "DENY" always;
        add_header Permissions-Policy "usb=(self)" always;
        add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; worker-src 'self' blob:; base-uri 'self'; frame-ancestors 'none'; form-action 'self'" always;
        add_header Cache-Control "no-cache" always;
        try_files \$uri =404;
    }

    location /assets/ {
        auth_request /auth-verify;
        add_header X-Content-Type-Options "nosniff" always;
        add_header Referrer-Policy "no-referrer" always;
        add_header X-Frame-Options "DENY" always;
        add_header Permissions-Policy "usb=(self)" always;
        add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; worker-src 'self' blob:; base-uri 'self'; frame-ancestors 'none'; form-action 'self'" always;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
        try_files \$uri =404;
    }

    location /fastboot/ {
        auth_request /auth-verify;
        add_header X-Content-Type-Options "nosniff" always;
        add_header Referrer-Policy "no-referrer" always;
        add_header X-Frame-Options "DENY" always;
        add_header Permissions-Policy "usb=(self)" always;
        add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; worker-src 'self' blob:; base-uri 'self'; frame-ancestors 'none'; form-action 'self'" always;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
        try_files \$uri =404;
    }

    location /releases/ {
        auth_request /auth-verify;
        gzip off;
        add_header X-Content-Type-Options "nosniff" always;
        add_header Referrer-Policy "no-referrer" always;
        add_header X-Frame-Options "DENY" always;
        add_header Permissions-Policy "usb=(self)" always;
        add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; worker-src 'self' blob:; base-uri 'self'; frame-ancestors 'none'; form-action 'self'" always;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
        add_header Accept-Ranges "bytes" always;
        types {
            application/zip zip;
        }
        default_type application/octet-stream;
        try_files \$uri =404;
    }

    location / {
        auth_request /auth-verify;
        try_files \$uri \$uri/ /index.html;
    }
}
EOF
}

enable_nginx_site() {
    local domain="$1"
    local layout="$2"
    local target_config active_config target_backup active_backup active_was_link active_target

    if [[ "${layout}" == "debian" ]]; then
        target_config="/etc/nginx/sites-available/${APP_NAME}.conf"
        active_config="/etc/nginx/sites-enabled/${APP_NAME}.conf"
        target_backup=""
        active_backup=""
        active_was_link="no"
        active_target=""

        if [[ -L "${active_config}" ]]; then
            active_was_link="yes"
            active_target="$(readlink "${active_config}")"
        elif [[ -e "${active_config}" ]]; then
            active_backup="$(mktemp /tmp/${APP_NAME}.sites-enabled.XXXXXX)"
            cp -a "${active_config}" "${active_backup}"
        fi
        if [[ -f "${target_config}" ]]; then
            target_backup="$(mktemp /tmp/${APP_NAME}.sites-available.XXXXXX)"
            cp -a "${target_config}" "${target_backup}"
        fi

        write_http_config "${domain}" "${target_config}.new"
        mv "${target_config}.new" "${target_config}"
        ln -sfn "${target_config}" "${active_config}"
        if nginx -t; then
            rm -f "${target_backup}" "${active_backup}"
        else
            echo "nginx -t failed. Restoring the previous working configuration and stopping." >&2
            rm -f "${active_config}"
            if [[ -n "${target_backup}" ]]; then
                mv "${target_backup}" "${target_config}"
            else
                rm -f "${target_config}"
            fi
            if [[ "${active_was_link}" == "yes" && -n "${active_target}" ]]; then
                ln -s "${active_target}" "${active_config}"
            elif [[ -n "${active_backup}" ]]; then
                mv "${active_backup}" "${active_config}"
            fi
            die "Fix the nginx configuration and run nginx -t again"
        fi

        if [[ -e /etc/nginx/sites-enabled/default ]]; then
            if grep -Rq "default_server" /etc/nginx/sites-enabled/default /etc/nginx/sites-available/default 2>/dev/null; then
                info "Default nginx site is present; leaving it enabled because this domain has an explicit server_name"
            fi
        fi
    else
        target_config="/etc/nginx/conf.d/${APP_NAME}.conf"
        write_http_config "${domain}" "${target_config}.new"
        if [[ -f "${target_config}" ]]; then
            cp -a "${target_config}" "${target_config}.bak"
        fi
        mv "${target_config}.new" "${target_config}"
        if ! nginx -t; then
            echo "nginx -t failed. Restoring the previous working configuration if one existed and stopping." >&2
            if [[ -f "${target_config}.bak" ]]; then
                mv "${target_config}.bak" "${target_config}"
            fi
            die "Fix ${target_config} and run nginx -t again"
        fi
        rm -f "${target_config}.bak"
    fi
}

reload_nginx() {
    if command -v systemctl >/dev/null 2>&1; then
        systemctl enable --now nginx
        systemctl reload nginx
    else
        service nginx reload || nginx -s reload
    fi
}

show_dns_status() {
    local domain="$1"
    info "DNS check for ${domain}"
    echo "The A/AAAA record for ${domain} must point to this server."
    if command -v getent >/dev/null 2>&1; then
        getent ahosts "${domain}" || true
    elif command -v dig >/dev/null 2>&1; then
        dig +short A "${domain}" || true
        dig +short AAAA "${domain}" || true
    else
        echo "Install dig or use your DNS provider to verify A/AAAA records."
    fi
    echo "Required inbound firewall access: TCP 80 and TCP 443."
}

obtain_certificate() {
    local domain="$1"
    local email="$2"
    info "Requesting Let's Encrypt certificate"
    if ! certbot --nginx -d "${domain}" --email "${email}" --agree-tos --no-eff-email --redirect; then
        cat >&2 <<EOF
ERROR: certbot failed.

The HTTP site was left in place. Check that:
- DNS A/AAAA for ${domain} points to this server.
- TCP 80 and TCP 443 are reachable from the public internet.
- No upstream firewall, proxy, or load balancer blocks the ACME challenge.

WebUSB production will NOT work until HTTPS has a valid certificate.
EOF
        exit 1
    fi
}

verify_certbot_renewal() {
    info "Checking Certbot renewal mechanism"
    if command -v systemctl >/dev/null 2>&1 && systemctl list-timers --all | grep -Eq 'certbot|snap.certbot.renew'; then
        systemctl list-timers --all | grep -E 'certbot|snap.certbot.renew' || true
    elif [[ -d /etc/cron.d ]] && ls /etc/cron.d/*certbot* >/dev/null 2>&1; then
        ls -1 /etc/cron.d/*certbot*
    else
        echo "WARNING: Could not confirm an automatic Certbot renewal timer or cron job."
        echo "Run: systemctl list-timers --all | grep certbot"
    fi
}

main() {
    require_root
    [[ "$#" -eq 2 ]] || die "Usage: sudo ./scripts/deploy-production.sh DOMAIN EMAIL"

    local domain="$1"
    local email="$2"
    validate_domain "${domain}" || die "Invalid DOMAIN: ${domain}"
    validate_email "${email}" || die "Invalid EMAIL: ${email}"

    ensure_dist
    ensure_server_packages
    publish_dist

    local layout
    layout="$(nginx_layout)"
    enable_nginx_site "${domain}" "${layout}"
    reload_nginx

    show_dns_status "${domain}"
    obtain_certificate "${domain}" "${email}"

    nginx -t
    reload_nginx
    verify_certbot_renewal

    echo
    echo "Production deployment complete for https://${domain}"
    echo "WebUSB requires HTTPS; verify in Chrome, Chromium, or Edge."
}

main "$@"
