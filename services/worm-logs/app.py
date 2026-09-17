from __future__ import annotations

import os
import re
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Iterable
from zoneinfo import ZoneInfo

from flask import Flask, abort, jsonify, render_template_string, request, url_for


APP_ROOT = Path("/opt/worm/services/worm-logs")
LOG_ROOT = Path("/opt/worm/logs")
DB_PATH = APP_ROOT / "logs.sqlite3"
TZ_NAME = "Europe/Rome"
TZ = ZoneInfo(TZ_NAME)
MAX_VIEW_BYTES = 256 * 1024
MAX_SEARCH_BYTES = 1024 * 1024
DEFAULT_LIMIT = 100
MAX_LIMIT = 500

SECRET_PATTERNS = [
    re.compile(r"(?i)(password|passwd|token|secret|api[_-]?key|api[_-]?secret|credential)(\s*[:=]\s*)([^\s'\";]+)"),
    re.compile(r"(?i)(authorization\s*:\s*bearer\s+)([a-z0-9._~+/-]+=*)"),
    re.compile(r"(?i)(private[_ -]?key)(\s*[:=]\s*)(.+)"),
]
PATCH_RE = re.compile(r"([a-z0-9]+(?:-[a-z0-9]+)*-v[0-9]{3,})", re.I)

app = Flask(__name__)


def now_rome() -> datetime:
    return datetime.now(TZ)


def connect_db() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            relpath TEXT NOT NULL UNIQUE,
            category TEXT NOT NULL,
            patch TEXT NOT NULL,
            filename TEXT NOT NULL,
            size INTEGER NOT NULL,
            mtime REAL NOT NULL,
            log_date TEXT NOT NULL,
            log_time TEXT NOT NULL,
            timezone TEXT NOT NULL,
            indexed_at TEXT NOT NULL
        )
        """
    )
    con.execute("CREATE INDEX IF NOT EXISTS idx_logs_mtime ON logs(mtime DESC)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_logs_category ON logs(category)")
    return con


def resolve_log_path(relpath: str) -> Path:
    base = LOG_ROOT.resolve()
    target = (LOG_ROOT / relpath).resolve()
    if os.path.commonpath([str(base), str(target)]) != str(base):
        abort(403)
    return target


def iter_log_files() -> Iterable[Path]:
    for path in LOG_ROOT.rglob("*"):
        try:
            if path.is_file() and not path.is_symlink():
                yield path
        except OSError:
            continue


def infer_patch(relpath: str, filename: str, category: str) -> str:
    match = PATCH_RE.search(relpath)
    if match:
        return match.group(1)
    if category in {"caddy", "nginx", "system", "bash", "build"}:
        return category
    stem = Path(filename).stem
    return stem[:80] if stem else "unknown"


def index_logs() -> None:
    con = connect_db()
    seen: set[str] = set()
    indexed_at = now_rome().isoformat()

    for path in iter_log_files():
        try:
            stat = path.stat()
            relpath = path.relative_to(LOG_ROOT).as_posix()
        except (OSError, ValueError):
            continue

        parts = relpath.split("/", 1)
        category = parts[0] if len(parts) > 1 else "root"
        filename = path.name
        patch = infer_patch(relpath, filename, category)
        mtime = datetime.fromtimestamp(stat.st_mtime, TZ)
        seen.add(relpath)

        con.execute(
            """
            INSERT INTO logs (
                relpath, category, patch, filename, size, mtime,
                log_date, log_time, timezone, indexed_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(relpath) DO UPDATE SET
                category=excluded.category,
                patch=excluded.patch,
                filename=excluded.filename,
                size=excluded.size,
                mtime=excluded.mtime,
                log_date=excluded.log_date,
                log_time=excluded.log_time,
                timezone=excluded.timezone,
                indexed_at=excluded.indexed_at
            """,
            (
                relpath,
                category,
                patch,
                filename,
                stat.st_size,
                stat.st_mtime,
                mtime.strftime("%Y-%m-%d"),
                mtime.strftime("%H:%M:%S"),
                TZ_NAME,
                indexed_at,
            ),
        )

    rows = con.execute("SELECT relpath FROM logs").fetchall()
    for row in rows:
        if row["relpath"] not in seen:
            con.execute("DELETE FROM logs WHERE relpath = ?", (row["relpath"],))

    con.commit()
    con.close()


def categories() -> list[str]:
    con = connect_db()
    rows = con.execute("SELECT DISTINCT category FROM logs ORDER BY category").fetchall()
    con.close()
    return [row["category"] for row in rows]


def clamp_limit(raw: str | None) -> int:
    try:
        value = int(raw or DEFAULT_LIMIT)
    except ValueError:
        return DEFAULT_LIMIT
    return max(1, min(value, MAX_LIMIT))


def contains_query(path: Path, query: str) -> bool:
    if not query:
        return True
    needle = query.lower()
    try:
        with path.open("rb") as handle:
            chunk = handle.read(MAX_SEARCH_BYTES)
    except OSError:
        return False
    text = chunk.decode("utf-8", errors="replace").lower()
    return needle in text


def redact(text: str) -> str:
    redacted = text
    for pattern in SECRET_PATTERNS:
        if pattern.groups >= 3:
            redacted = pattern.sub(r"\1\2[REDACTED]", redacted)
        else:
            redacted = pattern.sub(r"\1[REDACTED]", redacted)
    return redacted


def read_limited(path: Path) -> tuple[str, bool]:
    size = path.stat().st_size
    truncated = size > MAX_VIEW_BYTES
    with path.open("rb") as handle:
        if truncated:
            handle.seek(-MAX_VIEW_BYTES, os.SEEK_END)
        data = handle.read(MAX_VIEW_BYTES)
    return data.decode("utf-8", errors="replace"), truncated


INDEX_TEMPLATE = """
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Worm Logs</title>
<style>
:root { color-scheme: dark; }
body { margin: 0; background: #111; color: #e8e8e8; font: 14px/1.45 system-ui, sans-serif; }
main { max-width: 1180px; margin: 0 auto; padding: 28px 18px 48px; }
h1 { margin: 0 0 20px; font-size: 24px; font-weight: 700; }
form { display: grid; grid-template-columns: minmax(180px, 1fr) 180px 110px auto; gap: 10px; margin-bottom: 18px; }
input, select, button { background: #1b1b1b; color: #f3f3f3; border: 1px solid #3a3a3a; border-radius: 6px; padding: 9px 10px; }
button { cursor: pointer; background: #253527; border-color: #45664a; }
table { width: 100%; border-collapse: collapse; background: #151515; }
th, td { border-bottom: 1px solid #2b2b2b; padding: 9px 8px; text-align: left; vertical-align: top; }
th { color: #b7c7b7; font-size: 12px; text-transform: uppercase; }
a { color: #9fc6ff; text-decoration: none; }
a:hover { text-decoration: underline; }
.muted { color: #aaa; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
@media (max-width: 760px) {
  form { grid-template-columns: 1fr; }
  table, thead, tbody, tr, th, td { display: block; }
  thead { display: none; }
  tr { border-bottom: 1px solid #333; padding: 10px 0; }
  td { border: 0; padding: 4px 0; }
  .num { text-align: left; }
}
</style>
</head>
<body>
<main>
<h1>Worm Logs</h1>
<form method="get" action="/">
  <input name="q" value="{{ q }}" placeholder="Search text or filename">
  <select name="category">
    <option value="">All categories</option>
    {% for item in categories %}
    <option value="{{ item }}" {% if item == category %}selected{% endif %}>{{ item }}</option>
    {% endfor %}
  </select>
  <input name="limit" value="{{ limit }}" inputmode="numeric" aria-label="limit">
  <button type="submit">Search</button>
</form>
<table>
<thead><tr><th>Timestamp</th><th>Category</th><th>Patch</th><th>File</th><th class="num">Size</th></tr></thead>
<tbody>
{% for row in rows %}
<tr>
  <td>{{ row["log_date"] }} {{ row["log_time"] }} <span class="muted">{{ row["timezone"] }}</span></td>
  <td>{{ row["category"] }}</td>
  <td>{{ row["patch"] }}</td>
  <td><a href="{{ url_for('show_log', log_id=row['id']) }}">{{ row["relpath"] }}</a></td>
  <td class="num">{{ "{:,}".format(row["size"]) }}</td>
</tr>
{% endfor %}
</tbody>
</table>
</main>
</body>
</html>
"""

LOG_TEMPLATE = """
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{ row["filename"] }} - Worm Logs</title>
<style>
:root { color-scheme: dark; }
body { margin: 0; background: #111; color: #e8e8e8; font: 14px/1.45 system-ui, sans-serif; }
main { max-width: 1180px; margin: 0 auto; padding: 28px 18px 48px; }
a { color: #9fc6ff; text-decoration: none; }
.meta { color: #bbb; margin: 10px 0 18px; }
.notice { background: #2b2415; color: #ffd78a; padding: 10px 12px; border: 1px solid #6a531d; border-radius: 6px; margin-bottom: 14px; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; background: #151515; border: 1px solid #2b2b2b; border-radius: 6px; padding: 14px; }
</style>
</head>
<body>
<main>
<a href="/">Back</a>
<h1>{{ row["relpath"] }}</h1>
<div class="meta">{{ row["log_date"] }} {{ row["log_time"] }} {{ row["timezone"] }} | {{ "{:,}".format(row["size"]) }} bytes | {{ row["category"] }} | {{ row["patch"] }}</div>
{% if truncated %}<div class="notice">Large file: showing the last {{ max_bytes }} bytes only.</div>{% endif %}
<pre>{{ content }}</pre>
</main>
</body>
</html>
"""


@app.after_request
def add_security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=()"
    return response


@app.route("/")
def index():
    index_logs()
    q = request.args.get("q", "").strip()
    category = request.args.get("category", "").strip()
    limit = clamp_limit(request.args.get("limit"))

    sql = "SELECT * FROM logs WHERE 1=1"
    params: list[object] = []
    if category:
        sql += " AND category = ?"
        params.append(category)
    if q:
        like = f"%{q}%"
        sql += " AND (relpath LIKE ? OR filename LIKE ? OR patch LIKE ?)"
        params.extend([like, like, like])
    sql += " ORDER BY mtime DESC LIMIT ?"
    params.append(limit)

    con = connect_db()
    rows = con.execute(sql, params).fetchall()

    if q:
        placeholders = ",".join("?" for _ in rows) or "''"
        extra = con.execute(
            f"SELECT * FROM logs WHERE relpath NOT IN ({placeholders}) ORDER BY mtime DESC LIMIT ?",
            [row["relpath"] for row in rows] + [limit],
        ).fetchall()
        combined = list(rows)
        for row in extra:
            if len(combined) >= limit:
                break
            if category and row["category"] != category:
                continue
            if contains_query(resolve_log_path(row["relpath"]), q):
                combined.append(row)
        rows = combined

    con.close()
    return render_template_string(
        INDEX_TEMPLATE,
        rows=rows,
        categories=categories(),
        q=q,
        category=category,
        limit=limit,
    )


@app.route("/log/<int:log_id>")
def show_log(log_id: int):
    index_logs()
    con = connect_db()
    row = con.execute("SELECT * FROM logs WHERE id = ?", (log_id,)).fetchone()
    con.close()
    if row is None:
        abort(404)

    path = resolve_log_path(row["relpath"])
    if not path.is_file():
        abort(404)

    try:
        content, truncated = read_limited(path)
    except OSError:
        abort(404)

    return render_template_string(
        LOG_TEMPLATE,
        row=row,
        content=redact(content),
        truncated=truncated,
        max_bytes=MAX_VIEW_BYTES,
    )


@app.route("/health")
def health():
    return jsonify(
        {
            "status": "ok",
            "timezone": TZ_NAME,
            "time": now_rome().isoformat(),
        }
    )


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8300)
