# worm-network-v004-dedicated-vlan

Configura la VLAN privata Robot vSwitch sul dedicated usando lo stack nativo
`ifupdown`, senza modificare l'interfaccia pubblica `enp9s0` o la default route.

Parametri:

```text
VLAN_ID=4000
PRIVATE_INTERFACE=enp9s0.4000
PRIVATE_IPV4=10.20.1.2/24
MTU=1400
```

Apply:

```sh
/opt/worm/network/patches/worm-network-v004-dedicated-vlan/bin/apply-dedicated-vlan.sh
```

Rollback:

```sh
/opt/worm/network/patches/worm-network-v004-dedicated-vlan/bin/rollback-dedicated-vlan.sh /opt/worm/network/backup/network-YYYYMMDD-HHMMSS
```
