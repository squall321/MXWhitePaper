"""MXWhitePaper REST API 클라이언트 — stdlib urllib 전용.

imp/client.py 와 같은 이유로 httpx 를 쓰지 않는다 (바이너리 크기 ~30 MB 유지).
MCP read/write 도구가 쓰는 최소 표면만 구현:

  GET    /api/v1/documents?q=&limit=                  목록
  GET    /api/v1/documents/{slug}                     본문 + ETag
  POST   /api/v1/documents                            생성
  DELETE /api/v1/documents/{slug}                     archive (테스트 정리용)
  POST   /api/v1/documents/{slug}/blocks              {section_id, block, after_block_id?}
  PATCH  /api/v1/documents/{slug}/blocks/{id}         partial merge (body = block JSON)
  DELETE /api/v1/documents/{slug}/blocks/{id}
  POST   /api/v1/documents/{slug}/blocks/{id}/move    {target_section_id, after_block_id?}

모든 mutation 은 If-Match (W/"<doc_id>-<version>") 필수 — 호출측이
get_document() 가 돌려준 ETag 를 넘긴다. mismatch 시 서버는 412
PreconditionFailed (slug 충돌 등은 409 Conflict) — 양쪽 모두 "다시 읽고
재시도" 메시지로 변환한다.

서버 응답은 {data, meta, error} envelope. error 는 사람이 읽을 메시지로
변환해 ApiError 로 던진다. 테스트는 imp/client.py 와 같은 `opener` 주입
패턴으로 transport 를 바꿔치운다.
"""
from __future__ import annotations

import json
import os
import secrets
import socket
import time
import urllib.error
import urllib.request
from typing import Any, Callable
from urllib.parse import quote, urlencode

DEFAULT_API_URL = "http://127.0.0.1:8800"

TOKEN_HELP = (
    "MXWP_API_TOKEN 환경변수가 없습니다. 위키 UI 의 'API 토큰' 메뉴에서 "
    "write scope 토큰을 발급받아 (POST /api/v1/me/api-tokens, scopes "
    "['read','write']) MCP 설정 env 에 MXWP_API_TOKEN 으로 넣어주세요."
)

CONFLICT_HELP = (
    "문서가 그 사이 변경되었습니다 — get_document_outline 으로 다시 읽고 "
    "재시도하세요."
)

# Crockford base32 — ULID 알파벳 (I/L/O/U 제외).
_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def new_ulid() -> str:
    """stdlib 만으로 ULID 생성 (timestamp 48bit + random 80bit).

    schema 의 `^[0-9A-HJKMNP-TV-Z]{26}$` (Ulid def) 를 만족한다.
    """
    ts = int(time.time() * 1000)
    head: list[str] = []
    for _ in range(10):
        head.append(_CROCKFORD[ts & 31])
        ts >>= 5
    tail = "".join(secrets.choice(_CROCKFORD) for _ in range(16))
    return "".join(reversed(head)) + tail


def encode_multipart(
    *,
    file_field_name: str,
    filename: str,
    content: bytes,
    content_type: str,
    form_fields: dict[str, str],
) -> tuple[bytes, str]:
    """multipart/form-data body 를 stdlib 만으로 인코딩 → (body, boundary).

    form_fields 각 항목 → text part, file_field_name → file part.
    """
    boundary = "----mxwpmcp" + secrets.token_hex(16)
    crlf = b"\r\n"
    out: list[bytes] = []
    for name, value in form_fields.items():
        out.append(b"--" + boundary.encode("ascii"))
        out.append(
            f'Content-Disposition: form-data; name="{name}"'.encode("utf-8")
        )
        out.append(b"")
        out.append(str(value).encode("utf-8"))
    out.append(b"--" + boundary.encode("ascii"))
    out.append(
        (
            f'Content-Disposition: form-data; name="{file_field_name}"; '
            f'filename="{filename}"'
        ).encode("utf-8")
    )
    out.append(f"Content-Type: {content_type}".encode("ascii"))
    out.append(b"")
    out.append(content)
    out.append(b"--" + boundary.encode("ascii") + b"--")
    out.append(b"")
    return crlf.join(out), boundary


class ApiError(RuntimeError):
    """HTTP / transport 오류. 메시지는 이미 사람이 읽을 형태."""

    def __init__(self, message: str, *, status: int = 0, code: str = "") -> None:
        super().__init__(message)
        self.status = status
        self.code = code


def _default_opener(req: urllib.request.Request, timeout: float) -> Any:
    return urllib.request.urlopen(req, timeout=timeout)


class MxwpClient:
    """envelope 해석 + ETag 전달까지 담당하는 얇은 동기 클라이언트."""

    def __init__(
        self,
        base_url: str = DEFAULT_API_URL,
        token: str = "",
        *,
        opener: Callable[..., Any] | None = None,
        timeout: float = 15.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token
        self._opener = opener or _default_opener
        self.timeout = timeout

    @classmethod
    def from_env(cls, **kw: Any) -> "MxwpClient":
        return cls(
            os.environ.get("MXWP_API_URL", DEFAULT_API_URL),
            os.environ.get("MXWP_API_TOKEN", ""),
            **kw,
        )

    # ── transport ───────────────────────────────────────────────────

    def _headers(self, if_match: str | None) -> dict[str, str]:
        h = {"Accept": "application/json", "User-Agent": "mxwp-mcp/1.0"}
        if self.token:
            h["Authorization"] = f"Bearer {self.token}"
        if if_match:
            h["If-Match"] = if_match
        return h

    @staticmethod
    def _error_message(status: int, raw: str) -> tuple[str, str]:
        """(human message, error code) — envelope 의 error 를 풀어낸다."""
        code = ""
        server_msg = raw[:300]
        try:
            payload = json.loads(raw)
            err = payload.get("error") or {}
            code = err.get("code") or ""
            server_msg = err.get("message") or server_msg
        except (json.JSONDecodeError, AttributeError):
            pass
        if status in (409, 412):
            return f"{CONFLICT_HELP} (서버: {server_msg})", code
        if status == 401:
            return f"인증 실패 (401): {server_msg}. {TOKEN_HELP}", code
        if status == 403:
            return (
                f"권한/scope 부족 (403): {server_msg}. write scope 토큰이 "
                "필요합니다.",
                code,
            )
        return f"HTTP {status} {code}: {server_msg}", code

    def _request(
        self,
        method: str,
        path: str,
        *,
        body: dict[str, Any] | None = None,
        if_match: str | None = None,
        query: dict[str, Any] | None = None,
    ) -> tuple[Any, dict[str, Any], dict[str, str]]:
        """→ (data, meta, headers). 4xx/5xx/transport 는 ApiError."""
        url = f"{self.base_url}{path}"
        if query:
            url += "?" + urlencode({k: v for k, v in query.items() if v not in (None, "")})
        data_bytes = None
        headers = self._headers(if_match)
        if body is not None:
            data_bytes = json.dumps(body, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json"
        return self._send(method, path, url, data_bytes, headers)

    def _send(
        self,
        method: str,
        path: str,
        url: str,
        data_bytes: bytes | None,
        headers: dict[str, str],
    ) -> tuple[Any, dict[str, Any], dict[str, str]]:
        req = urllib.request.Request(url, data=data_bytes, method=method)
        for k, v in headers.items():
            req.add_header(k, v)
        try:
            resp = self._opener(req, self.timeout)
        except urllib.error.HTTPError as e:
            try:
                raw = e.read().decode("utf-8", errors="replace")
            except Exception:
                raw = ""
            msg, code = self._error_message(e.code, raw)
            raise ApiError(msg, status=e.code, code=code) from e
        except urllib.error.URLError as e:
            raise ApiError(
                f"API 서버에 연결할 수 없습니다: {self.base_url} ({e.reason}). "
                "MXWP_API_URL 을 확인하세요."
            ) from e
        except socket.timeout as e:
            raise ApiError(f"timeout ({self.timeout}s) on {method} {path}") from e

        raw = resp.read()
        out_headers = {k: v for k, v in resp.headers.items()}
        if not raw:
            return None, {}, out_headers
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as e:
            raise ApiError(f"non-JSON response on {method} {path}: {e}") from e
        if not isinstance(payload, dict):
            return payload, {}, out_headers
        return payload.get("data", payload), payload.get("meta") or {}, out_headers

    def _post_multipart(
        self,
        path: str,
        *,
        file_field_name: str,
        filename: str,
        content: bytes,
        content_type: str,
        form_fields: dict[str, str] | None = None,
    ) -> tuple[Any, dict[str, Any], dict[str, str]]:
        """multipart/form-data POST (stdlib boundary 직접 인코딩) → (data, meta, headers)."""
        body, boundary = encode_multipart(
            file_field_name=file_field_name,
            filename=filename,
            content=content,
            content_type=content_type,
            form_fields=form_fields or {},
        )
        headers = self._headers(None)
        headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
        return self._send("POST", path, f"{self.base_url}{path}", body, headers)

    @staticmethod
    def _etag(meta: dict[str, Any], headers: dict[str, str]) -> str:
        return (
            meta.get("etag")
            or headers.get("ETag")
            or headers.get("etag")
            or ""
        )

    # ── documents ───────────────────────────────────────────────────

    def list_documents(self, q: str = "", limit: int = 20) -> list[dict[str, Any]]:
        data, _meta, _h = self._request(
            "GET", "/api/v1/documents", query={"q": q, "limit": limit}
        )
        return data if isinstance(data, list) else []

    def get_document(self, slug: str) -> tuple[dict[str, Any], str]:
        """→ (data, etag). data 에 'content' (DocumentJSON) 포함."""
        path = f"/api/v1/documents/{quote(slug, safe='')}"
        data, meta, headers = self._request("GET", path)
        return data, self._etag(meta, headers)

    def create_document(self, payload: dict[str, Any]) -> tuple[dict[str, Any], str]:
        data, meta, headers = self._request(
            "POST", "/api/v1/documents", body=payload
        )
        return data, self._etag(meta, headers)

    def delete_document(self, slug: str) -> None:
        path = f"/api/v1/documents/{quote(slug, safe='')}"
        self._request("DELETE", path)

    # ── imports ─────────────────────────────────────────────────────

    def import_file(
        self,
        kind: str,
        *,
        filename: str,
        content: bytes,
        content_type: str,
        slug: str = "",
        title: str = "",
    ) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
        """파일 바이트를 /api/v1/imports/<kind> 로 multipart POST.

        → (document, summary, meta). document/summary 는 응답 data 의 동명 키,
        meta 는 envelope meta (slug 포함).
        """
        fields: dict[str, str] = {}
        if slug:
            fields["slug"] = slug
        if title:
            fields["title"] = title
        data, meta, _h = self._post_multipart(
            f"/api/v1/imports/{kind}",
            file_field_name="file",
            filename=filename,
            content=content,
            content_type=content_type,
            form_fields=fields,
        )
        data = data or {}
        return data.get("document") or {}, data.get("summary") or {}, meta

    # ── image upload (2-phase) ──────────────────────────────────────

    def init_upload(
        self, *, filename: str, mime_type: str, sha256: str, size: int
    ) -> dict[str, Any]:
        """POST /uploads/image/init → data dict (dedup 이면 deduped=True+image_id)."""
        data, _meta, _h = self._request(
            "POST",
            "/api/v1/uploads/image/init",
            body={
                "filename": filename,
                "mime_type": mime_type,
                "sha256": sha256,
                "size": size,
            },
        )
        return data or {}

    def put_bytes(self, url: str, content: bytes, content_type: str) -> None:
        """presigned PUT URL 로 raw 바이트 업로드 (envelope 없음)."""
        req = urllib.request.Request(
            url, data=content, method="PUT",
            headers={"Content-Type": content_type},
        )
        try:
            self._opener(req, self.timeout)
        except urllib.error.HTTPError as e:
            raise ApiError(
                f"presigned PUT 실패 (HTTP {e.code})", status=e.code
            ) from e
        except urllib.error.URLError as e:
            raise ApiError(f"presigned PUT 연결 실패: {e.reason}") from e

    def finalize_upload(self, upload_id: str) -> dict[str, Any]:
        """POST /uploads/image/finalize → data dict (image_id 등)."""
        data, _meta, _h = self._request(
            "POST",
            "/api/v1/uploads/image/finalize",
            body={"uploadId": upload_id},
        )
        return data or {}

    def upload_bytes(
        self, *, filename: str, content: bytes, mime_type: str
    ) -> dict[str, Any]:
        """raw 바이트를 2-phase (init→presigned PUT→finalize) 로 업로드.

        upload_image / upload_image_base64 / extract_pptx_images 가 공유하는
        공통 경로 — sha256 dedup 이면 PUT/finalize 를 생략한다.
        → {image_id, image_url?, deduped}
        """
        import hashlib

        sha256 = hashlib.sha256(content).hexdigest()
        init = self.init_upload(
            filename=filename, mime_type=mime_type, sha256=sha256, size=len(content)
        )
        urls = init.get("urls") or {}
        if init.get("deduped"):
            return {
                "image_id": init.get("image_id"),
                "image_url": urls.get("view") or urls.get("orig"),
                "deduped": True,
            }
        upload_id = init.get("uploadId")
        if not upload_id:
            raise ApiError(f"init 응답에 uploadId 가 없습니다: {init}")
        self.put_bytes(init["url"], content, mime_type)
        fin = self.finalize_upload(upload_id)
        fin_urls = fin.get("urls") or {}
        return {
            "image_id": fin.get("image_id"),
            "image_url": fin_urls.get("view") or fin_urls.get("orig"),
            "deduped": bool(fin.get("deduped")),
        }

    def upload_image_from_url(self, url: str) -> dict[str, Any]:
        """POST /uploads/image/from-url → 서버가 URL 을 직접 fetch (바이트가 모델 안 거침).

        → {image_id, image_url?, deduped}. 서버가 sha256 dedup 까지 끝낸 결과를 그대로 매핑.
        """
        data, _meta, _h = self._request(
            "POST",
            "/api/v1/uploads/image/from-url",
            body={"url": url},
        )
        data = data or {}
        urls = data.get("urls") or {}
        return {
            "image_id": data.get("image_id"),
            "image_url": urls.get("view") or urls.get("orig"),
            "deduped": bool(data.get("deduped")),
        }

    # ── blocks ──────────────────────────────────────────────────────

    def insert_block(
        self,
        slug: str,
        section_id: str,
        block: dict[str, Any],
        after_block_id: str | None,
        etag: str,
    ) -> tuple[dict[str, Any], str]:
        body: dict[str, Any] = {"section_id": section_id, "block": block}
        if after_block_id:
            body["after_block_id"] = after_block_id
        path = f"/api/v1/documents/{quote(slug, safe='')}/blocks"
        data, meta, headers = self._request("POST", path, body=body, if_match=etag)
        return data, self._etag(meta, headers)

    def patch_block(
        self, slug: str, block_id: str, block: dict[str, Any], etag: str
    ) -> tuple[dict[str, Any], str]:
        path = f"/api/v1/documents/{quote(slug, safe='')}/blocks/{quote(block_id, safe='')}"
        data, meta, headers = self._request("PATCH", path, body=block, if_match=etag)
        return data, self._etag(meta, headers)

    def delete_block(
        self, slug: str, block_id: str, etag: str
    ) -> tuple[dict[str, Any], str]:
        path = f"/api/v1/documents/{quote(slug, safe='')}/blocks/{quote(block_id, safe='')}"
        data, meta, headers = self._request("DELETE", path, if_match=etag)
        return data, self._etag(meta, headers)

    def move_block(
        self,
        slug: str,
        block_id: str,
        target_section_id: str,
        after_block_id: str | None,
        etag: str,
    ) -> tuple[dict[str, Any], str]:
        body: dict[str, Any] = {"target_section_id": target_section_id}
        if after_block_id:
            body["after_block_id"] = after_block_id
        path = (
            f"/api/v1/documents/{quote(slug, safe='')}/blocks/"
            f"{quote(block_id, safe='')}/move"
        )
        data, meta, headers = self._request("POST", path, body=body, if_match=etag)
        return data, self._etag(meta, headers)

    # ── triples (semantic relationships) ────────────────────────────
    # 문서 사이의 typed 의미 엣지 (subject --predicate--> object). ETag 무관
    # (문서 본문이 아니라 별도 doc_triples 테이블). inverse_predicate 는 object
    # 쪽에서 읽는 역방향 설명.

    def list_predicate_types(self) -> list[dict[str, Any]]:
        data, _meta, _h = self._request("GET", "/api/v1/triples/predicates")
        return data if isinstance(data, list) else []

    def get_subgraph(self, root: str, depth: int) -> dict[str, Any]:
        data, _meta, _h = self._request(
            "GET", "/api/v1/triples/subgraph",
            query={"root": root, "depth": depth},
        )
        return data or {}

    def list_triples(
        self,
        *,
        subject: str | None = None,
        object: str | None = None,
        predicate: str | None = None,
        source: str | None = None,
    ) -> list[dict[str, Any]]:
        data, _meta, _h = self._request(
            "GET",
            "/api/v1/triples",
            query={
                "subject": subject,
                "object": object,
                "predicate": predicate,
                "source": source,
            },
        )
        return data if isinstance(data, list) else []

    def create_triple(
        self,
        *,
        subject_slug: str,
        predicate: str,
        object_slug: str,
        inverse_predicate: str | None = None,
        source: str = "manual",
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "subject_slug": subject_slug,
            "predicate": predicate,
            "object_slug": object_slug,
            "source": source,
        }
        if inverse_predicate:
            body["inverse_predicate"] = inverse_predicate
        data, _meta, _h = self._request("POST", "/api/v1/triples", body=body)
        return data or {}

    def delete_triple(self, triple_id: str) -> None:
        self._request(
            "DELETE", f"/api/v1/triples/{quote(triple_id, safe='')}"
        )

    def extract_triples(self, subject_slug: str) -> dict[str, Any]:
        data, _meta, _h = self._request(
            "POST", "/api/v1/triples/extract", body={"subject_slug": subject_slug}
        )
        return data or {}


__all__ = [
    "ApiError", "MxwpClient", "new_ulid", "encode_multipart",
    "DEFAULT_API_URL", "TOKEN_HELP", "CONFLICT_HELP",
]
