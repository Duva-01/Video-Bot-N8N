"""Utilidades: logging, subprocess, ffprobe, deteccion NVENC."""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
import time
import unicodedata
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def log(stage: str, message: str, **meta) -> None:
    entry = {"ts": time.strftime("%H:%M:%S"), "stage": stage, "msg": message}
    entry.update(meta)
    print(json.dumps(entry, ensure_ascii=False), flush=True)


def die(message: str) -> None:
    print(f"[factory][error] {message}", file=sys.stderr, flush=True)
    raise SystemExit(1)


def run_cmd(args: list[str], desc: str = "", check: bool = True) -> subprocess.CompletedProcess:
    resolved = _resolve_cmd(args)
    log("cmd", desc or args[0], cmd=" ".join(str(a) for a in resolved[:6]) + (" ..." if len(resolved) > 6 else ""))
    proc = subprocess.run(resolved, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if check and proc.returncode != 0:
        tail = (proc.stderr or "")[-2000:]
        die(f"{desc or args[0]} fallo (rc={proc.returncode}):\n{tail}")
    return proc


def slugify(text: str, max_len: int = 60) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    text = re.sub(r"[^a-zA-Z0-9]+", "-", text).strip("-").lower()
    return text[:max_len] or "run"


def ffprobe_duration(path: str | Path) -> float:
    proc = run_cmd(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(path)],
        desc="ffprobe",
    )
    try:
        return float(proc.stdout.strip())
    except ValueError:
        return 0.0


@lru_cache(maxsize=1)
def pick_encoder(preferred: str = "auto") -> str:
    """Devuelve h264_nvenc si esta disponible; si no, libx264."""
    if preferred not in ("auto", "h264_nvenc"):
        return preferred
    ffmpeg = find_tool("ffmpeg")
    if not ffmpeg:
        return "libx264"
    proc = subprocess.run(
        [ffmpeg, "-hide_banner", "-encoders"], capture_output=True, text=True
    )
    if "h264_nvenc" in (proc.stdout or ""):
        test = subprocess.run(
            [ffmpeg, "-v", "error", "-f", "lavfi", "-i", "color=black:s=256x256:d=0.2",
             "-c:v", "h264_nvenc", "-f", "null", "-"],
            capture_output=True, text=True,
        )
        if test.returncode == 0:
            return "h264_nvenc"
    return "libx264"


def find_tool(name: str) -> str | None:
    found = shutil.which(name)
    if found:
        return found

    exe = f"{name}.exe" if not name.lower().endswith(".exe") else name
    candidates = [
        ROOT / ".tools" / "ffmpeg" / "bin" / exe,
        ROOT / ".tools" / "ffmpeg" / exe,
    ]
    candidates += sorted((ROOT / ".tools" / "ffmpeg").glob(f"**/bin/{exe}"))
    for candidate in candidates:
        if candidate.exists():
            return str(candidate)
    return None


def _resolve_cmd(args: list[str]) -> list[str]:
    if not args:
        return args
    first = str(args[0])
    if first.lower() in {"ffmpeg", "ffmpeg.exe", "ffprobe", "ffprobe.exe"}:
        resolved = find_tool(first)
        if resolved:
            return [resolve