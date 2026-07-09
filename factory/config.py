"""Carga de configuracion: channel.yaml + profile + .env."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
CONFIG_DIR = ROOT / "config"
OUTPUT_DIR = ROOT / "output"
ASSETS_DIR = ROOT / "assets"
DB_PATH = ROOT / "factory.db"

load_dotenv(ROOT / ".env")


@dataclass
class Settings:
    channel: dict[str, Any]
    profile: dict[str, Any]
    simulate: bool = False
    env: dict[str, str] = field(default_factory=dict)

    # --- helpers -----------------------------------------------------
    def ch(self, *keys: str, default: Any = None) -> Any:
        return _dig(self.channel, keys, default)

    def pr(self, *keys: str, default: Any = None) -> Any:
        return _dig(self.profile, keys, default)

    @property
    def fmt(self) -> str:
        return self.profile.get("format", "short")

    @property
    def size(self) -> tuple[int, int]:
        return int(self.pr("video", "width")), int(self.pr("video", "height"))

    @property
    def fps(self) -> int:
        return int(self.pr("video", "fps", default=30))


def _dig(data: dict, keys: tuple[str, ...], default: Any) -> Any:
    cur: Any = data
    for key in keys:
        if not isinstance(cur, dict) or key not in cur:
            return default
        cur = cur[key]
    return cur


def load_settings(fmt: str = "short", simulate: bool = False) -> Settings:
    channel_file = CONFIG_DIR / "channel.yaml"
    profile_file = CONFIG_DIR / "profiles" / f"{fmt}.yaml"
    if not profile_file.exists():
        raise FileNotFoundError(f"Perfil desconocido: {profile_file}")

    channel = yaml.safe_load(channel_file.read_text(encoding="utf-8"))
    profile = yaml.safe_load(profile_file.read_text(encoding="utf-8"))

    env_keys = [
        "PEXELS_API_KEY",
        "YOUTUBE_CLIENT_ID",
        "YOUTUBE_CLIENT_SECRET",
        "YOUTUBE_REFRESH_TOKEN",
    ]
    env = {k: os.environ.get(k, "") for k in env_keys}
    return Settings(channel=channel, profile=profile, simulate=simulate, env=env)
