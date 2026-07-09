"""Mini servidor local de revision: lista los videos subidos en private y
permite publicarlos con un clic (videos.update -> public).

Uso: python -m factory review  ->  http://127.0.0.1:8099
"""
from __future__ import annotations

import html
import json
from http.server import BaseHTTPRequestHandler, HTTPServer

from . import db
from .config import Settings, load_settings
from .pipeline import publish

PAGE = """<!doctype html><html><head><meta charset="utf-8">
<title>Factory Review</title>
<style>
 body{{font-family:system-ui;background:#0f1720;color:#d9d2c3;margin:40px auto;max-width:860px}}
 .card{{background:#1b2733;border-radius:12px;padding:18px 22px;margin:14px 0;
        display:flex;justify-content:space-between;align-items:center;gap:16px}}
 a{{color:#8ecdf5}} h1{{font-weight:600}}
 button{{background:#8c6a43;color:#fff;border:0;border-radius:8px;padding:10px 18px;
        font-size:15px;cursor:pointer}}
 .meta{{font-size:13px;opacity:.75}}
</style></head><body>
<h1>The Hidden Thread — cola de revision</h1>
{cards}
</body></html>"""

CARD = """<div class="card"><div>
<strong>{title}</strong>
<div class="meta">{fmt} · run #{id} · estado: {status}</div>
<div class="meta"><a href="https://youtube.com/watch?v={vid}" target="_blank">ver en YouTube (private)</a></div>
</div>
<form method="post" action="/publish/{vid}"><button>Publicar</button></form></div>"""


class Handler(BaseHTTPRequestHandler):
    settings: Settings = None  # type: ignore

    def do_GET(self):
        conn = db.connect()
        rows = conn.execute(
            "SELECT id, title, format, status, youtube_video_id FROM runs "
            "WHERE youtube_video_id IS NOT NULL AND status != 'published' "
            "ORDER BY id DESC LIMIT 50").fetchall()
        cards = "".join(CARD.format(
            title=html.escape(r["title"] or r["youtube_video_id"]),
            fmt=r["format"], id=r["id"], status=r["status"],
            vid=r["youtube_video_id"]) for r in rows) or "<p>Nada pendiente.</p>"
        body = PAGE.format(cards=cards).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path.startswith("/publish/"):
            video_id = self.path.rsplit("/", 1)[-1]
            conn = db.connect()
            try:
                publish.set_public(self.settings, video_id)
                conn.execute("UPDATE runs SET status='published' WHERE youtube_video_id=?",
                             (video_id,))
                conn.commit()
            except Exception as exc:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(exc)}).encode())
                return
        self.send_response(303)
        self.send_header("Location", "/")
        self.end_headers()

    def log_message(self, *args):
        pass


def serve(port: int = 8099) -> None:
    Handler.settings = load_settings("short")
    print(f"Review server: http://127.0.0.1:{port}")
    HTTPServer(("127.0.0.1", port), Handler).serve_forever()
