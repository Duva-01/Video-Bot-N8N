"""TTS local en GPU con direccion de actor y mastering.

- Chatterbox (calidad) / Kokoro (velocidad); voz de narrador configurable y
  clonable con assets/voice/narrator.wav.
- La expresividad sube con la energia de cada escena (1-3) y se insertan
  pausas dramaticas antes de las escenas marcadas con pause_before.
- Mastering con ffmpeg: highpass + de-esser + compresion + loudnorm -14 LUFS.

En modo simulate genera un tono con ffmpeg (sin GPU).
"""
from __future__ import annotations

from pathlib import Path

from ..config import ROOT, Settings
from ..utils import ffprobe_duration, log, run_cmd


def synthesize(settings: Settings, narration: str, out_wav: Path,
               scenes: list[dict] | None = None) -> float:
    """Genera la voz (con enfasis y pausas por escena) y devuelve su duracion."""
    out_wav.parent.mkdir(parents=True, exist_ok=True)
    chunks = _chunks(narration, scenes)
    raw_wav = out_wav.with_suffix(".raw.wav")

    if settings.simulate:
        _simulated_voice(narration, raw_wav)
    else:
        provider = settings.ch("voice", "provider", default="chatterbox")
        try:
            if provider == "kokoro":
                _kokoro(settings, chunks, raw_wav)
            else:
                _chatterbox(settings, chunks, raw_wav)
        except ImportError as exc:
            log("voice", f"{provider} no instalado ({exc}); usando Kokoro")
            _kokoro(settings, chunks, raw_wav)

    if settings.ch("voice", "mastering", default=True):
        _master(raw_wav, out_wav)
    else:
        raw_wav.replace(out_wav)

    duration = ffprobe_duration(out_wav)
    log("voice", "voz generada", seconds=round(duration, 1), file=out_wav.name,
        chunks=len(chunks))
    return duration


def _chunks(narration: str, scenes: list[dict] | None) -> list[dict]:
    """[(texto, energia, pausa_antes)] por escena, o por parrafos si no hay plan."""
    if scenes:
        return [{"text": s["text"], "energy": int(s.get("energy", 1)),
                 "pause_before": bool(s.get("pause_before", False))}
                for s in scenes if str(s.get("text", "")).strip()]
    return [{"text": c.strip(), "energy": 2, "pause_before": False}
            for c in narration.split("\n\n") if c.strip()]


# ---------------------------------------------------------------- motores
def _chatterbox(settings: Settings, chunks: list[dict], out_wav: Path) -> None:
    import torch
    import torchaudio
    from chatterbox.tts import ChatterboxTTS

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = ChatterboxTTS.from_pretrained(device=device)
    ref = settings.ch("voice", "reference_audio")
    if ref:
        ref = str((ROOT / ref).resolve())

    energy_map = settings.ch("voice", "energy_exaggeration",
                             default={1: 0.32, 2: 0.42, 3: 0.58}) or {}
    base = float(settings.ch("voice", "exaggeration", default=0.4))
    cfg_w = float(settings.ch("voice", "cfg_weight", default=0.5))
    pause = float(settings.ch("voice", "pause_seconds", default=0.45))

    waves = []
    for chunk in chunks:
        if chunk["pause_before"] and waves:
            waves.append(torch.zeros(1, int(pause * model.sr)))
        exag = float(energy_map.get(chunk["energy"], energy_map.get(str(chunk["energy"]), base)))
        wav = model.generate(chunk["text"], audio_prompt_path=ref,
                             exaggeration=exag, cfg_weight=cfg_w)
        waves.append(wav)
    full = torch.cat(waves, dim=-1)
    torchaudio.save(str(out_wav), full, model.sr)

    del model
    if device == "cuda":
        torch.cuda.empty_cache()


def _kokoro(settings: Settings, chunks: list[dict], out_wav: Path) -> None:
    import numpy as np
    import soundfile as sf
    from kokoro import KPipeline

    voice = settings.ch("voice", "kokoro_voice", default="bm_george")
    pause = float(settings.ch("voice", "pause_seconds", default=0.45))
    pipe = KPipeline(lang_code=voice[0])  # 'a' EN-US, 'b' EN-GB

    segments = []
    for chunk in chunks:
        if chunk["pause_before"] and segments:
            segments.append(np.zeros(int(pause * 24000), dtype=np.float32))
        for _, _, audio in pipe(chunk["text"], voice=voice):
            segments.append(audio)
    sf.write(str(out_wav), np.concatenate(segments), 24000)


# ------------------------------------------------------------- mastering
def _master(raw: Path, out: Path) -> None:
    """Voz 'producida': EQ, de-esser, compresion y loudness de plataforma."""
    run_cmd(
        ["ffmpeg", "-y", "-i", str(raw),
         "-af",
         "highpass=f=75,"
         "deesser=i=0.32,"
         "acompressor=threshold=-20dB:ratio=3:attack=8:release=180:makeup=3,"
         "loudnorm=I=-14:TP=-1.5:LRA=11",
         "-ar", "48000", "-ac", "1", str(out)],
        desc="mastering de voz",
    )
    raw.unlink(missing_ok=True)


def _simulated_voice(text: str, out_wav: Path) -> None:
    # ~2.6 palabras/segundo de narracion tranquila
    seconds = max(3.0, len(text.split()) / 2.6)
    run_cmd(
        ["ffmpeg", "-y", "-f", "lavfi", "-i", f"sine=frequency=220:duration={seconds:.2f}",
         "-ar", "24000", "-ac", "1", str(out_wav)],
        desc="voz simulada",
    )
