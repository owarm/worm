# WORM Network V004 Result

Applied at: `2026-09-15 16:57 Europe/Rome`

Detected native stack:

```text
systemd-networkd=inactive
NetworkManager=inactive
ifupdown=active
netplan=absent
```

Backup:

```text
/opt/worm/network/backup/network-20260915-165728/
```

Runtime verification:

```text
enp9s0           UP 162.55.6.173/26 2a01:4f8:252:7ee::2/64
enp9s0.4000      UP 10.20.1.2/24
default via 162.55.6.129 dev enp9s0 onlink
10.20.1.0/24 dev enp9s0.4000 proto kernel scope link src 10.20.1.2
```

VLAN detail:

```text
interface=enp9s0.4000
vlan_id=4000
mtu=1400
parent=enp9s0
```

Ping:

```text
10.20.1.1: no reply
10.20.0.2: no reply
```

Note:

```text
The public interface was not modified. It was already configured/running as
162.55.6.173/26 with default gateway 162.55.6.129, and remains unchanged.
```
