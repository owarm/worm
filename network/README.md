# WORM Network V001 Audit API

Central read-only audit orchestrator for:

- Hetzner Robot Dedicated
- Hetzner Cloud
- Existing VPS OPNsense
- Hetzner Cloud private Network
- Robot vSwitch
- Local Dedicated host

This patch does not apply network changes. It does not create vSwitches, Cloud Networks,
or OPNsense configuration, and it does not modify `enp9s0` or restart services.

## Layout

```text
/opt/worm/network/
├── bin/
├── config/
├── logs/
├── backup/
├── generated/
└── state/
```

## Setup

Copy or edit `config/secrets.env` from `config/secrets.env.example`.

Keep:

```text
APPLY_CHANGES=no
```

Secrets are ignored by git and must not be printed in logs.

## Run

```sh
/opt/worm/network/bin/audit-all.sh
```

Outputs are written to:

- `generated/dedicated.json`
- `generated/cloud.json`
- `generated/robot.json`
- `generated/opnsense.json`
- `generated/topology.txt`
- `generated/verify.json`
- `logs/audit-YYYYMMDD-HHMMSS.log`

The tools are read-only and produce a final summary headed:

```text
=== WORM NETWORK V001 AUDIT ===
```

