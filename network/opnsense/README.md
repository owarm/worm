# Worm OPNsense Bootstrap

Patch: `worm-opnsense-cleanup-v001`

## Current Architecture

Robot Dedicated:
- Linux host
- public interface enp9s0
- public IP 162.55.6.173/32
- public IP remains on host
- private vSwitch interface to be configured/audited

OPNsense:
- separate VPS
- WAN on VPS
- private network interface to Hetzner Cloud Network
- routes/firewall/NAT handled by VPS OPNsense

Networking:

```text
VPS OPNsense
  -> Hetzner Cloud Network
  -> Robot vSwitch
  -> Dedicated private VLAN
```

Explicitly NOT used:
- local OPNsense VM
- QEMU for OPNsense
- WAN bridge
- public-IP cutover

## Guardrails

Do not modify the live public interface, public IP, gateway, routing, firewall,
bridges, VLANs, or network namespaces as part of cleanup or documentation work.

