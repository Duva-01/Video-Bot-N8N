"""Direccion visual: plan de escenas con lenguaje de montaje + obtencion de assets.

1. El LLM actua de director: escenas + transicion + overlay + enfasis + energia
   + mood global + ancla de estilo (mismo "rodaje" en todo el video).
2. Cada escena se resuelve con: LTX img2vid (escenas hero), parallax 2.5D,
   Ken Burns variado, o b-roll de Pexels puntuado por un modelo de vision.
3. Las escenas largas se parten en shots (max_shot_seconds) y las transiciones
   punch/flash/whip se hornean al inicio del clip.

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
from ..llm import generate, vision_score
from ..utils import log
from . import motion
from .subtitles import Word

SCENES_PROMPT = """You are the film director of a {fmt} documentary video.
Turn this narration into a visual scene plan with editing language.

Narration:
\"\"\"{narration}\"\"\"

Split it into scenes of AT MOST {max_words} words each (a scene = one visual moment).
For each scene provide:
- "text": exact fragment of the narration
- "visual": vivid image-generation prompt (subject, setting, mood, era)
- "source": "image", or "broll" when real stock footage would work better (+ "query": 2-3 words)
- "transition": how the scene ENTERS — "cut" for normal flow, "punch" on a reveal,
  "flash" on a shock, "whip" on a sudden change of place/time. Most scenes = "cut";
  use effects ONLY on real narrative turns (2-3 per video max).
- "overlay": a number/date/short datum from the text to show huge on screen ("1859",
  "40,000 V"), or "" for most scenes. Max 2 overlays per video.
- "emphasis": 1-3 exact words from the text that carry the impact (numbers, names, turns)
- "energy": 1 calm, 2 building, 3 climax (exactly ONE scene with 3, near the payoff)
- "pause_before": true only for the scene right after which a dramatic beat lands

Also provide:
- "mood": overall music mood — one of {moods}
- "style_anchor": short phrase locking era/palette/materials shared by ALL scenes

Scene 1 must be the most visually striking moment of the whole video.
Return ONLY JSON:
{{"mood": "...", "style_anchor": "...", "scenes": [{{...}}]}}
"""


def plan_scenes(settings: Settings, narration: str) -> dict:
    """Devuelve {"mood", "style_anchor", "scenes": [...]}"""
    max_words = 12 if settings.fmt == "short" else 30
    moods = settings.ch("music", "moods", default=["tense", "epic", "curious", "dark", "calm"])
    data = generate(settings, SCENES_PROMPT.format(
        fmt=settings.fmt, narration=narration, max_words=max_words, moods=moods))

    mood, style_anchor = "curious", ""
    if isinstance(data, dict):
        mood = str(data.get("mood") or "curious").lower()
        style_anchor = str(data.get("style_anchor") or "")
    scenes = _extract_scenes(data)
    if len(scenes) < 3:
        scenes = _fallback_scenes(narration, max_words)

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
            scene["query"] = scene.get("query") or " ".join(scene["visual"].split()[:3])

    # exactamente una escena climax; la primera nunca lleva transicion
    if not any(s["energy"] == 3 for s in scenes):
        scenes[-1]["energy"] = 3
    scenes[0]["transition"] = "cut"

    log("visuals", "plan de escenas", scenes=len(scenes), mood=mood,
        broll=sum(1 for s in scenes if s.get("source") == "broll"),
        fx=[s["transition"] for s in scenes if s["transition"] != "cut"],
        overlays=[s["overlay"] for s in scenes if s["overlay"]])
    return {"mood": mood, "style_anchor": style_anchor, "scenes": scenes}


def _extract_scenes(data) -> list[dict]:
    if isinstance(data, dict):
        for key in ("scenes", "scene_plan", "visuals"):
            if key in data:
                data = data[key]
                break
        else:
            data = [data]
    if not isinstance(data, list):
        return []

    scenes = []
    for item in data:
        if not isinstance(item, dict):
            continue
        text = str(item.get("text") or item.get("narration") or "").strip()
        visual = str(item.get("visual") or item.get("prompt") or item.get("image_prompt") or "").strip()
        if not text or not visual:
            continue
        transition = str(item.get("transition", "cut")).lower()
        emphasis = item.get("emphasis") or []
        if isinstance(emphasis, str):
            emphasis = [emphasis]
        try:
            energy = min(3, max(1, int(item.get("energy", 1))))
        except (TypeError, ValueError):
            energy = 1
        scenes.append({
            "text": text,
            "visual": visual,
            "source": item.get("source") if item.get("source") in ("image", "broll") else "image",
            "query": item.get("query", ""),
            "transition": transition if transition in ("cut", "punch", "flash", "whip") else "cut",
            "overlay": str(item.get("overlay", "")).strip()[:14],
            "emphasis": [str(w).strip() for w in emphasis if str(w).strip()][:3],
            "energy": energy,
            "pause_before": bool(item.get("pause_before", False)),
        })
    return scenes


def _fallback_scenes(narration: str, max_words: int) -> list[dict]:
    words = narration.split()
    scenes = []
    for i in range(0, len(words), max_words):
        text = " ".join(words[i:i + max_words])
        scenes.append({"text": text, "visual": text, "source": "image", "query": "",
                       "transition": "cut", "overlay": "", "emphasis": [],
                       "energy": 1, "pause_before": False})
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


def fetch_visuals(settings: Settings, direction: dict, workdir: Path) -> list[dict]:
    """Genera/descarga el asset de cada escena y lo convierte en clip con movimiento."""
    scenes = direction["scenes"]
    style_anchor = direction.get("style_anchor", "")
    clips_dir = workdir / "clips"
    clips_dir.mkdir(parents=True, exist_ok=True)
    w, h = settings.size
    fps = settings.fps
    max_shot = float(settings.pr("video", "max_shot_seconds", default=3.0))

    # mismo seed en todo el video = mismo "rodaje"
    seed = random.randint(0, 2**31) if settings.ch(
        "visual_style", "consistent_seed", default=True) else None

    hero_idxs = _pick_hero_scenes(settings, scenes)
    parallax_on = bool(settings.ch("visual_style", "parallax", default=True))

    for i, scene in enumerate(scenes):
        duration = max(0.6, float(scene["end"]) - float(scene["start"]))
        clip = clips_dir / f"scene-{i:03d}.mp4"
        try:
            if settings.simulate:
                motion.color_clip(clip, duration, w, h, fps, i)
            elif scene.get("source") == "broll":
                try:
                    raw = _best_pexels_clip(settings, scene, clips_dir, i)
                    motion.fit_clip(raw, clip, duration, w, h, fps)
                except Exception as exc:
                    log("visuals", f"broll escena {i} fallo ({exc}); usando FLUX")
                    _image_scene(settings, scene, style_anchor, seed, clips_dir,
                                 clip, duration, w, h, fps, max_shot, i,
                                 hero=(i in hero_idxs), parallax_on=parallax_on)
            else:
                _image_scene(settings, scene, style_anchor, seed, clips_dir,
                             clip, duration, w, h, fps, max_shot, i,
                             hero=(i in hero_idxs), parallax_on=parallax_on)
            if not settings.simulate:
                motion.apply_transition(clip, scene.get("transition", "cut"), w, h, fps)
        except Exception as exc:  # una escena no debe tumbar el video entero
            log("visuals", f"escena {i} fallo ({exc}); usando fondo neutro")
            motion.color_clip(clip, duration, w, h, fps, i)
        scene["clip"] = str(clip)
    return scenes


def _pick_hero_scenes(settings: Settings, scenes: list[dict]) -> set[int]:
    ltx_cfg = settings.ch("visual_style", "ltx", default={}) or {}
    n_hero = int(settings.ch("visual_style", "hero_video_scenes", default=1))
    if not ltx_cfg.get("enabled", False) or n_hero <= 0:
        return set()
    ranked = sorted(range(len(scenes)),
                    key=lambda i: (scenes[i]["energy"], i == 0), reverse=True)
    ranked = [i for i in ranked if scenes[i].get("source") != "broll"]
    return set(ranked[:n_hero])


def _image_scene(settings: Settings, scene: dict, style_anchor: str,
                 seed: int | None, clips_dir: Path, clip: Path, duration: float,
                 w: int, h: int, fps: int, max_shot: float, idx: int,
                 hero: bool, parallax_on: bool) -> None:
    png = clips_dir / f"scene-{idx:03d}.png"
    prompt = scene["visual"] if not style_anchor else f"{scene['visual']}, {style_anchor}"
    comfy.generate_image(settings, prompt, png, width=w + 200, height=h + 200, seed=seed)

    if hero:
        try:
            _ltx_scene(settings, scene, png, clip, duration, w, h, fps)
            return
        except Exception as exc:
            log("visuals", f"LTX escena {idx} fallo ({exc}); usando parallax/kenburns")

    if duration > max_shot * 1.3:
        motion.split_image_shots(png, clip, duration, max_shot, w, h, fps,
                                 start_mode_idx=idx)
        return

    if parallax_on and idx % 2 == 1:  # alterna parallax y ken burns
        try:
            motion.parallax(png, clip, duration, w, h, fps)
            return
        except Exception as exc:
            log("visuals", f"parallax escena {idx} fallo ({exc}); ken burns")
    motion.ken_burns(png, clip, duration, w, h, fps,
                     motion.MODES[idx % len(motion.MODES)])


def _ltx_scene(settings: Settings, scene: dict, png: Path, clip: Path,
               duration: float, w: int, h: int, fps: int) -> None:
    """Anima la imagen con LTX; si la escena es mas larga, remata con ken burns."""
    gen_seconds = min(duration, 5.0)
    raw = clip.with_suffix(".ltx.mp4")
    # LTX genera a resolucion contenida y se reescala (mas estable en 16GB)
    gw, gh = (768, 1152) if h > w else (1152, 768)
    comfy.generate_video_ltx(settings, png, scene["visual"], raw, gen_seconds, gw, gh)
    if duration <= gen_seconds + 0.25:
        motion.fit_clip(raw, clip, duration, w, h, fps)
        return
    head = clip.with_suffix(".head.mp4")
    tail = clip.with_suffix(".tail.mp4")
    motion.fit_clip(raw, head, gen_seconds, w, h, fps)
    motion.ken_burns(png, tail, duration - gen_seconds, w, h, fps, "zoom_in")
    concat_txt = clip.with_suffix(".ltxcat.txt")
    concat_txt.write_text(
        f"file '{str(head.resolve())}'\nfile '{str(tail.resolve())}'\n", encoding="utf-8")
    from ..utils import run_cmd
    run_cmd(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(concat_txt),
             "-c", "copy", str(clip)], desc="LTX + kenburns")


# ------------------------------------------------------------- proveedores
def _best_pexels_clip(settings: Settings, scene: dict, out_dir: Path, idx: int) -> Path:
    """Descarga candidatos de Pexels y elige el mejor con el modelo de vision."""
    key = settings.env.get("PEXELS_API_KEY", "")
    query = scene.get("query") or scene["visual"]
    qs = urllib.parse.urlencode({"query": query, "per_page": 6, "orientation":
                                 "portrait" if settings.fmt == "short" else "landscape"})
    req = urllib.request.Request(f"https://api.pexels.com/videos/search?{qs}",
                                 headers={"Authorization": key})
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read())
    videos = (data.get("videos") or [])[:4]
    if not videos:
        raise RuntimeError(f"Pexels sin resultados para '{query}'")

    # puntua los thumbnails con Qwen-VL y elige el mejor
    best_video, best_score = videos[0], -1.0
    if len(videos) > 1:
        for j, video in enumerate(videos):
            thumb_url = video.get("image")
            if not thumb_url:
                continue
            try:
                thumb = out_dir / f"thumb-{idx:03d}-{j}.jpg"
                with urllib.request.urlopen(thumb_url, timeout=20) as resp:
                    thumb.write_bytes(resp.read())
                score = vision_score(settings, thumb, scene["visual"])
                if score > best_score:
                    best_video, best_score = video, score
            except Exception:
                continue
        log("visuals", "broll elegido por vision", query=query,
            score=round(best_score, 1))

    files = sorted(best_video.get("video_files", []), key=lambda f: -(f.get("height") or 0))
    best = next((f for f in files if (f.get("height") or 0) <= 2000), files[0])
    raw = out_dir / f"broll-{idx:03d}.mp4"
    with urllib.request.urlopen(best["link"], timeout=120) as resp:
        raw.write_bytes(resp.read())
    return raw
