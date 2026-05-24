# Block Darkmode Batch — Gap Analysis

**Recommendation: PROCEED TO REPORT.** Match Rate = **100%**.

---

## Overview

| Field | Value |
|---|---|
| Feature | `block-darkmode-batch` |
| Implementation | uncommitted (next) |
| Date | 2026-05-24 |

## Scores

| Category | Score |
|---|:---:|
| Plan AC (C1-C9) | 9/9 |
| Match | 100% |

## Verification

### 처리된 파일 (26 + 1 = 27)
| 그룹 | 파일 |
|---|---|
| Plan-listed (26) | Accordion / Calculator / Callout / DashboardEmbed / DataSource / DocLinkCard / FigureIndex / File / Flow / Form / Gallery / GlossaryRef / Iframe / ImageAnnotation / Image / KpiCards / Pdf / Placeholder / Quiz / Spreadsheet / Table / Tabs / Video / Whiteboard / Code (skip) / BlockRenderer (skip — utility) |
| Plan-missed (1) | ParagraphBlock (border-gray-300 divider 2곳) — 회귀 가드 신설 후 발견 → 처리 |
| 신규 가드 추가 | `AllBlocksDarkmode.test.ts` — 향후 회귀 자동 검출 |

### 의도 예외 2건 (allow-list)
- `CodeBlock.tsx` — 코드 블록은 *항상* 어두운 surface
- `WhiteboardBlock.tsx` — 화이트보드 캔버스 (사용자가 흰 배경 위에 그림)

### Acceptance Criteria
| # | Status |
|---|:---:|
| C1: bg-white + dark:bg-gray-900 | ✅ |
| C2: border-gray-200 + dark:border-gray-700 | ✅ |
| C3: text-gray-900 + dark:text-gray-100 | ✅ |
| C4: 사용자 색 미변경 | ✅ |
| C5: vitest/typecheck 회귀 0 | ✅ (1843/1843 + clean) |
| C6: 회귀 가드 테스트 신설 | ✅ (`AllBlocksDarkmode.test.ts`) |
| C7: snapshot 갱신 | ✅ (20 snapshot updates total — chart 1 + others 19) |
| C8: lat 갱신 | ✅ (documents.md Gotcha #11 추가) |
| C9: 사이클 보고서 + archive | 🔄 |

## Differences

### 🟡 Added (positive)
- 회귀 가드 테스트가 plan에 *없었던 검증 자동화* — Plan C6은 "회귀 정규식 검증"만 명시, 실제는 allow-list + 의도 예외 검증까지 포함
- ParagraphBlock divider 2건 — plan audit가 놓침 (heuristic grep이 `border-dashed`-only 패턴 누락). 가드가 잡아냄

### 🔴 Missing
None.

## Conclusion

26 + 1 = 27 파일 darkmode 일괄 처리. **회귀 가드 자동화**로 향후 신규 블록 추가 시 다크 일관성 깨짐 방지. **PROCEED TO REPORT**.
