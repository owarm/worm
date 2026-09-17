worm-os-wireguard-system-v001

System-level WireGuard preparation for Worm OS.

Kernel:
- Existing Android/Linux kernel WireGuard support detected in frankel-relevant 6.18 arm64 and arm64/16k prebuilts.
- No kernel config was duplicated or changed.

System integration:
- Installs wg from external/wireguard-tools.
- Installs worm_wg as a system_ext preflight wrapper.
- worm_wg validates /data/misc/worm/wireguard/worm0.conf by default.
- Supported config fields: Interface.Name, Interface.PrivateKeyFile, Interface.DNS, Interface.AutoStart, Peer.PublicKey, Peer.Endpoint, Peer.AllowedIPs, Peer.PersistentKeepalive.

Secret handling:
- Inline PrivateKey is rejected.
- PrivateKeyFile must live under /data/misc/worm/wireguard/.
- Private key file content is never read, logged, or archived by worm_wg.
- Peer public key, endpoint, and allowed IP values are redacted in output.

Boot safety:
- Missing config exits success and leaves WireGuard disabled.
- This patch does not add an init service or automatic interface bring-up.

Build:
- Target: frankel cp2a user
- Modules: worm_wg wg
- Result: SUCCESS
