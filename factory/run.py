"""Orquestador: ejecuta el pipeline completo de un video."""
from __future__ import annotations

import json
import time
from pathlib import Path

from . import db
from .config import OUTPUT_DIR, Settings
from .pipeline import assemble, publish, script, subtitles, thumbnail, topics, visuals, voice
from .utils import log, slugify


def run_pipeline(settings: Settings, upload: bool = True,
                 schedule: bool = False) -> Path:
    conn = db.connect()
    t0 = time.time()

    # 1. Tema con anti-repeticion
    topic = topics.select_topic(settings, conn)
    slug = f"{time.strftime('%Y%m%d-%H%M')}-{slugify(topic['canonical_topic'])}"
    run_id = db.create_run(conn, slug, settings.fmt)
    workdir = OUTPUT_DIR / slug
    workdir.mkdir(parents=True, exist_ok=True)
    db.update_run(conn, run_id, status="topic",
                  canonical_topic=topic["canonical_topic"], angle=topic["angle"],
                  series_id=topic.get("series_id"),
                  uniqueness_hash=topic["uniqueness_hash"])

    try:
        # 2. Guion multi-paso
        meta = script.write_script(settings, conn, topic)
        (workdir / "script.json").write_text(
            json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
        db.update_run(conn, run_id, status="scripted", title=meta.get("title"),
                      description=meta.get("summary"),
                      tags=json.dumps(meta.get("tags", [])))

        # 3. Voz
        voice_wav = workdir / "voice.wav"
        duration = voice.synthesize(settings, meta["narration"], voice_wav)
        db.update_run(conn, run_id, status="voiced")

        # 4. Subtitulos karaoke
        words = subtitles.transcribe(settings, voice_wav, meta["narration"], duration)
        ass_file = subtitles.build_ass(settings, words, workdir / "captions.ass")

        # 5. Visuales por escena
        scene_plan = visuals.plan_scenes(settings, meta["narration"])
        scene_plan = visuals.align_scenes(scene_plan, words, duration)
        scene_plan = visuals.fetch_visuals(settings, scene_plan, workdir)
        (workdir / "scenes.json").write_text(
            json.dumps(scene_plan, indent=2, ensure_ascii=False), encoding="utf-8")
        db.update_run(conn, run_id, status="visuals")

        # 6. Montaje final
        final = assemble.assemble(settings, scene_plan, voice_wav, ass_file, workdir)
        db.update_run(conn, run_id, status="rendered", video_path=str(final))

        # 6b. Capitulos + miniatura (longform)
        thumb = None
        if settings.fmt == "long":
            meta["chapters_text"] = _chapters_text(meta, words, duration)
            thumbs = thumbnail.make_thumbnails(settings, meta, workdir)
            thumb = thumbs[0] if thumbs else None
            if thumb:
                db.update_run(conn, run_id, thumbnail_path=str(thumb))

        # 7. Subida
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
    # reparte el tiempo proporcionalmente a las palabras de cada seccion
    counts = [max(1, len(s["narration"].split())) for s in sections]
    total = sum(counts)
    lines, cursor = [], 0.0
    for sec, count in zip(sections, counts):
        m, s = divmod(int(cursor), 60)
        lines.append(f"{m:02d}:{s:02d} {sec['title']}")
        cursor += duration * count / total
    return "\n".join(lines)
