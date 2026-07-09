"""End-card animada: LIKE - COMMENT - SUBSCRIBE con el branding del canal.

Se genera UNA vez con Pillow + ffmpeg y se cachea en assets/branding/;
despues se anade al final de cada video sin coste de render adicional.
"""
from __future__ import annotations

from pathlib import Path

from ..config import ASSETS_DIR, ROOT, Settings
from ..utils import ffprobe_duration, log, run_cmd

BG = (15, 23, 32)        # azul petroleo del canal
IVORY = (217, 210, 195)
GOLD = (140, 106, 67)
AMBER = (240, 217, 81)


def ensure_outro(settings: Settings) -> Path | None:
    """Devuelve el mp4 de outro cacheado (lo crea si no existe)."""
    if not settings.ch("outro", "enabled", default=True):
        return None
    w, h = settings.size
    fps = settings.fps
    out = ASSETS_DIR / "branding" / f"outro-{w}x{h}-{fps}.mp4"
    if out.exists():
        if ffprobe_duration(out) > 0.5:
            return out
        log("outro", "cache de outro corrupta; regenerando", file=out.name)
        out.unlink(missing_ok=True)
    try:
        _build(settings, out, w, h, fps)
        if ffprobe_duration(out) > 0.5:
            return out
        log("outro", "outro generado invalido; se omite")
        out.unlink(missing_ok=True)
        return None
    except Exception as exc:
        log("outro", f"no se pudo generar el outro ({exc})")
        return None


def _build(settings: Settings, out: Path, w: int, h: int, fps: int) -> None:
    from PIL import Image, ImageDraw

    seconds = float(settings.ch("outro", "seconds", default=3.2))
    headline = str(settings.ch("outro", "headline", default="ENJOYED THE THREAD?"))
    actions = [a for a in str(settings.ch(
        "outro", "actions", default="LIKE   COMMENT   SUBSCRIBE")).split() if a]
    channel = str(settings.ch("channel", "name", default="")).upper()

    total = max(2, int(seconds * fps))
    frames_dir = out.parent / "outro-frames"
    frames_dir.mkdir(parents=True, exist_ok=True)

    # tamanos auto-ajustados al ancho (medidos con la fuente real)
    probe = ImageDraw.Draw(Image.new("RGB", (8, 8)))
    f_head = _fit_font(probe, headline, int(h * 0.045), int(w * 0.86))
    gap = int(w * 0.06)
    f_act = _fit_font(probe, "  ".join(actions[:3]), int(h * 0.038),
                      int(w * 0.88) - gap * 2)
    f_brand = _fit_font(probe, channel, int(h * 0.022), int(w * 0.7))

    # posiciones x de las acciones, repartidas segun su ancho real
    widths = [probe.textlength(a, font=f_act) for a in actions[:3]]
    total_w = sum(widths) + gap * (len(widths) - 1)
    xs, cursor = [], (w - total_w) / 2
    for tw in widths:
        xs.append(cursor + tw / 2)
        cursor += tw + gap

    for f in range(total):
        t = f / fps
        img = Image.new("RGB", (w, h), BG)
        draw = ImageDraw.Draw(img)

        # linea dorada que se dibuja (0 - 0.5s)
        line_p = min(1.0, t / 0.5)
        lw = int(w * 0.62 * _ease(line_p))
        draw.rectangle([(w - lw) // 2, int(h * 0.40), (w + lw) // 2,
                        int(h * 0.40) + max(2, h // 480)], fill=GOLD)

        # nombre del canal (aparece 0.2s)
        if t > 0.2:
            a = _ease(min(1.0, (t - 0.2) / 0.35))
            _text_center(draw, channel, f_brand, w, int(h * 0.355),
                         _mix(BG, IVORY, a))

        # headline (0.5s, rise + fade)
        if t > 0.5:
            a = _ease(min(1.0, (t - 0.5) / 0.4))
            y = int(h * 0.455 + (1 - a) * h * 0.02)
            _text_center(draw, headline, f_head, w, y, _mix(BG, IVORY, a))

        # acciones con stagger (1.0s, 1.25s, 1.5s): fade + rise, sin escalar
        for i, action in enumerate(actions[:3]):
            t0 = 1.0 + i * 0.25
            if t <= t0:
                continue
            a = _ease(min(1.0, (t - t0) / 0.3))
            color = _mix(BG, AMBER if i == 2 else IVORY, a)
            y = int(h * 0.545 + (1 - a) * h * 0.015)
            _text_center(draw, action, f_act, None, y, color, cx=int(xs[i]))

        img.save(frames_dir / f"o{f:05d}.png")

    run_cmd(["ffmpeg", "-y", "-framerate", str(fps),
             "-i", str(frames_dir / "o%05d.png"),
             "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono",
             "-t", f"{seconds:.2f}", "-shortest",
             "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "veryfast",
             "-crf", "18", "-c:a", "aac", "-b:a", "96k", str(out)],
            desc="outro end-card")
    for p in frames_dir.glob("*.png"):
        p.unlink()
    frames_dir.rmdir()
    log("outro", "end-card generada y cacheada", file=out.name)


def _fit_font(draw, text: str, size: int, max_width: int):
    """Reduce el tamano hasta que el texto quepa en max_width."""
    while size > 8:
        font = _font(size)
        if draw.textlength(text, font=font) <= max_width:
            return font
        size = int(size * 0.94)
    return _font(size)


def _font(size: int):
    from PIL import ImageFont

    fonts_dir = ROOT / "assets" / "fonts"
    for ttf in sorted(fonts_dir.glob("*.ttf")) + sorted(fonts_dir.glob("*.otf")):
        try:
            return ImageFont.truetype(str(ttf), size)
        except OSError:
            continue
    for name in ("arialbd.ttf", "Arial Bold.ttf", "DejaVuSans-Bold.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    from PIL import ImageFont as F
    return F.load_default()


def _text_center(draw, text: str, font, w, y: int, color, cx=None) -> None:
    tw = draw.textlength(text, font=font)
    x = (cx - tw / 2) if cx is not None else (w - tw) / 2
    draw.text((x, y), text, font=font, fill=color)


def _ease(p: float) -> float:
    return 1 - (1 - p) ** 3  # ease-out cubic


def _mix(a, b, p: float):
    return tuple(int(x + (y - x) * p) for x, y in zip(a, b))
