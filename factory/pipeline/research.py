"""Research con Wikipedia (API gratuita) antes de escribir el guion.

Busca el articulo mas relevante, extrae el texto y el LLM condensa una lista
de hechos verificados (fechas, cifras, nombres) que se inyectan en los prompts
de guion. Menos alucinaciones = credibilidad del canal.
"""
from __future__ import annotations

import json
import urllib.parse
import urllib.request

from ..config import Settings
from ..llm import generate
from ..utils import log

FACTS_PROMPT = """Extract the verified facts from this Wikipedia material that are
relevant to a documentary about:

Topic: {topic}
Angle: {angle}

Wikipedia text:
\"\"\"{text}\"\"\"

Return 8-12 concrete facts: exact dates, numbers, names, places, quotes.
Only facts present in the text. No interpretation.
Return ONLY JSON: {{"facts": ["...", "..."]}}
"""

_API = "https://en.wikipedia.org/w/api.php"
_HEADERS = {"User-Agent": "HiddenThreadFactory/2.0 (personal project)"}


def gather_facts(settings: Settings, topic: dict) -> str:
    """Devuelve un bloque de texto con hechos verificados, o '' si no hay."""
    if settings.simulate or not settings.ch("research", "enabled", default=True):
        return ""
    try:
        text = _wikipedia_text(topic["canonical_topic"],
                               int(settings.ch("research", "max_chars", default=6000)))
        if not text:
            log("research", "sin articulo de Wikipedia; se escribe sin facts")
            return ""
        data = generate(settings, FACTS_PROMPT.format(
            topic=topic["canonical_topic"], angle=topic["angle"], text=text))
        facts = data.get("facts", []) if isinstance(data, dict) else data
        facts = [str(f).strip() for f in facts if str(f).strip()][:12]
        log("research", "facts verificados", count=len(facts))
        return "\n".join(f"- {f}" for f in facts)
    except Exception as exc:
        log("research", f"research fallo ({exc}); se escribe sin facts")
        return ""


def _wikipedia_text(query: str, max_chars: int) -> str:
    qs = urllib.parse.urlencode({
        "action": "query", "list": "search", "srsearch": query,
        "srlimit": 1, "format": "json"})
    with urllib.request.urlopen(
            urllib.request.Request(f"{_API}?{qs}", headers=_HEADERS), timeout=20) as resp:
        results = json.loads(resp.read()).get("query", {}).get("search", [])
    if not results:
        return ""
    title = results[0]["title"]

    qs = urllib.parse.urlencode({
        "action": "query", "prop": "extracts", "explaintext": 1,
        "titles": title, "format": "json"})
    with urllib.request.urlopen(
            urllib.request.Request(f"{_API}?{qs}", headers=_HEADERS), timeout=30) as resp:
        pages = json.loads(resp.read()).get("query", {}).get("pages", {})
    extract = next(iter(pages.values()), {}).get("extract", "")
    log("research", "articulo encontrado", title=title, chars=len(extract))
    return extract[:max_chars]
