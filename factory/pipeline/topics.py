"""Seleccion de tema con anti-repeticion (canonical_topic + angle + hash)."""
from __future__ import annotations

import random
import sqlite3

from .. import db
from ..config import Settings
from ..llm import generate
from ..utils import log

PROMPT = """You are the editorial director of "{name}" — {niche}

Today's series format: "{series_label}" — {series_angle}

These topics/angles were used recently and must be AVOIDED (no near-duplicates either):
{recent}

Banned topics: {banned}

Propose 5 topic candidates for a {fmt} video. Each must be:
- evergreen (interesting in 5 years)
- specific (a concrete event, decision, system or person — not a vague theme)
- high curiosity potential for a general audience

Return ONLY a JSON array of topic candidates:
[{{"canonical_topic": "...", "angle": "...", "series_id": "{series_id}"}}]
"""


def select_topic(settings: Settings, conn: sqlite3.Connection) -> dict:
    cooldown = int(settings.ch("editorial", "topic_cooldown_days", default=180))
    recent = db.recent_topics(conn, cooldown)
    recent_txt = "\n".join(f"- {r['canonical_topic']} ({r['angle']})" for r in recent) or "- none yet"

    series_list = settings.ch("editorial", "series", default=[])
    used_series = [r["series_id"] for r in recent[-3:]]
    candidates_series = [s for s in series_list if s["id"] not in used_series] or series_list
    series = random.choice(candidates_series)

    prompt = PROMPT.format(
        name=settings.ch("channel", "name"),
        niche=settings.ch("channel", "niche"),
        series_label=series["label"],
        series_angle=series["angle"],
        series_id=series["id"],
        recent=recent_txt,
        banned=", ".join(settings.ch("editorial", "banned_topics", default=[])) or "none",
        fmt=settings.fmt,
    )
    candidates = generate(settings, prompt)
    if isinstance(candidates, dict):
        candidates = [candidates]

    for cand in candidates:
        topic = str(cand.get("canonical_topic", "")).strip()
        angle = str(cand.get("angle", "")).strip()
        if topic and angle and (settings.simulate or not db.is_duplicate(conn, topic, angle)):
            cand["series_id"] = cand.get("series_id") or series["id"]
            cand["uniqueness_hash"] = db.uniqueness_hash(topic, angle)
            log("topics", "tema elegido", topic=topic, angle=angle)
            return cand
    raise RuntimeError("Ningun candidato de tema paso el fi