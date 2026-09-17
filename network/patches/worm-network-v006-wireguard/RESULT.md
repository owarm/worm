# WORM Network V006 Result

Status: blocked before OPNsense modification.

Detected from Hetzner Cloud API:

```text
network=worm-private
network_cidr=10.90.0.0/16
cloud_subnet=10.90.10.0/24
vswitch_subnet=10.90.20.0/24
opnsense_server=worm-opnsense
opnsense_private_net=empty
```

Requested by v006:

```text
WG_NETWORK=10.30.0.0/24
OPNSENSE_WG_IP=10.30.0.1/24
PRIVATE_CLOUD=10.20.0.0/24
DEDICATED_VSWITCH=10.20.1.0/24
DEDICATED_PRIVATE=10.20.1.2
```

Secrets availability:

```text
HETZNER_CLOUD_TOKEN=SET
OPNSENSE_URL=MISSING
OPNSENSE_API_KEY=MISSING
OPNSENSE_API_SECRET=MISSING
OPNSENSE_SSH_HOST=MISSING
OPNSENSE_SSH_USER=SET
OPNSENSE_SSH_PORT=SET
```

No OPNsense `config.xml` backup could be taken because Cloud topology preflight
failed before any OPNsense connection, and OPNsense SSH/API access is not
configured locally. No OPNsense changes were applied.

```text
=== WORM NETWORK V006 ===

WIREGUARD:
FAIL

WG NETWORK:
10.30.0.0/24

PRIVATE CLOUD:
FAIL

DEDICATED:
FAIL

MANAGEMENT WAN EXPOSURE:
DISABLED
```
