"""Guion multi-paso: hooks candidatos -> puntuacion -> guion -> metadata.

Shorts: guion completo de una pieza con estructura fija y loop final.
Longform: outline -> secciones generadas una a una (evita degradacion).
"""
from __future__ import annotations

import sqlite3

from .. import db
from ..config import Settings
from ..llm import generate
from ..utils import log

HOOKS_PROMPT = """You write opening lines for viral documentary shorts.

Topic: {topic}
Angle: {angle}

What has worked before on this channel (analytics feedback):
{feedback}

Write {n} hook candidates. Rules:
- first line a viewer hears at second 0 — must create an information gap instantly
- shocking claim, paradox or open question; NEVER an introduction ("Today we...")
- max 14 words, concrete nouns, present tense where possible

Return ONLY JSON: [{{"hook": "..."}}]
"""

SCORE_PROMPT = """Score each hook candidate from 1-10 for a YouTube Short.

Criteria: curiosity gap (does it force you to keep watching?), specificity, tension,
clarity in 1.5 seconds. Penalize cliches and vagueness.

Hooks:
{hooks}

Return ONLY JSON: [{{"index": 0, "score": 8, "reason": "..."}}]
"""

SHORT_PROMPT = """You are the head writer of "{name}" — {niche}

Topic: {topic}
Angle: {angle}
Opening hook (use EXACTLY as first sentence): {hook}

Write the narration for a ~{seconds}s YouTube Short ({min_w}-{max_w} words).
Structure: {structure}
Rules:
- every sentence must earn the next one (open loops, resolve late)
- concrete facts, numbers and names — no filler, no "imagine that"
- write for the ear: short sentences, active voice
- last sentence must connect back to the hook so the video loops seamlessly

Also produce metadata.
Return ONLY JSON:
{{"narration": "...", "hook": "...", "title": "max {title_max} chars, curiosity gap, no clickbait lies",
  "summary": "1 sentence for the description", "tags": ["...", 5-8 tags]}}
"""

OUTLINE_PROMPT = """You are the head writer of "{name}" — {niche}

Topic: {topic}
Angle: {angle}
Opening hook: {hook}

Design an outline for a ~{minutes}-minute documentary video with {n} sections.
Each section must end on an open question the next section answers.

Return ONLY JSON: {{"title": "...", "summary": "...", "tags": ["..."],
  "sections": [{{"title": "...", "summary": "what this section covers and its cliffhanger"}}]}}
"""

SECTION_PROMPT = """Continue writing the narration of a documentary for "{name}".

Topic: {topic} — {angle}
Full outline: {outline}
Section to write now ({idx}/{total}): {title} — {summary}
Previous section ended with: "{prev_tail}"

Write ~{words} words of narration for THIS section only.
Rules: for the ear, short sentences, concrete facts, end on the section's cliffhanger.
{first_rule}
Return ONLY JSON: {{"narration": "..."}}
"""


def write_script(settings: Settings, conn: sqlite3.Connection, topic: dict) -> dict:
    hook = _best_hook(settings, conn, topic)
    if settings.fmt == "long":
        return _write_long(settings, topic, hook)
    return _write_short(settings, topic, hook)


def _best_hook(settings: Settings, conn: sqlite3.Connection, topic: dict) -> str:
    n = int(settings.pr("script", "hook_candidates", default=5))
    feedback = db.hook_feedback(conn)
    feedback_txt = "\n".join(f"- {f}" for f in feedback) or "- no data yet"

    cands = generate(settings, HOOKS_PROMPT.format(
        topic=topic["canonical_topic"], angle=topic["angle"], n=n, feedback=feedback_txt))
    hooks = [c["hook"] for c in cands if isinstance(c, dict) and c.get("hook")]
    if not hooks:
        raise RuntimeError("El modelo no genero hooks")
    if len(hooks) == 1:
        return hooks[0]

    hooks_txt = "\n".join(f"{i}: {h}" for i, h in enumerate(hooks))
    scores = generate(settings, SCORE_PROMPT.format(hooks=hooks_txt), fast=True)
    try:
        best = max(scores, key=lambda s: float(s.get("score", 0)))
        hook = hooks[int(best["index"])]
    except (TypeError, KeyError, ValueError, IndexError):
        hook = hooks[0]
    log("script", "hook elegido", hook=hook)
    return hook


def _write_short(settings: Settings, topic: dict, hook: str) -> dict:
    data = generate(settings, SHORT_PROMPT.format(
        name=settings.ch("channel", "name"),
        niche=settings.ch("channel", "niche"),
        topic=topic["canonical_topic"], angle=topic["angle"], hook=hook,
        seconds=settings.pr("script", "target_seconds", default=45),
        min_w=settings.pr("script", "min_words", default=95),
        max_w=settings.pr("script", "max_words", default=145),
        structure=settings.pr("script", "structure", default="hook -> payoff"),
        title_max=settings.pr("metadata", "title_max_chars", default=60),
    ))
    data["hook"] = data.get("hook") or hook
    data["sections"] = None
    log("script", "guion corto listo", words=len(str(data.get("narration", "")).split()))
    return data


def _write_long(settings: Settings, topic: dict, hook: str) -> dict:
    n = int(settings.pr("script", "sections", default=6))
    words = int(settings.pr("script", "words_per_section", default=220))
    minutes = int(settings.pr("script", "target_seconds", default=600)) // 60

    outline = generate(settings, OUTLINE_PROMPT.format(
        name=settings.ch("channel", "name"), niche=settings.ch("channel", "niche"),
        topic=topic["canonical_topic"], angle=topic["angle"],
        hook=hook, minutes=minutes, n=n))

    sections, prev_tail = [], ""
    outline_txt = "; ".join(s["title"] for s in outline.get("sections", []))
    for i, sec in enumerate(outline.get("sections", []), start=1):
        first_rule = (f'The very first sentence must be EXACTLY: "{hook}"' if i == 1 else "")
        part = generate(settings, SECTION_PROMPT.format(
            name=settings.ch("channel", "name"),
            topic=topic["canonical_topic"], angle=topic["angle"],
            outline=outline_txt, idx=i, total=len(outline.get("sections", [])),
            title=sec["title"], summary=sec.get("summary", ""),
            prev_tail=prev_tail[-200:], words=words, first_rule=first_rule))
        narration = str(part.get("narration", "")).strip()
        sections.append({"title": sec["title"], "narration": narration})
        prev_tail = narration
        log("script", f"seccion {i} lista", words=len(narration.split()))

    return {
        "narration": "\n\n".join(s["narration"] for s in sections),
        "hook": hook,
        "title": outline.get("title", topic["canonical_topic"]),
        "summary": outline.get("summary", ""),
        "tags": outline.get("tags", []),
        "sections": sections,
    }
