"""Cliente de Ollama (LLM local + modelo de vision).

En modo simulate devuelve contenido enlatado para probar el pipeline sin GPU.
"""
from __future__ import annotations

import base64
import json
import urllib.request
from pathlib import Path

from .config import Settings
from .utils import extract_json, log


def generate(settings: Settings, prompt: str, system: str = "",
             fast: bool = False, as_json: bool = True) -> str | dict | list:
    if settings.simulate:
        return _simulated(prompt) if as_json else "simulated text"

    model = settings.ch("services", "ollama_fast_model" if fast else "ollama_model")
    text = _ollama(settings, model, prompt, system=system)
    return extract_json(text) if as_json else text


def vision_score(settings: Settings, image_path: Path, description: str) -> float:
    """Puntua 0-10 lo bien que una imagen encaja con la descripcion (Qwen-VL)."""
    if settings.simulate:
        return 7.0
    model = settings.ch("visual_style", "vision_model", default="qwen2.5vl:7b")
    prompt = (f"Rate from 0 to 10 how well this image matches: \"{description}\". "
              'Consider subject, era and mood. Return ONLY JSON: {"score": N}')
    try:
        b64 = base64.b64encode(image_path.read_bytes()).decode("ascii")
        text = _ollama(settings, model, prompt, images=[b64], timeout=120)
        data = extract_json(text)
        return float(data.get("score", 0)) if isinstance(data, dict) else 0.0
    except Exception as exc:
        log("llm", f"vision score fallo ({exc}); score neutro")
        return 5.0


def _ollama(settings: Settings, model: str, prompt: str, system: str = "",
            images: list[str] | None = None, timeout: int = 600) -> str:
    url = settings.ch("services", "ollama_url", default="http://127.0.0.1:11434")
    payload: dict = {
        "model": model, "prompt": prompt, "system": system, "stream": False,
        "options": {"temperature": 0.8, "num_ctx": 8192},
    }
    if images:
        payload["images"] = images
    req = urllib.request.Request(
        f"{url}/api/generate",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    log("llm", f"generando con {model}", chars=len(prompt))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except OSError as exc:
        raise RuntimeError(
            f"No se pudo conectar con Ollama en {url}. "
            f"Arranca Ollama y ejecuta: ollama pull {model}"
        ) from exc
    return body.get("response", "")


# ---------------------------------------------------------------- simulate
def _simulated(prompt: str) -> dict | list:
    p = prompt.lower()
    if "topic candidates" in p:
        return [
            {"canonical_topic": "The 1859 Carrington solar storm",
             "angle": "How one telegraph operator's log warned the modern grid",
             "series_id": "almost-happened"},
        ]
    if "hook candidates" in p:
        return [{"hook": "In 1859, the sky caught fire — and the telegraph kept working without power.", "score": 9}]
    if "score each hook" in p:
        return [{"index": 0, "score": 9, "reason": "strong curiosity gap"}]
    if "ruthless editor" in p:
        return {"narration": _extract_quoted_narration(prompt)}
    if "verified facts" in p and "wikipedia" in p:
        return {"facts": ["On September 1-2, 1859 a massive solar storm hit Earth",
                          "Telegraph operators reported sparks from their equipment",
                          "Richard Carrington observed the flare on September 1, 1859"],
                "archive_queries": ["Carrington event", "telegraph 1859"]}
    if "scene plan" in p or ("scene" in p and "plan" in p):
        return {
            "mood": "tense",
            "style_anchor": "1859 victorian era, aurora light, brass and wood technology",
            "scenes": [
                {"text": "In 1859, the sky caught fire.",
                 "visual": "aurora borealis blazing over a victorian city at night",
                 "source": "image", "transition": "cut", "overlay": "1859",
                 "emphasis": ["fire", "1859"], "energy": 2, "pause_before": False},
                {"text": "Telegraph lines sparked on their own.",
                 "visual": "vintage telegraph office, sparks on wires, dramatic light",
                 "source": "archival", "query": "telegraph office 1859",
                 "transition": "punch", "overlay": "",
                 "emphasis": ["sparked"], "energy": 2, "pause_before": False},
                {"text": "Operators kept sending messages with the batteries unplugged.",
                 "visual": "close up of telegraph key tapping, period drama style",
                 "source": "broll", "query": "telegraph vintage", "transition": "cut",
                 "overlay": "", "emphasis": ["unplugged"], "energy": 1, "pause_before": False},
                {"text": "If it happened today, the grid would collapse in minutes.",
                 "visual": "modern power grid at night from above, city blackout spreading",
                 "source": "image", "transition": "flash", "overlay": "MINUTES",
                 "emphasis": ["collapse", "minutes"], "energy": 3, "pause_before": True},
            ],
        }
    if "outline" in p:
        return {"title": "The Day the Sky Caught Fire", "summary": "The 1859 Carrington event.",
                "tags": ["history"], "sections": [
                    {"title": "The warning", "summary": "The event"},
                    {"title": "The cascade", "summary": "Consequences"}]}
    if "thumbnail concepts" in p:
        return [{"image_prompt": "aurora over a dark city, one telegraph pole silhouette",
                 "text": "THE SKY CAUGHT FIRE"}]
    return {
        "narration": "In 1859, the sky caught fire. Telegraph lines sparked on their own. "
                     "Operators kept sending messages with the batteries unplugged. "
                     "If it happened today, the grid would collapse in minutes.",
        "hook": "In 1859, the sky caught fire.",
        "title": "The Day the Sky Caught Fire",
        "summary": "The 1859 Carrington event nearly broke the modern world before it existed.",
        "tags": ["carrington event", "solar storm", "history"],
    }


def _extract_quoted_narration(prompt: str) -> str:
    start = prompt.find('"""')
    end = prompt.find('"""', start + 3)
    if start != -1 and end != -1:
        return prompt[start + 3:end].strip()
    return "In 1859, the sky caught fire."
