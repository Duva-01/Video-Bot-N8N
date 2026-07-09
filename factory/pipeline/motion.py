"""Motores de movimiento y efectos de montaje sobre clips.

- ken_burns: zoom/pan clasico (4 modos) sobre una imagen
- parallax: 2.5D con depth map (Depth-Anything v2 small, local)
- split_image_shots: parte una escena larga en varios shots con movimiento distinto
- apply_transition: punch / flash / whip horneados al inicio del clip
- fit_clip / color_clip: utilidades
"""
from __future__ import annotations

import math
from pathlib import Path

from ..utils import log, run_cmd

MODES = ("zoom_in", "zoom_out", "pan_left", "pan_right")

_depth_pipe = None  # cache del modelo de profundidad


def ken_burns(png: Path, out: Path, duration: float, w: int, h: int,
              fps: int, mode: str = "zoom_in") -> None:
    frames = max(2, int(duration * fps))
    rate = 0.14 / max(frames, 1)
    if mode == "zoom_out":
        zoom = f"max(1.14-{rate:.6f}*on,1.0)"
        x, y = "iw/2-(iw/zoom/2)", "ih/2-(ih/zoom/2)"
    elif mode == "pan_left":
        zoom = "1.14"
        x, y = f"(iw-iw/zoom)*(1-on/{frames})", "ih/2-(ih/zoom/2)"
    elif mode == "pan_right":
        zoom = "1.14"
        x, y = f"(iw-iw/zoom)*(on/{frames})", "ih/2-(ih/zoom/2)"
    else:  # zoom_in
        zoom = f"min(1+{rate:.6f}*on,1.14)"
        x, y = "iw/2-(iw/zoom/2)", "ih/2-(ih/zoom/2)"
    run_cmd(
        ["ffmpeg", "-y", "-loop", "1", "-i", str(png),
         "-vf",
         f"scale={w * 2}:{h * 2}:force_original_aspect_ratio=increase,"
         f"crop={w * 2}:{h * 2},"
         f"zoompan=z='{zoom}':x='{x}':y='{y}':d={frames}:s={w}x{h}:fps={fps}",
         "-t", f"{duration:.3f}", "-r", str(fps), "-pix_fmt", "yuv420p",
         "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-an", str(out)],
        desc=f"ken burns {mode}",
    )


def parallax(png: Path, out: Path, duration: float, w: int, h: int, fps: int) -> None:
    """Parallax 2.5D: 3 capas por profundidad moviendose a distinta velocidad."""
    import numpy as np
    from PIL import Image

    depth = _estimate_depth(png)  # 0..1, mayor = mas cerca
    frames = max(2, int(duration * fps))

    # margen del 8% para poder desplazar sin bordes vacios
    margin = 0.08
    big_w, big_h = int(w * (1 + margin * 2)), int(h * (1 + margin * 2))
    img = Image.open(png).convert("RGB")
    scale = max(big_w / img.width, big_h / img.height)
    img = img.resize((int(img.width * scale) + 1, int(img.height * scale) + 1))
    left, top = (img.width - big_w) // 2, (img.height - big_h) // 2
    arr = np.asarray(img.crop((left, top, left + big_w, top + big_h)), dtype=np.uint8)

    dep = np.asarray(Image.fromarray(
        (depth * 255).astype(np.uint8)).resize((big_w, big_h)), dtype=np.float32) / 255.0
    masks = [dep < 0.4, (dep >= 0.4) & (dep < 0.7), dep >= 0.7]  # bg, mid, fg
    speeds = [0.25, 0.6, 1.0]
    max_shift = int(w * 0.045)  # px de desplazamiento del fg
    off_x, off_y = int(w * margin), int(h * margin)

    frames_dir = out.parent / f"{out.stem}-pframes"
    frames_dir.mkdir(parents=True, exist_ok=True)
    for f in range(frames):
        t = f / max(frames - 1, 1)
        drift = (t - 0.5) * 2 * max_shift  # -max..+max
        frame = arr.copy()
        for mask, speed in zip(masks[1:], speeds[1:]):  # bg queda fijo de base
            shift = int(drift * speed)
            shifted = np.roll(arr, shift, axis=1)
            frame[mask] = shifted[mask]
        crop = frame[off_y:off_y + h, off_x + int(drift * 0.15):off_x + int(drift * 0.15) + w]
        if crop.shape[0] != h or crop.shape[1] != w:
            crop = frame[off_y:off_y + h, off_x:off_x + w]
        Image.fromarray(crop).save(frames_dir / f"p{f:05d}.png")

    run_cmd(["ffmpeg", "-y", "-framerate", str(fps),
             "-i", str(frames_dir / "p%05d.png"),
             "-t", f"{duration:.3f}", "-pix_fmt", "yuv420p",
             "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", str(out)],
            desc="parallax 2.5D")
    for p in frames_dir.glob("*.png"):
        p.unlink()
    frames_dir.rmdir()


def blurpad_still(png: Path, out_png: Path, w: int, h: int) -> Path:
    """Encaja una foto de archivo en 9:16 estilo documental: la foto entera
    centrada sobre su propia version ampliada, difuminada y oscurecida.
    Evita recortes brutales en fotos horizontales."""
    from PIL import Image, ImageEnhance, ImageFilter

    img = Image.open(png).convert("RGB")
    src_ratio, dst_ratio = img.width / img.height, w / h
    if abs(src_ratio - dst_ratio) < 0.18:  # aspecto parecido: cover normal
        img.save(out_png, quality=92)
        return out_png

    # fondo: cover + blur + oscurecer
    scale = max(w / img.width, h / img.height)
    bg = img.resize((int(img.width * scale) + 1, int(img.height * scale) + 1))
    left, top = (bg.width - w) // 2, (bg.height - h) // 2
    bg = bg.crop((left, top, left + w, top + h))
    bg = bg.filter(ImageFilter.GaussianBlur(36))
    bg = ImageEnhance.Brightness(bg).enhance(0.55)

    # frente: contain (la foto entera, ~86% del ancho/alto)
    fit = min((w * 0.92) / img.width, (h * 0.92) / img.height)
    fg = img.resize((max(1, int(img.width * fit)), max(1, int(img.height * fit))))
    bg.paste(fg, ((w - fg.width) // 2, (h - fg.height) // 2))
    bg.save(out_png, quality=92)
    return out_png


def _estimate_depth(png: Path):
    """Depth map 0..1 con Depth-Anything V2 small (una sola carga)."""
    global _depth_pipe
    import numpy as np

    if _depth_pipe is None:
        from transformers import pipeline as hf_pipeline
        try:
            import torch
            device = 0 if torch.cuda.is_available() else -1
        except ImportError:
            device = -1
        _depth_pipe = hf_pipeline("depth-estimation",
                                  model="depth-anything/Depth-Anything-V2-Small-hf",
                                  device=device)
    from PIL import Image
    img = Image.open(png).convert("RGB")
    img.thumbnail((640, 640))
    result = _depth_pipe(img)
    depth = np.asarray(result["depth"], dtype=np.float32)
    rng = depth.max() - depth.min()
    return (depth - depth.min()) / (rng if rng > 0 else 1.0)


def split_image_shots(png: Path, out: Path, duration: float, max_shot: float,
                      w: int, h: int, fps: int, start_mode_idx: int = 0) -> None:
    """Escena larga -> varios shots del mismo asset con movimiento distinto."""
    n = max(1, math.ceil(duration / max_shot))
    part = duration / n
    parts = []
    for i in range(n):
        sub = out.parent / f"{out.stem}-shot{i}.mp4"
        ken_burns(png, sub, part, w, h, fps, MODES[(start_mode_idx + i) % len(MODES)])
        parts.append(sub)
    if n == 1:
        parts[0].replace(out)
        return
    concat_txt = out.parent / f"{out.stem}-shots.txt"
    concat_txt.write_text(
        "".join(f"file '{str(p.resolve())}'\n" for p in parts), encoding="utf-8")
    run_cmd(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(concat_txt),
             "-c", "copy", str(out)], desc=f"concat {n} shots")


def apply_transition(clip: Path, kind: str, w: int, h: int, fps: int) -> None:
    """Hornea el efecto de entrada al principio del clip (in-place)."""
    if kind not in ("punch", "flash", "whip"):
        return
    n = max(2, int(0.18 * fps))
    punch = (f"zoompan=z='if(lte(on,{n}),1.14-0.14*on/{n},1)'"
             f":x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s={w}x{h}:fps={fps}")
    if kind == "punch":
        vf = punch
    elif kind == "flash":
        vf = f"{punch},fade=t=in:st=0:d=0.1:color=white"
    else:  # whip
        vf = f"{punch},boxblur=luma_radius=10:luma_power=1:enable='lte(t,0.13)'"
    tmp = clip.with_suffix(".trans.mp4")
    run_cmd(["ffmpeg", "-y", "-i", str(clip), "-vf", vf,
             "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "veryfast",
             "-crf", "18", "-an", str(tmp)], desc=f"transicion {kind}")
    tmp.replace(clip)


def fit_clip(raw: Path, out: Path, duration: float, w: int, h: int, fps: int) -> None:
    run_cmd(
        ["ffmpeg", "-y", "-i", str(raw),
         "-vf", f"scale={w}:{h}:force_original_aspect_ratio=increase,"
                f"crop={w}:{h},fps={fps}",
         "-t", f"{duration:.3f}", "-pix_fmt", "yuv420p",
         "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-an", str(out)],
        desc="ajustar clip",
    )


def color_clip(out: Path, duration: float, w: int, h: int, fps: int, idx: int) -> None:
    palette = ["0x0F1720", "0x1B2733", "0x22303C", "0x101C26"]
    color = palette[idx % len(palette)]
    run_cmd(
        ["ffmpeg", "-y", "-f", "lavfi",
         "-i", f"color=c={color}:s={w}x{h}:d={duration:.3f}:r={fps}",
         "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "veryfast", str(out)],
        desc="clip de color",
    )
