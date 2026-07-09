"""OAuth helpers for local YouTube authorization."""
from __future__ import annotations

from pathlib import Path

from google_auth_oauthlib.flow import InstalledAppFlow

from .config import ROOT, load_settings

YOUTUBE_SCOPE = "https://www.googleapis.com/auth/youtube"


def youtube_auth(port: int = 8098) -> None:
    """Open a browser consent flow and persist the refresh token in .env."""
    settings = load_settings("short")
    client_id = settings.env.get("YOUTUBE_CLIENT_ID", "").strip()
    client_secret = settings.env.get("YOUTUBE_CLIENT_SECRET", "").strip()
    if not client_id or not client_secret:
        raise SystemExit("Faltan YOUTUBE_CLIENT_ID/YOUTUBE_CLIENT_SECRET en .env")

    config = {
        "installed": {
            "client_id": client_id,
            "client_secret": client_secret,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [f"http://localhost:{port}/"],
        }
    }
    flow = InstalledAppFlow.from_client_config(config, scopes=[YOUTUBE_SCOPE])
    creds = flow.run_local_server(
        host="localhost",
        port=port,
        open_browser=True,
        authorization_prompt_message=(
            "\nAbre esta URL si no se abre el navegador:\n{url}\n"
        ),
        success_message=(
            "Autorizacion completada. Puedes cerrar esta pestana y volver a Codex."
        ),
    )
    if not creds.refresh_token:
        raise SystemExit("Google no devolvio refresh_token. Revoca acceso y reintenta.")
    _update_env(ROOT / ".env", "YOUTUBE_REFRESH_TOKEN", creds.refresh_token)
    print("YOUTUBE_REFRESH_TOKEN guardado en .env")


def _update_env(path: Path, key: str, value: str) -> None:
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    found = False
    out = []
    for line in lines:
        if line.startswith(f"{key}="):
            out.append(f"{key}={value}")
            found = True
        else:
            out.append(line)
    if not found:
        if out and out[-1].strip():
            out.append("")
        out.append(f"{key}={value}")
    path.write_text("\n".join(out) + "\n", encoding="utf-8")
