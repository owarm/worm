#!/usr/bin/env python3
import argparse
import os
import re
import shlex
import socket
import subprocess
import sys
import uuid
from datetime import datetime
from pathlib import Path

from db import RUNS_ROOT, SOURCES, connect, init_db, now_iso

SECRET_PATTERNS = [
    re.compile(r"(?i)(API[_-]?KEY\s*[=:]\s*)([^\s'\"&]+)"),
    re.compile(r"(?i)(PASSWORD\s*[=:]\s*)([^\s'\"&]+)"),
    re.compile(r"(?i)(TOKEN\s*[=:]\s*)([^\s'\"&]+)"),
    re.compile(r"(?i)(SECRET\s*[=:]\s*)([^\s'\"&]+)"),
    re.compile(r"(?i)(Bearer\s+)([A-Za-z0-9._~+/=-]+)"),
]


def redact(text: str) -> str:
    for pattern in SECRET_PATTERNS:
        text = pattern.sub(lambda m: m.group(1) + "[REDACTED]", text)
    return text


def slugify(value: str) -> str:
    value = re.sub(r"[^A-Za-z0-9._-]+", "-", value.strip()).strip("-")
    return value[:80] or "run"


def main() -> int:
    parser = argparse.ArgumentParser(prog="worm-run")
    parser.add_argument("--source", required=True, choices=sorted(SOURCES))
    parser.add_argument("--title", required=True)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command
    if command and command[0] == "--":
        command = command[1:]
    if not command:
        parser.error("missing command")

    init_db()
    run_uuid = str(uuid.uuid4())
    started = now_iso()
    dt = datetime.fromisoformat(started)
    log_dir = RUNS_ROOT / dt.strftime("%Y") / dt.strftime("%m") / dt.strftime("%d")
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / f"{dt.strftime('%H%M%S')}-{slugify(args.title)}-{run_uuid[:8]}.log"
    display_command = redact(" ".join(shlex.quote(part) for part in command))

    with connect() as conn:
        cur = conn.execute(
            """
            INSERT INTO runs
                (uuid, source, title, command, hostname, username, cwd, started_at,
                 ended_at, timezone, status, exit_code, log_file, bytes, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                run_uuid,
                args.source,
                args.title,
                display_command,
                socket.gethostname(),
                os.environ.get("USER") or os.environ.get("LOGNAME") or "",
                os.getcwd(),
                started,
                None,
                "Europe/Rome",
                "running",
                None,
                str(log_file),
                0,
                started,
            ),
        )
        run_id = cur.lastrowid

    exit_code = 127
    try:
        with log_file.open("wb") as out:
            proc = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
            assert proc.stdout is not None
            for chunk in iter(lambda: proc.stdout.read(8192), b""):
                out.write(chunk)
                out.flush()
                sys.stdout.buffer.write(chunk)
                sys.stdout.buffer.flush()
            exit_code = proc.wait()
    finally:
        status = "success" if exit_code == 0 else "failed"
        ended = now_iso()
        size = log_file.stat().st_size if log_file.exists() else 0
        with connect() as conn:
            conn.execute(
                "UPDATE runs SET ended_at = ?, exit_code = ?, status = ?, bytes = ? WHERE id = ?",
                (ended, exit_code, status, size, run_id),
            )
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
