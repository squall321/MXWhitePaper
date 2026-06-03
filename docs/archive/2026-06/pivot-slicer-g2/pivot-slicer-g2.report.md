# pivot-slicer-g2 — Completion Report

## Executive Summary
| | |
|---|---|
| **Feature** | G2 — SlicerBlock + cross-widget filter coordinator (Pivot 한정) |
| **Completion** | 2026-06-03 |
| **Match Rate** | 100% (Pivot ↔ Slicer 범위 내) |

### Value Delivered

| Perspective | Outcome |
|---|---|
| Problem | Pivot Sprint 5-6 까지 widget 자체 filters 만 가능. "부서 토글 + 분기 토글" 같은 인터랙티브 보고서 화면을 표현 불가 |
| Solution | 신규 `SlicerBlock` (chip group) + zustand `useSlicerStore` (id → active values) + `PivotTableBlock.boundSlicers?[]` 가 listen. viewer hydration 단계에서 `collectSlicerFilters` 가 active 를 `{field, op:'in'}` 으로 변환해 filters 에 concat — engine 변경 0 |
| Function/UX | 같은 문서 안 slicer 가 chip 토글되면 Pivot 이 즉시 재집계 + 재렌더. multi-select 가능. empty 활성 = 'All' (필터 없음, Excel semantic) |
| Core Value | Pivot 이 인터랙티브 cross-widget 필터 위에서 동작 — 실시간 보고서 화면 구성 가능 |

## 변경

### 1) Schema — `packages/shared/schemas/document.json`

- `SlicerBlock` 신규: `{type, id, label?, field, source (oneOf inline/data-source), multiSelect?, default?, meta?}`
- `PivotTableBlock.boundSlicers?: ULID[]` 신규 — listen 할 slicer id 목록
- Block union 에 `SlicerBlock` 추가
- codegen TS/Python 갱신

### 2) Store — `apps/web/src/features/slicer/store.ts` (신규)

- `useSlicerStore` zustand store — `{active: Record<id, string[]>}`
- 액션: `setSingle` / `toggle` / `clear` / `setActive` / `getActive`
- `useSlicerActive(id)` 셀렉터 — 해당 slicer 의 활성 변경 시에만 re-render
- 빈 활성 = 'All' (Excel pivot slicer 의 'All' 상태 미러)
- 단일 선택: 같은 값 재클릭 → clear (lock-in 회피)
- 다중 선택: 토글

### 3) Viewer — `apps/web/src/components/blocks/SlicerBlock.tsx` (신규)

- inline rows 또는 data-source (PivotTableBlock 과 같은 `useQuery` key 로 캐시 공유)
- distinct values 를 first-seen 순으로 chip 노출 (null 값 skip)
- aria-pressed + data-testid (id 8자 + value)
- 활성 set 비어 있지 않으면 ✕ clear 버튼
- 상태별 메시지: loading / error / dataSourceId 미존재 / distinct 0

### 4) PivotTableBlock 통합 — `apps/web/src/components/blocks/PivotTableBlock.tsx`

- `useHydratedPivotBlock` 안에 `useSlicerStore` 구독
- `collectSlicerFilters(block, sections, active)` pure helper export:
  - boundSlicers 의 각 id → draft 에서 slicer 찾기 → active 비어있지 않으면 `{field, op:'in', value}` 출력
- `withSlicers` synthetic clone 이 `filters: [...기존, ...slicerFilters]` 로 확장
- 4 status (inline/loading/error/ready) 모두 withSlicers 사용

### 5) Editor — `SlicerBlockEditor.tsx` (신규)

- label/field text + source kind 라디오 + multiSelect 체크박스 + 미리보기
- inline / data-source 둘 다. data-source 일 때 draft 의 DataSourceBlock select
- 변경 시 patchBlock 즉시 (debounce 없음 — 작은 컨트롤)

### 6) PivotTableBlockEditor 보강

- 신규 `BoundSlicersPicker` 컴포넌트 — draft 의 모든 SlicerBlock 자동 수집 후 체크박스 multi
- CalculatedItemsPicker 다음 자리에 mount

### 7) BlockRenderer + BlockInsertPalette

- `SlicerBlockEditor` lazy import + `case 'slicer'` 분기
- viewer 에 `case 'slicer'` 추가
- palette 에 슬라이서 entry (🔘, slash `/슬라이서`)

### 8) Tests +10 신규

- `slicer/__tests__/store.test.ts` (6): initial / setSingle / toggle / clear / setActive (clone 검증) / 두 id 격리
- `PivotTableBlock.test.tsx` collectSlicerFilters 4: 빈 boundSlicers / 일부 매칭 / 미존재 id skip / 빈 active 'All' semantic

### 9) Lat — `docs/lat/documents.md`

- 신규 `SlicerBlock` 항목 — chip 그룹 + useSlicerStore + collectSlicerFilters
- PivotTable 항목에 BoundSlicersPicker 추가

## 검증

- typecheck clean
- vitest **2436 / 2436** (+10 신규). 회귀 0
- codegen 16/16 valid

## Defer / 후속

- 다른 widget (chart/table/kpi-cards) 도 boundSlicers 패턴 확장 — 본 사이클은 Pivot 한정
- Timeline (날짜 range slider) — slicer 의 sibling
- pre-/post-filter ordering — slicer 가 항상 user filters 다음 적용. 의도된 순서지만 toggle 가능하면 좋음

37 번째 블록 (Slicer) 추가 → DocumentJSON 36 → 37 block types.
