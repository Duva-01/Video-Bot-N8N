"""Seleccion de tema con anti-repeticion y rotacion de dominio + serie."""
from __future__ import annotations

import random
import sqlite3

from .. import db
from ..config import Settings
from ..llm import generate
from ..utils import log

PROMPT = """You are the editorial director of "{name}" — {niche}

Today's series format: "{series_label}" — {series_angle}

The channel covers MANY domains, not just science: {domains}
Domains used recently (AVOID these today): {recent_domains}

These topics/angles were used recently and must be AVOIDED (no near-duplicates either):
{recent}

Banned topics: {banned}

Propose 5 topic candidates for a {fmt} video, each from a DIFFERENT domain.
Each must be:
- evergreen (interesting in 5 years)
- specific (a concrete event, decision, deal, person, accident or system — not a vague theme)
- high curiosity potential for a general audience
- about something REAL and documented (it will be fact-checked against Wikipedia)

Return ONLY a JSON array:
[{{"canonical_topic": "...", "angle": "...", "domain": "one of the domains", "series_id": "{series_id}"}}]
"""


def select_topic(settings: Settings, conn: sqlite3.Connection) -> dict:
    cooldown = int(settings.ch("editorial", "topic_cooldown_days", default=180))
    recent = db.recent_topics(conn, cooldown)
    recent_txt = "\n".join(f"- {r['canonical_topic']} ({r['angle']})" for r in recent) or "- none yet"

    domains = settings.ch("editorial", "domains", default=["history"]) or ["history"]
    recent_domains = [r.get("domain") for r in recent[-4:] if r.get("domain")]

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
        domains=", ".join(domains),
        recent_domains=", ".join(recent_domains) or "none",
        recent=recent_txt,
        banned=", ".join(settings.ch("editorial", "banned_topics", default=[])) or "none",
        fmt=settings.fmt,
    )
    candidates = generate(settings, prompt)
    if isinstance(candidates, dict):
        candidates = [candidates]

    # prioriza candidatos de dominios no usados recientemente
    def _priority(cand: dict) -> int:
        return 0 if cand.get("domain") in recent_domains else -1

    for cand in sorted([c for c in candidates if isinstance(c, dict)], key=_priority):
        topic = str(cand.get("canonical_topic", "")).strip()
        angle = str(cand.get("angle", "")).strip()
        if topic and angle and (settings.simulate or not db.is_duplicate(conn, topic, angle)):
            cand["series_id"] = cand.get("series_id") or series["id"]
            cand["domain"] = cand.get("domain") or "history"
            cand["uniqueness_hash"] = db.uniqueness_hash(topic, angle)
            log("topics", "tema elegido", topic=topic, angle=angle,
                domain=cand["domain"])
            return cand
    raise RuntimeError("Ningun candidato de tema paso el filtro anti-repeticion")
