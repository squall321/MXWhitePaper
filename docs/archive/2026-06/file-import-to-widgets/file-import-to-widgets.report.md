# file-import-to-widgets 완료 리포트

> PDCA cycle 완료: 2026-06-17 · commits `198ea2d` (+ deps `741292a` 선행) · match rate 100%
> Excel/PDF 파일을 분석해 위젯 백서로 분배 + Claude Desktop 파일 도구

## Executive Summary

| 관점 | 내용 |
| --- | --- |
| 문제 | docx/pptx 만 import 가능 (위젯 분배까지 완성), xlsx/pdf/이미지는 불가. Claude Desktop 에서 파일을 주면 위젯 백서가 되는 경로 부재 |
| 해결 | xlsx/pdf 서버 import 2종 + MCP 파일 도구 3종 — 기존 widget post-pass 재사용으로 분배 공짜 |
| 기능/UX 효과 | "이 엑셀 분석해서 백서로" → 시트=섹션·embedded 차트=ChartBlock, "이 PDF 가져와" → 휴리스틱 구조화, "이 이미지 넣어" → MinIO 업로드+삽입 |
| 핵심 가치 | 4포맷(docx/pptx/xlsx/pdf) 통합 import + Claude Desktop 단일 호출(import_file save=True)로 파일→백서 |

## 핵심 설계 — 파서만 새로, 분배는 재사용

docx/pptx import 가 이미 `apply_widget_markers` + `apply_widget_autodetect`
post-pass 로 위젯 분배를 한다. xlsx/pdf 도 **같은 DocumentJSON 을 만들어 동일
post-pass 를 태우면 분배가 공짜** — 새로 만든 건 파서(openpyxl/pymupdf)뿐.

| 포맷 | 진입 | 분배 |
| --- | --- | --- |
| xlsx | `xlsx_to_document` (openpyxl data_only) | 시트=섹션, 표→TableBlock(200행↑ Spreadsheet), embedded 차트→ChartBlock |
| pdf | `pdf_to_document` (pymupdf/fitz) | 폰트크기>본문×1.15→heading, find_tables()→Table, dotted-prefix→섹션, 이미지→placeholder |

## MCP 파일 도구 3종

- `import_file(path, kind="auto", save=True)` — 4포맷 → import endpoint →
  save 면 바로 새 문서 생성 후 slug, message 로 분배 결과 설명. Claude Desktop
  단일 호출로 "파일 → 백서" 완성.
- `upload_image(path)` — 로컬 이미지 2-phase presigned (init→PUT→finalize), sha256 dedup.
- `insert_image_block(slug, section_id, image_id, ...)` — ImageBlock 삽입 (로컬 선검증).
- api_client: `encode_multipart` + `_post_multipart` (boundary 직접 생성, `_send`
  추출로 ETag/에러 처리 공유) + import/upload 메서드.

## 핵심 인사이트 / 정직성 교정

- **"숫자 표 → 차트 자동" 은 과장이었다**: block-level autodetect 는
  callout/kpi-cards/gantt/gallery **4종뿐, chart 인식기 없음**. live xlsx import
  에서 숫자 표가 table 로 유지되는 것을 보고 발견 → README/lat/llm-document-formats/
  서비스 주석/테스트명까지 "일반 표는 표 유지, label/value→kpi·name/start/end→gantt,
  차트는 embedded 차트나 Widget 마커로" 로 전부 정정. (워크플로우 에이전트가 쓴
  문서의 과장을 통합 검증 단계에서 실측으로 잡음)
- **import_file 시그니처 drift**: T5(README)가 `(path, slug?, title?)→{document,summary}`
  로 썼으나 T4(실제)는 `(path, kind, save=True)→{slug?,...}`. 코드가 진실 — README
  를 실제에 맞춰 정정 + 수동 create/insert 루프 설명을 save=True 자동 저장으로 교체.
- **fitz builtin 폰트는 한글 글리프 없음**: 테스트 fixture 의 한글이 `·` 로 깨짐 →
  fixture 를 ASCII 로 (실제 PDF 는 폰트 임베드라 한글 추출 정상, 주석 명시).
- **PDF 정확도는 원본 구조 품질 의존** — 휴리스틱임을 summary.warnings 에 명시.

## 발견/운영

- API instance 가 살아있지만 uvicorn(--reload) 이 watchfiles cascade 로 죽어 healthz
  000 → instance stop + start.sh 로 복구 (기존 알려진 패턴).
- pre-commit OpenAPI drift guard 가 신규 /imports/xlsx,/pdf 를 정확히 잡음
  (openapi-dump 235 paths).
- 바이너리/tarball 은 gitignore — repo 비대화 없음. 재빌드는 런타임/배포용.

## 검증

- api pytest **exit 0** (xlsx 9 + pdf 7 신규 + 기존 전체), mcp tests **20** (live 포함),
  바이너리 stdio handshake **14 tools** (import_file/upload_image/insert_image_block 포함),
  coverage 38×2, lat **325 refs 0 broken**, rag --check OK, live xlsx import 위젯 분배 실증.
- 바이너리 4종 + tarball 122.4MB 재빌드.

## 잔여

- PDF 이미지 실제 업로드 (현재 placeholder + warning) — 라우터에서 fitz 추출 이미지를
  upload_service 로 올리는 wiring 은 별도 사이클 (import_file 의 image_uploader 주입점은 준비됨).
- pymupdf 는 현재 pip 임시 설치로 동작, api.def/pyproject 선언 완료 — 다음 api.sif
  재빌드 시 영구 반영.
