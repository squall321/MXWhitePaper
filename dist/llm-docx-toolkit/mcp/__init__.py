"""mxwp-mcp package — entry point for the MCP stdio server.

The directory shares a name with Anthropic's installed `mcp` SDK. Anything
that needs the SDK must go through `__main__.py` (which un-shadows the SDK
before loading `server.py` via importlib), or — for tests — load
`server.py` directly with importlib.util.spec_from_file_location.
"""
from __future__ import annotations
