"""CLI: python -m factory <comando>

  run      genera un video completo (y lo sube salvo --no-upload)
  review   servidor local para publicar videos private con un clic
  stats    descarga analytics y actualiza los insights de hooks
  check    comprueba dependencias y servicios (Ollama, ComfyUI, ffmpeg, NVENC)
"""
from __future__ import annotations

import argparse

from .config import load_settings


def main() -> None:
    parser = argparse.ArgumentParser(prog="factory",
                                     description="The Hidden Thread — video factory local")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_run = sub.add_parser("run", help="genera un video completo")
    p_run.add_argument("--format", choices=["short", "long"], default="short")
    p_run.add_argument("--no-upload", action="store_true", help="solo renderizar")
    p_run.add_argument("--schedule", action="store_true",
                       help="programa la publicacion (requiere API auditada)")
    p_run.add_argument("--simulate", action="store_true",
                       help="sin GPU ni APIs: assets sinteticos para probar el pipeline")
    p_run.add_argument("--count", type=int, default=1, help="videos a generar en lote")

    p_rev = sub.add_parser("review", help="servidor de revision/publicacion")
    p_rev.add_argument("--port", type=int, default=8099)

    p_stats = sub.add_parser("stats", help="analytics + insights de hooks")
    p_stats.add_argument("--simulate", action="store_true")

    p_music = sub.add_parser("music", help="genera la biblioteca musical local (ACE-Step)")
    p_music.add_argument("--styles", default="", help="lista separada por comas (defecto: los 10)")
    p_music.add_argument("--per-style", type=int, default=1)
    p_music.add_argument("--seconds", type=float, default=None)
    p_music.add_argument("--force", action="store_true", help="regenerar aunque existan")
    p_music.add_argument("--simulate", action="store_true", help="pistas sinteticas de prueba")

    sub.add_parser("check", help="diagnostico del entorno")

    args = parser.parse_args()

    if args.cmd == "run":
        from .run import run_pipeline
        settings = load_settings(args.format, simulate=args.simulate)
        for i in range(args.count):
            if args.count > 1:
                print(f"\n=== video {i + 1}/{args.count} ===")
            run_pipeline(settings, upload=not args.no_upload, schedule=args.schedule)
    elif args.cmd == "review":
        from .review import serve
        serve(args.port)
    elif args.cmd == "stats":
        from . import db
        from .pipeline.analytics import print_report, refresh_stats
        settings = load_settings("short", simulate=args.simulate)
        conn = db.connect()
        refresh_stats(settings, conn)
        print_report(conn)
    elif args.cmd == "music":
        from .pipeline.music import generate_library
        settings = load_settings("short", simulate=args.simulate)
        styles = [s.strip() for s in args.styles.split(",") if s.strip()] or None
        generate_library(settings, styles=styles, per_style=args.per_style,
                         seconds=args.seconds, force=args.force)
    elif args.cmd == "check":
        _check()


def _check() -> None:
    import json
    import urllib.request

    from .utils import find_tool, pick_encoder

    settings = load_settings("short")
    print("== factory check ==")
    ffmpeg = find_tool("ffmpeg")
    print(f"ffmpeg:   {'OK' if ffmpeg else 'FALTA (winget install ffmpeg)'}")
    print(f"encoder:  {pick_encoder('auto')}")

    for name, url, probe in (
        ("ollama", settings.ch("services", "ollama_url"), "/api/tags"),
        ("comfyui", settings.ch("services", "comfyui_url"), "/system_stats"),
    ):
        try:
            with urllib.request.urlopen(f"{url}{probe}", timeout=5) as resp:
                json.loads(resp.read())
            print(f"{name}:   OK ({url})")
        except Exception:
            print(f"{name}:   NO RESPONDE ({url})")

    for mod, hint in (("chatterbox", "pip install chatterbox-tts"),
                      ("kokoro", "pip install kokoro soundfile"),
                      ("faster_whisper", "pip install faster-whisper"),
                      ("googleapiclient", "pip install google-api-python-client google-auth"),
                      ("PIL", "pip install pillow"),
                      ("yaml", "pip install pyyaml")):
        try:
            __import__(mod)
            print(f"{mod}: OK")
        except ImportError:
            print(f"{mod}: FALTA -> {hint}")

    env_ok = all(settings.env.get(k) for k in
                 ("YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET", "YOUTUBE_REFRESH_TOKEN"))
    print(f"youtube creds: {'OK' if env_ok else 'FALTAN en .env'}")
    print(f"pexels key:    {'OK' if settings.env.get('PEXELS_API_KEY') else 'FALTA (opcional)'}")
