# Documents lat — DocumentJSON v1.0 + CRUD + versioning

> 중심 엔티티 `documents` 테이블과 사내 표준 본문 포맷 **DocumentJSON v1.0**
> 의 검증, 저장, 조회, 패치, 버저닝, 검색 인덱싱.
>
> 연관 lat: [[imports]] (입력) · [[export]] (출력) · [[storage]] (이미지) ·
> [[core]] (auth/etag/errors)

## Endpoints

전부 [[src/app/routers/documents.py]] (`/api/v1/documents`).

| Method | Path | 인증 | 역할 |
|---|---|---|---|
| GET | `/` | reader+ | 목록 (필터/페이지네이션) |
| GET | `/{slug}` | reader+ | 단일 조회 (role 별 block redaction 적용) |
| GET | `/{slug}/html` | reader+ | 서버 사이드 HTML 렌더 (PDF 용) |
| POST | `/` | editor+ | 신규 생성 |
| PUT | `/{slug}` | editor+ | 전체 교체 — 버전 INSERT |
| DELETE | `/{slug}` | admin | soft-delete |
| GET | `/{slug}/backlinks` | reader+ | 다른 문서가 인용한 링크 |
| GET | `/{slug}/versions` | reader+ | 버전 목록 |
| GET | `/{slug}/versions/{n}` | reader+ | 특정 버전 |
| POST | `/{slug}/versions/{n}/restore` | editor+ | 버전 복원 (= 새 버전 INSERT) |
| PATCH | `/{slug}/title` | editor+ | 제목/요약 인라인 수정 |
| PATCH | `/{slug}/infobox` | editor+ | 우측 사이드 정보 박스 |
| PATCH | `/{slug}/variables` | editor+ | 본문 템플릿 변수 |
| PATCH | `/{slug}/custom-css` | editor+ | 문서별 CSS |
| PATCH | `/{slug}/sections/{section_id}` | editor+ | 섹션 부분 수정 |
| PATCH | `/{slug}/blocks/{block_id}` | editor+ | 블록 부분 수정 |
| POST | `/{slug}/blocks` | editor+ | 블록 추가 |
| DELETE | `/{slug}/blocks/{block_id}` | editor+ | 블록 삭제 |
| POST | `/{slug}/blocks/{block_id}/move` | editor+ | 블록 이동 (섹션 간/내) |
| POST | `/{slug}/sections/reorder` | editor+ | 섹션 트리 재배열 |
| POST | `/{slug}/ping` | reader+ | 조회수 카운트 |

모든 mutation 엔드포인트는 **ETag + If-Match** 로 낙관적 잠금. 형식:
`W/"<doc_id>-<version>"`. 클라이언트가 stale ETag 를 보내면 409.

## DocumentJSON v1.0 schema

[[src/app/schemas/document.py]] 에 pydantic 모델 정의. 필수 키:

```text
{
  "schema_version": "1.0",
  "id":             "<ULID>",
  "slug":           "<lower-case-slug>",
  "title":          "<문서 제목>",
  "metadata": {
    "division":        "MX" | "<코드>",
    "owners":          ["email@…"],
    "tags":            ["…"],
    "confidentiality": "public" | "internal" | "restricted",
    "team":   "...",        // optional
    "group":  "...",        // optional
    "part":   "...",        // optional
  },
  "summary": "...",         // optional, 500자 컷
  "sections": [
    {
      "id":     "<ULID>",
      "level":  1..6,
      "title":  "...",
      "blocks": [ { type: "...", ... }, ... ],
      "subsections": [ … ]
    }
  ]
}
```

### Block types

[[src/app/schemas/document.py]] 에 정의된 주요 block 클래스:

- `ParagraphBlock` — markdown-flavored inline (`**굵게**`, `*기울임*`,
  `` `code` ``, `[link](url)`)
- `Heading4Block` — depth-4 이상 헤딩은 sub-section 으로 자동 승격되므로
  실제로는 임시. 자세히는 [[#heading-promotion]].
- `ListBlock` — `style: "bullet"|"ordered"`, `items[]`
- `QuoteBlock` — `text`, `cite?`
- `CalloutBlock` — `variant: "info"|"warn"|"danger"|"success"`, `title?`, `text`
- `CodeBlock` — `language`, `code`
- `MathBlock` — LaTeX `expression`, `display: "block"|"inline"`
- `TableBlock` — `headers[]`, `rows[][]`, `caption?`, `options{}` (정렬, 정렬,
  aggregate, footer, density, border-style). 두 가지 셀 모드:
  1. **flat**: `headers` + `rows` (단순 텍스트 그리드)
  2. **sparse**: `cells[]` — 각 항목 `{r, c, text?, blocks?, header?, rowSpan?, colSpan?}`.
     ★ 셀은 `text` **또는** `blocks` 중 하나만 — `blocks` 가 있으면
     [[src/app/services/document_service.py#_normalise_table_cells]] 가
     `text` 를 자동 제거해 one-of 계약 유지. `CellBlock` 은 `ParagraphBlock`
     / `ImageBlock` / `ListBlock` 셋으로 제한 (테이블 안 테이블 금지).
- `KpiCardsBlock` — `items[]` (label, value, trend)
- `ChartBlock`, `ImageBlock`, `ColumnsBlock`, `TabsBlock`, `AccordionBlock`,
  `GanttBlock`, `FlowBlock`, `OrgChartBlock`, …

전체 enum 은 [[src/app/schemas/document.py]] 참고. 새 block type 추가 시:
1. 스키마 클래스 + Union 등록
2. [[src/app/services/document_service.py#_scrub_block_array]] 의 redaction 분기
3. [[export]] 의 docx/pptx/md/html 렌더러 4 개에 분기 추가

## 핵심 진입점

| 함수 | 위치 | 책임 |
|---|---|---|
| `create_document()` | [[src/app/services/document_service.py#create_document]] | POST `/` 의 본체 |
| `replace_document()` | [[src/app/services/document_service.py#replace_document]] | PUT `/{slug}` — 새 버전 INSERT |
| `archive_document()` | [[src/app/services/document_service.py#archive_document]] | soft-delete |
| `validate_documentjson()` | [[src/app/services/document_service.py#validate_documentjson]] | 스키마 + 정규화 (renumber, columns widths) |
| `make_etag()` / `parse_if_match()` | [[src/app/services/document_service.py#make_etag]] | ETag 발급/검증 |
| `scrub_for_response()` | [[src/app/services/document_service.py#scrub_for_response]] | 응답 직전 role-기반 redaction |
| `patch_section()`, `patch_block()`, … | [[src/app/services/document_service.py#patch_section]] 부근 | 부분 수정 패밀리 |
| `move_block()`, `reorder_sections()` | [[src/app/services/document_service.py#move_block]] | 트리 재배열 |
| `restore_version()` | [[src/app/services/document_service.py#restore_version]] | 과거 버전 → 새 버전 INSERT |
| `update_links_for_document()` | [[src/app/services/document_service.py#update_links_for_document]] | 본문 위키링크 → `links` 테이블 |
| `refresh_search_view()` | [[src/app/services/document_service.py#refresh_search_view]] | materialized view refresh (테스트는 `MXWP_SKIP_VIEW_REFRESH=1`) |
| `reindex_meili()` | [[src/app/services/document_service.py#reindex_meili]] | Meilisearch 색인 |

Repository (DB I/O) 는 [[src/app/repos/document_repo.py]]:
- `find_by_slug()`, `find_by_id()`, `list_documents()` — 조회
- `insert_document()`, `update_document()`, `soft_delete_document()` — 변경
- `insert_version()`, `list_versions()`, `find_version()` — 버전
- `replace_links_for_document()`, `list_backlinks()` — 링크 그래프
- `upsert_tag()`, `replace_document_tags()` — 태그
- `insert_audit()` — 감사 로그

## Section numbering ★

`validate_documentjson()` → `renumber_sections()` ([[src/app/services/section_numbering.py#renumber_sections]])
가 매 저장 시 섹션 번호를 1, 1.1, 1.1.1 형태로 재발급한다. `level` 만 신뢰하고
입력의 `number` 는 무시.

### Heading promotion

본문에 `heading-4`, `heading-5`, `heading-6` 블록이 섹션 트리 *안*에 박혀
있으면, [[src/app/services/heading_promote.py#promote_inline_headings]] 가
이를 **새로운 sub-section 으로 승격**한다 — renumber 보다 *먼저* 호출되어
새 섹션도 정상 번호를 받음.

이래야 [[imports]] 의 dotted-prefix 승격 (`3.1.2.3 Foo`) 과 일관성이 유지됨.

## Role-based block redaction ★

각 block 은 `meta.audience: ["reader", "editor", "admin", "owner"]` 또는
`meta.permission: "public" | "internal" | "restricted"` 를 가질 수 있다.

응답 직전 [[src/app/services/document_service.py#scrub_for_response]] 가
요청 사용자 role 의 level 과 비교해:
- 통과면 그대로
- 미통과면 block 을 **redacted placeholder** 로 치환 (type 은 보존, 내용 비움)

이 동작은 **응답 레이어**에서만 일어남 — DB 에는 원본이 남고 admin 도구는
원본을 본다. 잘못된 위치 (예: `update_document` 직전 BEGIN) 에 호출하면
편집자가 본인이 못 보는 블록을 무의식적으로 지워버리는 사고가 남.

## Versioning

- `documents` 테이블에 `version` 컬럼 (정수).
- 매 `PUT` / `restore` 마다 `version += 1` + `document_versions` 에 INSERT.
- `document_versions.content_json` 은 그 시점의 본문 스냅샷 (full snapshot
  — diff 가 아님).
- ETag 는 `(doc_id, version)` 기반이라 새 버전 = 새 ETag.

## Webhooks + Meilisearch + Glossary

매 저장/패치 flush 시:
1. `update_links_for_document()` — 본문에서 `[[…]]` 추출 → `links` 테이블 갱신
2. `reindex_meili()` — Meilisearch `documents` index 갱신
3. `upsert_glossary_terms()` — 본문에 새 용어가 있으면 glossary 자동 등록
4. `fire_webhook()` — 등록된 외부 URL 에 이벤트 발송 (3 회 재시도)
5. `refresh_search_view()` — PostgreSQL materialized view refresh

테스트 환경에선 5번이 **비활성화** (`MXWP_SKIP_VIEW_REFRESH=1` 가
[[src/tests/conftest.py]] 에서 자동 세팅) — async engine reset 과 충돌 방지.

## CSS / Variable / Infobox patch

DocumentJSON 본체와 분리된 작은 영역:
- **infobox** — 우측 사이드의 메타 카드. `metadata.infobox` 키.
- **variables** — `{{varname}}` 본문 치환용 dict. `metadata.variables`.
- **custom_css** — 문서 1개에만 적용되는 sanitized CSS.
  [[src/app/services/css_sanitizer.py]] 가 정화. 위험한 속성/셀렉터 거름.

각 PATCH 엔드포인트는 본문 변경 없이 metadata 만 갱신하므로 빠르고
materialized view refresh 도 스킵 가능.

## Gotchas

1. **ETag 형식**: weak `W/"<id>-<version>"`. 따옴표 누락하면 클라이언트에서
   파싱 깨짐. CDN/프록시가 ETag 를 strong 으로 변환하지 않게 조심.
2. **renumber 는 매 저장마다 일어남** — 클라이언트가 보낸 `section.number`
   는 표시용이지 권위 없음. FE 도 응답값을 다시 받아 표시.
3. **`replace_document` 는 비싸다** — 본문 전체 교체 + 버전 INSERT + 인덱싱
   3 단계. UI 의 빠른 편집은 patch_section/patch_block 으로 가야 한다.
4. **soft-delete 후 같은 slug 재생성 금지** — `archived_at IS NULL` 조건의
   unique index 가 있어서 archive 된 문서를 살리려면 `restore_version` 이나
   admin SQL 이 필요.
5. **block redaction 은 응답 전용** — DB 변경 함수에 절대 끼우지 말 것.
6. **`_walk_sections` / `_walk_blocks_in_section` 는 generator** — 다중 소비하면
   재호출 필요. 종종 `list(_walk_…)` 로 박제하고 시작하는 게 안전.
7. **columns widths 정규화**: `widths` 가 100 의 합이 아니면 비례 재조정.
   `[[src/app/services/document_service.py#_normalise_columns_widths]]`.

## Settings (`app.core.config`)

| 키 | 기본 | 의미 |
|---|---|---|
| `max_blocks_per_document` | 5000 | 본문 블록 수 캡 |
| `max_sections_per_document` | 500 | 섹션 수 캡 |
| `archive_default_days` | 90 | soft-delete TTL 안내값 |

## 테스트 지도

| 파일 | 무엇 |
|---|---|
| [[src/tests/test_documents.py]] | CRUD + ETag |
| [[src/tests/test_block_patch.py]] | patch_block / patch_section |
| [[src/tests/test_block_permissions.py]] | role-based redaction |
| [[src/tests/test_bulk_docs.py]] | 대량 생성 |
| [[src/tests/test_versions.py]] | 버전 INSERT / restore |
