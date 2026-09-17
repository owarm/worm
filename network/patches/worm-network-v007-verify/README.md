# worm-network-v007-verify

Final end-to-end read-only audit for WORM network state.

The verifier checks:

- Dedicated public IP/default route;
- Dedicated private VLAN `enp9s0.4000`;
- Robot vSwitch when Robot credentials are configured;
- Hetzner Cloud Network and OPNsense attachment;
- OPNsense routing, NAT, firewall and WireGuard when SSH is configured;
- basic connectivity and DNS from the Dedicated host.

Run:

```sh
/opt/worm/network/patches/worm-network-v007-verify/bin/verify-final.sh
```

Logs are written under:

```text
/opt/worm/network/patches/worm-network-v007-verify/state/
```
