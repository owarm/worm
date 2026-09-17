import html
import json
import re
import sqlite3
from datetime import datetime
from pathlib import Path
from string import Template
from urllib.parse import parse_qs

from db import DB_PATH, RUNS_ROOT, SOURCES, STATUSES, TZ, connect, import_existing_logs, init_db, inside_runs_root

SECRET_PATTERNS = [
    re.compile(r"(?i)(API[_-]?KEY\s*[=:]\s*)([^\s'\"&]+)"),
    re.compile(r"(?i)(PASSWORD\s*[=:]\s*)([^\s'\"&]+)"),
    re.compile(r"(?i)(TOKEN\s*[=:]\s*)([^\s'\"&]+)"),
    re.compile(r"(?i)(SECRET\s*[=:]\s*)([^\s'\"&]+)"),
    re.compile(r"(?i)(Bearer\s+)([A-Za-z0-9._~+/=-]+)"),
]

BASE_DIR = Path(__file__).resolve().parent
TAIL_BYTES = 160 * 1024


def redact(text: str) -> str:
    for pattern in SECRET_PATTERNS:
        text = pattern.sub(lambda m: m.group(1) + "[REDACTED]", text)
    return text


def esc(value) -> str:
    return html.escape("" if value is None else str(value), quote=True)


def render_template(name: str, **ctx) -> bytes:
    raw = (BASE_DIR / "templates" / name).read_text(encoding="utf-8")
    return Template(raw).safe_substitute({k: str(v) for k, v in ctx.items()}).encode("utf-8")


def response(start_response, status: str, body: bytes, content_type: str = "text/html; charset=utf-8", headers=None):
    hdrs = [
        ("Content-Type", content_type),
        ("Content-Length", str(len(body))),
        ("X-Content-Type-Options", "nosniff"),
        ("Referrer-Policy", "no-referrer"),
    ]
    if headers:
        hdrs.extend(headers)
    start_response(status, hdrs)
    return [body]


def fmt_bytes(size: int) -> str:
    size = int(size or 0)
    for unit in ("B", "KiB", "MiB", "GiB"):
        if size < 1024 or unit == "GiB":
            return f"{size:.1f} {unit}" if unit != "B" else f"{size} B"
        size /= 1024


def parse_dt(value: str | None):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value).astimezone(TZ)
    except ValueError:
        return None


def fmt_dt(value: str | None) -> str:
    dt = parse_dt(value)
    return dt.strftime("%Y-%m-%d %H:%M:%S %Z") if dt else ""


def duration(start: str | None, end: str | None) -> str:
    a = parse_dt(start)
    b = parse_dt(end)
    if not a:
        return ""
    if not b:
        b = datetime.now(TZ)
    seconds = max(0, int((b - a).total_seconds()))
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    if h:
        return f"{h}h {m}m {s}s"
    if m:
        return f"{m}m {s}s"
    return f"{s}s"


def get_run(run_id: str):
    try:
        rid = int(run_id)
    except ValueError:
        return None
    with connect() as conn:
        return conn.execute("SELECT * FROM runs WHERE id = ?", (rid,)).fetchone()


def tail_file(path: str, max_bytes: int = TAIL_BYTES):
    real = Path(path).resolve()
    if not inside_runs_root(real):
        raise PermissionError("log path is outside /opt/worm/logs/runs")
    size = real.stat().st_size
    start = max(0, size - max_bytes)
    with real.open("rb") as fh:
        fh.seek(start)
        data = fh.read(max_bytes)
    text = data.decode("utf-8", errors="replace")
    if start:
        text = f"[tail: last {max_bytes} bytes of {size}]\n" + text
    return redact(text), size


def index(environ, start_response):
    query = parse_qs(environ.get("QUERY_STRING", ""), keep_blank_values=True)
    q = query.get("q", [""])[0].strip()
    source = query.get("source", [""])[0].strip()
    status = query.get("status", [""])[0].strip()
    clauses = []
    params = []
    if q:
        clauses.append("(title LIKE ? OR command LIKE ? OR hostname LIKE ? OR cwd LIKE ?)")
        needle = f"%{q}%"
        params.extend([needle, needle, needle, needle])
    if source in SOURCES:
        clauses.append("source = ?")
        params.append(source)
    if status in STATUSES:
        clauses.append("status = ?")
        params.append(status)
    where = "WHERE " + " AND ".join(clauses) if clauses else ""
    sql = f"SELECT * FROM runs {where} ORDER BY started_at DESC, id DESC LIMIT 300"
    with connect() as conn:
        rows = conn.execute(sql, params).fetchall()
    body = []
    for row in rows:
        body.append(
            "<tr>"
            f"<td>{esc(fmt_dt(row['started_at']))}</td>"
            f"<td><a href=\"/run/{row['id']}\">{esc(row['title'])}</a></td>"
            f"<td><span class=\"pill source\">{esc(row['source'])}</span></td>"
            f"<td><span class=\"pill {esc(row['status'])}\">{esc(row['status'])}</span></td>"
            f"<td>{esc(row['exit_code'])}</td>"
            f"<td>{esc(fmt_bytes(row['bytes']))}</td>"
            f"<td>{esc(row['hostname'])}</td>"
            "</tr>"
        )
    options_source = '<option value="">all</option>' + "".join(
        f'<option value="{esc(s)}"{" selected" if s == source else ""}>{esc(s)}</option>' for s in sorted(SOURCES)
    )
    options_status = '<option value="">all</option>' + "".join(
        f'<option value="{esc(s)}"{" selected" if s == status else ""}>{esc(s)}</option>' for s in ("running", "success", "failed")
    )
    return response(
        start_response,
        "200 OK",
        render_template(
            "index.html",
            rows="\n".join(body) or '<tr><td colspan="7" class="empty">No runs found.</td></tr>',
            q=esc(q),
            source_options=options_source,
            status_options=options_status,
            db_path=esc(DB_PATH),
        ),
    )


def detail(environ, start_response, run_id: str):
    run = get_run(run_id)
    if not run:
        return response(start_response, "404 Not Found", b"not found", "text/plain; charset=utf-8")
    try:
        log_text, size = tail_file(run["log_file"])
        log_notice = ""
    except (OSError, PermissionError) as exc:
        log_text = ""
        size = run["bytes"]
        log_notice = f"<p class=\"warn\">{esc(exc)}</p>"
    refresh = '<meta http-equiv="refresh" content="3">' if run["status"] == "running" else ""
    meta = [
        ("id", run["id"]),
        ("uuid", run["uuid"]),
        ("source", run["source"]),
        ("hostname", run["hostname"]),
        ("username", run["username"]),
        ("timezone", run["timezone"]),
        ("log_file", run["log_file"]),
        ("bytes", fmt_bytes(size)),
    ]
    meta_html = "".join(f"<dt>{esc(k)}</dt><dd>{esc(v)}</dd>" for k, v in meta)
    return response(
        start_response,
        "200 OK",
        render_template(
            "detail.html",
            refresh=refresh,
            id=esc(run["id"]),
            title=esc(run["title"]),
            command=esc(redact(run["command"])),
            cwd=esc(run["cwd"]),
            start=esc(fmt_dt(run["started_at"])),
            end=esc(fmt_dt(run["ended_at"])),
            duration=esc(duration(run["started_at"], run["ended_at"])),
            status=esc(run["status"]),
            exit_code=esc(run["exit_code"]),
            metadata=meta_html,
            log_notice=log_notice,
            log=esc(log_text),
        ),
    )


def api_tail(start_response, run_id: str):
    run = get_run(run_id)
    if not run:
        return response(start_response, "404 Not Found", b'{"error":"not found"}', "application/json")
    try:
        text, size = tail_file(run["log_file"])
        payload = {"id": run["id"], "status": run["status"], "bytes": size, "tail": text}
        return response(start_response, "200 OK", json.dumps(payload).encode(), "application/json")
    except PermissionError as exc:
        return response(start_response, "403 Forbidden", json.dumps({"error": str(exc)}).encode(), "application/json")
    except OSError as exc:
        return response(start_response, "404 Not Found", json.dumps({"error": str(exc)}).encode(), "application/json")


def application(environ, start_response):
    init_db()
    path = environ.get("PATH_INFO", "/")
    method = environ.get("REQUEST_METHOD", "GET")
    if method != "GET":
        return response(start_response, "405 Method Not Allowed", b"method not allowed", "text/plain; charset=utf-8")
    if path == "/health":
        return response(start_response, "200 OK", b"ok\n", "text/plain; charset=utf-8")
    if path == "/":
        return index(environ, start_response)
    if path.startswith("/run/"):
        return detail(environ, start_response, path.rsplit("/", 1)[-1])
    if path.startswith("/api/run/") and path.endswith("/tail"):
        parts = path.strip("/").split("/")
        if len(parts) == 4:
            return api_tail(start_response, parts[2])
    return response(start_response, "404 Not Found", b"not found", "text/plain; charset=utf-8")


if __name__ == "__main__":
    import_existing_logs()
    from wsgiref.simple_server import make_server

    with make_server("127.0.0.1", 8765, application) as httpd:
        httpd.serve_forever()
