"""Plan de escenas y obtencion de visuales.

1. El LLM divide la narracion en escenas con un prompt visual por escena.
2. Cada escena se resuelve con: imagen FLUX (ComfyUI) o b-roll real (Pexels).
3. Las imagenes se convierten en clips con movimiento Ken Burns (ffmpeg zoompan).

En modo simulate se generan clips de color solido.
"""
from __future__ import annotations

import json
import random
import urllib.parse
import urllib.request
from pathlib import Path

from .. import comfy
from ..config import Settings
from ..llm import generate
from ..utils import log, run_cmd
from .subtitles import Word

SCENES_PROMPT = """Turn this narration into a visual scene plan for a {fmt} documentary video.

Narration:
\"\"\"{narration}\"\"\"

Split it into scenes of AT MOST {max_words} words each (a scene = one visual moment).
For each scene give a vivid image-generation prompt (subject, setting, mood, era)
and, when real archival/stock footage would work better, a 2-3 word stock query.

Return ONLY JSON, in narration order, covering ALL the text:
[{{"text": "exact fragment of the narration", "visual": "image prompt",
   "source": "image" | "broll", "query": "stock query (only if broll)"}}]
"""


def plan_scenes(settings: Settings, narration: str) -> list[dict]:
    max_words = 12 if settings.fmt == "short" else 30
    scenes = generate(settings, SCENES_PROMPT.format(
        fmt=settings.fmt, narration=narration, max_words=max_words))
    if not isinstance(scenes, list) or not scenes:
        raise RuntimeError("El plan de escenas no es valido")

    # Fuerza la mezcla broll/imagen segun configuracion
    ratio = float(settings.ch("visual_style", "broll_ratio", default=0.35))
    has_pexels = bool(settings.env.get("PEXELS_API_KEY"))
    for scene in scenes:
        if not has_pexels:
            scene["source"] = "image"
    n_broll = sum(1 for s in scenes if s.get("source") == "broll")
    if has_pexels and n_broll == 0 and ratio > 0:
        for scene in random.sample(scenes, max(1, int(len(scenes) * ratio))):
            scene["source"] = "broll"
            scene.setdefault("query", " ".join(scene["visual"].split()[:3]))
    log("visuals", "plan de escenas", scenes=len(scenes),
        broll=sum(1 for s in scenes if s.get("source") == "broll"))
    return scenes


def align_scenes(scenes: list[dict], words: list[Word], total: float) -> list[dict]:
    """Asigna start/end a cada escena mapeando su texto sobre los timestamps."""
    if not words:
        step = total / len(scenes)
        for i, s in enumerate(scenes):
            s["start"], s["end"] = i * step, (i + 1) * step
        return scenes

    counts = [max(1, len(str(s.get("text", "")).split())) for s in scenes]
    total_words = sum(counts)
    idx = 0
    for scene, count in zip(scenes, counts):
        share = round(count / total_words * len(words))
        start_word = words[min(idx, len(words) - 1)]
        end_word = words[min(idx + max(1, share) - 1, len(words) - 1)]
        scene["start"] = start_word.start
        scene["end"] = end_word.end
        idx += max(1, share)
    scenes[0]["start"] = 0.0
    scenes[-1]["end"] = total
    # sin huecos ni solapes
    for prev, cur in zip(scenes, scenes[1:]):
        cur["start"] = prev["end"]
    return scenes


def fetch_visuals(settings: Settings, scenes: list[dict], workdir: Path) -> list[dict]:
    """Descarga/genera el asset de cada escena y lo convierte en clip de video."""
    clips_dir = workdir / "clips"
    clips_dir.mkdir(parents=True, exist_ok=True)
    w, h = settings.size

    for i, scene in enumerate(scenes):
        duration = max(0.6, float(scene["end"]) - float(scene["start"]))
        clip = clips_dir / f"scene-{i:03d}.mp4"
        try:
            if settings.simulate:
                _color_clip(clip, duration, w, h, settings.fps, i)
            elif scene.get("source") == "broll":
                raw = _pexels_clip(settings, scene.get("query") or scene["visual"], clips_dir, i)
                _fit_clip(raw, clip, duration, w, h, settings.fps)
            else:
                png = clips_dir / f"scene-{i:03d}.png"
                comfy.generate_image(settings, scene["visual"], png,
                                     width=w + 200, height=h + 200)
                _ken_burns(png, clip, duration, w, h, settings.fps, zoom_in=(i % 2 == 0))
        except Exception as exc:  # una escena no debe tumbar el video entero
            log("visuals", f"escena {i} fallo ({exc}); usando fondo neutro")
            _color_clip(clip, duration, w, h, settings.fps, i)
        scene["clip"] = str(clip)
    return scenes


# ------------------------------------------------------------- proveedores
def _pexels_clip(settings: Settings, query: str, out_dir: Path, idx: int) -> Path:
    key = settings.env.get("PEXELS_API_KEY", "")
    qs = urllib.parse.urlencode({"query": query, "per_page": 6, "orientation":
                                 "portrait" if settings.fmt == "short" else "landscape"})
    req = urllib.request.Request(f"https://api.pexels.com/videos/search?{qs}",
                                 headers={"Authorization": key})
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read())
    videos = data.get("videos") or []
    if not videos:
        raise RuntimeError(f"Pexels sin resultados para '{query}'")
    video = random.choice(videos[:4])
    files = sorted(video.get("video_files", []), key=lambda f: -(f.get("height") or 0))
    best = next((f for f in files if (f.get("height") or 0) <= 2000), files[0])
    raw = out_dir / f"broll-{idx:03d}.mp4"
    with urllib.request.urlopen(best["link"], timeout=120) as resp:
        raw.write_bytes(resp.read())
    return raw


# --------------------------------------------------------------- ffmpeg
def _ken_burns(png: Path, out: Path, duration: float, w: int, h: int,
               fps: int, zoom_in: bool) -> None:
    frames = max(2, int(duration * fps))
    if zoom_in:
        zoom = f"min(1+0.0009*on,1.12)"
    else:
        zoom = f"max(1.12-0.0009*on,1.0)"
    run_cmd(
        ["ffmpeg", "-y", "-loop", "1", "-i", str(png),
         "-vf",
         f"scale={w * 2}:{h * 2}:force_original_aspect_ratio=increase,"
         f"crop={w * 2}:{h * 2},"
         f"zoompan=z='{zoom}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
         f":d={frames}:s={w}x{h}:fps={fps}",
         "-t", f"{duration:.3f}", "-r", str(fps), "-pix_fmt", "yuv420p",
         "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-an", str(out)],
        desc="ken burns",
    )


def _fit_clip(raw: Path, out: Path, duration: float, w: int, h: int, fps: int) -> None:
    run_cmd(
        ["ffmpeg", "-y", "-i", str(raw),
         "-vf", f"scale={w}:{h}:force_original_aspect_ratio=increase,"
                f"crop={w}:{h},fps={fps}",
         "-t", f"{duration:.3f}", "-pix_fmt", "yuv420p",
         "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-an", str(out)],
        desc="ajustar broll",
    )


def _color_clip(out: Path, duration: float, w: int, h: int, fps: int, idx: int) -> None:
    palette = ["0x0F1720", "0x1B2733", "0x22303C", "0x101C26"]
    color = palette[idx % len(palette)]
    run_cmd(
        ["ffmpeg", "-y", "-f", "lavfi",
         "-i", f"color=c={color}:s={w}x{h}:d={duration:.3f}:r={fps}",
         "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "veryfast", str(out)],
        desc="clip de color",
    )
