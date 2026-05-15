"""Minimal stub replacing `app.core.config.get_settings` for the standalone
toolkit. Only the two fields the import pipeline actually reads are exposed.

This file is the ONLY thing the toolkit changes about the production import
codebase — everything else is the real, unmodified `docx_import` /
`widget_markers` source so validation behaviour matches a live server.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class _ToolkitSettings:
    import_default_division: str = "MX"
    import_default_confidentiality: str = "internal"
    docx_import_max_bytes: int = 50 * 1024 * 1024  # generous local cap


def get_settings() -> _ToolkitSettings:
    return _ToolkitSettings()
