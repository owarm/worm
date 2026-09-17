# WORM Network V005 Result

Status: blocked before OPNsense modification.

Detected from Hetzner Cloud API:

```text
network=worm-private
network_cidr=10.90.0.0/16
cloud_subnet=10.90.10.0/24 gateway=10.90.0.1
vswitch_subnet=10.90.20.0/24 gateway=10.90.0.1
opnsense_server=worm-opnsense
opnsense_private_net=empty
```

Requested by v005:

```text
WORM_CLOUD_NET=10.20.0.0/24
WORM_VSWITCH_NET=10.20.1.0/24
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

Preflight result:

```text
ERROR: Cloud subnet 10.20.0.0/24 not present on worm-private
```

No OPNsense `config.xml` backup could be taken because the required Cloud
topology check failed before any OPNsense modification. OPNsense SSH/API access
is also not configured locally. No OPNsense changes were applied.

```text
=== WORM NETWORK V005 ===

OPNSENSE PRIVATE:
UNKNOWN

ROUTE TO VSWITCH:
FAIL

FIREWALL:
FAIL

OUTBOUND NAT:
FAIL

DEDICATED PRIVATE:
10.20.1.2

STATUS:
PRIVATE_ROUTING_READY=NO
```
