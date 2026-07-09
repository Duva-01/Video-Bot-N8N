"""Cliente de Ollama (LLM local). En modo simulate devuelve contenido enlatado."""
from __future__ import annotations

import json
import urllib.request

from .config import Settings
from .utils import extract_json, log


def generate(settings: Settings, prompt: str, system: str = "",
             fast: bool = False, as_json: bool = True) -> str | dict | list:
    if settings.simulate:
        return _simulated(prompt) if as_json else "simulated text"

    url = settings.ch("services", "ollama_url", default="http://127.0.0.1:11434")
    model = settings.ch("services", "ollama_fast_model" if fast else "ollama_model")
    payload = {
        "model": model,
        "prompt": prompt,
        "system": system,
        "stream": False,
        "options": {"temperature": 0.8, "num_ctx": 8192},
    }
    req = urllib.request.Request(
        f"{url}/api/generate",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    log("llm", f"generando con {model}", chars=len(prompt))
    try:
        with urllib.request.urlopen(req, timeout=600) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except OSError as exc:
        raise RuntimeError(
            f"No se pudo conectar con Ollama en {url}. "
            f"Arranca Ollama y ejecuta: ollama pull {model}"
        ) from exc
    text = body.get("response", "")
    return extract_json(text) if as_json else text


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
    if "scene" in p and "plan" in p:
        return [
            {"text": "In 1859, the sky caught fire.", "visual": "aurora borealis blazing over a victorian city at night", "source": "image"},
            {"text": "Telegraph lines sparked on their own.", "visual": "vintage telegraph office, sparks on wires, dramatic light", "source": "image"},
            {"text": "Operators kept sending messages with the batteries unplugged.", "visual": "close up of telegraph key tapping, period drama style", "source": "broll", "query": "telegraph vintage"},
            {"text": "If it happened today, the grid would collapse.", "visual": "modern power grid at night from above, city blackout spreading", "source": "image"},
        ]
    if "outline" in p:
        return {"sections": [{"title": "The warning", "summary": "The event"},
                             {"title": "The cascade", "summary": "Consequences"}]}
    return {
        "narration": "In 1859, the sky caught fire. Telegraph lines sparked on their own. "
                     "Operators kept sending messages with the batteries unplugged. "
                     "A solar storm had turned Earth's atmosphere into a generator. "
                     "If it happened today, the grid would collapse in minutes. "
                     "And that fire in the sky? Scientists say it's not if — it's when.",
        "hook": "In 1859, the sky caught fire.",
        "title": "The Day the Sky Caught Fire",
        "summary": "The 1859 Carrington event nearly broke the modern world before it existed.",
        "tags": ["carrington event", "solar storm", "history"],
    }
