# Gap Analysis — widget-marker-import (Phase 1)

- **Feature**: widget-marker-import (Phase 1)
- **Design**: [widget-marker-import.design.md](../02-design/features/widget-marker-import.design.md)
- **Plan**: [widget-marker-import.plan.md](../01-plan/features/widget-marker-import.plan.md)
- **Date**: 2026-05-15
- **Match Rate**: **100%**

## Per-Area

| Area | Score | Notes |
|---|:---:|---|
| `widget_markers.py` 모듈 형상 | 100% | 6 심볼 (`WIDGET_MARKER_RE`, `parse_marker`, `WIDGET_CONVERTERS`, `_convert_callout`, `_convert_kpi_cards`, `apply_widget_markers`) 모두 존재 |
| Regex (Design Section 3) | 100% | 대소문자 무시 + 한/영 + 옵션 variant |
| `_convert_callout` (4.1) | 100% | variant 화이트리스트 + info 폴백 + paragraph-only |
| `_convert_kpi_cards` (4.2) | 100% | label+value 필수, delta/trend 옵션, 최대 4 카드 |
| Dispatcher | 100% | callable 2 + None 16 = 정확히 18 타입 |
| `apply_widget_markers` 재귀 | 100% | subsections 재귀 + in-place mutate |
| docx hook (Section 5) | 100% | `docx_import.py:954-957` |
| pptx hook (Section 5) | 100% | `pptx_import.py:369-373` |
| Tests (Section 6) | 100% | 15 케이스 / 7 카테고리 |
| lat 문서 | 100% | `docs/lat/imports.md` "Widget marker post-pass" 섹션 |
| LLM 가이드 | 100% | `llm-document-formats.md` Section 2.99 의 Phase 1 callout |
| Out-of-scope 준수 | 100% | 16 Phase-2 위젯 None hook, 외부 위젯 작업 없음 |

## Conservative-Fallback 검증

| 시나리오 | 결과 | 위치 |
|---|---|---|
| 미등록 위젯 타입 | marker 텍스트 보존 | `widget_markers.py:215-219` |
| Phase 2 hook (None) | warning + marker drop + target 보존 | `widget_markers.py:221-228` |
| Marker 뒤 블록 없음 | 조용히 drop | `widget_markers.py:230-232` |
| Converter None 반환 | 둘 다 보존 | `widget_markers.py:236-240` |

Design Section 2.2 의 4 fallback 경로 모두 코드와 일치.

## 차이 / Drift

None. 100% 일치.

## Out-of-Scope (의도적으로 미구현)

- 16 Phase-2 위젯 변환 함수
- 다중 블록 위젯 (gallery, tabs/accordion 시리즈)
- 마커 없는 자동 패턴 인식
- Export 측 마커 emit
- FE 위젯 UI

## 권장 액션

없음. `/pdca report widget-marker-import` 진행.
