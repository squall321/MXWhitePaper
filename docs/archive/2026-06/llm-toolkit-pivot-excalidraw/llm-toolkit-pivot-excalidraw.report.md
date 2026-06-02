# llm-toolkit-pivot-excalidraw — Completion Report

## Executive Summary
| | |
|---|---|
| **Feature** | E3 — LLM toolkit 갱신: PivotTable (Sprint 1-5) + FlowBlock excalidraw 명세 |
| **Completion** | 2026-06-02 |
| **Match Rate** | 100% |

### Value Delivered

| Perspective | Outcome |
|---|---|
| Problem | LLM 산출 docx/JSON 보고서에 핵심 위젯 2종 가이드 부재. PivotTable 은 가이드 3개 (input-rules / widgets-via-api / system-prompt) 어디에도 명세가 없어 외부 LLM 이 schema 추론에만 의존. FlowBlock excalidraw 도 D1+E1 의 viewer/editor 출시 후 가이드 미반영 |
| Solution | (1) `llm-widgets-via-api.md` 에 §3.22 pivot-table 정식 명세 (Sprint 1-5 통합 + 실용 예시). flow 섹션에 excalidraw 변형 추가. (2) `llm-input-rules.md` §3 위젯 룰에 pivot-table 추가 + flow 의 excalidraw 가이드라인. (3) `llm-system-prompt.md` 표 35→36 블록 + pivot 행 추가 + §3 핵심 위젯 예시에 pivot + excalidraw 추가. (4) examples 2 신설 (pivot-table.json / flow-excalidraw.json) + all-widgets.json 에 pivot 블록 통합. (5) RAG 재인덱싱 + binary 재빌드 |
| Function/UX | 외부 LLM 이 가이드 따라 시간 그룹 / calculated items / showAs / numberFormat 산출 가능. Excalidraw scene 보존 경로 명시 |
| Core Value | Sprint 5 의 schema 변경이 LLM 사용자 도달. 외부 LLM 산출 보고서 호환성 한 단계 격상 |

## 변경

### 1) `docs/llm-widgets-via-api.md`

- §3.12 flow 에 **Excalidraw 변형** 추가 — `engine: "excalidraw"` + scene JSON 문자열, parse 실패 시 viewer recovery banner 명세
- §3.22 **pivot-table (피벗 표)** 정식 신설 — Sprint 1 (최소) / 2 (totals/sort/filters) / 3 (showAs/numberFormat) / 4 (expr) / 5 (date group + calculatedItems) 단계별 예시 + 실용 LLM 산출 예 (2024 분기별 부서 매출 + H1 합산)
- 후속 섹션 번호 3.22→3.23 시프트

### 2) `docs/llm-input-rules.md`

- §3.5 flow 에 docx 는 mermaid 표준 / 외부 Excalidraw 보존은 API 직접 명시 + 자세한 키는 widgets-via-api 링크
- §3.13 **pivot-table** 신설 — "docx 로는 만들 수 없다, API 전용". 5 가지 핵심 패턴 (시간 분석 / 분기 합산 / 비율 / TOP N / 계산 필드) + widgets-via-api 링크

### 3) `dist/llm-docx-toolkit/llm-system-prompt.md`

- §2 카운트 35 → 36 블록 + "API 전용 1" 카테고리 명시 + pivot-table 안내
- §2 표 flow 행에 Excalidraw 보존 메모 + pivot-table 행 신규
- §3 핵심 위젯 예시에 pivot-table JSON 한 개 + flow excalidraw 짧은 형식

### 4) Examples (gitignored binary, 별도 release)

- `pivot-table.json` 신설 — 분기별 부서 매출 + H1/H2 calculated items + 전사 합계
- `flow-excalidraw.json` 신설 — 사각형 2개 + 화살표의 최소 scene
- `all-widgets.json` 에 pivot-table 블록 통합 (chart 다음 자리). widget_counts + block_count 갱신
- 두 신규 example schema validate 통과

### 5) RAG 재인덱싱

- `dist/llm-docx-toolkit/rag/chunks.jsonl` 재생성 — document.json 의 신규 키 (rows union, calculatedItems, group) 가 검색 가능
- `rag/index.lock` 의 source_hashes 갱신

### 6) Binary 재빌드

- `python build.py` 로 4 binary 갱신:
  - `bin/mxwp-import-linux` (7.4 MB) ✓ sanity OK
  - `bin/mxwp-rules-linux` (26.8 MB) ✓ sanity OK
  - `bin/mxwp-validator-linux` (14.4 MB) — PyInstaller hidden import `ulid` 빠짐 (기존 빌드와 동일 이슈, 호스트 PyPI 설치 가정)
  - `bin/mxwp-mcp-linux` (122 MB) — 동일 `mcp` 모듈 hidden import 이슈
- `_release/lite-linux/llm-docx-toolkit-lite-linux.tar.gz` (161 MB) 새 tar

## 검증

- 신규 example 2 schema validate 통과
- 기존 sample 16/16 valid (codegen)
- RAG chunker 통과 (37 examples 인덱싱)
- binary 4종 모두 생성 + 2종 sanity OK

## Defer / 후속

- mxwp-validator / mxwp-mcp 의 PyInstaller hidden import (`ulid` / `mcp`) fix — 별도 사이클
- macos/windows binary 빌드 (CI 가 처리)
- llm-document-formats.md 의 docx/pptx 항목에 pivot-table 표기 (현재 미작성, docx 표현 불가라 우선순위 낮음)

## 누적 cycle

| Cycle | commit |
|---|---|
| D1-E1 | 25a842b … d8f3ce2 |
| F1 (fresh-host 자동화) | d1587d5 |
| E2 (Pivot Sprint 5) | 67fa5f4 |
| **E3 (LLM toolkit 갱신)** | 본 사이클 |

## 다음 단계

- Pivot Sprint 6+ deferred: Slicer (XL) / DataSource 참조 (L)
- llm-document-formats.md pivot 항목
- 사용자 결정에 위임
