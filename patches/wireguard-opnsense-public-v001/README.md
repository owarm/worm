# wireguard-opnsense-public-v001

Configura OPNsense come endpoint WireGuard pubblico per Worm OS.

Architettura:

```text
Internet -> 162.55.6.173:51820/UDP -> OPNsense wg0 10.66.66.1/24 -> Worm OS 10.66.66.2/32
```

Parametri:

```text
INSTANCE=WORM-WG
ASSIGNED_INTERFACE=WORM_WG
WAN_IP=162.55.6.173
LISTEN_PORT=51820
WG_TUNNEL=10.66.66.1/24
WORM_OS_ADDRESS=10.66.66.2/32
MTU=1420
MSS=1380
DNS=10.66.66.1
```

Prerequisiti locali:

- `/opt/worm/network/config/secrets.env` con `OPNSENSE_SSH_HOST`, `OPNSENSE_SSH_USER`, `OPNSENSE_SSH_PORT`.
- `WORM_OS_PUBLIC_KEY` esportata nell'ambiente oppure passata da secret locale non versionato.
- Plugin WireGuard presente su OPNsense e comando `wg` disponibile lato OPNsense.

Apply:

```sh
WORM_OS_PUBLIC_KEY='...' /opt/worm/patches/wireguard-opnsense-public-v001/apply.sh
```

Audit:

```sh
/opt/worm/patches/wireguard-opnsense-public-v001/audit.sh
```

Output audit:

```text
/opt/worm/logs/wireguard-opnsense-public-v001.log
```

Regole di sicurezza:

- Le private key OPNsense/Worm OS non vengono stampate.
- La private key OPNsense viene generata su OPNsense e resta in `/conf/config.xml`.
- La private key Worm OS non deve essere inserita nell'immagine GrapheneOS.
- `/opt/worm/keys` deve restare `0700`; eventuali file con private key devono restare `0600`.
- Eventuali backup completi di `/conf/config.xml` vengono salvati solo in
  `/opt/worm/keys/opnsense-backup/wireguard-opnsense-public-v001/`, mai sotto
  `/opt/worm/patches`.
