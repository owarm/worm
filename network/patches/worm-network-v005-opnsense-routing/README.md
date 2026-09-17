# worm-network-v005-opnsense-routing

Configura OPNsense come router/firewall fra Hetzner Cloud Network privata,
vSwitch Robot e Internet.

Lo script non inventa gateway o nomi interfaccia:

- legge Network/Subnet/Gateway da Hetzner Cloud API;
- legge `ifconfig` su OPNsense via SSH;
- salva prima `/conf/config.xml` in `backup/opnsense-config-YYYYMMDD-HHMMSS.xml`;
- procede solo se OPNsense e' gia collegata alla Cloud Network attesa.

Prerequisiti in `config/secrets.env`:

```text
HETZNER_CLOUD_TOKEN=...
OPNSENSE_SSH_HOST=...
OPNSENSE_SSH_USER=root
OPNSENSE_SSH_PORT=22
```

Apply:

```sh
/opt/worm/network/patches/worm-network-v005-opnsense-routing/bin/apply-opnsense-routing.sh
```

Verify:

```sh
/opt/worm/network/patches/worm-network-v005-opnsense-routing/bin/verify-opnsense-routing.sh
```
