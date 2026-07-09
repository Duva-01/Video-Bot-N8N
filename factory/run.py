"""Orquestador: ejecuta el pipeline completo de un video."""
from __future__ import annotations

import json
import time
from pathlib import Path

from . import db
from .config import OUTPUT_DIR, Settings
from .pipeline import (assemble, publish, research, script, subtitles,
                       thumbnail, topics, visuals, voice)
from .utils import log, slugify


def run_pipeline(settings: Settings, upload: bool = True,
                 schedule: bool = False) -> Path:
    conn = db.connect()
    t0 = time.time()

    # 1. Tema con anti-repeticion
    topic = topics.select_topic(settings, conn)
    slug = f"{time.strftime('%Y%m%d-%H%M%S')}-{slugify(topic['canonical_topic'])}"
    run_id = db.create_run(conn, slug, settings.fmt)
    workdir = OUTPUT_DIR / slug
    workdir.mkdir(parents=True, exist_ok=True)
    db.update_run(conn, run_id, status="topic",
                  canonical_topic=topic["canonical_topic"], angle=topic["angle"],
                  series_id=topic.get("series_id"),
                  uniqueness_hash=topic["uniqueness_hash"])

    try:
        # 2. Research: facts verificados de Wikipedia
        facts = research.gather_facts(settings, topic)
        if facts:
            (workdir / "facts.md").write_text(facts, encoding="utf-8")

        # 3. Guion multi-paso (hooks -> guion -> editor)
        meta = script.write_script(settings, conn, topic, facts=facts)
        (workdir / "script.json").write_text(
            json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
        db.update_run(conn, run_id, status="scripted", title=meta.get("title"),
                      description=meta.get("summary"),
                      tags=json.dumps(meta.get("tags", [])))

        # 4. Direccion visual: escenas + beats + mood + ancla de estilo
        direction = visuals.plan_scenes(settings, meta["narration"])
        scenes = direction["scenes"]

        # 5. Voz dirigida por escena (enfasis + pausas) + mastering
        voice_wav = workdir / "voice.wav"
        duration = voice.synthesize(settings, meta["narration"], voice_wav,
                                    scenes=scenes)
        db.update_run(conn, run_id, status="voiced")

        # 6. Timing por palabra + alineacion de escenas
        words = subtitles.transcribe(settings, voice_wav, meta["narration"], duration)
        scenes = visuals.align_scenes(scenes, words, duration)

        # 7. Captions karaoke + overlays de datos + hook cover
        ass_file = subtitles.build_ass(settings, words, workdir / "captions.ass",
                                       scenes=scenes, hook=meta.get("hook"))

        # 8. Visuales: LTX / parallax / ken burns / broll con vision
        scenes = visuals.fetch_visuals(settings, direction, workdir)
        (workdir / "scenes.json").write_text(
            json.dumps(direction, indent=2, ensure_ascii=False), encoding="utf-8")
        db.update_run(conn, run_id, status="visuals")

        # 9. Montaje final: transiciones + SFX + musica dinamica
        final = assemble.assemble(settings, scenes, voice_wav, ass_file, workdir,
                                  mood=direction.get("mood", "curious"))
        db.update_run(conn, run_id, status="rendered", video_path=str(final))

        # 9b. Capitulos + miniatura (longform)
        thumb = None
        if settings.fmt == "long":
            meta["chapters_text"] = _chapters_text(meta, words, duration)
            thumbs = thumbnail.make_thumbnails(settings, meta, workdir)
            thumb = thumbs[0] if thumbs else None
            if thumb:
                db.update_run(conn, run_id, thumbnail_path=str(thumb))

        # 10. Subida
        if upload:
            publish_at = publish.next_publish_slot(settings, conn) if schedule else None
            video_id = publish.upload(settings, conn, run_id, final, meta,
                                      thumbnail=thumb, publish_at=publish_at)
            if publish_at:
                conn.execute("INSERT INTO queue (run_id, publish_at) VALUES (?,?)",
                             (run_id, publish_at))
                conn.commit()
                log("run", "programado", publish_at=publish_at, video_id=video_id)
        else:
            db.update_run(conn, run_id, status="rendered_only")

        log("run", "pipeline completado", minutes=round((time.time() - t0) / 60, 1),
            output=str(final))
        return final

    except Exception as exc:
        db.update_run(conn, run_id, status="failed", error=str(exc)[:500])
        db.log_event(conn, run_id, "run", "failed", {"error": str(exc)[:500]})
        raise


def _chapters_text(meta: dict, words, duration: float) -> str:
    sections = meta.get("sections") or []
    if not sections:
        return ""
    counts = [max(1, len(s["narration"].split())) for s in sections]
    total = sum(counts)
    lines, cursor = [], 0.0
    for sec, count in zip(sections, counts):
        m, s = divmod(int(cursor), 60)
        lines.append(f"{m:02d}:{s:02d} {sec['title']}")
        cursor += duration * count / total
    return "\n".join(lines)
