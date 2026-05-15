# Plan — widget-phase2-batch

> Phase 1 (callout + kpi-cards) 직후, 나머지 14개 위젯 마커 변환기를
> 한 번의 PDCA 사이클로 일괄 완성한다. 동시에 청사진만 남아있던 follow-up
> 들 (mixed-cells web editor, 작은 TODO 들) 도 같이 처리.

## Executive Summary

| 관점 | 내용 |
| --- | --- |
| **Problem** | LLM 이 docx/pptx 로 풍부한 위젯을 표현하고 싶어도 marker 만 인식되고 실제 변환은 callout/kpi-cards 둘뿐. 나머지 14개는 warning + marker drop 만 됨. mixed-cells 도 BE 만 살아있고 web editor 는 text-only fallback. |
| **Solution** | widget_markers.py 의 `None` 14개를 모두 실제 converter 로 채우고 + dispatcher 등록 + 테스트 + lat 동기화. mixed-cells web editor 추가. 작은 TODO 일괄 정리. |
| **Function UX Effect** | LLM 이 만든 docx/pptx 가 import 되면 chart / gantt / flow / gallery / org-chart / columns / tabs / accordion / doc-link-card / glossary-ref / image-annotation / iframe / video / file / pdf / whiteboard 16종 위젯이 자동으로 복원. Mixed-cell 표는 web 에서도 paragraph/image/list 가 보이고 편집 가능. |
| **Core Value** | "외부 LLM → MX whitepaper 풀스택 위젯" 파이프라인 완성. 청사진 → 실구현 전환의 종지부. |

## Scope

### IN

**A. Widget Phase 2 — 14 converters** (`apps/api/app/services/widget_markers.py`):

1. `chart` — table → ChartBlock (columns 정보 + series 추정)
2. `gantt` — Task/Start/End 표 → GanttBlock (task list with dates)
3. `flow` — code block (mermaid DSL) → FlowBlock
4. `org-chart` — 들여쓰기 목록 또는 Parent/Child 표 → OrgChartBlock (트리)
5. `columns` — 2-3개 paragraph (또는 table N cols) → ColumnsBlock
6. `tabs` — sub-heading 시리즈 → TabsBlock (multi-block first case for tabs)
7. `accordion` — sub-heading 시리즈 → AccordionBlock (multi-block)
8. `gallery` — 연속 image 블록 N 개 묶기 (multi-block pair 첫 케이스)
9. `doc-link` → schema type `doc-link-card` — 단일 paragraph (slug 또는 URL) → DocLinkCardBlock
10. `glossary` → schema type `glossary-ref` — 단일 paragraph (term) → GlossaryRefBlock
11. `image-annotation` — image + 표(주석 좌표) → ImageAnnotationBlock
12. `iframe` — paragraph (URL) → IframeBlock
13. `video` — paragraph (URL 또는 vimeo/youtube ID) → VideoBlock
14. `file` — image block 또는 paragraph (filename) → FileBlock
15. `pdf` — paragraph (URL) → PdfBlock
16. `whiteboard` — image block → WhiteboardBlock (image fallback)

> **명명 충돌 주의**: marker `doc-link` ↔ schema `doc-link-card`,
> marker `glossary` ↔ schema `glossary-ref`. converter 가 schema type
> 으로 emit 해야 함.

**B. Mixed-cells web editor**:

- `apps/web/src/components/blocks/TableBlock.tsx` — `cell.blocks` 가 있으면 paragraph/image/list 렌더링.
- `apps/web/src/features/editor/blocks/tableCells.ts` — `blocks` 보존 + 편집은 일단 read-only (편집 인터페이스는 deferred).

**C. 작은 follow-up 정리**:

- `apps/api/app/services/markdown_export.py:46` — cycle 5 TODO 검증/해소
- Agent X 가 잡은 round-trip 안전화 1건: `_json.dumps(...)[:7000]` → codepoint-safe truncation (`apps/api/app/routers/imports.py`)

**D. multi-block pair 구조 확장**:

- `_rewrite_blocks` 에 multi-block target 지원 (gallery N images, tabs/accordion N sections). converter 가 "내가 N 개 소비했음" 반환.

### OUT

- C/D 영역 (AI placeholder → 실제 LLM, SSO public flow) — 정책 결정 필요로 별도 처리.
- Phase 3 자동 패턴 인식 (마커 없이 추론) — 다음 사이클.
- web editor 의 mixed-cell **편집** (현재 read-only 렌더만).
- Export 측 마커 emit (round-trip 시 위젯 → 마커).

## Success Criteria

1. `widget_markers.WIDGET_CONVERTERS` 의 모든 값이 callable (None 0개).
2. 각 위젯마다 docx 또는 pptx 통합 round-trip 테스트 1개 이상.
3. `apptainer exec instance://mxwp_api ... pytest tests/test_widget_markers.py` 100% 통과.
4. 전체 테스트 슈트 (`pytest tests/`) 회귀 0건.
5. `pnpm typecheck` 통과 (mixed-cells web 변경 포함).
6. `lat/imports.md` 의 widget marker 표가 14 신규 항목 반영.
7. `make openapi-dump` drift 0.
8. `llm-document-formats.md` 의 "현재 미구현 청사진" 마킹이 모두 "구현됨" 으로 갱신.

## Work Split Plan (에이전트 분할)

총 **18 work unit** — 모두 안 겹치는 파일/함수/테스트 케이스.

### Generator agents (Opus, 병렬 가능)

| ID | 위젯 | 핵심 입력 패턴 | 산출 파일 |
|---|---|---|---|
| G1 | chart | TableBlock | `_convert_chart` in widget_markers.py |
| G2 | gantt | TableBlock (Task/Start/End) | `_convert_gantt` |
| G3 | flow | CodeBlock (mermaid) | `_convert_flow` |
| G4 | org-chart | ListBlock 또는 TableBlock | `_convert_org_chart` |
| G5 | columns | ColumnsBlock or sequential N para | `_convert_columns` |
| G6 | tabs | ListBlock (헤딩+본문 쌍) | `_convert_tabs` |
| G7 | accordion | ListBlock (헤딩+본문 쌍) | `_convert_accordion` |
| G8 | gallery (multi) | 연속 ImageBlock N개 | `_convert_gallery` + multi-pair infra |
| G9 | doc-link → doc-link-card | ParagraphBlock | `_convert_doc_link` |
| G10 | glossary → glossary-ref | ParagraphBlock | `_convert_glossary` |
| G11 | image-annotation | ImageBlock + TableBlock | `_convert_image_annotation` |
| G12 | iframe + video + file + pdf + whiteboard (5 simple) | ParagraphBlock(URL) or ImageBlock | 5 converter 함수 묶음 |
| G13 | mixed-cells web render | `TableBlock.tsx` + `tableCells.ts` | TS 변경 |
| G14 | TODO 정리 + json codepoint-safe + lat 동기화 | imports.py, markdown_export.py, lat/imports.md, llm-document-formats.md | 작은 BE/문서 변경 |

### Verifier agents (Sonnet, 병렬 가능)

각 Generator 결과를 따로 받지 않고, **메인 thread 가 통합 적용 후** Verifier 들을 띄움.

| ID | 검증 범위 |
|---|---|
| V1 | G1-G4 (chart/gantt/flow/org-chart) — schema 적합 + 음성 케이스 (잘못된 target) |
| V2 | G5-G7 (columns/tabs/accordion) — 다중 sub-content 처리 |
| V3 | G8 (gallery, multi-block) — N=0/1/N 경계 + 다른 위젯과 간섭 없음 |
| V4 | G9-G12 (doc-link/glossary/image-annotation/5 simple) — schema type 이름 매칭 (`doc-link-card`/`glossary-ref`) 정확성 |
| V5 | G13 (web render) — typecheck + 시각 fallback 검증 + 회귀 가드 |
| V6 | G14 + 전체 통합 — pytest 회귀 0, openapi drift 0, lat 표 완전성 |

## Risks

- **multi-block pair 인프라 (G8) 가 모든 다른 converter 에 영향**. 메인 thread 가 G8 결과를 먼저 통합한 뒤 나머지 적용해야 안전.
- 위젯 schema 가 의외로 좁아서 (예: GanttBlock 필드명 / OrgChart 노드 구조) converter 가 lossy 변환을 해야 할 수도. 각 generator 에 "schema 먼저 읽고 → 보수적 fallback (None 반환) 으로 정보 손실 없게" 룰 주입.
- iframe/video/file/pdf/whiteboard 는 docx/pptx 에 자연스러운 표현이 없어 거의 paragraph(URL) 뿐. 변환 가치 낮지만 사용자 결정으로 "모두" 진행.

## Cycle Boundaries

본 사이클의 archive 는 단일 `widget-phase2-batch` 폴더로. 후속:
- Phase 3 자동 인식 (별도 사이클)
- mixed-cells web 편집 (별도 사이클)
- Export 측 마커 emit (별도 사이클)
