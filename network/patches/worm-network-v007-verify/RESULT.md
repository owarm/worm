# WORM Network V007 Result

Final read-only audit result:

```text
=== WORM NETWORK FINAL ===

DEDICATED PUBLIC:
PASS

DEDICATED PRIVATE VLAN:
PASS

VSWITCH:
FAIL

CLOUD NETWORK:
FAIL

OPNSENSE:
FAIL

ROUTING:
FAIL

NAT:
FAIL

WIREGUARD:
FAIL

FINAL STATUS:
NOT_READY
```

Reasons:

```text
Robot API credentials missing, so Robot vSwitch membership cannot be verified.
Cloud Network worm-private is still 10.90.0.0/16, not the requested 10.20.0.0/16.
Cloud subnets are 10.90.10.0/24 and 10.90.20.0/24, not 10.20.0.0/24 and 10.20.1.0/24.
worm-opnsense private_net is empty.
OPNsense SSH/API is not configured locally.
WireGuard cannot be verified or configured without OPNsense access.
```

Passing checks:

```text
Dedicated public IP is on enp9s0.
Default route is via 162.55.6.129 dev enp9s0.
Dedicated VLAN enp9s0.4000 is UP.
Dedicated VLAN MTU is 1400.
Dedicated VLAN IP is 10.20.1.2/24.
Dedicated DNS and HTTPS Internet access from the public route work.
```
