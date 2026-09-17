# worm-network-v006-wireguard

Configura management privato Worm via WireGuard su OPNsense.

Parametri:

```text
WG_NETWORK=10.30.0.0/24
OPNSENSE_WG_IP=10.30.0.1/24
WORM_CLOUD_NET=10.20.0.0/24
WORM_VSWITCH_NET=10.20.1.0/24
DEDICATED_PRIVATE=10.20.1.2
```

Lo script preferisce la API OPNsense WireGuard quando disponibile e non stampa
private key. Prima di ogni modifica deve salvare:

```text
/opt/worm/network/backup/opnsense-config-YYYYMMDD-HHMMSS.xml
```

Apply:

```sh
/opt/worm/network/patches/worm-network-v006-wireguard/bin/apply-wireguard.sh
```

Verify:

```sh
/opt/worm/network/patches/worm-network-v006-wireguard/bin/verify-wireguard.sh
```

La patch e' gated: se OPNsense non e' collegata alla Cloud Network privata
attesa o se la API WireGuard non e' disponibile, termina senza modifiche.
