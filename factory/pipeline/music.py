"""Generacion LOCAL de musica con ACE-Step (Apache 2.0) via ComfyUI.

10 estilos de underscore documental. Se genera una biblioteca en assets/music/
({estilo}-{nn}.mp3) y el montaje elige por el mood que decide el director LLM
(assemble._pick_music ya selecciona por prefijo del nombre).

Uso:  python -m factory music                # 1 pista por estilo
      python -m factory music --per-style 3 --seconds 100
      python -m factory music --styles tense,war --force
"""
from __future__ import annotations

from pathlib import Path

from .. import comfy
from ..config import ROOT, Settings
from ..utils import ffprobe_duration, log, run_cmd

# 10 estilos -> tags de ACE-Step (instrumental siempre)
STYLES: dict[str, str] = {
    "tense": "dark tense cinematic underscore, pulsing staccato strings, low drones, "
             "ticking percussion, suspense, documentary score, instrumental, 95 bpm",
    "epic": "epic orchestral documentary score, powerful strings, brass swells, "
            "cinematic percussion, heroic, wide, instrumental",
    "curious": "light curious documentary underscore, plucked pizzicato strings, "
               "marimba, celesta, playful minimal, quirky, instrumental",
    "dark": "dark ambient drone, ominous low textures, sub bass, distant metallic "
            "hits, slow evolving dread, instrumental",
    "somber": "somber emotional piano and cello, melancholic slow documentary score, "
              "intimate, reflective, instrumental",
    "triumphant": "uplifting triumphant orchestral score, hopeful strings and horns, "
                  "rising progression, cinematic finale, instrumental",
    "mystery": "mysterious investigative underscore, soft synth pulse, harp arpeggios, "
               "noir tension, detective documentary, instrumental",
    "war": "military percussion, taiko and snare drums, staccato low strings, "
           "march rhythm, wartime documentary score, instrumental",
    "noir": "film noir jazz, muted trumpet, brushed drums, double bass, smoky vintage "
            "slow mood, 1950s, instrumental",
    "minimal": "minimal ambient pulse, soft felt piano motif, airy pads, neutral calm "
               "background underscore, instrumental",
}

NEGATIVE = "vocals, singing, voice, speech, rap, choir words, noise, low quality, distortion"


def generate_library(settings: Settings, styles: list[str] | None = None,
                     per_style: int = 1, seconds: float | None = None,
                     force: bool = False) -> list[Path]:
    music_dir = ROOT / settings.ch("music", "directory", default="assets/music")
    music_dir.mkdir(parents=True, exist_ok=True)
    seconds = seconds or float(settings.ch("music", "ace", "seconds", default=95))
    wanted = [s for s in (styles or list(STYLES)) if s in STYLES]
    if not wanted:
        raise SystemExit(f"Estilos validos: {', '.join(STYLES)}")

    done: list[Path] = []
    for style in wanted:
        for n in range(1, per_style + 1):
            out = music_dir / f"{style}-{n:02d}.mp3"
            if out.exists() and not force:
                log("music", "ya existe (usa --force para regenerar)", file=out.name)
                done.append(out)
                continue
            try:
                if settings.simulate:
                    _simulated_track(style, out, min(seconds, 12))
                else:
                    _ace_track(settings, style, out, seconds)
                if ffprobe_duration(out) < 5:
                    log("music", "pista invalida; descartada", file=out.name)
                    out.unlink(missing_ok=True)
                    continue
                done.append(out)
                log("music", "pista lista", style=style, file=out.name,
                    seconds=round(ffprobe_duration(out)))
            except Exception as exc:
                log("music", f"estilo {style} fallo ({exc})")
    log("music", "biblioteca actualizada", tracks=len(done), dir=str(music_dir))
    return done


def _ace_track(settings: Settings, style: str, out: Path, seconds: float) -> None:
    raw = out.with_suffix(".flac")
    comfy.generate_music(settings, STYLES[style], NEGATIVE, raw, seconds)
    # a mp3 con nivel consistente (el ducking del montaje hace el resto)
    run_cmd(["ffmpeg", "-y", "-i", str(raw),
             "-af", "loudnorm=I=-18:TP=-2:LRA=11",
             "-c:a", "libmp3lame", "-b:a", "192k", str(out)],
            desc="flac -> mp3")
    raw.unlink(missing_ok=True)


def _simulated_track(style: str, out: Path, seconds: float) -> None:
    freq = 110 + (sorted(STYLES).index(style) % 10) * 22
    run_cmd(["ffmpeg", "-y", "-f", "lavfi",
             "-i", f"sine=frequency={freq}:duration={seconds:.1f}",
             "-af", "volume=0.35,tremolo=f=0.5:d=0.6",
             "-c:a", "libmp3lame", "-b:a", "128k", str(out)],
            desc=f"pista simulada {style}")
