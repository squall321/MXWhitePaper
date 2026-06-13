"""Pytest setup — load the SDK `mcp` before pytest picks up the local one.

The toolkit's directory contains a package literally named `mcp`. When tests
run from the toolkit root, that local package shadows the installed SDK.
This conftest runs first and pre-imports the SDK so subsequent `import mcp…`
calls (including the one inside our server module) resolve correctly.
"""
from __future__ import annotations

import importlib
import sys
from pathlib import Path


_TOOLKIT_DIR = str(Path(__file__).resolve().parents[2])


def _ensure_sdk_mcp() -> None:
    # Make sure the SDK is imported *first* so its modules occupy sys.modules
    # under `mcp.*`. Removing existing `mcp.*` entries would also delete the
    # pytest-installed `mcp.tests.conftest` placeholder, so we don't.
    saved = sys.path[:]
    sys.path = [p for p in sys.path if p != _TOOLKIT_DIR and p not in ("", ".")]
    try:
        importlib.import_module("mcp.server.fastmcp")
    finally:
        sys.path = saved


_ensure_sdk_mcp()


def pytest_configure(config) -> None:
    config.addinivalue_line(
        "markers",
        "live: live MXWhitePaper API 가 필요한 통합 테스트 (도달 불가 시 skip)",
    )
