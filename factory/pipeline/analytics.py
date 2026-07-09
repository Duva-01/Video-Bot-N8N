"""Loop de datos: YouTube Analytics API -> insights que alimentan los hooks.

`python -m factory stats` descarga retencion/CTR por video, lo guarda en SQLite
y pide al LLM 3 insights accionables que se inyectan en el prompt de hooks.
"""
from __future__ import annotations

import datetime as dt
import sqlite3
import time

from .. import db
from ..config import Settings
from ..llm import generate
from ..utils import log
from .publish import _youtube_client

INSIGHT_PROMPT = """You are a YouTube growth analyst for a documentary shorts channel.

Per-video performance data (last 28 days):
{table}

Write exactly 3 short, actionable insights about WHAT KIND OF HOOKS AND TOPICS
retain viewers on this channel (e.g. "hooks with a concrete year outperform
questions"). Base them only on the data.

Return ONLY JSON: [{{"insight": "..."}}]
"""


def _analytics_client(settings: Settings):
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build

    creds = Credentials(
        token=None,
        refresh_token=settings.env["YOUTUBE_REFRESH_TOKEN"],
        client_id=settings.env["YOUTUBE_CLIENT_ID"],
        client_secret=settings.env["YOUTUBE_CLIENT_SECRET"],
        token_uri="https://oauth2.googleapis.com/token",
        scopes=["https://www.googleapis.com/auth/yt-analytics.readonly"],
    )
    return build("youtubeAnalytics", "v2", credentials=creds, cache_discovery=False)


def refresh_stats(settings: Settings, conn: sqlite3.Connection) -> None:
    if settings.simulate:
        log("analytics", "SIMULATE: sin llamadas a la API")
        return

    rows = conn.execute(
        "SELECT youtube_video_id, title FROM runs "
        "WHERE youtube_video_id IS NOT NULL AND youtube_video_id != 'simulated'"
    ).fetchall()
    if not rows:
        log("analytics", "no hay videos subidos todavia")
        return

    yta = _analytics_client(settings)
    end = dt.date.today().isoformat()
    start = (dt.date.today() - dt.timedelta(days=28)).isoformat()
    ids = ",".join(r["youtube_video_id"] for r in rows[:200])

    result = yta.reports().query(
        ids="channel==MINE", startDate=start, endDate=end,
        metrics="views,averageViewPercentage,averageViewDuration,likes,shares",
        dimensions="video", filters=f"video=={ids}", maxResults=200,
    ).execute()

    titles = {r["youtube_video_id"]: r["title"] for r in rows}
    now = time.time()
    lines = []
    for row in result.get("rows", []):
        vid, views, avg_pct, avg_dur, likes, shares = row[:6]
        for metric, value in (("views", views), ("avg_view_pct", avg_pct),
                              ("avg_view_sec", avg_dur), ("likes", likes),
                              ("shares", shares)):
            conn.execute(
                "INSERT INTO analytics (youtube_video_id, metric, value, fetched_at) "
                "VALUES (?,?,?,?)", (vid, metric, float(value), now))
        lines.append(f'- "{titles.get(vid, vid)}": {views} views, '
                     f"{avg_pct}% retained, {avg_dur}s avg, {likes} likes, {shares} shares")
    conn.commit()
    log("analytics", "metricas guardadas", videos=len(lines))
    if not lines:
        return

    insights = generate(settings, INSIGHT_PROMPT.format(table="\n".join(lines)))
    if isinstance(insights, dict):
        insights = [insights]
    for item in insights[:3]:
        text = str(item.get("insight", "")).strip()
        if text:
            conn.execute(
                "INSERT INTO hook_insights (insight, source, created_at) VALUES (?,?,?)",
                (text, "youtube-analytics", now))
            log("analytics", "insight", text=text)
    conn.commit()


def print_report(conn: sqlite3.Connection) -> None:
    rows = conn.execute("""
        SELECT r.title, r.format, r.status,
               MAX(CASE WHEN a.metric='views' THEN a.value END) AS views,
               MAX(CASE WHEN a.metric='avg_view_pct' THEN a.value END) AS retention
        FROM runs r LEFT JOIN analytics a ON a.youtube_video_id = r.youtube_video_id
        GROUP BY r.id ORDER BY r.id DESC LIMIT 25""").fetchall()
    print(f"{'title':<52} {'fmt':<6} {'status':<10} {'views':>8} {'ret%':>6}")
    for r in rows:
        print(f"{(r['title'] or '-')[:50]:<52} {r['format']:<6} {r['status']:<10} "
              f"{int(r['views'] or 0):>8} {round(r['retention'] or 0, 1):>6}")
