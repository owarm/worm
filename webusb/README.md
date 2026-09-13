# Worm OS Web Installer

Browser-based WebUSB installer for Worm OS. The app is intentionally scoped to fastboot factory ZIP installation and does not contain private signing keys, release signing keys, AVB private keys, passwords, tokens, analytics, telemetry, or external trackers.

## Supported hardware

Only Google Pixel devices explicitly supported by Worm OS should be connected. The current target is Google Pixel 10 with Google USB vendor ID `18d1`.

## Pixel 10 / frankel

The supported product codename is `frankel`. The installer verifies `getvar product` and refuses unsupported products.

## Browser requirements

Use Chrome, Chromium, or Edge with WebUSB enabled. Do not assume Safari or Firefox support because WebUSB is not available there.

## HTTPS requirement

WebUSB requires a secure context. Production deployments must use HTTPS. Local development on `localhost` or `127.0.0.1` is accepted by browsers as a secure context.

## Node/npm requirements

Node.js `>=22` and npm `>=10` are expected.

## Install dependencies

```sh
npm install
```

## Development

```sh
npm run dev
```

Open the Vite local URL in a supported Chromium-based browser.

## Production build

```sh
npm run typecheck
npm run test
npm run build
```

## Build output

Production files are generated in `dist/`. Deploy the contents of `dist/` to `/var/www/worm-webusb` or your equivalent web root.

## Release workflow

Create a Worm OS factory ZIP outside this repository, sign it with the correct Worm OS release keys and AVB key, then add it with the manifest script. The web installer never generates or stores private keys.

## Creating manifest

```sh
npm run manifest -- /opt/worm/releases/frankel-install-2026091200.zip 2026091200
```

This copies the ZIP into `public/releases/`, computes SHA-256 and byte size, and writes `public/manifest.json`.

## Verifying release

```sh
npm run verify-release
```

The verifier checks schema, `frankel`, path safety, SHA-256, and size. A placeholder manifest without a real local ZIP means the release package is not installed yet.

## WebUSB permissions

The browser asks the user to select a USB device. The app filters for Google vendor ID `18d1` and then verifies fastboot product and serial.

## Automatic reconnect

Fastboot operations may reboot or disconnect the Pixel. The reconnect manager waits only during documented installer states and is disposed after final completion or definitive errors.

## Bootloader unlock

Bootloader unlock requires an explicit checkbox and click. The installer runs the real fastboot command equivalent to `flashing unlock` through `android-fastboot`.

## Data wipe warnings

Unlocking and locking the bootloader erase user data. The UI requires separate confirmations for unlock and lock. These operations are never resumed automatically after refresh.

## Factory flashing

The app downloads the release ZIP, verifies SHA-256, and passes the Blob to `android-fastboot` `flashFactoryZip(blob, wipe, onReconnect, onProgress)`. The factory ZIP is handled by the library, not by manifest-defined partition commands.

## AVB / Verified Boot

Only lock the bootloader after a complete verified Worm OS installation prepared and signed with the Worm OS release keys and correct AVB key. A build is not lockable merely because it boots.

## Bootloader lock

`Lock Bootloader` is enabled only at `LOCK_READY`, after successful factory flash, `frankel` product verification, matching serial when available, verified release SHA-256, and no destructive operation in progress. The user must confirm on the Pixel with physical buttons.

## Final reboot

After lock handling completes safely, `Reboot Pixel` runs the real fastboot reboot API. The app then enters `COMPLETE`, stops reconnect polling, and releases Wake Lock.

## IndexedDB cache

Downloaded releases may be cached in IndexedDB. Cached data is rehashed before use. Corrupt cache entries are deleted and re-downloaded.

## SHA-256 verification

The manifest SHA-256 must match the downloaded factory ZIP before flashing. Flash and lock are blocked when the verified digest is missing or mismatched.

## nginx deployment

Use `nginx/worm-webusb.conf` as a production template. It redirects HTTP to HTTPS, serves `/var/www/worm-webusb`, enables WebUSB via `Permissions-Policy`, sets a strict CSP, and protects the entire HTTPS site with Nginx HTTP Basic Authentication. The authentication challenge is served before the browser receives `index.html`, JavaScript, CSS, `manifest.json`, release ZIPs, or WebUSB installer assets.

The expected Basic Auth username is `worm`. The password must be created manually on the server and must not be hardcoded in this project. The Nginx template expects the password file at:

```sh
/etc/nginx/.worm-webusb.htpasswd
```

Install the password utility and create the server-side password file:

```sh
apt install apache2-utils
htpasswd -c /etc/nginx/.worm-webusb.htpasswd worm
```

Then validate and reload Nginx:

```sh
nginx -t
systemctl reload nginx
```

Do not save the PIN or password in `package.json`, a published `.env`, JavaScript, HTML, git, or logs. The client-side installation-code gate has been removed because access is now protected by Nginx before the application loads. Production deployment serves only local static files from `dist/` and does not require external JavaScript, analytics, telemetry, HTTP configuration, or a CDN.

## Production deployment

1. Point the DNS `A` and/or `AAAA` record for your installer domain to the production server.
2. Ensure inbound TCP `80` and TCP `443` are reachable. The deploy script does not modify firewall rules.
3. Build the production bundle:

```sh
npm run build
```

4. Deploy with a real domain and administrator email:

```sh
sudo ./scripts/deploy-production.sh install.worm-os.com admin@worm-os.com
```

The deploy script publishes only `dist/` to `/var/www/worm-webusb`. No Worm OS private keys, `/opt/worm/keys`, or `/opt/worm/source` content should be placed in `dist/` or copied into the web root.

5. Verify HTTPS in Chrome, Chromium, or Edge. WebUSB requires a valid HTTPS secure context in production.
6. For future updates, rebuild and publish the new `dist/` while keeping nginx configuration and certificates:

```sh
npm run build
sudo ./scripts/update-production.sh
```

7. Check services and certificates when troubleshooting:

```sh
systemctl status nginx
nginx -t
certbot certificates
```

## Windows USB driver note

Windows may require a compatible USB driver for WebUSB/fastboot. Use trusted vendor or platform documentation. This project does not download or install drivers automatically.

## Linux USB permissions note

Linux may require udev rules for Google vendor ID `18d1`. Configure the host system deliberately; the installer does not modify `/etc/udev` automatically.

## Troubleshooting

Check browser support, HTTPS, USB cable quality, fastboot mode, device selection, product codename, serial mismatch, release SHA-256 mismatch, and local USB permissions. Reconnect prompts appear only when an operation can safely continue.

## Security model

The manifest can identify only a release ZIP path, SHA-256, size, channel, device, and release id. It cannot inject JavaScript, define arbitrary fastboot commands, define arbitrary partitions, or authorize unexpected cross-origin downloads.

## Architecture

`src/installer.ts` orchestrates WebUSB fastboot operations. `src/state.ts` owns legal state transitions and safe metadata restore. `src/release.ts` validates manifest and release URLs. `src/blob-store.ts` manages IndexedDB cache. `scripts/` creates and verifies release manifests.

## Physical-device testing checklist

- Chrome, Chromium, or Edge opens the installer over HTTPS or localhost.
- Pixel 10 enters fastboot and appears through WebUSB.
- Product is reported as `frankel`.
- Serial remains consistent across reconnects when available.
- Unlock requires checkbox, click, and Pixel physical-button confirmation.
- Factory ZIP downloads, hashes, flashes, and wipes as expected.
- `Lock Bootloader` appears only at `LOCK_READY`.
- Lock requires checkbox, click, and Pixel physical-button confirmation.
- Locked state is verified with `getvar unlocked` when available.
- Final reboot reaches Android and reconnect polling stops.
