"""Research con Wikipedia: facts verificados + imagenes reales del articulo.

- Busca el articulo mas relevante y extrae el texto -> el LLM condensa facts
  (fechas, cifras, nombres) que se inyectan en los prompts del guion.
- Extrae las IMAGENES del propio articulo (fotos reales, mapas, documentos):
  el material de archivo mas relevante posible para el motor visual.
- Genera queries de busqueda para Commons/Archive.org.
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

Return:
- 8-12 concrete facts: exact dates, numbers, names, places, quotes. Only facts
  present in the text. No interpretation.
- 4-6 short archive search queries (2-4 words each) to find REAL historical
  photos/footage of the people, places and events involved.

Return ONLY JSON: {{"facts": ["..."], "archive_queries": ["..."]}}
"""

_API = "https://en.wikipedia.org/w/api.php"
_HEADERS = {"User-Agent": "HiddenThreadFactory/3.0 (personal project)"}
_IMG_BLACKLIST = ("logo", "icon", "wiki", "book-new", "question", "edit-",
                  "symbol", "disambig", "sound", "speaker")


def gather(settings: Settings, topic: dict) -> dict:
    """Devuelve {"facts": str, "queries": [str], "wiki_images": [url]}."""
    empty = {"facts": "", "queries": [], "wiki_images": []}
    if settings.simulate or not settings.ch("research", "enabled", default=True):
        return empty
    try:
        title, text = _wikipedia_text(
            topic["canonical_topic"],
            int(settings.ch("research", "max_chars", default=6000)))
        if not text:
            log("research", "sin articulo de Wikipedia; se escribe sin facts")
            return empty

        data = generate(settings, FACTS_PROMPT.format(
            topic=topic["canonical_topic"], angle=topic["angle"], text=text))
        facts, queries = [], []
        if isinstance(data, dict):
            facts = [str(f).strip() for f in data.get("facts", []) if str(f).strip()][:12]
            queries = [str(q).strip() for q in data.get("archive_queries", [])
                       if str(q).strip()][:6]
        elif isinstance(data, list):
            facts = [str(f).strip() for f in data if str(f).strip()][:12]

        images = _wikipedia_images(title)
        log("research", "research completo", facts=len(facts),
            queries=len(queries), wiki_images=len(images))
        return {"facts": "\n".join(f"- {f}" for f in facts),
                "queries": queries, "wiki_images": images}
    except Exception as exc:
        log("research", f"research fallo ({exc}); se escribe sin facts")
        return empty


def gather_facts(settings: Settings, topic: dict) -> str:
    """Compatibilidad: solo el bloque de facts."""
    return gather(settings, topic)["facts"]


def _api(params: dict) -> dict:
    qs = urllib.parse.urlencode({**params, "format": "json"})
    req = urllib.request.Request(f"{_API}?{qs}", headers=_HEADERS)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def _wikipedia_text(query: str, max_chars: int) -> tuple[str, str]:
    results = _api({"action": "query", "list": "search", "srsearch": query,
                    "srlimit": 1}).get("query", {}).get("search", [])
    if not results:
        return "", ""
    title = results[0]["title"]
    pages = _api({"action": "query", "prop": "extracts", "explaintext": 1,
                  "titles": title}).get("query", {}).get("pages", {})
    extract = next(iter(pages.values()), {}).get("extract", "")
    log("research", "articulo encontrado", title=title, chars=len(extract))
    return title, extract[:max_chars]


def _wikipedia_images(title: str, width: int = 1400) -> list[str]:
    """URLs de las imagenes del articulo (jpg/png grandes, sin iconos)."""
    if not title:
        return []
    try:
        pages = _api({"action": "query", "generator": "images", "titles": title,
                      "gimlimit": 25, "prop": "imageinfo",
                      "iiprop": "url|size|mime", "iiurlwidth": width,
                      }).get("query", {}).get("pages", {})
    except Exception:
        return []
    urls = []
    for page in pages.values():
        info = (page.get("imageinfo") or [{}])[0]
        mime = info.get("mime", "")
        name = str(page.get("title", "")).lower()
        if mime not in ("image/jpeg", "image/png"):
            continue
        if any(b in name for b in _IMG_BLACKLIST):
            continue
        if int(info.get("width", 0)) < 500:
            continue
        url = info.get("thumburl") or info.get("url")
        if url:
            urls.append(url)
    return urls[:15]
