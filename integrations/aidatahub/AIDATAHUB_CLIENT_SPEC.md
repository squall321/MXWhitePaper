# AX Hub Client Spec — for MXWhitePaper Integration

> AX Hub (Mobile eXperience AI Data Hub) 가 MXWhitePaper 문서를 받는 방식의
> 명세서. MXWP 측 LLM/엔지니어가 이 문서를 통합 코드 자동·수동 작성 시 사용.

대상 AX Hub: v0.8+
인증: `X-API-Key: <token>` HTTP 헤더
콘텐츠 타입: `application/json`

---

## 1. AX Hub Record 스키마 핵심

```json
{
  "id": "DOC-MX-WP-2026-0000000001",           // auto_seq 권장
  "data_type": "DOC",
  "team": "MX",
  "group": "WP",
  "year": 2026,
  "title": "AI Data Hub 사업부 확산 전략 v1.0",
  "summary": "1쪽 요약 — 검색 가중치 boost",
  "content": {
    "sections": [
      {"section_id":"1","level":1,"title":"개요","content_text":"..."},
      {"section_id":"1.1","level":2,"title":"배경","content_text":"..."},
      {"section_id":"2","level":1,"title":"전략","content_text":"..."}
    ]
  },
  "doc_type": "whitepaper",
  "tags": ["whitepaper","strategy","author:김ㅇㅇ","status:published"],
  "agents": ["mx-whitepaper-analyst"],
  "classification": "internal",
  "language": "ko",
  "author": "mxwp",
  "department": "MX/WP",
  "valid_from": "2026-03-15",
  "subject_keywords": ["AI Data Hub","확산","전략"],
  "version": "1.0"
}
```

**필수 필드**: `title`, `content`  
**id 자동 부여 시**: `data_type`, `team`, `group`, `year` (auto_seq=true)

---

## 2. POST /api/records/import 사양

```
POST {AIDH_BASE_URL}/api/records/import
?auto_seq=true&external_source=mxwp[&dry_run=true]
X-API-Key: <token>
Content-Type: application/json
```

### Body 3가지 형식 모두 허용
```json
// 단건
{"title":"...","content":{...},"_external_id":"<document_id>"}

// 배열
[ {...}, {...} ]

// wrapped
{"auto_seq":true,"external_source":"mxwp","records":[...]}
```

### `_external_id` (UPSERT 키)
- MXWP 의 `document_id` (UUID) 그대로 전달
- AX Hub 의 `external_id_map(source='mxwp', external_id=<uuid>)` 조회 → 자동 UPSERT

### 응답
```json
{
  "count":50,"ok":48,"failed":2,"warnings":1,
  "auto_seq":true,"dry_run":false,"external_source":"mxwp",
  "results":[
    {"id":"DOC-MX-WP-2026-0000000001","action":"inserted","external_id":"abc-123-...","warnings":[]},
    ...
  ]
}
```

### 한도
- 1 호출당 최대 **1000 records**
- whitepaper 는 1 문서 1 record — 보통 분할 필요 없음

---

## 3. DocumentJSON v1.0 → AX Hub Record 변환 규약

### Source: MXWP `GET /api/v1/documents/`
응답 (목록):
```json
{
  "items": [
    {
      "document_id": "uuid",
      "slug": "ai-data-hub-strategy",
      "title": "...",
      "summary": "...",
      "status": "published",
      "tags": ["..."],
      "authors": ["..."],
      "keywords": ["..."],
      "version": "1.0",
      "etag": "...",
      "created_at": "2026-03-15T...",
      "updated_at": "2026-05-28T..."
    }
  ],
  "next_cursor": "..."
}
```

응답 (단건 `GET /api/v1/documents/{slug}`):
- 위 + `sections[]` 트리 (재귀)

### Target: AX Hub Record

```python
def doc_to_record(doc: dict) -> dict:
    sections_flat = flatten_sections(doc.get("sections", []))
    return {
        "_external_id": doc["document_id"],
        "data_type": "DOC",
        "team": "MX",
        "group": "WP",
        "year": parse_year(doc.get("created_at")),
        "title": doc["title"],
        "summary": doc.get("summary") or "",
        "doc_type": classify_doc_type(doc),   # "whitepaper" or "feasibility_study"
        "tags": collect_tags(doc),
        "agents": ["mx-whitepaper-analyst"],
        "classification": "internal",
        "language": "ko",
        "author": "mxwp",
        "department": "MX/WP",
        "valid_from": parse_date(doc.get("created_at")),
        "subject_keywords": doc.get("keywords") or [],
        "version": doc.get("version") or "1.0",
        "content": {"sections": sections_flat},
    }
```

### sections 트리 → 평탄화 (DFS)
```python
def flatten_sections(sections, parent_path=""):
    out = []
    for s in sections:
        sid = s.get("number") or s.get("id") or "0"
        out.append({
            "section_id": sid,
            "level": s.get("level", 1),
            "title": s.get("title") or "",
            "content_text": render_blocks(s.get("blocks", [])),
            "figure_refs": collect_image_ids(s.get("blocks", [])),
            "table_refs": [],
        })
        # 자식 재귀
        if s.get("children"):
            out.extend(flatten_sections(s["children"], parent_path=sid))
    return out
```

### blocks → markdown content_text

```python
def render_blocks(blocks):
    parts = []
    for b in blocks:
        bt = b.get("type")
        if bt == "paragraph":
            parts.append(b.get("text") or "")
        elif bt == "heading":
            level = b.get("level", 1)
            parts.append(f"{'#' * level} {b.get('text', '')}")
        elif bt == "list":
            prefix = "1. " if b.get("ordered") else "- "
            items = b.get("items") or []
            parts.append("\n".join(f"{prefix}{it}" for it in items))
        elif bt == "table":
            parts.append(render_table(b))  # markdown table
        elif bt == "code":
            lang = b.get("lang", "")
            parts.append(f"```{lang}\n{b.get('code','')}\n```")
        elif bt == "math":
            parts.append(f"$$\n{b.get('tex','')}\n$$")
        elif bt == "quote":
            parts.append(f"> {b.get('text','')}")
        elif bt == "callout":
            kind = b.get("kind", "note")
            parts.append(f"**[{kind}]** {b.get('text','')}")
        elif bt == "image-attachment":
            alt = b.get("alt") or ""
            url = b.get("url") or f"attachment://{b.get('image_id', '?')}"
            parts.append(f"![{alt}]({url})")
    return "\n\n".join(parts)
```

### Attachments (이미지)

MXWP 의 이미지 (MinIO) 처리:
- **url_ref 모드 (권장)**: `record_attachments` 에 `source_url=<minio_presigned_url>` 저장. record 본문에는 `![alt](url)` 형태로 인용.
- **download_upload 모드**: MinIO 에서 다운 → AX Hub `/attachments/` 로 업로드.

본 어댑터는 config.yml 의 `sync.attachment_mode` 로 결정.

---

## 4. 인증 & 보안

- 헤더: `X-API-Key: <AIDH_API_KEY>`
- AX Hub `/api/auth/keys` 에서 admin 이 발급
- 90일 키 회전 권장
- TLS: `https://aidatahub.internal` (운영)

---

## 5. 에러 응답

```json
{"detail": "...", "type": "..."}
```

| HTTP | 의미 | 권장 동작 |
|---|---|---|
| 200 | 부분 성공 가능 | `results[i].error` 확인 후 dead_letter |
| 400 | body 형식 오류 | mapping_rules 또는 변환 로직 수정 |
| 401 | API 키 만료 | 키 회전 |
| 413 | records 1000 초과 | 분할 호출 |
| 429 | rate limit | backoff + 재시도 |
| 500 | AX Hub 내부 오류 | dead_letter, backoff |

---

## 6. 호출 예시 (MXWP 측 코드)

```python
import httpx

async def push_documents(docs: list[dict], *, aidh_url: str, aidh_key: str):
    body = {
        "auto_seq": True,
        "external_source": "mxwp",
        "records": [doc_to_record(d) for d in docs],
    }
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            f"{aidh_url}/api/records/import",
            params={"auto_seq": "true", "external_source": "mxwp"},
            headers={"X-API-Key": aidh_key, "Content-Type": "application/json"},
            json=body,
        )
        resp.raise_for_status()
        return resp.json()
```

전체 동작은 `aidatahub_sync.py` 참조.

---

## 7. AX Hub 측 사전 등록 (1회)

AX Hub 운영자가:
1. `org_group` (MX/WP)
2. `doc_type` (whitepaper — mode=llm_context)
3. `agent` (mx-whitepaper-analyst)
4. `sync_source` (mxwp — mapping_rules 포함)
5. `api_key` (MXWP 용 X-API-Key 발급)

→ AX Hub repo 의 `examples/MX/whitepaper-mxwp/setup.sh` 가 4번까지 자동.

---

## 8. 변경 이력

| 버전 | 날짜 | 변경 |
|---|---|---|
| 1.0 | 2026-05-28 | 초안 (DocumentJSON v1.0 매핑) |
