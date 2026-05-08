"""Stand-alone .env loader — refresh_links / seed 가 쓰던 동일 헬퍼."""
from __future__ import annotations

import os
from pathlib import Path


def _load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        if value.startswith(('"', "'")):
            quote = value[0]
            end = value.find(quote, 1)
            value = value[1:end] if end != -1 else value[1:]
        else:
            hp = value.find(" #")
            if hp != -1:
                value = value[:hp]
            value = value.strip()
        os.environ.setdefault(key, value)


def load_env() -> None:
    """컨테이너 안 (/workspace/.env) → 호스트 직접 (../../.env) 순서로 시도."""
    for candidate in (
        Path("/workspace/.env"),
        Path(__file__).resolve().parents[3] / ".env",
    ):
        _load_env_file(candidate)
