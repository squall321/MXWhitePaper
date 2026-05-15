# widget-marker-import (Phase 1) Design Document

> **Summary**: docx/pptx import 시 `Widget: <type>` 마커 단락 + 다음 블록 쌍을
> 진짜 위젯 블록으로 변환하는 통일 룰의 인프라 + 2 위젯 (callout, kpi-cards) POC.
>
> **Project**: MXWhitePaper
> **Author**: koopark
> **Date**: 2026-05-15
> **Status**: Implemented
> **Planning Doc**: [widget-marker-import.plan.md](../01-plan/features/widget-marker-import.plan.md)

---

## 1. Overview

### 1.1 Design Goals

- 단일 후처리(post-pass) 패스로 모든 위젯 인식 — walk 로직 자체 변경 0 (회귀 최소화).
- 신규 위젯 추가 비용 = converter 함수 1 개 + dispatcher 등록.
- 마커 없는 문서 영향 0 (기존 763 회귀 가드).
- docx 와 pptx importer 가 동일 모듈 (`widget_markers.py`) 공유 — 중복 0.

### 1.2 Design Principles

- **Post-pass 패턴** — 본문 walk 가 만든 블록 리스트를 두 번째 패스로 rewrite.
- **Pair-based** — 마커 paragraph + 다음 1 개 블록만 매칭. 다중 블록 위젯 (gallery N 이미지 등) 은 future work.
- **Conservative fallback** — 변환 실패 시 marker + target 둘 다 보존. 정보 손실 0.
- **Dispatcher 등록제** — 알려진 위젯 타입만 처리. 미등록은 false-positive 회피 위해 paragraph 로 그대로 둠.

---

## 2. Architecture

### 2.1 Module Boundary

```text
┌─────────────────────────────────────────────────────────────┐
│ apps/api/app/services/widget_markers.py   (shared module)   │
│   ├── WIDGET_MARKER_RE         정규식                        │
│   ├── parse_marker(text)       → (type, variant) | None      │
│   ├── WIDGET_CONVERTERS        dict[type → ConverterFn|None] │
│   ├── _convert_callout         Phase 1                       │
│   ├── _convert_kpi_cards       Phase 1                       │
│   └── apply_widget_markers(sections, summary)  진입점        │
└─────────────────────────────────────────────────────────────┘
              ▲                              ▲
              │                              │
┌──────────────────────────┐   ┌──────────────────────────────┐
│ docx_import              │   │ pptx_import                  │
│   _build_sections() 끝   │   │   slide loop 끝              │
│   → apply_widget_markers │   │   → apply_widget_markers     │
└──────────────────────────┘   └──────────────────────────────┘
```

### 2.2 Data flow (per import)

1. Importer 가 평소처럼 본문 → `sections[].blocks[]` 빌드.
2. `apply_widget_markers(sections, summary)` 호출.
3. 각 section.blocks 를 walk:
   - 현재 블록이 paragraph + `parse_marker(text)` 매치 → 마커.
   - `WIDGET_CONVERTERS[type]` 조회:
     - 함수 → 다음 블록을 converter 에 전달, 결과 widget 으로 교체 (i += 2).
     - `None` (Phase 2 hook) → 마커 소비, warning 추가, target 그대로 (i += 1).
     - 미등록 → marker 그대로 paragraph 로 emit (false positive 보호).
   - 매치 안 됨 → 평소대로.
4. Subsections 재귀.

---

## 3. 마커 문법

```text
^\s*(?:Widget|위젯)\s*:\s*([a-z][a-z0-9-]*)\s*(?:\(\s*([^)]+?)\s*\))?\s*$
```

| 입력 예시 | parse_marker 결과 |
|---|---|
| `Widget: callout (warn)` | `("callout", "warn")` |
| `위젯: kpi-cards` | `("kpi-cards", None)` |
| `WIDGET: chart (bar)` | `("chart", "bar")` |
| `Widget callout warn` (콜론 없음) | `None` |
| `정보: callout` (한국어 prefix 다름) | `None` |

---

## 4. Phase 1 Converters

### 4.1 `_convert_callout`

- 입력: variant (info/warn/danger/tip — 그 외는 info 폴백) + 다음 단락.
- 출력: `CalloutBlock {type, id, variant, text}`.
- 실패: 다음 블록이 paragraph 가 아니거나 빈 텍스트면 None.

### 4.2 `_convert_kpi_cards`

- 입력: 다음 표 (variant 무시).
- 헤더 매칭: `label`, `value` 필수 / `delta`, `trend` 옵션 (대소문자 무시).
- 출력: `KpiCardsBlock {type, id, items[≤4]}` — 각 item 은 `{label, value, delta?, trend?}`.
- 실패: 다음 블록이 table 아니거나 label/value 헤더 없으면 None.

---

## 5. Importer 통합 지점

| Importer | Hook 위치 |
|---|---|
| docx_import.docx_to_document | `_convert_references_sections()` 직후, default-section fallback 직전 (line 953) |
| pptx_import.pptx_to_document | slide loop 종료 직후, metadata 빌드 직전 (line 368) |

두 importer 모두 sections 트리가 완성된 시점이라 동일 함수가 작동.

---

## 6. 테스트 전략

| 카테고리 | 케이스 |
|---|---|
| Regex 단위 | 한/영, variant, hyphen, 공백 strip, freeform 거부 |
| Dispatch 단위 | callout 변환, unknown variant 폴백, kpi-cards 변환, kpi-cards 헤더 누락 시 둘 다 보존 |
| Phase 2 hook | chart 마커 → warning + target 보존 |
| False positive 회피 | unknown type marker 텍스트 그대로 |
| Recursion | subsections 안 마커도 동작 |
| docx 라운드트립 | callout 마커 패턴 docx export → import → CalloutBlock 회수 |
| 회귀 가드 | 마커 없는 docx 는 import 결과에 callout/kpi-cards 없음 |

총 15 신규 테스트, 모두 통과. 전체 회귀: 778/778.

---

## 7. Out of Scope (Phase 2+)

- Phase 2 위젯 변환 함수 12 종 (chart, gantt, flow, org-chart, columns, tabs, accordion, gallery, doc-link, glossary, image-annotation, iframe/video/file/pdf/whiteboard).
- 다중 블록 위젯 (gallery N 이미지 묶기, tabs/accordion 의 heading-4 시리즈 흡수 등).
- 자동 패턴 인식 (마커 없이 콘텐츠 모양만으로 위젯 추론 — future-B 의 "2차" 컬럼).
- export 측 마커 emit — 굳이 안 함 (export 는 이미 native 위젯 → docx 렌더 보유).
- FE 위젯 UI — 본 작업은 BE 만.
