# mcp-write-tools 완료 리포트

> PDCA cycle 완료: 2026-06-13 · commit `43c4b41` · match rate 100% · Claude Desktop 에서 문서 작성/편집 가능

## Executive Summary

| 관점 | 내용 |
| --- | --- |
| 문제 | mxwp-mcp 가 RAG 조회(query_rules/read_chunk/system_prompt) 전용 — Claude Desktop/Code 에서 문서를 *읽고 쓸* 수 없었음. "프롬프트 복사→AI→붙여넣기" 수작업 의존 |
| 해결 | write tools 10종 추가 (38 위젯 전부, slug 타겟) + ReportArchive 검증 패턴 이식 + Claude Desktop 등록 자료 |
| 기능/UX 효과 | "X 문서 2장에 callout 추가해줘" → Claude 가 outline 읽고 직접 insert. 모든 위젯, 특정 글 타겟 |
| 핵심 가치 | 만능 토큰 금지(개인별 API 토큰) + 로컬 선검증 재시도 루프 + ETag 자동 — 안전한 직접 쓰기 |

## 도구 표면 (13종)

| 분류 | 도구 | 비고 |
| --- | --- | --- |
| RAG (기존) | query_rules / read_chunk(resource) / mxwp_system_prompt(prompt) | 유지 |
| read (신규) | list_documents / get_document_outline / get_section / get_block | outline 은 토큰 절약형 구조 지도 (block 별 hint) |
| write (신규) | create_document / insert_block / update_block / delete_block / move_block / validate_block | slug + section_id/block_id 타겟 |

stdio handshake 실측: `tools/list` 11종 + `resources/list` (read_chunk templated) + `prompts/list` (mxwp_system_prompt) — Claude Desktop 핸드셰이크 정상.

## ReportArchive 패턴 이식

1. **로컬 선검증 루프**: `schema_validate.py` 가 전송 전 block 을 `document.json` 의 `$defs`
   type-const 매칭 Block 정의로 jsonschema(Draft2020-12) 검증 → 실패 시 API 호출 없이
   `[{path,message}]` 반환 → Claude 가 고쳐 재호출. (ReportArchive 의 "느슨한 입력→검증→재시도".)
2. **개인별 토큰**: `MXWP_API_TOKEN` (write scope) — 만능 토큰 금지. 위키 UI 우상단 프로필 →
   "🔑 개인 API 토큰" → "쓰기" scope 발급 (UI 라벨 실검증).
3. **항상 안전 경로**: ETag 자동 (api_client 가 내부 GET→If-Match), 충돌 시 412 → "outline
   다시 읽고 재시도" 안내. urllib-only (바이너리 의존성 최소).

## 발견/정정 (live 검증에서)

- **ETag 충돌은 412** (PreconditionFailed), lat documents.md 의 409 표기는 오류 → 정정.
- **PATCH /blocks/{id} 는 partial merge** — 도구가 GET→로컬 병합→full body 전송, 서버가
  반환하는 `meta:null` 키 제거 필요.
- **신규 문서 status=draft** — GET /documents (published 목록) 에 미노출. `q` 는 title/summary
  ILIKE (slug 미검색).
- **build.py _MCP_SPEC 누락**: T1 이 sibling 모듈/jsonschema/schema 의 _MCP_SPEC 미반영을
  발견 → stage 복사 + hiddenimports(api_client/schema_validate/jsonschema) + datas(document.json)
  보강. 미보강 시 frozen 바이너리의 write tools 만 lazy-load 실패 (RAG 3종은 무영향).

## 검증

- mcp/tests **17 passed**: validate_block 5 (유효/type오타/필수누락 path) + fake-transport 6
  (ETag/412/토큰누락) + **live 통합 1** (실토큰→create→5위젯 insert→outline→update→move→delete→정리)
  + 기존 server 5
- toolkit 전체 **96 passed 1 skipped**
- 바이너리 stdio handshake: 11 tools + resource + prompt 노출, exit 0
- tarball 122.4MB 재생성

## 핵심 인사이트

- **outline-first 가 토큰 비용을 가른다**: 문서 전체 JSON 대신 `get_document_outline` (block 별
  한 줄 hint) 으로 Claude 가 어디를 고칠지 정하고 필요한 block 만 get — ReportArchive 의
  describe_template 와 같은 발상.
- **write 도구의 안전은 3겹**: (1) 로컬 검증으로 잘못된 block 이 서버에 안 감, (2) 개인 토큰으로
  권한 격리, (3) ETag 로 동시 수정 충돌 방지. 어느 하나도 만능 토큰/검증 생략으로 무력화 안 됨.
- **resource/prompt vs tool**: read_chunk/system_prompt 를 tool 이 아닌 resource/prompt 로 둔
  기존 설계가 옳음 — tools/list 에 안 나와도 정상이며 Claude 가 맥락 자료로 활용.

## 잔여

- 차트/이미지 등 바이너리 자산 위젯은 JSON 구조는 작성 가능하나 실제 이미지 업로드(MinIO)는
  별도 흐름 — 현재는 placeholder block 생성까지. (필요 시 별도 사이클: MCP 이미지 업로드 도구.)
