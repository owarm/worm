# worm-logs-v001

Dynamic Worm OS log viewer for `logs.coffee.pm`.

- Python WSGI service in `/opt/worm/services/logs`
- SQLite metadata database in `/opt/worm/services/logs/data/logs.sqlite3`
- New run logs in `/opt/worm/logs/runs/YYYY/MM/DD/`
- Global runner: `/usr/local/bin/worm-run`
- Gunicorn service: `worm-logs.service` on `127.0.0.1:8765`
- nginx reverse proxy follows the existing VPN-only `10.90.0.0/16` policy when available.

The browser output redacts visible secret-like patterns. Original log files are not modified.
