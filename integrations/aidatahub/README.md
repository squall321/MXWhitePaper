# MX White Paper → AX Hub (Mobile eXperience AI Data Hub) 통합

> MXWhitePaper 의 published 문서 (DocumentJSON v1.0) 본문을 AX Hub 로
> 미러링하여 다른 부서 데이터(시뮬/시험/VOC)와 결합 검색 가능하게 한다.

작성일: 2026-05-28
대상 AX Hub: v0.8+ (alembic 0026/0027)
MXWhitePaper 측 변경: **Sprint 3 — `limit/offset` 페이지네이션 5줄 추가** (routers/documents.py + repos/document_repo.py)

---

## 1. 핵심 동선 — 2가지 모드

### A. 초기 backfill (1회) — MXWP 측이 push

```bash
python aidatahub_sync.py \
  --mode=push-all \
  --config=config.yml
```

published 문서 전부 → DocumentJSON 변환 → AX Hub 일괄 적재.

### B. 정기 update — 두 옵션

**B-1. AX Hub pull (권장)**
- AX Hub 운영자가 `sync_sources` 에 `mxwp` 1회 등록 (sync_source.example.json 사용)
- AX Hub 외부 cron 이 매 30분 `POST /api/sync/sources/{id}/run` 호출
- MXWhitePaper 측 추가 작업 0

**B-2. MXWP 측 webhook push (real-time)**
- 문서 publish 이벤트 시 즉시 단건 push
- 본 폴더의 webhook handler 예시 참조 (아래 §4)

---

## 2. 본 폴더 파일 구성

| 파일 | 용도 |
|---|---|
| `README.md` | 본 문서 |
| `AIDATAHUB_CLIENT_SPEC.md` | AX Hub record/import 사양 — LLM/사람용 통합 명세 |
| `aidatahub_sync.py` | push-all / push-recent 어댑터 (DocumentJSON → record) |
| `requirements.txt` | httpx, pyyaml 만 |
| `config.example.yml` | URL/키/매핑 룰 |

---

## 3. DocumentJSON → AX Hub Record 변환 규약

### Source: DocumentJSON v1.0 (MXWP 의 `apps/api/app/routers/documents.py`)
주요 필드:
- `document_id` (UUID), `slug` (URL-friendly)
- `title`, `summary`, `status` (draft|published|archived)
- `version`, `etag`, `created_at`, `updated_at`
- `content.metadata` — 분류성 필드 *모두 여기 안*:
  - `tags[]`, `owners[]` (★ `authors` 아님), `keywords[]?`
  - `division`, `team`, `group`, `part` (조직 hint)
  - `confidentiality` (`public` | `internal` | `restricted`)
- `content.sections[]` — 트리 구조, 재귀
  - `{number, title, level, blocks, subsections}` (★ v1.0 = `subsections`; 호환 fallback = `children`)
  - blocks: `paragraph | heading | list | table | code | math | quote | callout | image-attachment`

### Target: AX Hub Record

| MXWP DocumentJSON | AX Hub Record |
|---|---|
| `document_id` | `_external_id` |
| `title` | `title` |
| `summary` | `summary` |
| `metadata.tags + [f"author:{o}" for o in metadata.owners] + [f"status:{status}"] + division/team/group/confidentiality hint` | `tags` |
| `metadata.keywords ?? metadata.tags` (fallback) | `subject_keywords` |
| `created_at.year` | `year` |
| `created_at.date()` | `valid_from` |
| `version` (str 강제) | `version` |
| `content.sections` (재귀, `subsections` 우선) → DFS 평탄화 | `content.sections[]` |
| `metadata.confidentiality` (`public/internal/restricted`) | `classification` (`public/internal/confidential`) |
| `metadata.division` | (필요시) `team`/`group` fallback hint |
| `images (MinIO URL)` | `record_attachments` (URL 참조 — config.attachment_mode) |

자동 부여:
- `data_type = "DOC"`, `team = "MX"`, `group = "WP"` (hardcoded — metadata.division 은 *tag* hint 로만)
- `doc_type = "whitepaper"` (metadata.tags / metadata.division 에 `feasibility` 가 있으면 `feasibility_study`)
- `agents = ["mx-whitepaper-analyst"]`
- `classification`: confidentiality 매핑 — 누락 시 `internal`
- `language = doc.lang ?? metadata.lang ?? "ko"`
- `author = "mxwp"`, `department = "MX/WP"`

### sections DFS 평탄화 룰
DocumentJSON 의 sections 는 children 으로 트리. 평탄화 시:

```
1. DFS 순회 — 부모 → 자식 순
2. section_id = number (예 "1.1.2")
3. level = level (1=장, 2=절, 3=항)
4. title = title
5. content_text = blocks 를 markdown 직렬화:
   - paragraph → 그대로
   - heading → "# title"
   - list → "- item\n..."
   - table → " | a | b | \n | c | d | "
   - code → "```lang\ncode\n```"
   - math → "$$tex$$"
   - quote → "> 본문"
   - callout → "**[note] body**"
   - image-attachment → "![alt](attachment_url) — MinIO 참조"
6. figure_refs/table_refs 는 attachments 의 image_id 누적
```

### Attachments 정책
config.yml 의 `sync.attachment_mode`:
- `url_ref` (권장): MinIO presigned URL 을 record_attachments.source_url 에 저장. 파일 본체 전송 없음 — 빠름.
- `download_upload`: AX Hub 의 attachment storage 에 본체 복사. 무겁지만 MXWP 다운 시에도 보존.

---

## 4. MXWhitePaper 측 준비 (한 번만)

### 4-1. API 키 발급
AX Hub 가 호출할 때 인증 (또는 본 어댑터가 MXWP API 호출 시).
- MXWP 의 admin 권한 토큰 발급
- `${MXWP_INTERNAL_KEY}` 환경변수로 분리

### 4-2. (옵션) Webhook 등록
즉시 push 모드 사용 시:
- MXWP 의 `document publish` 이벤트 hook 에 본 어댑터의 `push_one(document_id)` 호출

### 4-3. AX Hub 측 sync_source 등록 (MXWP 운영자가 AX Hub 측에 요청)
```bash
# AX Hub repo 의 examples/MX/whitepaper-mxwp/sync_source.example.json 참고
curl -X POST http://aidatahub:8001/api/sync/sources \
  -H "X-API-Key: $AIDH_API_KEY" \
  -H "Content-Type: application/json" \
  --data @sync_source.json
```

---

## 5. 운영 후 확인

```bash
# AX Hub 검색
curl "http://aidatahub:8001/api/search?q=AI+Data+Hub+로드맵&agent_type=mx-whitepaper-analyst"
curl "http://aidatahub:8001/api/records?team=MX&group=WP&limit=10"

# sync_run 이력
curl "http://aidatahub:8001/api/sync/sources" | jq '.[] | select(.name=="mxwp")'
curl "http://aidatahub:8001/api/sync/sources/{id}/runs?limit=5"
```

---

## 6. 트러블슈팅

| 증상 | 원인 | 대처 |
|---|---|---|
| record content_text 짧음 (table 깨짐) | DocumentJSON.blocks 의 table type 직렬화 룰 미스매치 | `aidatahub_sync.py` 의 `_render_block(table, ...)` 룰 보강 |
| 이미지 보이지 않음 | MinIO URL 만료 | attachment_mode=`download_upload` 로 변경 + 재실행 |
| 같은 document 가 record 2건 | external_id_map 누락 — `external_source=mxwp` 파라미터 확인 |
| version 충돌 (ETag) | MXWP 측 ETag 미사용 | summary 의 version 필드 비교로 강제 UPSERT |
| 한국어 잘림 | DocumentJSON 의 blocks 안에 raw HTML | strip_html 룰 적용 |

---

## 7. 보안

- MXWP 의 role-based redaction (reader+) 가 적용된 응답을 가져옴 → secret 자료는 자동 제외
- AX Hub 측에 도착 시 `classification=internal` 강제
- 향후 MXWP 의 confidential 등급 도달 시 `classification=confidential` 자동 매핑 (config.yml 보강)

---

## 8. 관련 문서

- `AIDATAHUB_CLIENT_SPEC.md` — AX Hub 측 record 스키마/import 사양
- MXWhitePaper lat: `/home/koopark/claude/MXWhitePaper/docs/lat/documents.md` (DocumentJSON 정의)
- AX Hub Ingest Kit: `GET /api/schema/ingest-kit.zip?agent_type=mx-whitepaper-analyst`
