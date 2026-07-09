"""Subtitulos karaoke: faster-whisper (timestamps por palabra) -> ASS.

Formato que domina en Shorts: 2-3 palabras en pantalla, palabra activa resaltada.
En modo simulate se estiman los tiempos repartiendo la duracion entre palabras.
"""
from __future__ import annotations

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
Style: Caption,{font},{size},{base},{base},{outline},&H96000000,-1,0,0,0,100,100,0,0,1,{border},0,2,60,60,{margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""


def build_ass(settings: Settings, words: list[Word], out_ass: Path) -> Path:
    w, h = settings.size
    group_size = int(settings.ch("captions", "words_per_group", default=3))
    active = settings.ch("captions", "active_color", default="&H0051D9F0&").strip("&")
    base = settings.ch("captions", "base_color", default="&H00FFFFFF&").strip("&")
    outline = settings.ch("captions", "outline_color", default="&H00101010&").strip("&")
    font = settings.ch("captions", "font", default="Arial Black")

    size = int(h * 0.045) if settings.fmt == "short" else int(h * 0.055)
    margin_v = int(h * 0.28) if settings.fmt == "short" else int(h * 0.08)

    lines = [ASS_HEADER.format(w=w, h=h, font=font, size=size, base=f"&{base}&",
                               outline=f"&{outline}&", border=max(2, size // 14),
                               margin_v=margin_v)]

    groups = [words[i:i + group_size] for i in range(0, len(words), group_size)]
    for group in groups:
        for idx, word in enumerate(group):
            start, end = word.start, (group[idx + 1].start if idx + 1 < len(group) else group[-1].end)
            if end <= start:
                end = start + 0.05
            parts = []
            for j, other in enumerate(group):
                token = _ass_escape(other.text)
                if j == idx:
                    parts.append(f"{{\\c&{active}&\\fscx108\\fscy108}}{token}{{\\r}}")
                else:
                    parts.append(token)
            text = " ".join(parts)
            lines.append(
                f"Dialogue: 0,{_ts(start)},{_ts(end)},Caption,,0,0,0,,{text}\n"
            )

    out_ass.write_text("".join(lines), encoding="utf-8-sig")
    log("subs", "ASS karaoke generado", groups=len(groups), file=out_ass.name)
    return out_ass


def _ts(seconds: float) -> str:
    cs = int(round(seconds * 100))
    h, rem = divmod(cs, 360000)
    m, rem = divmod(rem, 6000)
    s, cs = divmod(rem, 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def _ass_escape(text: str) -> str:
    return text.replace("{", "(").replace("}", ")").replace("\n", " ")
