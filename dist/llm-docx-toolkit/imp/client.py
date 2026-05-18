"""HTTP client — stdlib only (urllib + manual multipart).

Why no httpx? The lite toolkit binary is meant to stay ~30 MB. httpx pulls
in h11 / anyio / sniffio which would push us past that for one POST per
file. urllib is in the stdlib so the cost is zero binary bytes.

The two pieces that urllib doesn't give us for free:
  * multipart/form-data encoding (used by POST /imports/docx)
  * a "transport" we can swap out in tests so we don't need a live server

`MXWPClient.__init__` accepts an `opener` callable that defaults to
`urllib.request.urlopen` — tests pass a fake. The contract is the same as
`urlopen`: takes a `Request`, returns an object with `.read()`, `.status`,
`.headers`.
"""
from __future__ import annotations

import json
import mimetypes
import secrets
import socket
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Callable, Protocol
from urllib.parse import quote


class _OpenerResponse(Protocol):  # pragma: no cover trivial protocol
    status: int
    headers: Any

    def read(self) -> bytes: ...


Opener = Callable[[urllib.request.Request, float], _OpenerResponse]


class ClientError(RuntimeError):
    """Wrapper for transport / HTTP errors. Carries (status, body) so the
    uploader can route 401/403/409/413/429 to the right Outcome."""

    def __init__(self, message: str, *, status: int = 0, body: str = "") -> None:
        super().__init__(message)
        self.status = status
        self.body = body


def _default_opener(req: urllib.request.Request, timeout: float) -> _OpenerResponse:
    return urllib.request.urlopen(req, timeout=timeout)  # type: ignore[return-value]


# ─── multipart encoding ───────────────────────────────────────────────


def _encode_multipart(
    fields: dict[str, str], files: dict[str, tuple[str, bytes, str]]
) -> tuple[bytes, str]:
    """Build a multipart/form-data body + content-type header.

    `files` maps field name → (filename, content, mime_type). We do not
    base64-encode binaries — urllib transmits the raw bytes intact.

    The boundary is built from `secrets.token_hex` (16 bytes) so two
    concurrent uploads can never collide. Per RFC 2046 the boundary can
    appear inside neither field text nor file bytes — a random 32-hex
    string is statistically safe.
    """
    boundary = f"----mxwpImport{secrets.token_hex(16)}"
    crlf = b"\r\n"
    parts: list[bytes] = []
    for name, value in fields.items():
        parts.append(f"--{boundary}".encode())
        parts.append(
            f'Content-Disposition: form-data; name="{name}"'.encode()
        )
        parts.append(b"")
        parts.append(value.encode("utf-8"))
    for name, (filename, content, mime) in files.items():
        parts.append(f"--{boundary}".encode())
        # Filename may contain UTF-8; use RFC 5987 filename* so non-ASCII
        # (Korean) names survive without latin-1 mangling.
        ascii_safe = filename.encode("ascii", errors="replace").decode("ascii")
        parts.append(
            (
                f'Content-Disposition: form-data; name="{name}"; '
                f'filename="{ascii_safe}"; '
                f"filename*=UTF-8''{quote(filename, safe='')}"
            ).encode()
        )
        parts.append(f"Content-Type: {mime}".encode())
        parts.append(b"")
        parts.append(content)
    parts.append(f"--{boundary}--".encode())
    parts.append(b"")
    body = crlf.join(parts)
    return body, f"multipart/form-data; boundary={boundary}"


# ─── client ───────────────────────────────────────────────────────────


class MXWPClient:
    """Minimal client for the three endpoints the importer touches:

      POST /api/v1/imports/docx
      POST /api/v1/documents
      GET  /api/v1/documents/{slug}
      PUT  /api/v1/documents/{slug}  (with If-Match)

    All methods raise ClientError on transport / 4xx / 5xx (except 404
    on GET, which returns None — that's "slug is free").
    """

    def __init__(
        self,
        server: str,
        token: str,
        *,
        opener: Opener | None = None,
        timeout: float = 60.0,
        user_agent: str = "mxwp-import/1.0",
    ) -> None:
        self.server = server.rstrip("/")
        self.token = token
        self._opener: Opener = opener or _default_opener
        self.timeout = timeout
        self.user_agent = user_agent

    # ── helpers ────────────────────────────────────────────────────

    def _headers(self, extra: dict[str, str] | None = None) -> dict[str, str]:
        h: dict[str, str] = {
            "Authorization": f"Bearer {self.token}",
            "Accept": "application/json",
            "User-Agent": self.user_agent,
        }
        if extra:
            h.update(extra)
        return h

    def _do(
        self,
        method: str,
        path: str,
        *,
        body: bytes | None = None,
        headers: dict[str, str] | None = None,
        allow_404: bool = False,
    ) -> tuple[int, bytes, dict[str, str]]:
        url = f"{self.server}{path}"
        req = urllib.request.Request(url, data=body, method=method)
        for k, v in self._headers(headers).items():
            req.add_header(k, v)
        try:
            resp = self._opener(req, self.timeout)
        except urllib.error.HTTPError as e:
            err_body = ""
            try:
                err_body = e.read().decode("utf-8", errors="replace")
            except Exception:
                pass
            if allow_404 and e.code == 404:
                return 404, b"", {}
            raise ClientError(
                f"HTTP {e.code} on {method} {path}: {err_body[:300]}",
                status=e.code,
                body=err_body,
            ) from e
        except urllib.error.URLError as e:
            raise ClientError(f"transport error on {method} {path}: {e.reason}") from e
        except socket.timeout as e:
            raise ClientError(f"timeout on {method} {path}") from e

        status = getattr(resp, "status", 200)
        raw = resp.read()
        # `resp.headers` is an email.message.Message; flatten to plain dict.
        out_headers: dict[str, str] = {}
        for k, v in resp.headers.items():
            out_headers[k] = v
        return status, raw, out_headers

    @staticmethod
    def _parse_json(raw: bytes) -> dict[str, Any]:
        if not raw:
            return {}
        try:
            data = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as e:
            raise ClientError(f"non-JSON response: {e}", body=raw[:300].decode("utf-8", errors="replace")) from e
        if not isinstance(data, dict):
            raise ClientError(f"response body is not an object: {type(data).__name__}")
        return data

    @staticmethod
    def _unwrap_envelope(payload: dict[str, Any]) -> dict[str, Any]:
        """The server wraps successful payloads in `{ok: true, data: ...}`.

        Older smoke tests have called endpoints that returned bare objects —
        fall back to the whole payload when `data` is absent so we don't
        explode on a shape change.
        """
        if "data" in payload and isinstance(payload["data"], dict):
            return payload["data"]
        return payload

    # ── endpoints ───────────────────────────────────────────────────

    def import_docx(self, file: Path, slug: str, title: str) -> dict[str, Any]:
        """POST /imports/docx → `{document, summary}` (after envelope unwrap)."""
        content = file.read_bytes()
        mime = (
            mimetypes.guess_type(file.name)[0]
            or "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        )
        body, content_type = _encode_multipart(
            fields={"slug": slug, "title": title},
            files={"file": (file.name, content, mime)},
        )
        status, raw, _ = self._do(
            "POST",
            "/api/v1/imports/docx",
            body=body,
            headers={"Content-Type": content_type, "Content-Length": str(len(body))},
        )
        if status >= 400:
            raise ClientError(f"import_docx returned HTTP {status}", status=status,
                              body=raw[:300].decode("utf-8", errors="replace"))
        return self._unwrap_envelope(self._parse_json(raw))

    def create_document(self, doc: dict[str, Any]) -> dict[str, Any]:
        """POST /documents → `{id, slug, title, version, status}`."""
        body = json.dumps(doc, ensure_ascii=False).encode("utf-8")
        status, raw, headers = self._do(
            "POST",
            "/api/v1/documents",
            body=body,
            headers={"Content-Type": "application/json", "Content-Length": str(len(body))},
        )
        if status >= 400:
            raise ClientError(f"create_document returned HTTP {status}", status=status)
        data = self._unwrap_envelope(self._parse_json(raw))
        # ETag on the response header is useful for follow-up updates.
        etag = headers.get("ETag") or headers.get("etag")
        if etag and "etag" not in data:
            data["etag"] = etag
        return data

    def get_document(self, slug: str) -> dict[str, Any] | None:
        """GET /documents/{slug} → data dict (with `etag` injected from
        the response header), or None when the slug does not exist (404)."""
        # Path component may be Korean; URL-encode.
        path = f"/api/v1/documents/{quote(slug, safe='')}"
        status, raw, headers = self._do("GET", path, allow_404=True)
        if status == 404:
            return None
        if status >= 400:
            raise ClientError(f"get_document returned HTTP {status}", status=status)
        data = self._unwrap_envelope(self._parse_json(raw))
        etag = headers.get("ETag") or headers.get("etag")
        if etag:
            data["etag"] = etag
        return data

    def update_document(
        self, slug: str, doc: dict[str, Any], etag: str
    ) -> dict[str, Any]:
        """PUT /documents/{slug} with If-Match. Returns the updated data."""
        body = json.dumps(doc, ensure_ascii=False).encode("utf-8")
        path = f"/api/v1/documents/{quote(slug, safe='')}"
        status, raw, headers = self._do(
            "PUT",
            path,
            body=body,
            headers={
                "Content-Type": "application/json",
                "Content-Length": str(len(body)),
                "If-Match": etag,
            },
        )
        if status >= 400:
            raise ClientError(f"update_document returned HTTP {status}", status=status)
        data = self._unwrap_envelope(self._parse_json(raw))
        new_etag = headers.get("ETag") or headers.get("etag")
        if new_etag and "etag" not in data:
            data["etag"] = new_etag
        return data


__all__ = ["ClientError", "MXWPClient", "Opener"]
