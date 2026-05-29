# Pivot Table 위젯 — Planning Document

> **Summary**: Excel pivot table 동등 위젯. rows × cols × values 축 + 집계 (sum/count/avg/...) +
> subtotal/grand total + sort/filter 로 raw rows 을 cross-tab 표로 즉시 변환. MX 의 SpreadsheetBlock
> formulaEngine 통계 함수 + TableBlock sparse cells 시각화 재사용. XL ~3일+, Sprint 4 분할.
>
> **Project**: MX White Paper
> **Feature**: pivot-table
> **Version**: 0.1.0
> **Date**: 2026-05-29
> **Status**: Draft (사용자 결정 3 항목 대기)
> **Previous**: Workflow audit (2026-05-29) 가 OVERLY_AMBITIOUS dismiss 했으나 사용자 명시 요청

---

## Executive Summary

| Perspective | Content |
|---|---|
| **Problem** | 사용자가 raw rows (월별 매출 / 부서별 KPI / 설문 응답) 를 *축별 합계* 로 보려면 현재 SpreadsheetBlock formula 수동 작성 (SUMIFS 등) 또는 TableBlock 손작업. Excel 의 pivot drag-drop 동등 UI 부재. |
| **Solution** | 신규 `pivot-table` 블록. raw rows (inline 또는 향후 DataSource 참조) 에서 rows/cols/values 축 선택 시 즉시 cross-tab. 집계는 formulaEngine 의 통계 함수 (cycle 1 추가됨) 재사용. 시각화는 TableBlock sparse + grand total 행/열. |
| **Function/UX Effect** | "월별 매출 데이터 100행 → 부서×년도 cross-tab + 합계" 가 drag-drop 으로. Excel 사용자 즉시 인지. |
| **Core Value** | Excel pivot 대체 — 화이트페이퍼 안에서 raw → 집계 표 → (cycle 3 conditional formatting + cycle 2 sparkline) 시너지로 *데이터 분석 백서* 한 페이지에 완성 |

---

## 1. Overview

### 1.1 Purpose

Excel pivot table 의 핵심 가치 — *"raw rows → row × col cross-tab + 집계"* — 를 MX 안에서 구현.
이전 workflow audit 이 OVERLY_AMBITIOUS dismiss 했으나 사용자가 명시 요청 → 정식 사이클.

### 1.2 Out of Scope (Phase 1)
- Drill down (셀 클릭 → 원본 rows)
- Slicer / Timeline (cross-widget filter)
- Calculated item (행/열 내 가상 항목)
- 다중 데이터 소스 (Power Query 동등)
- 시간 그룹 (year/quarter/month auto-group)

### 1.3 Decisions (사용자 확정 대기)

| # | 결정 항목 | 옵션 |
|---|---|---|
| D1 | **블록 신설 vs TableBlock 확장** | A) 신규 `pivot-table` 블록 (권장) / B) TableBlock 에 `mode: "pivot"` 추가 |
| D2 | **데이터 소스 범위** | A) inline rows 만 (Phase 1) / B) inline + CSV paste / C) inline + DataSourceBlock 참조 (Phase 2) |
| D3 | **calculated field 포함 여부** | A) Sprint 4 에 포함 / B) Sprint 5+ deferred (사용자 정의 measure 식) |

**추천**: D1=A (신규 블록 — TableBlock 의 flat/sparse 와 inheritance 부담 회피), D2=B (CSV paste 까지, Phase 1 최소 UX), D3=A (formulaEngine 이미 있어 비용 작음).

---

## 2. Sprint 분할 (XL ~3일+)

### Sprint 1 — 데이터 모델 + 기본 pivot (M, ~1일)
- 신규 schema `PivotTableBlock` (type: 'pivot-table')
- 집계 엔진 (pure helper) — rows/cols/values × aggregator (sum/count/avg/min/max)
- 기본 viewer (rows × cols cross-tab, subtotal 없음, 1 measure)
- editor MVP (rows/cols/values multi-select dropdown)
- 신규 vitest 15+

### Sprint 2 — Subtotal + Grand total + 다중 measure + sort/filter (M, ~1일)
- subtotal (row/col 각각 토글)
- grand total (row+col 교차)
- 다중 measure (예: [sum(revenue), avg(profit)] 동시 표시)
- 라벨 정렬 / 측정값 기반 정렬
- top-N filter, label/value filter
- 신규 vitest 15+

### Sprint 3 — % of total / 누적 / 표시 형식 (S, ~반나절)
- "show values as" (% of row total / col total / grand total / running total)
- numberFormat (천단위 콤마 / % / 통화 / 소수점 자리수)
- 신규 vitest 10+

### Sprint 4 — Calculated field (S, ~반나절)
- 사용자 정의 measure: 식 (formulaEngine 표현식, 예: `revenue - cost`)
- field 이름 + 식 입력 UI
- 신규 vitest 10+

### Sprint 5+ deferred (backlog)
- Drill down (셀 → 원본 list 모달)
- Slicer / Timeline (cross-widget visual filter)
- Calculated item
- 시간 자동 그룹 (year/quarter/month)
- DataSourceBlock 참조 (Sprint 4 의 calculated field 가 안정된 후)

---

## 3. 데이터 모델 (Sprint 1)

```ts
interface PivotTableBlock {
  type: 'pivot-table'
  id: string
  source: {
    kind: 'inline'  // Phase 1 만 — Phase 2 에서 'csv' / 'dataSourceRef' 추가
    rows: Record<string, string | number | null>[]  // raw rows
    schema?: {  // optional, 자동 추론 가능
      fields: { name: string; dtype: 'number' | 'string' | 'date' }[]
    }
  }
  rows: string[]      // row 축 (e.g., ['department', 'year'])
  cols: string[]      // col 축 (e.g., ['quarter'])
  values: {           // measure
    field: string
    agg: 'sum' | 'count' | 'avg' | 'min' | 'max' | 'median' | 'stdev' | 'var'  // Sprint 1 부터 cycle 1 통계 재사용
    label?: string    // 표시 이름 (default = "{agg}({field})")
    showAs?: 'value' | 'pct_row' | 'pct_col' | 'pct_total' | 'running'  // Sprint 3+
    numberFormat?: string  // e.g., "#,##0.00", "0.0%"  // Sprint 3+
  }[]
  totals?: {  // Sprint 2+
    grand?: boolean
    row?: boolean
    col?: boolean
  }
  sort?: {  // Sprint 2+
    axis: 'row' | 'col'
    by: string  // dimension name or measure label
    order?: 'asc' | 'desc'
  }
  filters?: {  // Sprint 2+
    field: string
    op: 'in' | 'not_in' | 'gt' | 'lt' | 'top_n' | 'bottom_n'
    value: unknown
  }[]
  options?: {
    emptyCell?: string  // default '-'
  }
}
```

---

## 4. Acceptance Criteria (Phase 1 = Sprint 1)

- **C1**: rows + cols + values 지정 시 cross-tab 정확 (수동 검증 + 단위 테스트로 비교)
- **C2**: 집계 5종 (sum/count/avg/min/max) 정확 — cycle 1 의 formulaEngine 헬퍼 재사용
- **C3**: 빈 셀 표시 (default '-', 사용자 옵션)
- **C4**: BE schema validation 통과
- **C5**: editor 가 source.rows 의 fields 자동 추출 → row/col/value picker dropdown 채움
- **C6**: 신규 vitest 15+ (집계 엔진 unit + editor SSR + viewer SSR)
- **C7**: typecheck clean, 회귀 0
- **C8**: lat docs/lat/documents.md PivotTableBlock 한 단락
- **C9**: llm-input-rules.md §3 에 pivot-table 위젯 가이드

---

## 5. UI 와이어프레임 (ASCII)

### Editor (PivotTableBlockEditor)

```
┌────────────────────────────────────────────────────────────────┐
│ Pivot Table Editor                            [Show Result ▼] │
├────────────────────────────────────────────────────────────────┤
│ Source: ○ Inline rows  ○ CSV paste  ○ DataSource (Phase 2)   │
│ ┌─────────────────────────────────────────────────────────┐   │
│ │ {department: "Sales", year: 2024, revenue: 100, ...}     │   │
│ │ {department: "R&D", year: 2024, revenue: 80, ...}        │   │
│ │ ...                                              [Paste] │   │
│ └─────────────────────────────────────────────────────────┘   │
│                                                                │
│ Fields detected: department / year / revenue / cost / ...     │
│                                                                │
│ Rows:    [department × ] [year × ]   [+ Add row dim]          │
│ Cols:    [quarter × ]                [+ Add col dim]          │
│ Values:  [SUM(revenue) × ] [AVG(profit) × ]  [+ Add value]    │
│                                                                │
│ □ Grand total   □ Row total   □ Col total                     │
└────────────────────────────────────────────────────────────────┘
```

### Viewer

```
                  │  Q1   │  Q2   │  Q3   │  Q4   │ Total │
─────────────────────────────────────────────────────────
 Sales  │ 2024  │  100  │  120  │  130  │  110  │  460  │
 Sales  │ 2025  │  150  │  170  │       │       │  320  │
 R&D    │ 2024  │   80  │   90  │   85  │   95  │  350  │
 ...                                                       
 Total  │       │  330  │  380  │  215  │  205  │ 1130  │
```

---

## 6. 영향 받는 파일 (Sprint 1)

### 신규
- `apps/web/src/components/blocks/PivotTableBlock.tsx` (viewer)
- `apps/web/src/components/blocks/pivotEngine.ts` (집계 pure helper)
- `apps/web/src/components/blocks/__tests__/pivotEngine.test.ts` (10+ 테스트)
- `apps/web/src/components/blocks/__tests__/PivotTableBlock.test.tsx` (5+ SSR)
- `apps/web/src/features/editor/blocks/PivotTableBlockEditor.tsx` (editor)
- `apps/web/src/features/editor/blocks/__tests__/PivotTableBlockEditor.test.tsx` (5+)

### 수정
- `packages/shared/schemas/document.json` (PivotTableBlock 정의 + Block union 에 추가)
- 자동 codegen: `apps/web/src/types/document.ts` + `apps/api/app/schemas/document.py`
- `apps/web/src/components/blocks/BlockRenderer.tsx` (또는 비슷한 dispatcher) — pivot-table case 추가
- `apps/web/src/features/editor/components/BlockInsertPalette.tsx` (또는 SlashCommandMenu) — pivot-table 추가
- `apps/web/src/components/blocks/__tests__/__snapshots__/AllBlocksRender.test.tsx.snap` (신규 블록 snapshot 추가)
- `docs/lat/documents.md` PivotTableBlock 항목
- `docs/llm-input-rules.md` + dist mirror §3 (위젯 룰)

### 호환성
- 기존 35 블록 영향 0
- formulaEngine 재사용 (helper export 만 import)
- TableBlock 의 sparse cells 시각화 패턴 참고 (코드 복사 아닌 design 참고)

---

## 7. 다음 단계

1. **사용자 결정 3 항목** (D1/D2/D3) 확정
2. Sprint 1 구현 워크플로우 시작 (M, ~1일)
3. Sprint 1 완료 후 → archive 47번째 + 사용자에게 Sprint 2 진행 여부 확인

### 백로그 (Sprint 5+ deferred 항목 명시)
- Drill down · Slicer · Calculated item · 시간 그룹 · DataSource 참조

---

## Version History

- 0.1.0 (2026-05-29) — Workflow audit 가 dismiss 한 항목을 사용자 명시 요청으로 정식 사이클화. plan 작성 (직접 — rate limit 환경)
