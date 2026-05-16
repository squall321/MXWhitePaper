"""`python -m mcp` entry — un-shadows the SDK before invoking server.main()."""
from __future__ import annotations

import importlib
import importlib.util
import sys
from pathlib import Path


def _bootstrap() -> None:
    """Resolve the local-vs-SDK `mcp` name collision.

    Load our `server.py` via importlib (so the relative import system never
    has to re-resolve `mcp`), then strip the local `mcp` package + toolkit
    dir from sys, leaving the installed SDK as the sole `mcp`.
    """
    here = Path(__file__).resolve().parent
    server_spec = importlib.util.spec_from_file_location(
        "_mxwp_mcp_server", here / "server.py"
    )
    assert server_spec is not None and server_spec.loader is not None
    server_mod = importlib.util.module_from_spec(server_spec)

    # Drop the local `mcp` so the SDK wins on subsequent imports.
    toolkit_dir = str(here.parent)
    sys.path = [
        p for p in sys.path
        if p != toolkit_dir and p != "" and p != "."
    ]
    for k in [k for k in sys.modules if k == "mcp" or k.startswith("mcp.")]:
        del sys.modules[k]
    # Keep toolkit dir reachable for `from rag…` imports, but at the tail so
    # site-packages keeps priority for `mcp`.
    if toolkit_dir not in sys.path:
        sys.path.append(toolkit_dir)

    server_spec.loader.exec_module(server_mod)
    server_mod.main()


if __name__ == "__main__":
    _bootstrap()
