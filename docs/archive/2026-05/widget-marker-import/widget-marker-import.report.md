# widget-marker-import (Phase 1) — 완료 보고

## Executive Summary

| 항목 | 값 |
| --- | --- |
| Feature | widget-marker-import (Phase 1) |
| Date | 2026-05-15 |
| Match Rate | 100% |
| Tests | 15 신규 (regex + dispatcher + integration) + 763 회귀 = **778/778** |
| Files | 신규 2 (widget_markers.py, test_widget_markers.py) + 수정 4 (docx_import, pptx_import, lat/imports.md, llm-document-formats.md) |

### Value Delivered (4 perspectives)

| 관점 | 결과 |
| --- | --- |
| **Problem** | docx/pptx import 시 paragraph/table/list 외 14 종 위젯이 평탄화돼 모두 사라짐. LLM 이 사내 표준 위젯을 docx 로 생성할 방법 부재. |
| **Solution** | "직전 단락 `Widget: <type>` 마커 → 다음 블록을 해당 위젯으로 변환" 통일 룰. Phase 1 은 인프라 + callout + kpi-cards. |
| **Function / UX** | LLM 이 `Widget: callout (warn)` + 단락만 출력해도 import 후 진짜 callout. 미지원 위젯은 마커 인식 + warning + target 보존 (정보 손실 0). |
| **Core Value** | "LLM → docx → MX" 파이프라인의 핵심 누락 조각 해결. Phase 2 위젯은 converter 함수 1 개씩 추가만으로 확장. |

---

## 1. PDCA Pipeline

| Phase | 산출물 | 결과 |
|---|---|---|
| Plan | `docs/01-plan/features/widget-marker-import.plan.md` | 7 단계 + 4 위험 명시 |
| Design | `docs/02-design/features/widget-marker-import.design.md` | Post-pass 패턴, 모듈 경계, fallback 4 경로 |
| Do | 신규 2 + 수정 4 파일 | 모든 단계 implement |
| Check | `docs/03-analysis/widget-marker-import.analysis.md` | 100% Match Rate |
| Act | (불필요 — ≥90%) | skip |

---

## 2. 변경 내역

### 2.1 신규 — `widget_markers.py`

| Symbol | 책임 |
|---|---|
| `WIDGET_MARKER_RE` | 정규식 — 한/영 + variant 옵션 |
| `parse_marker(text)` | `(type, variant) \| None` 반환 |
| `WIDGET_CONVERTERS` | 18 타입 dispatcher (callable 2 + None 16) |
| `_convert_callout` | 다음 단락 → CalloutBlock (info/warn/danger/tip) |
| `_convert_kpi_cards` | 다음 표 → KpiCardsBlock (label/value 필수) |
| `apply_widget_markers` | 진입점 — sections 재귀 walk + 마커 pair rewrite |

### 2.2 importer 통합

- `docx_import.py:954-957` — `_convert_references_sections()` 직후 hook.
- `pptx_import.py:369-373` — slide loop 종료 후 hook.

두 importer 모두 sections 트리 완성 시점에 동일 함수 호출 — 중복 0.

### 2.3 Fallback 4 경로 (정보 손실 0)

| 시나리오 | 동작 |
|---|---|
| 미등록 위젯 타입 | marker 텍스트 보존 (false positive 회피) |
| Phase 2 hook (None) | warning + marker drop + target 그대로 |
| 마커 뒤 블록 없음 | marker 조용히 drop |
| Converter 실패 (wrong target type 등) | marker + target 둘 다 보존 |

### 2.4 Tests

`tests/test_widget_markers.py` — 15 케이스:

| 카테고리 | 개수 |
|---|:---:|
| Regex 단위 | 5 |
| Dispatch 단위 (callout/kpi-cards) | 4 |
| Phase 2 hook warning | 1 |
| False positive 회피 | 1 |
| Subsections 재귀 | 1 |
| docx 라운드트립 | 1 |
| 마커 없는 문서 회귀 가드 | 1 |
| Dispatcher 형상 sanity | 1 |

전체 회귀: 763 → 778, 0 실패.

### 2.5 문서

- `docs/lat/imports.md` — "Widget marker post-pass" 섹션 신규.
- `docs/llm-document-formats.md` Section 2.99 — "Phase 1 구현 완료" callout + LLM 작성법 가이드.

---

## 3. 성능 / 호환성

- **post-pass 비용**: section 당 O(n) blocks. 본 walk 보다 훨씬 가벼움.
- **API 호환성**: 기존 클라이언트 / 기존 docx 100% 동일 import. 마커 없는 문서는 영향 0.
- **DB migration**: 0.
- **schema 변경**: 0 — 생성하는 위젯 블록은 기존 CalloutBlock / KpiCardsBlock 스키마.

---

## 4. Out of Scope (Phase 2+)

| 항목 | 비고 |
|---|---|
| 12 Phase-2 위젯 변환 함수 | converter 함수 1 개씩만 추가하면 됨 |
| 다중 블록 위젯 (gallery N, tabs/accordion 시리즈) | 현재 1+1 pair 만 |
| 마커 없는 자동 패턴 인식 | future-B "2차" 컬럼 |
| Export 측 마커 emit | 기존 native 위젯 렌더 활용 |
| FE 위젯 UI | BE 만 |

---

## 5. Next Steps

1. **Phase 2 위젯 단계적 추가** — 가장 흔한 순:
   - `chart` (CSV table → ChartBlock)
   - `gantt` (Task/Start/End 표 → GanttBlock)
   - `gallery` (다음 N 이미지 묶기 — multi-block 첫 케이스)
   - `flow` (mermaid DSL code block → FlowBlock)

2. **자동 패턴 인식 (Phase 3)** — 마커 없이도 콘텐츠 모양만으로 인식. 가장 큰 ROI 는:
   - PPT "Before/After" 슬라이드 → columns 2단
   - PPT 인포그래픽 (큰 숫자/퍼센트) → kpi-cards
   - 단일 셀 + 배경색 표 → callout

3. **Archive Phase 1** — `/pdca archive widget-marker-import`.
