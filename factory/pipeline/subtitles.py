"""Subtitulos karaoke con diseno propio + overlays de datos + hook cover.

- faster-whisper da timestamps por palabra.
- Captions: 2-3 palabras, palabra activa con "pop" animado en ambar; las
  palabras de impacto (numeros, nombres, giros) van en color fuego y mas
  grandes aunque no esten activas.
- Overlays: datos gigantes en pantalla ("1859") con fade + escala.
- Hook cover: el hook en grande durante el primer segundo (el frame 1 es la
  miniatura del short en el feed).

En modo simulate se estiman los tiempos repartiendo la duracion entre palabras.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from ..config import Settings
from ..utils import log


@dataclass
class Word:
    text: str
    start: float
    end: float


def transcribe(settings: Settings, wav: Path, narration: str, duration: float) -> list[Word]:
    if settings.simulate:
        return _estimate(narration, duration)

    from faster_whisper import WhisperModel

    model_name = settings.ch("services", "whisper_model", default="large-v3")
    compute = settings.ch("services", "whisper_compute", default="float16")
    try:
        model = WhisperModel(model_name, device="cuda", compute_type=compute)
    except Exception:  # sin CUDA -> CPU
        model = WhisperModel(model_name, device="cpu", compute_type="int8")

    segments, _ = model.transcribe(
        str(wav), language=settings.ch("channel", "language", default="en"),
        word_timestamps=True, vad_filter=True,
        initial_prompt=narration[:800],
    )
    words: list[Word] = []
    for seg in segments:
        for w in seg.words or []:
            words.append(Word(w.word.strip(), float(w.start), float(w.end)))
    del model
    log("subs", "transcripcion lista", words=len(words))
    return words


def _estimate(narration: str, duration: float) -> list[Word]:
    tokens = narration.split()
    if not tokens:
        return []
    step = duration / len(tokens)
    return [Word(t, i * step, (i + 1) * step) for i, t in enumerate(tokens)]


# ------------------------------------------------------------------ ASS
ASS_HEADER = """[Script Info]
ScriptType: v4.00+
PlayResX: {w}
PlayResY: {h}
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,{font},{size},{base},{base},{outline},&H78000000,-1,0,0,0,100,100,1,0,1,{border},2,2,60,60,{margin_v},1
Style: Overlay,{overlay_font},{overlay_size},{emphasis},{emphasis},{outline},&H96000000,-1,0,0,0,100,100,2,0,1,{overlay_border},3,8,60,60,{overlay_margin},1
Style: Cover,{cover_font},{cover_size},{base},{base},{outline},&H96000000,-1,0,0,0,100,100,1,0,1,{border},3,5,80,80,0,1
Style: Brand,{font},{brand_size},{base},{base},{outline},&H00000000,-1,0,0,0,100,100,3,0,1,2,0,8,60,60,{brand_margin},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""


def build_ass(settings: Settings, words: list[Word], out_ass: Path,
              scenes: list[dict] | None = None, hook: str | None = None) -> Path:
    w, h = settings.size
    group_size = int(settings.ch("captions", "words_per_group", default=3))
    if settings.fmt == "short":
        group_size = min(group_size, 2)
    active = _c(settings.ch("captions", "active_color", default="&H0051D9F0&"))
    base = _c(settings.ch("captions", "base_color", default="&H00FFFFFF&"))
    emphasis_c = _c(settings.ch("captions", "emphasis_color", default="&H002E86FF&"))
    outline = _c(settings.ch("captions", "outline_color", default="&H00101010&"))
    font = settings.ch("captions", "font", default="Arial Black")
    overlay_font = settings.ch("captions", "overlay_font", default=None) or font
    cover_font = settings.ch("captions", "cover_font", default=None) or font
    upper = bool(settings.ch("captions", "uppercase", default=True))
    pop = bool(settings.ch("captions", "pop", default=True))

    size = int(h * 0.042) if settings.fmt == "short" else int(h * 0.055)
    margin_v = int(h * 0.30) if settings.fmt == "short" else int(h * 0.08)
    overlay_size = int(h * 0.10)
    cover_size = int(h * 0.052)

    lines = [ASS_HEADER.format(
        w=w, h=h, font=font, overlay_font=overlay_font, cover_font=cover_font,
        size=size, base=base, outline=outline,
        emphasis=emphasis_c, border=max(3, size // 12),
        margin_v=margin_v, overlay_size=overlay_size,
        overlay_border=max(4, overlay_size // 14),
        overlay_margin=int(h * 0.16), cover_size=cover_size,
        brand_size=int(h * 0.016), brand_margin=int(h * 0.032))]

    emphasis_words = _emphasis_set(scenes)

    # --- captions karaoke
    groups = [words[i:i + group_size] for i in range(0, len(words), group_size)]
    for group in groups:
        for idx, word in enumerate(group):
            start = word.start
            end = group[idx + 1].start if idx + 1 < len(group) else group[-1].end
            if end <= start:
                end = start + 0.05
            parts = []
            for j, other in enumerate(group):
                token = _ass_escape(other.text.upper() if upper else other.text)
                is_emph = _norm(other.text) in emphasis_words
                color = emphasis_c if is_emph else (active if j == idx else base)
                tags = f"\\c{color}"
                if is_emph:
                    tags += "\\fscx106\\fscy106"
                if j == idx:
                    if pop:
                        tags += "\\fscx84\\fscy84\\t(0,70,\\fscx112\\fscy112)"
                    else:
                        tags += "\\fscx108\\fscy108"
                parts.append(f"{{{tags}}}{token}{{\\r}}")
            text = " ".join(parts)
            lines.append(f"Dialogue: 1,{_ts(start)},{_ts(end)},Caption,,0,0,0,,{text}\n")

    # --- overlays de datos gigantes
    if scenes and settings.ch("captions", "overlay_enabled", default=True):
        for scene in scenes:
            datum = str(scene.get("overlay", "")).strip()
            if not datum or "start" not in scene:
                continue
            start = float(scene["start"]) + 0.08
            end = min(float(scene["end"]), start + 2.4)
            if end - start < 0.5:
                continue
            text = ("{\\fad(120,220)\\fscx72\\fscy72\\t(0,140,\\fscx100\\fscy100)}"
                    f"{_ass_escape(datum.upper() if upper else datum)}")
            lines.append(f"Dialogue: 2,{_ts(start)},{_ts(end)},Overlay,,0,0,0,,{text}\n")

    # --- hook cover en el primer segundo (frame 1 = miniatura del feed)
    if hook and settings.fmt == "short" and settings.ch(
            "captions", "hook_cover", default=True):
        wrapped = _wrap(hook.upper() if upper else hook, max_chars=18)
        text = ("{\\fad(50,260)\\fscx90\\fscy90\\t(0,120,\\fscx100\\fscy100)}"
                f"{_ass_escape(wrapped)}")
        lines.append(f"Dialogue: 3,{_ts(0.0)},{_ts(1.05)},Cover,,0,0,0,,{text}\n")

    # --- watermark sutil del canal (todo el video)
    if words and settings.ch("captions", "watermark", default=True):
        channel = str(settings.ch("channel", "name", default="")).upper()
        if channel:
            total_end = words[-1].end + 8
            text = f"{{\\alpha&H82&}}{_ass_escape(channel)}"
            lines.append(
                f"Dialogue: 0,{_ts(0.0)},{_ts(total_end)},Brand,,0,0,0,,{text}\n")

    out_ass.write_text("".join(lines), encoding="utf-8-sig")
    log("subs", "ASS generado", groups=len(groups),
        emphasis=len(emphasis_words), file=out_ass.name)
    return out_ass


def _emphasis_set(scenes: list[dict] | None) -> set[str]:
    result: set[str] = set()
    for scene in scenes or []:
        for word in scene.get("emphasis", []) or []:
            for token in str(word).split():
                norm = _norm(token)
                if norm:
                    result.add(norm)
    return result


def _wrap(text: str, max_chars: int = 18) -> str:
    """Envuelve texto largo con \\N (WrapStyle 2 no envuelve solo)."""
    lines, line = [], ""
    for word in text.split():
        trial = f"{line} {word}".strip()
        if len(trial) > max_chars and line:
            lines.append(line)
            line = word
        else:
            line = trial
    lines.append(line)
    return "\\N".join(lines)


def _norm(token: str) -> str:
    return re.sub(r"[^\w]", "", token).lower()


def _c(color: str) -> str:
    color = str(color).strip()
    if not color.startswith("&"):
        color = f"&{color}"
    if not color.endswith("&"):
        color = f"{color}&"
    return color


def _ts(seconds: float) -> str:
    cs = int(round(seconds * 100))
    h, rem = divmod(cs, 360000)
    m, rem = divmod(rem, 6000)
    s, cs = divmod(rem, 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def _ass_escape(text: str) -> str:    return text.replace("{", "(").replace("}", ")").replace("\n", " ")
