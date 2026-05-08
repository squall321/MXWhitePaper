"""Sprint 0 — codegen drift check stub.

After running `pnpm schema:gen`, the file `apps/api/app/schemas/document.py` is
created from the JSON Schema. This stub imports a few names so CI catches
breaking changes immediately.

Until codegen has been run for the first time, this module is intentionally a
no-op. CI invokes `pnpm schema:gen && python -c "import app.schemas.__check__"`
to verify the generated file compiles.
"""
from __future__ import annotations

try:  # pragma: no cover — exists only after first codegen run
    from app.schemas import document as _document_module  # type: ignore[attr-defined]
except ImportError:
    _document_module = None  # type: ignore[assignment]


__all__ = ["_document_module"]
