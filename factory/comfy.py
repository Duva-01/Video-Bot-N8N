"""Cliente de la API de ComfyUI: imagenes FLUX.1-schnell y video LTX (img2vid).

ComfyUI debe estar corriendo en local (COMFYUI_URL). Los workflows se envian
por /prompt y se recogen por /history; las imagenes se suben por /upload/image.
"""
from __future__ import annotations

import json
import random
import time
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

from .config import Settings
from .utils import log, run_cmd

FLUX_WORKFLOW = {
    "ckpt": {"class_type": "CheckpointLoaderSimple",
             "inputs": {"ckpt_name": "flux1-schnell-fp8.safetensors"}},
    "pos": {"class_type": "CLIPTextEncode",
            "inputs": {"text": "", "clip": ["ckpt", 1]}},
    "neg": {"class_type": "CLIPTextEncode",
            "inputs": {"text": "", "clip": ["ckpt", 1]}},
    "latent": {"class_type": "EmptyLatentImage",
               "inputs": {"width": 1088, "height": 1920, "batch_size": 1}},
    "sampler": {"class_type": "KSampler",
                "inputs": {"model": ["ckpt", 0], "positive": ["pos", 0],
                            "negative": ["neg", 0], "latent_image": ["latent", 0],
                            "seed": 0, "steps": 4, "cfg": 1.0,
                            "sampler_name": "euler", "scheduler": "simple",
                            "denoise": 1.0}},
    "decode": {"class_type": "VAEDecode",
               "inputs": {"samples": ["sampler", 0], "vae": ["ckpt", 2]}},
    "save": {"class_type": "SaveImage",
             "inputs": {"images": ["decode", 0], "filename_prefix": "factory"}},
}

# img2vid con LTX-Video (nodos nativos de ComfyUI)
LTX_WORKFLOW = {
    "ckpt": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": ""}},
    "clip": {"class_type": "CLIPLoader",
             "inputs": {"clip_name": "", "type": "ltxv"}},
    "pos": {"class_type": "CLIPTextEncode", "inputs": {"text": "", "clip": ["clip", 0]}},
    "neg": {"class_type": "CLIPTextEncode", "inputs": {"text": "", "clip": ["clip", 0]}},
    "img": {"class_type": "LoadImage", "inputs": {"image": ""}},
    "i2v": {"class_type": "LTXVImgToVideo",
            "inputs": {"positive": ["pos", 0], "negative": ["neg", 0],
                        "vae": ["ckpt", 2], "image": ["img", 0],
                        "width": 768, "height": 1152, "length": 97,
                        "batch_size": 1, "strength": 1.0}},
    "cond": {"class_type": "LTXVConditioning",
             "inputs": {"positive": ["i2v", 0], "negative": ["i2v", 1],
                         "frame_rate": 24.0}},
    "sampler": {"class_type": "KSampler",
                "inputs": {"model": ["ckpt", 0], "positive": ["cond", 0],
                            "negative": ["cond", 1], "latent_image": ["i2v", 2],
                            "seed": 0, "steps": 22, "cfg": 3.0,
                            "sampler_name": "euler", "scheduler": "normal",
                            "denoise": 1.0}},
    "decode": {"class_type": "VAEDecode",
               "inputs": {"samples": ["sampler", 0], "vae": ["ckpt", 2]}},
    "save": {"class_type": "SaveImage",
             "inputs": {"images": ["decode", 0], "filename_prefix": "factory-ltx"}},
}


def generate_image(settings: Settings, prompt: str, out_png: Path,
                   width: int = 1088, height: int = 1920,
                   seed: int | None = None) -> Path:
    """Genera una imagen con FLUX.1-schnell y la guarda en out_png."""
    url = settings.ch("services", "comfyui_url", default="http://127.0.0.1:8188")
    style = settings.ch("visual_style", "image_style", default="")
    negative = settings.ch("visual_style", "negative", default="")

    wf = json.loads(json.dumps(FLUX_WORKFLOW))
    wf["pos"]["inputs"]["text"] = f"{prompt}, {style}"
    wf["neg"]["inputs"]["text"] = negative
    wf["latent"]["inputs"]["width"] = width - width % 16
    wf["latent"]["inputs"]["height"] = height - height % 16
    wf["sampler"]["inputs"]["seed"] = seed if seed is not None else random.randint(0, 2**31)

    prompt_id = _queue(url, wf)
    images = _wait(url, prompt_id, timeout=600)
    if not images:
        raise RuntimeError("ComfyUI no devolvio imagenes")
    _download(url, images[0], out_png)
    log("comfy", "imagen generada", file=out_png.name)
    return out_png


def generate_video_ltx(settings: Settings, image_png: Path, motion_prompt: str,
                       out_mp4: Path, seconds: float, width: int, height: int) -> Path:
    """Anima una imagen con LTX-Video (img2vid) y la guarda como mp4."""
    url = settings.ch("services", "comfyui_url", default="http://127.0.0.1:8188")
    cfg = settings.ch("visual_style", "ltx", default={}) or {}
    fps = int(cfg.get("fps", 24))

    # LTX pide dimensiones multiplo de 32 y length = 8k+1
    w = max(512, (width // 32) * 32)
    h = max(512, (height // 32) * 32)
    frames = int(seconds * fps)
    frames = max(9, (frames // 8) * 8 + 1)

    uploaded = _upload_image(url, image_png)
    wf = json.loads(json.dumps(LTX_WORKFLOW))
    wf["ckpt"]["inputs"]["ckpt_name"] = cfg.get("checkpoint", "ltx-video-2b-v0.9.5.safetensors")
    wf["clip"]["inputs"]["clip_name"] = cfg.get("text_encoder", "t5xxl_fp8_e4m3fn_scaled.safetensors")
    wf["pos"]["inputs"]["text"] = (
        f"{motion_prompt}. Subtle realistic motion, cinematic documentary footage, "
        "smooth slow camera movement, natural lighting changes.")
    wf["neg"]["inputs"]["text"] = settings.ch("visual_style", "negative", default="")
    wf["img"]["inputs"]["image"] = uploaded
    wf["i2v"]["inputs"].update({"width": w, "height": h, "length": frames})
    wf["sampler"]["inputs"]["seed"] = random.randint(0, 2**31)
    wf["sampler"]["inputs"]["steps"] = int(cfg.get("steps", 22))

    prompt_id = _queue(url, wf)
    images = _wait(url, prompt_id, timeout=1200)
    if len(images) < 8:
        raise RuntimeError(f"LTX devolvio {len(images)} frames")

    frames_dir = out_mp4.parent / f"{out_mp4.stem}-frames"
    frames_dir.mkdir(parents=True, exist_ok=True)
    for i, image in enumerate(images):
        _download(url, image, frames_dir / f"f{i:05d}.png")
    run_cmd(["ffmpeg", "-y", "-framerate", str(fps),
             "-i", str(frames_dir / "f%05d.png"),
             "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "veryfast",
             "-crf", "18", str(out_mp4)], desc="frames LTX -> mp4")
    log("comfy", "video LTX generado", file=out_mp4.name, frames=len(images))
    return out_mp4


# musica con ACE-Step (nodos core de ComfyUI)
ACE_WORKFLOW = {
    "ckpt": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": ""}},
    "latent": {"class_type": "EmptyAceStepLatentAudio",
               "inputs": {"seconds": 95, "batch_size": 1}},
    "pos": {"class_type": "TextEncodeAceStepAudio",
            "inputs": {"clip": ["ckpt", 1], "tags": "", "lyrics": "[inst]",
                        "lyrics_strength": 1.0}},
    "neg": {"class_type": "TextEncodeAceStepAudio",
            "inputs": {"clip": ["ckpt", 1], "tags": "", "lyrics": "",
                        "lyrics_strength": 1.0}},
    "shift": {"class_type": "ModelSamplingSD3",
              "inputs": {"model": ["ckpt", 0], "shift": 5.0}},
    "sampler": {"class_type": "KSampler",
                "inputs": {"model": ["shift", 0], "positive": ["pos", 0],
                            "negative": ["neg", 0], "latent_image": ["latent", 0],
                            "seed": 0, "steps": 50, "cfg": 5.0,
                            "sampler_name": "euler", "scheduler": "simple",
                            "denoise": 1.0}},
    "decode": {"class_type": "VAEDecodeAudio",
               "inputs": {"samples": ["sampler", 0], "vae": ["ckpt", 2]}},
    "save": {"class_type": "SaveAudio",
             "inputs": {"audio": ["decode", 0], "filename_prefix": "factory-music"}},
}


def generate_music(settings: Settings, tags: str, negative: str, out_path: Path,
                   seconds: float) -> Path:
    """Genera una pista instrumental con ACE-Step y la guarda (flac)."""
    url = settings.ch("services", "comfyui_url", default="http://127.0.0.1:8188")
    cfg = settings.ch("music", "ace", default={}) or {}

    wf = json.loads(json.dumps(ACE_WORKFLOW))
    wf["ckpt"]["inputs"]["ckpt_name"] = cfg.get(
        "checkpoint", "ace_step_v1_3.5b.safetensors")
    wf["latent"]["inputs"]["seconds"] = float(seconds)
    wf["pos"]["inputs"]["tags"] = tags
    wf["neg"]["inputs"]["tags"] = negative
    wf["sampler"]["inputs"]["seed"] = random.randint(0, 2**31)
    wf["sampler"]["inputs"]["steps"] = int(cfg.get("steps", 50))
    wf["sampler"]["inputs"]["cfg"] = float(cfg.get("cfg", 5.0))

    prompt_id = _queue(url, wf)
    outputs = _wait(url, prompt_id, timeout=1800)
    if not outputs:
        raise RuntimeError("ComfyUI no devolvio audio (¿checkpoint ACE-Step instalado?)")
    _download(url, outputs[0], out_path)
    log("comfy", "musica generada", file=out_path.name)
    return out_path


# ------------------------------------------------------------------ http
def _queue(url: str, workflow: dict) -> str:
    payload = json.dumps({"prompt": workflow}).encode("utf-8")
    req = urllib.request.Request(f"{url}/prompt", data=payload,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())["prompt_id"]
    except OSError as exc:
        raise RuntimeError(
            f"No se pudo conectar con ComfyUI en {url}. "
            "Arranca ComfyUI (o desactiva las escenas de imagen)."
        ) from exc


def _wait(url: str, prompt_id: str, timeout: int) -> list[dict]:
    deadline = time.time() + timeout
    while time.time() < deadline:
        with urllib.request.urlopen(f"{url}/history/{prompt_id}", timeout=30) as resp:
            hist = json.loads(resp.read())
        if prompt_id in hist:
            entry = hist[prompt_id]
            if entry.get("status", {}).get("status_str") == "error":
                raise RuntimeError(f"ComfyUI devolvio error: {entry['status']}")
            images = []
            for node in entry.get("outputs", {}).values():
                images.extend(node.get("images", []))
                images.extend(node.get("audio", []))
            if images:
                return images
        time.sleep(2)
    raise TimeoutError("ComfyUI no termino a tiempo")


def _download(url: str, image: dict, out_path: Path) -> None:
    qs = urllib.parse.urlencode({
        "filename": image["filename"],
        "subfolder": image.get("subfolder", ""),
        "type": image.get("type", "output"),
    })
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(f"{url}/view?{qs}", timeout=60) as resp:
        out_path.write_bytes(resp.read())


def _upload_image(url: str, png: Path) -> str:
    boundary = uuid.uuid4().hex
    name = f"{uuid.uuid4().hex}.png"
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="image"; filename="{name}"\r\n'
        "Content-Type: image/png\r\n\r\n"
    ).encode() + png.read_bytes() + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(
        f"{url}/upload/image", data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read())["name"]
