"""Persistencia en SQLite: runs, anti-repeticion, cola y analytics."""
from __future__ import annotations

import hashlib
import json
import sqlite3
import time
from pathlib import Path
from typing import Any

from .config import DB_PATH

SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    format TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'created',
    canonical_topic TEXT,
    angle TEXT,
    series_id TEXT,
    uniqueness_hash TEXT,
    title TEXT,
    description TEXT,
    tags TEXT,
    video_path TEXT,
    thumbnail_path TEXT,
    youtube_video_id TEXT,
    error TEXT,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER,
    stage TEXT NOT NULL,
    message TEXT NOT NULL,
    meta TEXT,
    ts REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL,
    publish_at TEXT,
    done INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS analytics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    youtube_video_id TEXT NOT NULL,
    metric TEXT NOT NULL,
    value REAL NOT NULL,
    fetched_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS hook_insights (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    insight TEXT NOT NULL,
    source TEXT,
    created_at REAL NOT NULL
);
"""


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn


def uniqueness_hash(topic: str, angle: str) -> str:
    base = f"{topic.strip().lower()}::{angle.strip().lower()}"
    return hashlib.sha256(base.encode("utf-8")).hexdigest()[:16]


def create_run(conn: sqlite3.Connection, slug: str, fmt: str) -> int:
    now = time.time()
    cur = conn.execute(
        "INSERT INTO runs (slug, format, created_at, updated_at) VALUES (?,?,?,?)",
        (slug, fmt, now, now),
    )
    conn.commit()
    return int(cur.lastrowid)


def update_run(conn: sqlite3.Connection, run_id: int, **fields: Any) -> None:
    fields["updated_at"] = time.time()
    cols = ", ".join(f"{k}=?" for k in fields)
    conn.execute(f"UPDATE runs SET {cols} WHERE id=?", (*fields.values(), run_id))
    conn.commit()


def log_event(conn: sqlite3.Connection, run_id: int | None, stage: str,
              message: str, meta: dict | None = None) -> None:
    conn.execute(
        "INSERT INTO events (run_id, stage, message, meta, ts) VALUES (?,?,?,?,?)",
        (run_id, stage, message, json.dumps(meta or {}), time.time()),
    )
    conn.commit()


def recent_topics(conn: sqlite3.Connection, days: int) -> list[dict]:
    cutoff = time.time() - days * 86400
    rows = conn.execute(
        "SELECT canonical_topic, angle, series_id FROM runs "
        "WHERE created_at > ? AND canonical_topic IS NOT NULL",
        (cutoff,),
    ).fetchall()
    return [dict(r) for r in rows]


def is_duplicate(conn: sqlite3.Connection, topic: str, angle: str) -> bool:
    h = uniqueness_hash(topic, angle)
    row = conn.execute(
        "SELECT 1 FROM runs WHERE uniqueness_hash = ? LIMIT 1", (h,)
    ).fetchone()
    return row is not None


def hook_feedback(conn: sqlite3.Connection, limit: int = 8) -> list[str]:
    rows = conn.execute(
        "SELECT insight FROM hook_insights ORDER BY created_at DESC LIMIT ?",
        (limit,),
    ).fetchall()
    return [r["insight"] for r in rows]
