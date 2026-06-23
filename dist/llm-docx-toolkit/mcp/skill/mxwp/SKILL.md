---
name: MXWhitePaper 백서 작성
description: MXWhitePaper 위키에 백서/문서를 초안으로 작성·편집한다. 사용자가 "백서 써줘", "문서 만들어줘", "이 엑셀 백서화해줘", "PDF 가져와줘", "이미지 넣어줘", "차트 데이터 갱신" 등 MXWhitePaper 문서 생성/수정을 요청할 때 사용. mxwp-rag MCP 서버 도구로 구조를 파악하고 block JSON 룰을 확인해 초안을 만든다.
allowed-tools: mcp__mxwp-rag__*
---

# MXWhitePaper 백서 작성

`mxwp-rag` MCP 서버로 위키 문서를 **초안(draft)** 으로 만들고 편집한다.
**생성·수정 결과는 사람이 위키 화면에서 최종 검토**한다 — 게시/공유는 사람이 한다.

쓰기 도구는 `MXWP_API_TOKEN`(write scope) 이 있어야 동작한다. 토큰이 없으면
도구가 API 를 호출하지 않고 발급 안내 에러를 돌려준다.

## 도구

### 읽기 (구조 파악 — 본문 손대기 전에 먼저)
- `mcp__mxwp-rag__query_rules(query, k=5)` — block JSON 작성 룰을 top-k 청크로 검색
- `mcp__mxwp-rag__get_document_outline(slug)` — 섹션 트리 + block 별 한 줄 hint (토큰 절약 지도)
- `mcp__mxwp-rag__get_section(slug, section_id)` — 섹션 1개의 블록 전체 JSON
- `mcp__mxwp-rag__get_block(slug, block_id)` — 블록 1개의 전체 JSON
- `mcp__mxwp-rag__list_documents(q="", limit=20)` — 문서 목록(slug/title/part/updated_at)

### 쓰기 (블록 편집 — `MXWP_API_TOKEN` write scope 필수)
- `mcp__mxwp-rag__create_document(title, slug?, part_slug?, summary?)` — 새 문서(빈 '개요' 섹션 포함)
- `mcp__mxwp-rag__insert_block(slug, section_id, block, after_block_id?)` — 블록 삽입
- `mcp__mxwp-rag__update_block(slug, block_id, block)` — 블록 수정(부분 키 병합, type 변경 시 완전 block)
- `mcp__mxwp-rag__delete_block(slug, block_id)` — 블록 삭제
- `mcp__mxwp-rag__move_block(slug, block_id, target_section_id, after_block_id?)` — 블록 이동
- `mcp__mxwp-rag__validate_block(block)` — 로컬 schema 검증(API 호출 없음, 미리 점검용)

### 파일·이미지 (위젯 채우기 — `MXWP_API_TOKEN` write scope 필수)
- `mcp__mxwp-rag__import_file(path, kind="auto", save=True)` — 로컬 docx/pptx/xlsx/pdf 를 위젯 분배된 DocumentJSON 으로 변환(`save=True` 면 새 문서로 저장해 slug 반환)
- `mcp__mxwp-rag__upload_image(path)` — 로컬 이미지 파일을 업로드(Claude Code 등 셸/로컬 접근 가능 환경)
- `mcp__mxwp-rag__upload_image_from_url(url, filename?)` — 웹 URL 이미지를 **서버가 직접 받아** 업로드(크기·화질 제약 없음, 권장)
- `mcp__mxwp-rag__upload_image_base64(filename, data_base64, mime_type?)` — 작은 로컬 이미지를 base64 로 업로드(Claude Desktop)
- `mcp__mxwp-rag__extract_pptx_images(path)` — .pptx 속 그림들을 각각 별도 이미지로 추출
- `mcp__mxwp-rag__insert_image_block(slug, section_id, image_id, alt?, caption?, after_block_id?)` — 위 업로드가 준 image_id 로 ImageBlock 삽입

## 워크플로
1. **구조 파악** — 새 문서가 아니면 먼저 `get_document_outline(slug)` 로 섹션 트리와
   block 별 hint 를 본다. slug 를 모르면 `list_documents(q=...)` 로 찾는다. 특정 블록의
   현재 JSON 이 필요하면 `get_block` / `get_section`.
2. **룰 확인** — block JSON 형식은 외우지 말고 `query_rules` 로 검색한다
   (예: `query_rules("callout 블록 형식")`, `query_rules("chart 데이터 형식")`).
   막막하면 `mxwp_system_prompt` 프롬프트도 참고.
3. **작성/수정** — `create_document` → `insert_block` 반복으로 새 문서를 짜거나,
   `get_block` → `update_block` 으로 기존 블록을 고친다. 전송 전 로컬 schema 검증이
   자동으로 돌고, 실패하면 **API 호출 없이** path 별 에러가 온다 — 그 블록을 고쳐
   재시도한다. 불안하면 `validate_block` 으로 미리 점검.
4. **사람이 검토** — 완료 후 문서 URL(`/docs/<slug>`) 을 사용자에게 안내한다.
   게시/공유 판단은 사람이 위키 화면에서 한다.

## 이미지 넣기 — 환경에 맞는 3경로 (RA 패턴)

이미지를 문서에 넣으려면 **(1) 업로드해서 `image_id` 를 얻고 → (2) `insert_image_block`** 한다.
업로드 경로는 이미지 출처/환경에 따라 고른다.

| 상황 | 도구 | 비고 |
|---|---|---|
| **웹 URL 의 이미지** | `upload_image_from_url(url)` | **권장.** 서버가 직접 받아 바이트가 모델/클라이언트를 안 거쳐 **크기·화질 제약 없음**. 공개 http/https 만(사설·내부 주소 차단) |
| **작은 로컬 이미지** (Claude Desktop) | `upload_image_base64(filename, data_base64)` | base64 가 모델 출력 토큰을 소모하므로 **작은 이미지(≈256KB 이하) 전용**. 큰 파일은 거부 |
| **큰 로컬 이미지 / 다수** (Claude Code, 셸 접근) | `upload_image(path)` | 로컬 파일 경로를 직접 읽어 2-phase presigned 로 업로드. 크기 제약 사실상 없음 |
| **PPT 속 그림** | `extract_pptx_images(path)` | .pptx 를 풀어 슬라이드 그림을 각각 별도 이미지로 추출 → 여러 `image_id`. 각각 `insert_image_block` |

세 업로드 도구 모두 동일 sha256 이면 **dedup**(같은 그림은 다시 안 올라감) 된다.
얻은 `image_id` 를 `insert_image_block(slug, section_id, image_id, caption=...)` 에 넘긴다.

예) 웹 이미지 한 장 넣기:
```
upload_image_from_url("https://example.com/diagram.png")  → {image_id, ...}
get_document_outline(slug)                                → section_id + 끝 block_id
insert_image_block(slug, section_id, image_id, caption="구조도", after_block_id=...)
```

## 파일로 백서 만들기 (import_file)
엑셀 분석/PDF 보고서/Word 문서를 백서로 옮길 때 `import_file` 한 번이면
"파일 → 위젯 분배된 문서" 가 끝난다(`save=True` 기본 → 새 문서 slug 반환).
저장 전 구조만 보려면 `save=False`(요약 `message`/`summary` 만). 변환 한계·경고는
`summary.warnings` 에 담기므로 **숨기지 말고 사용자에게 보고**한다.
- xlsx: 시트=섹션, 표 보존 + embedded 차트→차트 블록 + label/value→KPI
- pptx: 슬라이드=섹션, 텍스트/표 + 위젯 마커/autodetect(셀 속 그림은 못 가져오므로 PPT 그림은 `extract_pptx_images` 사용)
- pdf: 폰트 크기로 heading 추정 + find_tables() 표 추출(이미지는 placeholder + warning)
- docx: 스타일/dotted-prefix 로 섹션 트리, 표/이미지/목록/코드/수식 + 위젯 마커/autodetect

## 자동 처리 (신경 안 써도 됨)
- **로컬 선검증** — `insert_block`/`update_block`/`insert_image_block` 은 전송 전 block 을
  schema 로 검증. 실패 시 API 를 안 부르고 path 별 에러를 돌려준다(고쳐 재시도).
- **ETag 잠금** — 도구가 내부에서 문서 ETag 를 받아 `If-Match` 로 보낸다. 그 사이
  다른 사람/탭이 수정했으면 "문서가 그 사이 변경됨" 에러 → `get_document_outline`
  으로 다시 읽고 재시도(덮어쓰기 사고는 구조적으로 안 남).
- **에러 변환** — API 에러 envelope 를 사람이 읽을 메시지로 바꿔 돌려준다.

## 원칙
- **항상 초안.** 게시/공유는 사람이 위키 화면에서 한다.
- **추측으로 채우지 말 것** — 모르는 값은 사용자에게 묻는다. 채울 수 없는 블록은 비운다.
- **누락·경고는 투명하게** — `import_file` 의 `summary.warnings`, 스키마 탈락, 못 넣은
  이미지는 조용히 넘기지 말고 사용자에게 알려 검토 화면에서 보완하게 한다.
- block JSON 형식은 외우지 말고 `query_rules` 로 검색해 그대로 따른다.
