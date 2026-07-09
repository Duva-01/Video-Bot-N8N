"""Subida a YouTube con la Data API v3.

Nota: hasta pasar la auditoria de compliance de Google, los videos de proyectos
API no auditados quedan en 'private'. El review server permite publicarlos con
un clic. Con la auditoria aprobada, cambia publish.privacy a 'public' o usa
--schedule para programar.
"""
from __future__ import annotations

import datetime as dt
import sqlite3
from pathlib import Path

from .. import db
from ..config import Settings
from ..utils import log


def _youtube_client(settings: Settings):
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build

    creds = Credentials(
        token=None,
        refresh_token=settings.env["YOUTUBE_REFRESH_TOKEN"],
        client_id=settings.env["YOUTUBE_CLIENT_ID"],
        client_secret=settings.env["YOUTUBE_CLIENT_SECRET"],
        token_uri="https://oauth2.googleapis.com/token",
        scopes=["https://www.googleapis.com/auth/youtube"],
    )
    return build("youtube", "v3", credentials=creds, cache_discovery=False)


def upload(settings: Settings, conn: sqlite3.Connection, run_id: int,
           video_path: Path, meta: dict, thumbnail: Path | None = None,
           publish_at: str | None = None) -> str:
    if settings.simulate:
        log("publish", "SIMULATE: no se sube nada", video=str(video_path))
        db.update_run(conn, run_id, status="uploaded", youtube_video_id="simulated")
        return "simulated"

    from googleapiclient.http import MediaFileUpload

    yt = _youtube_client(settings)
    privacy = settings.ch("publish", "privacy", default="private")
    status: dict = {
        "privacyStatus": "private" if publish_at else privacy,
        "selfDeclaredMadeForKids": bool(settings.ch("publish", "made_for_kids", default=False)),
    }
    if publish_at:
        status["publishAt"] = publish_at  # requiere privacy private + proyecto auditado

    tags = meta.get("tags") or []
    hashtags = " ".join(settings.pr("metadata", "hashtags", default=[]))
    description = settings.pr("metadata", "description_template", default="{summary}").format(
        summary=meta.get("summary", ""), hashtags=hashtags,
        chapters=meta.get("chapters_text", ""))
    title = str(meta.get("title", "Untitled"))
    if settings.fmt == "short" and "#shorts" not in title.lower():
        title = f"{title} #Shorts"[:100]

    body = {
        "snippet": {
            "title": title,
            "description": description,
            "tags": tags[:15],
            "categoryId": str(settings.ch("publish", "category_id", default="27")),
            "defaultLanguage": settings.ch("channel", "language", default="en"),
        },
        "status": status,
    }
    media = MediaFileUpload(str(video_path), mimetype="video/mp4",
                            chunksize=8 * 1024 * 1024, resumable=True)
    request = yt.videos().insert(part="snippet,status", body=body, media_body=media)

    response = None
    while response is None:
        progress, response = request.next_chunk()
        if progress:
            log("publish", f"subiendo {int(progress.progress() * 100)}%")
    video_id = response["id"]
    log("publish", "video subido", video_id=video_id, privacy=status["privacyStatus"])

    if thumbnail and thumbnail.exists():
        try:
            yt.thumbnails().set(videoId=video_id,
                                media_body=MediaFileUpload(str(thumbnail))).execute()
        except Exception as exc:
            log("publish", f"miniatura no aplicada: {exc}")

    db.update_run(conn, run_id, status="uploaded", youtube_video_id=video_id)
    db.log_event(conn, run_id, "publish", "uploaded", {"video_id": video_id})
    return video_id


def set_public(settings: Settings, video_id: str) -> None:
    yt = _youtube_client(settings)
    video = yt.videos().list(part="snippet,status", id=video_id).execute()["items"][0]
    video["status"]["privacyStatus"] = "public"
    yt.videos().update(part="status", body={"id": video_id, "status": video["status"]}).execute()
    log("publish", "video publicado", video_id=video_id)


def next_publish_slot(settings: Settings, conn: sqlite3.Connection) -> str:
    """Siguiente hora de publicacion libre segun schedule_hours_utc."""
    hours = settings.ch("publish", "schedule_hours_utc", default=[15, 20])
    taken = {row["publish_at"] for row in
             conn.execute("SELECT publish_at FROM queue WHERE done=0").fetchall()}
    slot = dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=30)
    for _ in range(14 * len(hours)):
        candidates = [slot.replace(hour=h, minute=0, second=0, microsecond=0)
                      for h in sorted(hours)]
        for cand in candidates:
            iso = cand.isoformat().replace("+00:00", "Z")
            if cand > slot and iso not in taken:
                return iso
        slot += dt.timedelta(days=1)
    raise RuntimeError("No hay hueco de publicacion en 14 dias")
