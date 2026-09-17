# Worm Private Update Portal

Private static portal for Worm Release and OTA packages.

## Audit Findings

- Requested WireGuard command: `wg show` is not available on this host.
- `systemctl status wg-quick@* --no-pager` returned no active WireGuard unit output.
- Real private/VPN-facing interface found: `enp9s0.4000`.
- Real server private IP found: `10.90.20.10/24`.
- Real private/VPN route found: `10.90.0.0/16 via 10.90.20.1 dev enp9s0.4000`.
- Existing public Nginx listens on `0.0.0.0:443` and `[::]:443` for other hosts.
- Existing Nginx virtual hosts found: `apps.coffee.pm`, `releases.coffee.pm`, `worm.estixari.com`.
- Existing HTTPS certificates found for `apps.coffee.pm`, `releases.coffee.pm`, and `worm.estixari.com`.
- No dedicated Let’s Encrypt certificate was found for `worm.coffee.pm` under `/etc/letsencrypt/live`.
- A valid Let’s Encrypt wildcard certificate was found at `/etc/letsencrypt/live/coffee.pm`, with SAN `*.coffee.pm` and `coffee.pm`.
- Existing local Worm reports describe `worm.coffee.pm` as intended on `10.90.20.10`.

## VPN-Only Enforcement

The portal Nginx config uses a split Nginx layout for `worm.coffee.pm`.

VPN requests use:

- `listen 10.90.20.10:443 ssl;`
- `allow 10.90.0.0/16;`
- `deny all;`
- `root /var/www/worm-private;`

Public HTTPS requests use a separate server block with no private root and only:

- `return 302 https://worm.estixari.com/;`

Public HTTP requests also redirect to `https://worm.estixari.com/`, except `/.well-known/acme-challenge/`, which is left available under `/var/www/letsencrypt` for Certbot/ACME compatibility.

The redirect intentionally does not preserve `$request_uri`, so public requests for private paths such as `/release/`, `/ota/`, `/files/`, and `/public-data/` all collapse to `https://worm.estixari.com/`. There was no IPv6 VPN address found during audit.

## Package Sources

The generator scans only this allowlist:

- `/opt/worm/releases`
- `/opt/worm/grapheneos/releases`
- `/opt/worm/artifacts`
- `/opt/worm/webusb/public/releases`
- `/opt/worm/webusb/dist/releases`

It excludes target files, tool ZIPs, temporary files, source paths, key-like names, and symlinks resolving outside their allowlisted root.

## Deploy

```bash
cd /opt/worm/private-portal
sudo ./scripts/deploy.sh
```

The deploy script generates indexes, validates JSON, creates `/var/www/worm-private`, links approved package files into `/var/www/worm-private/files`, installs `/etc/nginx/sites-available/worm-private.conf` atomically, runs `nginx -t`, and reloads Nginx only after a valid test.

The deploy script requires the valid wildcard certificate at:

- `/etc/letsencrypt/live/coffee.pm/fullchain.pem`
- `/etc/letsencrypt/live/coffee.pm/privkey.pem`

It does not create self-signed certificates and does not modify firewall rules.

## Update

```bash
cd /opt/worm/private-portal
sudo ./scripts/update.sh
```

Use this after new builds arrive. It refreshes `public-data/releases.json`, `public-data/ota.json`, and the controlled file links in the private webroot.

## Verify

```bash
./scripts/check-vpn-access.sh
nginx -t
```

Local access should be tested against `https://worm.coffee.pm/` resolving to `10.90.20.10` from the VPN DNS or host override. Non-VPN clients should receive `302 Location: https://worm.estixari.com/`, never the portal.

Current DNS detection from this host did not return a public `worm.coffee.pm` address with `getent ahostsv4`. Earlier Worm reports in `/opt/worm/artifacts/reports` describe the intended split as VPN/private traffic using `10.90.20.10`, while public DNS previously pointed at a public WEB address. DNS was not changed automatically.
