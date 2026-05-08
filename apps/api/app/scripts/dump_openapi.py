#!/usr/bin/env python3
"""Dump the FastAPI runtime OpenAPI spec to apps/api/openapi.json.

Used by CI + the pre-commit hook to detect drift between the live FastAPI
contract and the committed snapshot. Run with:

    python3 apps/api/app/scripts/dump_openapi.py

The script imports ``app.main:app`` and calls ``app.openapi()`` — no server
needs to be running. Output is pretty-printed JSON so diffs are reviewable.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
API_ROOT = ROOT / "apps" / "api"
OUT = API_ROOT / "openapi.json"

# Ensure ``app`` package is importable when running from repo root.
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

# Avoid pulling real DB / secret config during import — the OpenAPI generator
# only needs route shapes, not runtime settings. These defaults are safe even
# when the api container is not running.
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://x:x@localhost/x")
os.environ.setdefault("MEILI_URL", "http://localhost:7700")
os.environ.setdefault("MEILI_MASTER_KEY", "x")
os.environ.setdefault("MINIO_ENDPOINT", "http://localhost:9000")
os.environ.setdefault("MINIO_ACCESS_KEY", "x")
os.environ.setdefault("MINIO_SECRET_KEY", "x")
os.environ.setdefault("JWT_SECRET", "x")

from app.main import app  # noqa: E402

spec = app.openapi()
OUT.write_text(json.dumps(spec, indent=2, ensure_ascii=False, sort_keys=True) + "\n")
paths = len(spec.get("paths", {}))
print(f"✓ OpenAPI spec dumped → {OUT.relative_to(ROOT)} ({paths} paths)")
