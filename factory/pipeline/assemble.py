"""Montaje final con FFmpeg: concat de escenas + voz + musica con ducking +
subtitulos karaoke, encoding NVENC (fallback libx264)."""
from __future__ import annotations

import random
from pathlib import Path

from ..config import ROOT, Settings
from ..utils import ffprobe_duration, log, pick_encoder, run_cmd


def assemble(settings: Settings, scenes: list[dict], voice_wav: Path,
             ass_file: Path | None, workdir: Path) -> Path:
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
    music = _pick_music(settings)
    out = workdir / "final.mp4"

    args = ["ffmpeg", "-y", "-i", str(base), "-i", str(voice_wav)]
    filters = []
    if music:
        args += ["-stream_loop", "-1", "-i", str(music)]
        duck = float(settings.ch("music", "ducking_db", default=-13))
        gain = 10 ** (duck / 20)
        filters.append(
            f"[2:a]volume={gain:.3f},afade=t=out:st={max(0.0, duration - 2):.2f}:d=2[bg];"
            "[1:a][bg]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=400"
            ":level_sc=1[mixbg];"
            "[1:a][mixbg]amix=inputs=2:duration=first:weights=1 0.9[aout]"
        )
        amap = "[aout]"
    else:
        amap = "1:a"

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
    args += ["-map", vmap, "-map", amap, "-t", f"{duration:.3f}"]

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
    log("assemble", "video montado", file=out.name,
        seconds=round(ffprobe_duration(out), 1), encoder=encoder)
    return out


def _pick_music(settings: Settings) -> Path | None:
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
    return random.choice(tracks)


def _escape_filter_path(path: Path) -> str:
    # ffmpeg filter args en Windows: escapar \ y :
    p = str(path.resolve()).replace("\\", "/").replace(":", r"\:")
    return f"'{p}'"
