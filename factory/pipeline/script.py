"""Guion multi-paso: hooks candidatos -> puntuacion -> guion -> editor -> metadata.

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

Verified facts (ONLY use numbers, dates and names from this list — never invent):
{facts}

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

Verified facts (ONLY use numbers, dates and names from this list — never invent):
{facts}

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

Verified facts (ONLY use numbers, dates and names from this list — never invent):
{facts}

Write ~{words} words of narration for THIS section only.
Rules: for the ear, short sentences, concrete facts, end on the section's cliffhanger.
{first_rule}
Return ONLY JSON: {{"narration": "..."}}
"""

EXPAND_PROMPT = """You are the head writer of a documentary channel.
This narration is TOO SHORT for the target length. Current: {current} words.
Target: {min_w}-{max_w} words.

Narration:
\"\"\"{narration}\"\"\"

Verified facts you may draw from (never invent new claims):
{facts}

Expand it by ADDING DEPTH, not padding: one or two extra reveals, a concrete
consequence, a vivid detail from the facts. Rules:
- keep the FIRST sentence exactly as written (it is the hook)
- keep the LAST sentence as the closing loop line
- short sentences, active voice, written for the ear
- every added sentence must open or close a loop

Return ONLY JSON: {{"narration": "..."}}
"""

EDITOR_PROMPT = """You are a ruthless editor of documentary narration.

Narration:
\"\"\"{narration}\"\"\"

Rewrite it. Rules:
- cut every filler word and redundant sentence; every line must open or close a loop
- keep the FIRST sentence exactly as written (it is the hook)
- keep all facts, numbers and names intact
- keep it {min_w}-{max_w} words; do not add new claims
- written for the ear: short sentences, active voice

Return ONLY JSON: {{"narration": "..."}}
"""


def write_script(settings: Settings, conn: sqlite3.Connection, topic: dict,
                 facts: str = "") -> dict:
    hook = _best_hook(settings, conn, topic)
    facts = facts or "- (no verified facts available; be conservative with claims)"
    if settings.fmt == "long":
        return _write_long(settings, topic, hook, facts)
    return _write_short(settings, topic, hook, facts)


def _edit_pass(settings: Settings, narration: str, min_w: int, max_w: int) -> str:
    if not settings.ch("research", "editor_pass", default=True):
        return narration
    try:
        data = generate(settings, EDITOR_PROMPT.format(
            narration=narration, min_w=min_w, max_w=max_w))
        edited = str(data.get("narration", "")).strip() if isinstance(data, dict) else ""
        if edited and len(edited.split()) >= min_w * 0.6:
            log("script", "editor pass aplicado",
                antes=len(narration.split()), despues=len(edited.split()))
            return edited
    except Exception as exc:
        log("script", f"editor pass fallo ({exc}); se mantiene el original")
    return narration


def _best_hook(settings: Settings, conn: sqlite3.Connection, topic: dict) -> str:
    n = int(settings.pr("script", "hook_candidates", default=5))
    feedback = db.hook_feedback(conn)
    feedback_txt = "\n".join(f"- {f}" for f in feedback) or "- no data yet"

    cands = generate(settings, HOOKS_PROMPT.format(
        topic=topic["canonical_topic"], angle=topic["angle"], n=n, feedback=feedback_txt))
    hooks = _extract_hooks(cands)
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


def _extract_hooks(data) -> list[str]:
    if isinstance(data, dict):
        for key in ("hooks", "candidates", "hook_candidates"):
            if key in data:
                data = data[key]
                break
        else:
            data = [data]
    if not isinstance(data, list):
        return []

    hooks = []
    for item in data:
        if isinstance(item, str) and item.strip():
            hooks.append(item.strip())
        elif isinstance(item, dict):
            hook = item.get("hook") or item.get("text") or item.get("candidate")
            if hook:
                hooks.append(str(hook).strip())
    return hooks


def _write_short(settings: Settings, topic: dict, hook: str, facts: str) -> dict:
    min_w = int(settings.pr("script", "min_words", default=95))
    max_w = int(settings.pr("script", "max_words", default=145))
    data = generate(settings, SHORT_PROMPT.format(
        name=settings.ch("channel", "name"),
        niche=settings.ch("channel", "niche"),
        topic=topic["canonical_topic"], angle=topic["angle"], hook=hook,
        facts=facts,
        seconds=settings.pr("script", "target_seconds", default=45),
        min_w=min_w, max_w=max_w,
        structure=settings.pr("script", "structure", default="hook -> payoff"),
        title_max=settings.pr("metadata", "title_max_chars", default=60),
    ))
    data["hook"] = data.get("hook") or hook
    data["sections"] = None
    narration = _edit_pass(settings, str(data.get("narration", "")), min_w, max_w)
    narration = _length_gate(settings, narration, facts, min_w, max_w)
    data["narration"] = narration
    log("script", "guion corto listo", words=len(narration.split()),
        est_seconds=round(len(narration.split()) / 2.6))
    return data


def _length_gate(settings: Settings, narration: str, facts: str,
                 min_w: int, max_w: int) -> str:
    """Si el guion queda corto, se expande con profundidad real (max 2 intentos)."""
    if settings.simulate or not settings.ch("research", "expand_pass", default=True):
        return narration
    for attempt in range(2):
        words = len(narration.split())
        if words >= int(min_w * 0.92):
            return narration
        log("script", "guion corto: expandiendo", words=words, objetivo=min_w,
            intento=attempt + 1)
        try:
            data = generate(settings, EXPAND_PROMPT.format(
                current=words, min_w=min_w, max_w=max_w,
                narration=narration, facts=facts))
            expanded = str(data.get("narration", "")).strip() if isinstance(data, dict) else ""
            if len(expanded.split()) > words:
                narration = expanded
        except Exception as exc:
            log("script", f"expand fallo ({exc}); se mantiene el guion")
            break
    return narration


def _write_long(settings: Settings, topic: dict, hook: str, facts: str) -> dict:
    n = int(settings.pr("script", "sections", default=6))
    words = int(settings.pr("script", "words_per_section", default=220))
    minutes = int(settings.pr("script", "target_seconds", default=600)) // 60

    outline = generate(settings, OUTLINE_PROMPT.format(
        name=settings.ch("channel", "name"), niche=settings.ch("channel", "niche"),
        topic=topic["canonical_topic"], angle=topic["angle"],
        hook=hook, facts=facts, minutes=minutes, n=n))

    sections, prev_tail = [], ""
    outline_txt = "; ".join(s["title"] for s in outline.get("sections", []))
    for i, sec in enumerate(outline.get("sections", []), start=1):
        first_rule = (f'The very first sentence must be EXACTLY: "{hook}"' if i == 1 else "")
        part = generate(settings, SECTION_PROMPT.format(
            name=settings.ch("channel", "name"),
            topic=topic["canonical_topic"], angle=topic["angle"],
            outline=outline_txt, idx=i, total=len(outline.get("sections", [])),
            title=sec["title"], summary=sec.get("summary", ""),
            prev_tail=prev_tail[-200:], words=words, first_rule=first_rule,
            facts=facts))
        narration = str(part.get("narration", "")).strip()
        narration = _edit_pass(settings, narration, int(words * 0.7), words)
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
