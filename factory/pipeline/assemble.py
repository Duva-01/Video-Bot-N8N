"""Montaje final con FFmpeg.

- Concat de escenas (transiciones ya horneadas en cada clip).
- Musica elegida por mood del guion, con ducking bajo la voz y subida en el climax.
- SFX alineados a los beats: whoosh en transiciones, ding en overlays de datos,
  riser entrando hacia la escena climax.
- Subtitulos/overlays ASS quemados. Encoding NVENC (fallback libx264).
"""
from __future__ import annotations

import random
from pathlib import Path

from ..config import ROOT, Settings
from ..utils import ffprobe_duration, log, pick_encoder, run_cmd


def assemble(settings: Settings, scenes: list[dict], voice_wav: Path,
             ass_file: Path | None, workdir: Path, mood: str = "curious") -> Path:
    concat_txt = workdir / "concat.txt"
    lines = []
    for scene in scenes:
        clip = scene.get("clip")
        if clip and Path(clip).exists():
            safe = str(Path(clip).resolve()).replace("'", r"'\''")
            lines.append(f"file '{safe}'\n")
    if not lines:
        raise RuntimeError("No hay clips que montar")
    concat_txt.write_text("".join(lines), encoding="utf-8")

    base = workdir / "base.mp4"
    run_cmd(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(concat_txt),
             "-c", "copy", str(base)], desc="concat escenas")

    encoder = pick_encoder(settings.pr("render", "encoder", default="auto"))
    duration = ffprobe_duration(voice_wav)
    music = _pick_music(settings, mood)
    sfx_events = _sfx_events(settings, scenes, duration)
    out = workdir / "final.mp4"

    # --- inputs
    args = ["ffmpeg", "-y", "-i", str(base), "-i", str(voice_wav)]
    input_idx = 2
    music_idx = -1
    if music:
        args += ["-stream_loop", "-1", "-i", str(music)]
        music_idx = input_idx
        input_idx += 1
    for event in sfx_events:
        args += ["-i", str(event["file"])]
        event["idx"] = input_idx
        input_idx += 1

    # --- audio graph
    filters = []
    mix_label = "1:a"
    if music:
        gain = 10 ** (float(settings.ch("music", "ducking_db", default=-13)) / 20)
        boost = 10 ** (float(settings.ch("music", "climax_boost_db", default=4)) / 20)
        cs, ce = _climax_window(scenes, duration)
        vol = (f"volume='{gain:.3f}*if(between(t,{cs:.2f},{ce:.2f}),{boost:.3f},1)'"
               ":eval=frame")
        filters.append(
            f"[{music_idx}:a]{vol},afade=t=out:st={max(0.0, duration - 2):.2f}:d=2[bg];"
            "[bg][1:a]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=400"
            ":level_sc=1[duck];"
            "[1:a][duck]amix=inputs=2:duration=first:normalize=0[mix1]"
        )
        mix_label = "[mix1]"
    if sfx_events:
        sfx_labels = []
        for k, event in enumerate(sfx_events):
            delay = max(0, int(event["at"] * 1000))
            filters.append(
                f"[{event['idx']}:a]adelay={delay}:all=1,"
                f"volume={event['gain']:.3f}[sfx{k}]")
            sfx_labels.append(f"[sfx{k}]")
        src_label = mix_label if mix_label.startswith("[") else f"[{mix_label}]"
        filters.append(
            f"{src_label}{''.join(sfx_labels)}"
            f"amix=inputs={1 + len(sfx_labels)}:duration=first:normalize=0[aout]")
        mix_label = "[aout]"

    # --- video graph
    vf = []
    if ass_file and ass_file.exists():
        ass_escaped = _escape_filter_path(ass_file)
        fonts_dir = _escape_filter_path(ROOT / "assets" / "fonts")
        vf.append(f"subtitles={ass_escaped}:fontsdir={fonts_dir}")
    vmap = "0:v"
    if vf:
        filters.append(f"[0:v]{','.join(vf)}[vout]")
        vmap = "[vout]"

    if filters:
        args += ["-filter_complex", ";".join(filters)]
    args += ["-map", vmap, "-map", mix_label, "-t", f"{duration:.3f}"]

    if encoder == "h264_nvenc":
        args += ["-c:v", "h264_nvenc", "-preset", settings.pr("render", "preset", default="p5"),
                 "-rc", "vbr", "-cq", str(settings.pr("render", "crf", default=18)),
                 "-b:v", settings.pr("render", "bitrate", default="10M"),
                 "-maxrate", "20M", "-bufsize", "30M"]
    else:
        args += ["-c:v", "libx264", "-preset", "medium",
                 "-crf", str(settings.pr("render", "crf", default=18))]
    args += ["-pix_fmt", "yuv420p", "-r", str(settings.fps),
             "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
             "-movflags", "+faststart", str(out)]

    run_cmd(args, desc=f"render final ({encoder})")
    log("assemble", "video montado", file=out.name, mood=mood,
        sfx=len(sfx_events), seconds=round(ffprobe_duration(out), 1),
        encoder=encoder)
    return out


# ------------------------------------------------------------------ audio
def _pick_music(settings: Settings, mood: str) -> Path | None:
    if not settings.ch("music", "enabled", default=True):
        return None
    music_dir = ROOT / settings.ch("music", "directory", default="assets/music")
    if not music_dir.exists():
        return None
    tracks = sorted([*music_dir.glob("*.mp3"), *music_dir.glob("*.wav"),
                     *music_dir.glob("*.m4a")])
    if not tracks:
        log("assemble", "sin musica: pon pistas en assets/music (YouTube Audio Library)")
        return None
    matching = [t for t in tracks if mood.lower() in t.stem.lower()]
    track = random.choice(matching or tracks)
    log("assemble", "musica elegida", track=track.name, mood=mood,
        by_mood=bool(matching))
    return track


def _climax_window(scenes: list[dict], duration: float) -> tuple[float, float]:
    for scene in scenes:
        if int(scene.get("energy", 1)) == 3 and "start" in scene:
            return float(scene["start"]), min(float(scene["end"]), duration)
    return duration, duration  # sin climax -> sin boost


def _sfx_events(settings: Settings, scenes: list[dict], duration: float) -> list[dict]:
    if not settings.ch("sfx", "enabled", default=True):
        return []
    gain = 10 ** (float(settings.ch("sfx", "volume_db", default=-16)) / 20)
    files = {kind: ROOT / str(settings.ch("sfx", kind, default=""))
             for kind in ("transition", "overlay", "riser")}

    events: list[dict] = []
    for i, scene in enumerate(scenes):
        start = float(scene.get("start", 0))
        if i > 0 and scene.get("transition") in ("punch", "flash", "whip") \
                and files["transition"].is_file():
            events.append({"file": files["transition"], "at": max(0.0, start - 0.15),
                           "gain": gain})
        if str(scene.get("overlay", "")).strip() and files["overlay"].is_file():
            events.append({"file": files["overlay"], "at": start + 0.08,
                           "gain": gain * 0.8})
    for scene in scenes:
        if int(scene.get("energy", 1)) == 3 and files["riser"].is_file():
            events.append({"file": files["riser"],
                           "at": max(0.0, float(scene.get("start", 0)) - 2.5),
                           "gain": gain * 0.7})
            break
    return [e for e in events if e["at"] < duration][:10]


def _escape_filter_path(path: Path) -> str:
    # ffmpeg filter args en Windows: escapar \ y :
    p = str(path.resolve()).replace("\\", "/").replace(":", r"\:")
    return f"'{p}'"
