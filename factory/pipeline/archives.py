"""Motor de archivo: material REAL de dominio publico / licencias libres.

Fuentes (todas gratuitas, sin API key):
- Imagenes del articulo de Wikipedia del tema (maxima relevancia)
- Wikimedia Commons (busqueda de fotos historicas, mapas, documentos)
- Archive.org (footage real: newsreels, documentales, material de epoca)

Cada candidato se puntua con el modelo de vision (Qwen-VL) contra la
descripcion de la escena; solo se acepta si supera el umbral configurado.
"""
from __future__ import annotations

import json
import urllib.parse
import urllib.request
from pathlib import Path

from ..config import Settings
from ..llm import vision_score
from ..utils import log, run_cmd

_HEADERS = {"User-Agent": "HiddenThreadFactory/3.0 (personal project)"}
_COMMONS_API = "https://commons.wikimedia.org/w/api.php"


class ArchivePool:
    """Gestiona candidatos de archivo para un video: descarga, puntua y
    evita reutilizar el mismo asset en dos escenas."""

    def __init__(self, settings: Settings, wiki_images: list[str],
                 queries: list[str], workdir: Path):
        self.settings = settings
        self.queries = queries or []
        self.dir = workdir / "archive"
        self.dir.mkdir(parents=True, exist_ok=True)
        self.used: set[str] = set()
        self.min_score = float(settings.ch("visual_style", "archives",
                                           "min_vision_score", default=5.0))
        self.max_candidates = int(settings.ch("visual_style", "archives",
                                              "max_candidates", default=5))
        # pre-descarga las imagenes del articulo (candidatos permanentes)
        self.wiki_pool: list[Path] = []
        for i, url in enumerate((wiki_images or [])[:12]):
            path = self._download(url, self.dir / f"wiki-{i:02d}.jpg")
            if path:
                self.wiki_pool.append(path)
        log("archive", "pool inicial", wiki=len(self.wiki_pool),
            queries=len(self.queries))

    # -------------------------------------------------------------- stills
    def best_still(self, scene: dict, idx: int) -> Path | None:
        """Mejor foto real para la escena, o None si nada supera el umbral."""
        candidates: list[Path] = [p for p in self.wiki_pool if str(p) not in self.used]

        query = scene.get("query") or " ".join(scene["visual"].split()[:4])
        for j, url in enumerate(self._commons_search(query)[:self.max_candidates]):
            path = self._download(url, self.dir / f"commons-{idx:03d}-{j}.jpg")
            if path:
                candidates.append(path)

        best, best_score = None, -1.0
        for cand in candidates[:self.max_candidates + len(self.wiki_pool)]:
            try:
                score = vision_score(self.settings, cand, scene["visual"])
            except Exception:
                continue
            if score > best_score:
                best, best_score = cand, score
        if best and best_score >= self.min_score:
            self.used.add(str(best))
            log("archive", "foto de archivo elegida", scene=idx,
                score=round(best_score, 1), file=best.name)
            return best
        log("archive", "sin archivo valido para la escena", scene=idx,
            best=round(best_score, 1))
        return None

    # -------------------------------------------------------------- video
    def archive_video(self, scene: dict, idx: int) -> Path | None:
        """Footage real de Archive.org para la escena (newsreels, etc.)."""
        if not self.settings.ch("visual_style", "archives",
                                "archive_org_video", default=True):
            return None
        max_mb = float(self.settings.ch("visual_style", "archives",
                                        "max_video_mb", default=80))
        query = scene.get("query") or " ".join(scene["visual"].split()[:4])
        try:
            identifiers = self._archive_org_search(query)
        except Exception as exc:
            log("archive", f"busqueda archive.org fallo ({exc})")
            return None
        for ident in identifiers[:3]:
            if ident in self.used:
                continue
            try:
                url, size_mb = self._archive_org_file(ident, max_mb)
                if not url:
                    continue
                raw = self._download(url, self.dir / f"aorg-{idx:03d}.mp4",
                                     timeout=600)
                if not raw:
                    continue
                # valida relevancia con un frame
                frame = self.dir / f"aorg-{idx:03d}-frame.jpg"
                run_cmd(["ffmpeg", "-y", "-v", "error", "-ss", "2", "-i", str(raw),
                         "-frames:v", "1", str(frame)], desc="frame archive.org",
                        check=False)
                if frame.exists():
                    score = vision_score(self.settings, frame, scene["visual"])
                    if score < self.min_score - 1:
                        log("archive", "footage descartado por vision",
                            id=ident, score=round(score, 1))
                        continue
                self.used.add(ident)
                log("archive", "footage real elegido", id=ident,
                    mb=round(size_mb, 1))
                return raw
            except Exception as exc:
                log("archive", f"item {ident} fallo ({exc})")
        return None

    # ------------------------------------------------------------ fuentes
    def _commons_search(self, query: str) -> list[str]:
        try:
            qs = urllib.parse.urlencode({
                "action": "query", "list": "search",
                "srsearch": query, "srnamespace": 6, "srlimit": 8,
                "format": "json"})
            data = self._get_json(f"{_COMMONS_API}?{qs}")
            titles = [r["title"] for r in data.get("query", {}).get("search", [])
                      if str(r.get("title", "")).lower().endswith(
                          (".jpg", ".jpeg", ".png"))]
            if not titles:
                return []
            qs = urllib.parse.urlencode({
                "action": "query", "titles": "|".join(titles[:8]),
                "prop": "imageinfo", "iiprop": "url|size|mime",
                "iiurlwidth": 1400, "format": "json"})
            pages = self._get_json(f"{_COMMONS_API}?{qs}").get(
                "query", {}).get("pages", {})
            urls = []
            for page in pages.values():
                info = (page.get("imageinfo") or [{}])[0]
                if info.get("mime") in ("image/jpeg", "image/png") \
                        and int(info.get("width", 0)) >= 500:
                    urls.append(info.get("thumburl") or info.get("url"))
            return [u for u in urls if u]
        except Exception as exc:
            log("archive", f"commons fallo ({exc})")
            return []

    def _archive_org_search(self, query: str) -> list[str]:
        qs = urllib.parse.urlencode({
            "q": f'({query}) AND mediatype:(movies)',
            "fl[]": "identifier", "rows": 5, "page": 1, "output": "json"})
        data = self._get_json(f"https://archive.org/advancedsearch.php?{qs}")
        return [d["identifier"] for d in
                data.get("response", {}).get("docs", [])]

    def _archive_org_file(self, identifier: str, max_mb: float) -> tuple[str | None, float]:
        data = self._get_json(f"https://archive.org/metadata/{identifier}")
        files = data.get("files", [])
        mp4s = [f for f in files if str(f.get("name", "")).endswith(".mp4")
                and float(f.get("size", 0) or 0) / 1e6 <= max_mb]
        if not mp4s:
            return None, 0.0
        # prefiere las versiones 512kb (pequenas y suficientes para 9:16 crop)
        mp4s.sort(key=lambda f: (0 if "512kb" in f["name"] else 1,
                                 float(f.get("size", 0) or 0)))
        chosen = mp4s[0]
        name = urllib.parse.quote(chosen["name"])
        return (f"https://archive.org/download/{identifier}/{name}",
                float(chosen.get("size", 0) or 0) / 1e6)

    # ------------------------------------------------------------- utiles
    def _get_json(self, url: str) -> dict:
        req = urllib.request.Request(url, headers=_HEADERS)
        with urllib.request.urlopen(req, timeout=45) as resp:
            return json.loads(resp.read())

    def _download(self, url: str, out: Path, timeout: int = 90) -> Path | None:
        try:
            req = urllib.request.Request(url, headers=_HEADERS)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                out.write_bytes(resp.read())
            return out if out.stat().st_size > 10_000 else None
        except Exception:
            return None
