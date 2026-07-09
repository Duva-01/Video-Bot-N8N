"""TTS local en GPU: Chatterbox (calidad) con fallback a Kokoro (velocidad).

Los modelos se cargan, generan y se liberan para dejar VRAM al resto de etapas.
En modo simulate genera un tono con ffmpeg (sin GPU).
"""
from __future__ import annotations

from pathlib import Path

from ..config import ROOT, Settings
from ..utils import ffprobe_duration, log, run_cmd


def synthesize(settings: Settings, text: str, out_wav: Path) -> float:
    """Genera la voz en out_wav y devuelve la duracion en segundos."""
    out_wav.parent.mkdir(parents=True, exist_ok=True)
    if settings.simulate:
        _simulated_voice(text, out_wav)
    else:
        provider = settings.ch("voice", "provider", default="chatterbox")
        try:
            if provider == "kokoro":
                _kokoro(settings, text, out_wav)
            else:
                _chatterbox(settings, text, out_wav)
        except ImportError as exc:
            log("voice", f"{provider} no instalado ({exc}); usando Kokoro")
            _kokoro(settings, text, out_wav)
    duration = ffprobe_duration(out_wav)
    log("voice", "voz generada", seconds=round(duration, 1), file=out_wav.name)
    return duration


def _chatterbox(settings: Settings, text: str, out_wav: Path) -> None:
    import torch
    import torchaudio
    from chatterbox.tts import ChatterboxTTS

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = ChatterboxTTS.from_pretrained(device=device)
    ref = settings.ch("voice", "reference_audio")
    if ref:
        ref = str((ROOT / ref).resolve())

    # Chatterbox rinde mejor por trozos: generamos por parrafos y concatenamos.
    chunks = [c.strip() for c in text.split("\n\n") if c.strip()] or [text]
    waves = []
    for chunk in chunks:
        wav = model.generate(
            chunk,
            audio_prompt_path=ref,
            exaggeration=float(settings.ch("voice", "exaggeration", default=0.45)),
            cfg_weight=float(settings.ch("voice", "cfg_weight", default=0.5)),
        )
        waves.append(wav)
    full = torch.cat(waves, dim=-1)
    torchaudio.save(str(out_wav), full, model.sr)

    del model
    if device == "cuda":
        torch.cuda.empty_cache()


def _kokoro(settings: Settings, text: str, out_wav: Path) -> None:
    import numpy as np
    import soundfile as sf
    from kokoro import KPipeline

    voice = settings.ch("voice", "kokoro_voice", default="am_michael")
    pipe = KPipeline(lang_code=voice[0])  # 'a' = ingles americano
    segments = [audio for _, _, audio in pipe(text, voice=voice)]
    sf.write(str(out_wav), np.concatenate(segments), 24000)


def _simulated_voice(text: str, out_wav: Path) -> None:
    # ~2.6 palabras/segundo de narracion tranquila
    seconds = max(3.0, len(text.split()) / 2.6)
    run_cmd(
        ["ffmpeg", "-y", "-f", "lavfi", "-i", f"sine=frequency=220:duration={seconds:.2f}",
         "-ar", "24000", "-ac", "1", str(out_wav)],
        desc="voz simulada",
    )
