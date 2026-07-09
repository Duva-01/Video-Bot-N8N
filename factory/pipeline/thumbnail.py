"""Miniaturas para longform: imagen FLUX + texto grande con Pillow.

Genera N variantes para test A/B. En modo simulate usa fondos planos.
"""
from __future__ import annotations

from pathlib import Path

from .. import comfy
from ..config import Settings
from ..llm import generate
from ..utils import log

THUMB_PROMPT = """Design {n} YouTube thumbnail concepts for this video.

Title: {title}
Summary: {summary}

Each concept: one dominant visual idea (a symbol, object or moment — not a collage)
plus overlay text of MAX {max_words} words, high contrast, no clickbait lies.

Return ONLY JSON: [{{"image_prompt": "...", "text": "..."}}]
"""


def make_thumbnails(settings: Settings, meta: dict, workdir: Path) -> list[Path]:
    n = int(settings.pr("thumbnail", "variants", default=3))
    max_words = int(settings.pr("thumbnail", "text_max_words", default=5))
    concepts = generate(settings, THUMB_PROMPT.format(
        n=n, title=meta.get("title", ""), summary=meta.get("summary", ""),
        max_words=max_words))
    if isinstance(concepts, dict):
        concepts = [concepts]

    out_paths = []
    for i, concept in enumerate(concepts[:n]):
        base = workdir / f"thumb-{i}-base.png"
        final = workdir / f"thumb-{i}.png"
        try:
            if settings.simulate:
                _flat_background(base)
            else:
                comfy.generate_image(settings, concept["image_prompt"], base,
                                     width=1280, height=720)
            _overlay_text(base, final, str(concept.get("text", ""))[:60])
            out_paths.append(final)
        except Exception as exc:
            log("thumbnail", f"variante {i} fallo: {exc}")
    log("thumbnail", "miniaturas listas", count=len(out_paths))
    return out_paths


def _flat_background(out: Path) -> None:
    from PIL import Image

    Image.new("RGB", (1280, 720), (15, 23, 32)).save(out)


def _overlay_text(base: Path, out: Path, text: str) -> None:
    from PIL import Image, ImageDraw, ImageFont

    img = Image.open(base).convert("RGB").resize((1280, 720))
    draw = ImageDraw.Draw(img, "RGBA")
    # franja inferior para legibilidad
    draw.rectangle([(0, 460), (1280, 720)], fill=(10, 14, 20, 160))

    font = None
    for name in ("arialbd.ttf", "Arial Bold.ttf", "DejaVuSans-Bold.ttf"):
        try:
            font = ImageFont.truetype(name, 92)
            break
        except OSError:
            continue
    font = font or ImageFont.load_default()

    words = text.upper().split()
    lines, line = [], ""
    for word in words:
        trial = f"{line} {word}".strip()
        if draw.textlength(trial, font=font) > 1160 and line:
            lines.append(line)
            line = word
        else:
            line = trial
    lines.append(line)

    y = 700 - len(lines) * 104
    for ln in lines:
        x = (1280 - draw.textlength(ln, font=font)) / 2
        draw.text((x + 4, y + 4), ln, font=font, fill=(0, 0, 0))
        draw.text((x, y), ln, font=font, fill=(217, 210, 195))
        y += 104
    img.save(out, quality=92)
