#!/usr/bin/env python3
import argparse
import json
import os
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

TZ = ZoneInfo("Europe/Rome")
PORTAL_ROOT = Path(__file__).resolve().parents[1]
DB_PATH = PORTAL_ROOT / "timeline" / "timeline.db"
PUBLIC_JSON = PORTAL_ROOT / "public-data" / "timeline.json"
LOGS_URL = "https://logs.coffee.pm/"

SOURCE_ROOTS = [
    Path("/opt/worm/logs"),
    Path("/opt/worm/backups"),
    Path("/opt/worm/patches"),
    Path("/opt/worm/artifacts"),
    Path("/opt/worm/apps"),
    Path("/opt/worm/releases"),
]

BLOCKED = re.compile(
    r"(?:^|/)(?:keys?|\.git|\.gradle|\.kotlin|node_modules|build|__pycache__)(?:/|$)|"
    r"(?:credential|secret|password|passwd|token|keystore|key\.properties|"
    r"keystore\.properties|auth\.env|\.env|id_rsa|id_ed25519|wg.*private|"
    r"privkey|private[-_ ]?key|\.pk8$|\.pem$|\.jks$)",
    re.IGNORECASE,
)

CATEGORIES = {
    "logs": "SYSTEM",
    "backups": "BACKUP",
    "patches": "PATCH",
    "artifacts": "BUILD",
    "apps": "APP",
    "releases": "RELEASE",
}

GROUPS = {
    "SYSTEM": "system",
    "APP": "apps",
    "BUILD": "builds",
    "PATCH": "patches",
    "RELEASE": "releases",
    "OTA": "releases",
    "NETWORK": "network",
    "BACKUP": "system",
    "SECURITY": "system",
    "AUDIT": "system",
}

TIME_PATTERNS = [
    re.compile(r"(20\d{6})[-_ ]?(\d{6})"),
    re.compile(r"(20\d{6})[-_ ]?(\d{4})"),
    re.compile(r"(20\d{2})[-_]?(\d{2})[-_]?(\d{2})[-_ T]?(\d{2})?[-_:]?(\d{2})?[-_:]?(\d{2})?"),
]


def safe_text(value, limit=180):
    text = re.sub(r"[\x00-\x1f]+", " ", str(value))
    text = re.sub(r"/opt/worm/[^\s]+", "[internal path]", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:limit].rstrip()


def infer_dt(path, stat_result):
    name = path.name
    now = datetime.now(TZ)

    def plausible(value):
        if value.year < 2020:
            return None
        if value > now.replace(microsecond=0) and (value - now).days > 1:
            return None
        return value

    for pattern in TIME_PATTERNS:
        match = pattern.search(name)
        if not match:
            continue
        groups = match.groups()
        try:
            if len(groups[0]) == 8:
                date = groups[0]
                time = (groups[1] or "000000").ljust(6, "0")
                value = datetime.strptime(f"{date}{time}", "%Y%m%d%H%M%S").replace(tzinfo=TZ)
                if plausible(value):
                    return value
                continue
            year, month, day, hour, minute, second = groups
            value = datetime(
                int(year),
                int(month),
                int(day),
                int(hour or 0),
                int(minute or 0),
                int(second or 0),
                tzinfo=TZ,
            )
            if plausible(value):
                return value
        except ValueError:
            continue
    return datetime.fromtimestamp(stat_result.st_mtime, TZ)


def category_for(root, rel):
    first = root.name
    joined = "/".join(rel.parts).lower()
    if "network" in joined or "caddy" in joined or "nginx" in joined or "opnsense" in joined:
        return "NETWORK"
    if "audit" in joined or "report" in joined:
        return "AUDIT"
    if "ota" in joined:
        return "OTA"
    if "sign" in joined or "newkey" in joined or "samekey" in joined:
        return "SECURITY"
    if "machinallm" in joined:
        return "BUILD"
    if first == "apps":
        return "APP"
    return CATEGORIES.get(first, "SYSTEM")


def title_for(path, rel, category):
    stem = path.stem
    cleaned = re.sub(r"[-_]?20\d{6}(?:[-_ ]?\d{4,6})?", "", stem)
    cleaned = cleaned.replace("_", " ").replace("-", " ")
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if not cleaned:
        cleaned = rel.parts[0] if rel.parts else path.name
    if "machinallm" in cleaned.lower():
        return "MachinaLLM build update"
    if "webusb" in cleaned.lower():
        return "WebUSB change"
    if category == "OTA":
        return "OTA release update"
    if category == "BACKUP":
        return "Backup captured"
    if category == "AUDIT":
        return "Audit report updated"
    if category == "NETWORK":
        return "Network/server change"
    return cleaned.title()


def description_for(root, rel, category):
    location = rel.parent.as_posix()
    if location == ".":
        location = root.name
    templates = {
        "SYSTEM": "System maintenance record indexed from WORM logs.",
        "APP": "Application repository activity indexed for the private portal.",
        "BUILD": "Build artifact or build log indexed for WORM project activity.",
        "PATCH": "Patch bundle or patch log registered in the WORM workspace.",
        "RELEASE": "Release artifact activity indexed for private distribution.",
        "OTA": "OTA package or OTA tooling activity indexed for private distribution.",
        "NETWORK": "Server or network maintenance activity recorded in WORM logs.",
        "BACKUP": "Backup snapshot registered for portal activity tracking.",
        "SECURITY": "Signing or key-related workflow record indexed without exposing key material.",
        "AUDIT": "Audit/report artifact indexed for project traceability.",
    }
    return f"{templates.get(category, templates['SYSTEM'])} Source: {safe_text(location, 64)}."


def status_for(path, category):
    name = path.name.lower()
    if any(word in name for word in ("fail", "error", "anomal", "root-cause")):
        return "Review"
    if any(word in name for word in ("success", "final", "complete", "ready", "release")):
        return "Complete"
    if category in {"AUDIT", "NETWORK", "SECURITY"}:
        return "Recorded"
    return None


def log_link(root, rel):
    if root.name != "logs":
        return None
    query = rel.as_posix()
    if BLOCKED.search(query):
        return None
    return {
        "url": f"{LOGS_URL}?q={query}",
        "label": "Open log",
    }


def iter_candidates():
    seen = set()
    for root in SOURCE_ROOTS:
        if not root.exists():
            continue
        for current, dirnames, filenames in os.walk(root):
            current_path = Path(current)
            dirnames[:] = [
                name for name in dirnames
                if not BLOCKED.search((current_path / name).as_posix())
            ]
            for filename in filenames:
                path = current_path / filename
                path_text = path.as_posix()
                if BLOCKED.search(path_text):
                    continue
                try:
                    stat_result = path.stat()
                except OSError:
                    continue
                if not path.is_file():
                    continue
                real = path.resolve()
                if real in seen:
                    continue
                seen.add(real)
                rel = path.relative_to(root)
                yield root, rel, path, stat_result


def build_events(limit):
    events = []
    for root, rel, path, stat_result in iter_candidates():
        category = category_for(root, rel)
        dt = infer_dt(path, stat_result)
        link = log_link(root, rel)
        event_id = re.sub(r"[^a-z0-9]+", "-", f"{root.name}-{rel.as_posix()}".lower()).strip("-")
        events.append({
            "id": event_id[:96],
            "timestamp": dt.astimezone(TZ).isoformat(),
            "date": dt.strftime("%d %b %Y").lstrip("0"),
            "time": dt.strftime("%H:%M %Z"),
            "title": safe_text(title_for(path, rel, category), 96),
            "category": category,
            "group": GROUPS.get(category, "system"),
            "description": safe_text(description_for(root, rel, category)),
            "status": status_for(path, category),
            "link": link,
        })
    events.sort(key=lambda item: item["timestamp"], reverse=True)
    return events[:limit]


def write_db(events):
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("""
            create table if not exists timeline_events (
                id text primary key,
                timestamp text not null,
                date text not null,
                time text not null,
                title text not null,
                category text not null,
                event_group text not null,
                description text not null,
                status text,
                link_url text,
                link_label text
            )
        """)
        conn.execute("delete from timeline_events")
        conn.executemany(
            """
            insert into timeline_events (
                id, timestamp, date, time, title, category, event_group,
                description, status, link_url, link_label
            ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    event["id"],
                    event["timestamp"],
                    event["date"],
                    event["time"],
                    event["title"],
                    event["category"],
                    event["group"],
                    event["description"],
                    event["status"],
                    event["link"]["url"] if event["link"] else None,
                    event["link"]["label"] if event["link"] else None,
                )
                for event in events
            ],
        )


def write_json(events):
    PUBLIC_JSON.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generatedAt": datetime.now(timezone.utc).astimezone(TZ).isoformat(),
        "timezone": "Europe/Rome",
        "events": events,
    }
    PUBLIC_JSON.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description="Build the WORM private portal timeline.")
    parser.add_argument("--limit", type=int, default=240)
    args = parser.parse_args()
    events = build_events(args.limit)
    write_db(events)
    write_json(events)
    print(f"Timeline events: {len(events)}")
    print(f"Timeline DB: {DB_PATH}")
    print(f"Timeline JSON: {PUBLIC_JSON}")


if __name__ == "__main__":
    main()
