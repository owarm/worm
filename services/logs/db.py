import os
import sqlite3
from pathlib import Path
from zoneinfo import ZoneInfo
from datetime import datetime

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "data" / "logs.sqlite3"
LOG_ROOT = Path("/opt/worm/logs").resolve()
RUNS_ROOT = (LOG_ROOT / "runs").resolve()
TZ = ZoneInfo("Europe/Rome")

SOURCES = {"codex", "bash", "shell", "patch", "build", "audit"}
STATUSES = {"running", "success", "failed"}


def now_iso() -> str:
    return datetime.now(TZ).isoformat(timespec="seconds")


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                uuid TEXT NOT NULL UNIQUE,
                source TEXT NOT NULL,
                title TEXT NOT NULL,
                command TEXT NOT NULL,
                hostname TEXT NOT NULL,
                username TEXT NOT NULL,
                cwd TEXT NOT NULL,
                started_at TEXT NOT NULL,
                ended_at TEXT,
                timezone TEXT NOT NULL,
                status TEXT NOT NULL,
                exit_code INTEGER,
                log_file TEXT NOT NULL,
                bytes INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_runs_started_at ON runs(started_at DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_runs_source ON runs(source)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status)")


def inside_log_root(path: str | Path) -> bool:
    try:
        Path(path).resolve().relative_to(LOG_ROOT)
        return True
    except ValueError:
        return False


def inside_runs_root(path: str | Path) -> bool:
    try:
        Path(path).resolve().relative_to(RUNS_ROOT)
        return True
    except ValueError:
        return False


def import_existing_logs() -> int:
    init_db()
    imported = 0
    hostname = os.uname().nodename
    username = "legacy"
    with connect() as conn:
        known = {row["log_file"] for row in conn.execute("SELECT log_file FROM runs")}
        for path in sorted(LOG_ROOT.rglob("*.log")):
            if not path.is_file() or not inside_log_root(path):
                continue
            log_file = str(display_path_for_log(path))
            if log_file in known:
                continue
            stat = path.stat()
            dt = datetime.fromtimestamp(stat.st_mtime, TZ).isoformat(timespec="seconds")
            title = path.stem
            source = infer_source(title)
            conn.execute(
                """
                INSERT INTO runs
                    (uuid, source, title, command, hostname, username, cwd, started_at,
                     ended_at, timezone, status, exit_code, log_file, bytes, created_at)
                VALUES
                    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    f"legacy-{stat.st_ino}-{stat.st_mtime_ns}",
                    source,
                    title,
                    "",
                    hostname,
                    username,
                    "",
                    dt,
                    dt,
                    "Europe/Rome",
                    "success",
                    0,
                    log_file,
                    stat.st_size,
                    now_iso(),
                ),
            )
            imported += 1
    return imported


def display_path_for_log(path: Path) -> Path:
    path = path.resolve()
    if inside_runs_root(path):
        return path
    stat = path.stat()
    dt = datetime.fromtimestamp(stat.st_mtime, TZ)
    safe_name = "".join(ch if ch.isalnum() or ch in "._-" else "-" for ch in path.name)
    link_dir = RUNS_ROOT / "legacy" / dt.strftime("%Y") / dt.strftime("%m") / dt.strftime("%d")
    link_dir.mkdir(parents=True, exist_ok=True)
    link = link_dir / f"{dt.strftime('%H%M%S')}-{safe_name}"
    if link.exists():
        return link.resolve()
    os.link(path, link)
    return link.resolve()


def normalize_legacy_paths() -> int:
    init_db()
    changed = 0
    with connect() as conn:
        rows = conn.execute("SELECT id, log_file FROM runs").fetchall()
        for row in rows:
            path = Path(row["log_file"])
            if not path.exists() or inside_runs_root(path):
                continue
            new_path = display_path_for_log(path)
            conn.execute("UPDATE runs SET log_file = ? WHERE id = ?", (str(new_path), row["id"]))
            changed += 1
    return changed


def infer_source(title: str) -> str:
    lower = title.lower()
    if "audit" in lower:
        return "audit"
    if "patch" in lower:
        return "patch"
    if "build" in lower or "release" in lower or "sync" in lower:
        return "build"
    return "shell"
