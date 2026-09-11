# PATCH-002 - System WireGuard

Target: Pixel 10 / frankel / Android 17

KEEP:
- Pixel kernel WireGuard built-in
- linux/wireguard.h UAPI
- Generic Netlink

REMOVE:
- wireguard-tools
- wg / wg-quick
- libmnl modifications

ADD:
- Android-native privileged WireGuard controller
- init integration
- dedicated SELinux policy
- wg0 lifecycle
- WORM-supplied runtime configuration

No private keys, peer secrets or production endpoints are stored in Git.
