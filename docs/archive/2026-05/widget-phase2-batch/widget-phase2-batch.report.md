# Report — widget-phase2-batch

## Executive Summary

| 관점 | 내용 |
| --- | --- |
| **Feature** | widget-phase2-batch |
| **Started** | 2026-05-15 |
| **Completed** | 2026-05-15 (단일 세션, ~5h) |
| **Match Rate** | **100%** |
| **Problem** | widget marker 14종이 placeholder (`None`). LLM 산출 docx/pptx 가 chart/gantt/flow 등을 표현해도 import 시 marker drop + warning 만 됨. mixed-cells 도 web 은 text-only fallback. 작은 TODO 산재. |
| **Solution** | 단일 PDCA 사이클 안에서 14 converter 구현 + multi-block 인프라 + web mixed-cell 렌더 + UTF-8 safe header. 14 Generator (Opus) × 6 Verifier (Sonnet) 병렬 분할. |
| **Function UX Effect** | LLM 산출 docx/pptx 의 **16 종 위젯 자동 복원**. Mixed-cell 표는 web 에서도 paragraph/image/list 렌더. roundtrip 응답 헤더는 UTF-8 codepoint-safe. |
| **Core Value** | "외부 LLM → MX whitepaper 풀스택 위젯" 파이프라인 종지부. Marker 청사진 → 실구현 전환 완료. |

## 1. 결과 메트릭

| 지표 | 값 |
|---|---|
| Match Rate | **100%** |
| 통합 converter 수 | 16 (Phase 1: 2, Phase 2: 14) |
| 전체 pytest 통과 | **835/835** |
| widget_markers 테스트 | **72/72** (이전 15 → +57) |
| Web typecheck | **exit 0** |
| OpenAPI drift | **0** |
| 신규 LOC (widget_markers.py) | +828 (247 → 1075) |
| 변경 파일 | 6 (widget_markers.py, test_widget_markers.py, imports.py, TableBlock.tsx, tableCells.ts, lat/imports.md, llm-document-formats.md) |

## 2. 작업 분할 결과 (에이전트 병렬화)

### Wave A — 9 Generator (Opus, 동시 발사)

| Agent | 담당 | LOC | Tests |
|---|---|:---:|:---:|
| G1 | `_convert_chart` + `_parse_number` | ~80 | 5 |
| G2 | `_convert_gantt` | ~75 | 4 |
| G3 | `_convert_flow` + `_codeblock_source` | ~35 | 3 |
| G4 | `_convert_org_chart` (list + table 입력) | ~130 | 5 |
| G9 | `_convert_doc_link` (slug + URL) | ~50 | 4 |
| G10 | `_convert_glossary` | ~25 | 4 |
| G11 | `_convert_image_annotation` | ~115 | 5 |
| G12 | iframe + video + file + pdf + whiteboard | ~150 | 9 |
| G14 | UTF-8 header + lat + llm-docs | (다른 파일) | — |

→ 메인 thread 통합: dispatcher 의 9 None 등록 + sanity test 갱신 → **817 passed 회귀 0**.

### Wave B — 5 Generator (Opus, 동시 발사)

| Agent | 담당 | LOC | Tests |
|---|---|:---:|:---:|
| G5 | `_convert_columns` (multi-block) | ~40 | 5 |
| G6 | `_convert_tabs` (multi-block) | ~50 | 4 |
| G7 | `_convert_accordion` (multi-block) | ~45 | 4 |
| G8 | `_convert_gallery` (multi-block) | ~45 | 5 |
| G13 | Web mixed-cells render (TS) | ~50 | (typecheck only) |

→ 메인 thread 통합: dispatcher 의 4 None 등록 + sanity test 갱신 → **835 passed 회귀 0**.

### Verifier — 6 Agent (Sonnet, 동시 발사)

| Verifier | 담당 | BLOCKING | minor |
|---|---|:---:|:---:|
| V1 | chart/gantt/flow/org-chart | 0 | 2 |
| V2 | columns/tabs/accordion | 0 | 1 |
| V3 | gallery + dispatcher infra | 0 | 2 |
| V4 | doc-link/glossary/img-ann/5 simple | 0 | 0 |
| V5 | Web mixed-cells | 0 | 2 |
| V6 | 통합 (dispatcher / lat / docs / openapi) | **1** | 3 |

→ 1 blocking + 8 minor → **5 fix-up 즉시 처리, 4 명시적 defer**.

## 3. 발견 + 처리된 이슈

### Blocking (V6 발견, fix-up 완료)
- `llm-document-formats.md` 의 "14 위젯" 이 실제 16 과 모순 → "16 위젯" 으로 정정.

### Minor (fix-up 완료)
- `_h4` test fixture 가 schema 의 `title` 대신 `text` 사용 → `title` 사용으로 변경.
- chart converter 의 partial-None row 에서 series 길이 불일치 → 누락 cell 을 0.0 으로 채워 길이 정렬.
- flow converter 가 whitespace-only source 통과 → `value.strip()` 검사 추가.
- lat/imports.md 의 stale 카운트 (778→835, 15→72) → 정정.
- test 파일 docstring "12 위젯" → "Phase 1 + Phase 2 (16 위젯)" 으로 갱신.

### Defer (명시적, follow-up)
- gallery `(Carousel)` 대문자 케이스 테스트 (구현은 정확 — `.lower()`).
- web 이미지 URL 의 `encodeURIComponent` (ULID/UUID 만 들어가므로 안전).
- `mergeWith` 의 blocks 경로 Vitest 단위 테스트.
- `markdown_export.py:46` 의 TODO (cycle 5) — 여전히 applicable, 별도 cycle 처리.

## 4. 핵심 의사 결정

### 4.1 Converter 시그니처 확장 (단일 → 다중 target)

이전:
```python
fn(variant, target: dict, summary) -> widget | None
```
이후:
```python
fn(variant, targets: list[dict], summary) -> (widget, n_consumed) | None
```

→ multi-block 위젯 (gallery N images, tabs/accordion N heading-content pairs, columns 2-4 blocks) 가 가능. Phase 1 converter 2개도 동시에 마이그레이션 (wrapper 도입 없이 직접 — 회귀 0).

### 4.2 정보 손실 0 룰 일관 적용

모든 converter 는 변환할 수 없는 입력에 `None` 반환 → dispatcher 가 marker + target 모두 보존. **whiteboard** 의 경우 docx/pptx 가 strokes/shapes 를 표현할 수 없어 *항상* None — image 가 자연스럽게 살아남음.

### 4.3 Schema-vs-marker 이름 분기 (doc-link/glossary)

- Marker `Widget: doc-link` → emit `type: "doc-link-card"`.
- Marker `Widget: glossary` → emit `type: "glossary-ref"`.

이유: LLM 친화적 짧은 이름과 schema 의 정식 type 명을 별개로 유지. V4 가 양쪽 정확성을 검증.

### 4.4 camelCase / snake_case 함정 회피

- `ImageBlock.imageId` (camelCase) → `ImageAnnotationBlock.image_id` (snake_case)
- `FileBlock.fileId` (camelCase) ≠ `PdfBlock.file_id` (snake_case) — 같은 family 인데 다름.

V4 가 모든 converter 의 케이싱 검증, 0 결함.

### 4.5 file/pdf 의 placeholder fileId + warning

실제 파일이 import 시점에 없으므로 placeholder ULID 발급 + summary.warnings 에 informative 메시지 추가. 사용자는 import 후 에디터에서 파일을 다시 연결.

## 5. 변경 파일 요약

| 파일 | 변경 |
|---|---|
| `apps/api/app/services/widget_markers.py` | ConverterFn 시그니처 확장 + 14 신규 converter + 헬퍼들 (~828 LOC) |
| `apps/api/tests/test_widget_markers.py` | ~57 신규 테스트 + 새 helper (_image, _list, _code, _h4, _callout, _run_converter) |
| `apps/api/app/routers/imports.py` | `_safe_header_value(s, max_bytes)` helper + roundtrip endpoint 호출부 |
| `apps/web/src/components/blocks/TableBlock.tsx` | `renderCellContent` helper + `<th>` / `<td>` 적용 |
| `apps/web/src/features/editor/blocks/tableCells.ts` | `mergeWith` blocks-aware merge + `cellsToFlat` 주석 |
| `docs/lat/imports.md` | Widget marker 표 16 행으로 확장 + 카운트 갱신 |
| `docs/llm-document-formats.md` | Phase 2 구현 완료 callout (16 위젯) |

## 6. 다음 사이클 후보

1. **Phase 3 자동 패턴 인식** (마커 없이 컨텐츠 모양만으로 위젯 추론):
   - PPT "Before/After" 슬라이드 → columns 2단
   - 인포그래픽 (큰 숫자/%) → kpi-cards
   - 단일 셀 + 배경색 표 → callout
2. **Mixed-cells web 편집** (현재 read-only 렌더만).
3. **Export 측 마커 emit** (위젯 → docx/pptx round-trip 시 marker 로 변환).
4. **AI placeholder → 실제 LLM** (정책 결정 필요).
5. **SSO public flow** (회사 IdP 결정 필요).

## 7. 학습

- **에이전트 분할 분담 패턴**: 14 generator 동시 발사는 file conflict 위험 → Wave 분할 (9 + 5) 이 안정적. 같은 파일 (widget_markers.py + test_widget_markers.py) 에 동시 append 가 잘 작동 (모든 generator 가 자기 영역만 새로 추가, dispatcher 등록은 메인이 일괄).
- **시그니처 마이그레이션은 Wave 0**: Phase 1 converter 의 시그니처를 generator 가 알 수 있도록 미리 변경. 그러면 generator 들이 일관된 코드 작성.
- **Verifier 가 BLOCKING 1건 찾음**: 사람 작성 문서 (llm-document-formats.md) 의 "14 위젯" 숫자 오기. 자동 grep 으로 못 잡는 의미론적 inconsistency 를 sonnet 이 잡음.
- **rule violation 도 결과적으로 OK**: 3 generator (G9/G10/G11) 가 "DO NOT modify dispatcher" 룰을 어기고 자기 한 줄 변경. 메인이 어차피 14개 일괄 등록할 예정이라 충돌 0. 룰을 강하게 강제하기보다 메인이 통합 시 통제하는 게 작업 효율적.
