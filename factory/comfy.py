"""Cliente de la API de ComfyUI: imagenes FLUX.1-schnell y video LTX.

ComfyUI debe estar corriendo en local (COMFYUI_URL). Los workflows se envian
por la API /prompt y se recogen por /history cuando terminan.
"""
from __future__ import annotations

import json
import random
import time
import urllib.parse
import urllib.request
from pathlib import Path

from .config import Settings
from .utils import log

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


def generate_image(settings: Settings, prompt: str, out_png: Path,
                   width: int = 1088, height: int = 1920) -> Path:
    """Genera una imagen con FLUX.1-schnell y la guarda en out_png."""
    url = settings.ch("services", "comfyui_url", default="http://127.0.0.1:8188")
    style = settings.ch("visual_style", "image_style", default="")
    negative = settings.ch("visual_style", "negative", default="")

    wf = json.loads(json.dumps(FLUX_WORKFLOW))
    wf["pos"]["inputs"]["text"] = f"{prompt}, {style}"
    wf["neg"]["inputs"]["text"] = negative
    wf["latent"]["inputs"]["width"] = width - width % 16
    wf["latent"]["inputs"]["height"] = height - height % 16
    wf["sampler"]["inputs"]["seed"] = random.randint(0, 2**31)

    prompt_id = _queue(url, wf)
    images = _wait(url, prompt_id, timeout=600)
    if not images:
        raise RuntimeError("ComfyUI no devolvio imagenes")
    _download(url, images[0], out_png)
    log("comfy", "imagen generada", file=out_png.name)
    return out_png


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
