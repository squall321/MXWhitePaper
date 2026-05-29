# excel-functions-25 — Completion Report

## Executive Summary

| Perspective | Content |
|---|---|
| **Feature** | formulaEngine 25 함수 확장 (Excel 계열 기술통계/회귀/lookup) |
| **Completion** | 2026-05-29 |
| **Match Rate** | **100%** |
| **Code Delta** | formulaEngine.ts +370 LOC |
| **Tests** | +57 신규 vitest, **137 / 137** 통과 |
| **Regression** | 0건 |

### Value Delivered

| Perspective | Outcome |
|---|---|
| **Problem** | 기존 formulaEngine 은 SUM/AVG 등 기본만 지원 → spreadsheet 사용자가 Excel 에서 익숙한 STDEV/CORREL/VLOOKUP 류를 못 써 *외부 도구로 가공 후 paste* 하는 마찰. |
| **Solution** | 25 함수 일괄 추가 — 기술통계 12 + 회귀 6 + lookup 7. 도트 alias (`STDEV.S` 등) 는 preprocessAliases 로 정규화 후 dispatch. |
| **Function/UX Effect** | spreadsheet 셀에 Excel 호환 수식 직접 입력 가능. 외부 도구 round-trip 불필요. |
| **Core Value** | spreadsheet 위젯의 "계산 self-sufficiency" — paste-and-compute 워크플로 마찰 ↓. |

## 구현 위치

- `apps/web/src/lib/spreadsheet/formulaEngine.ts` — +370 LOC
  - 기술통계 (12): STDEV.S/P, VAR.S/P, MEDIAN, MODE.SNGL, QUARTILE.INC, PERCENTILE.INC, GEOMEAN, HARMEAN, SKEW, KURT
  - 회귀 (6): SLOPE, INTERCEPT, RSQ, CORREL, PEARSON, FORECAST
  - lookup (7): VLOOKUP, HLOOKUP, INDEX, MATCH, CHOOSE, XLOOKUP, IFS
  - helper: `flattenNumerics` / `expand2D` / `matToList` / `eqLoose` / `pairNumerics` / `linearFit`
  - `preprocessAliases` — `STDEV.S` → `STDEV_S` 식 도트 alias 정규화
- 테스트: `apps/web/src/lib/spreadsheet/formulaEngine.test.ts` — +57 신규
- 문서: `docs/lat/documents.md` + `docs/llm-input-rules.md` 양쪽 함수 표 동기화

## 테스트

| 단계 | 결과 |
|---|---|
| typecheck | clean |
| web vitest | **137 / 137** (+57 신규) |
| 회귀 | 0건 |

## 후속

- spreadsheet 셀 범위 드래그 (widget-integrity 백로그 S4) 와 묶어 *대화형 spreadsheet 사이클* 가능
- 추가 함수 요청 시 `flattenNumerics` / `pairNumerics` 패턴으로 ≤30 LOC 단위 확장
- 도트 alias 패턴은 `LN`/`LOG10`/`POWER` 등 수학 함수 batch 에도 재사용 가능
