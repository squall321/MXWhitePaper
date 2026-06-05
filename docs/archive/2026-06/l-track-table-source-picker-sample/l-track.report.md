# l-track-table-source-picker-sample — Completion Report

## Executive Summary
| | |
| --- | --- |
| **Feature** | L 트랙 — TableBlockEditor source picker UI (L-1) + Sample 17 TableBlock source 예제 (L-2) |
| **Completion** | 2026-06-05 |
| **Match Rate** | 100% |
| **Commits** | `1846525` |

### Value Delivered

| Perspective | Outcome |
| --- | --- |
| Problem | K 트랙이 TableBlock schema 에 source/filters 를 추가했지만 editor UI 가 없어 LLM/JSON 직접 편집만 가능. sample 17 의 TableBlock 은 여전히 static rows 만 |
| Solution | (L-1) ChartSourcePanel 패턴을 재사용한 TableSourcePanel — labelField/aggregations 제외 (TableBlock 은 block.headers 가 projection). (L-2) sample 17 의 table 블록을 source.kind='inline' + filters: amount>50 으로 변환 |
| Function/UX | 일반 사용자도 GUI 로 TableBlock 의 source/data-source 연결 가능. sample 문서가 실제 동작 (drill modal, filter, slicer 연동) 을 즉시 시연 |
| Core Value | 4/4 widget × 4/4 capability matrix = **16/16 cell 100% 완성**. cross-widget filter 마지막 UI 갭 해소 |

## (L-1) TableSourcePanel

### 변경 파일
- `apps/web/src/features/editor/blocks/TableBlockEditor.tsx`
  - import: `useMemo` 추가 (line 1)
  - 호출 위치: flat (line ~459) + sparse (line ~659) 두 분기 return 모두에서 BoundSlicersPicker 위에 노출
  - panel 정의: file 끝 (line 998 ~)

### UI 요소
- Source kind 라디오: `none` / `inline` / `data-source`
- DataSourceBlock picker `<select>` (kind='data-source' 일 때만)
- inline rows 의 첫 행 key 를 datalist 자동완성 힌트로 노출

### 의도적 제외
- `labelField` 입력 — TableBlock 은 viewer 가 raw rows 를 `block.headers` 컬럼명으로 projection 하므로 별도 입력 불필요
- `aggregations[]` 입력 — TableBlock 은 집계 widget 이 아님
- `filters[]` 편집 UI — 본 사이클 범위 밖 (JSON 직접 편집 가능, 미래 cycle 에서 row repeater)

### apply/push/schedule 패턴
기존 `schedule(next)` debounce (800ms idle → patchBlock) 그대로 사용. ChartBlockEditor 와 동일 패턴.

## (L-2) Sample 17 의 TableBlock 변환

### 변경 (`packages/shared/samples/17-cross-widget-filter.json`)
- `block.rows`: `[["Sales", "2026-01-15", "120"], ...]` (8 정적 행) → `[["IGNORED — source overrides", "IGNORED", "0"]]` (명시적 placeholder, source 가 덮어쓰는 동작 시각 증빙)
- `block.source`: pivot/kpi/slicer/timeline 과 같은 8 행 inline 데이터 추가 (같은 데이터 공유)
- `block.filters`: `[{field: 'amount', op: 'gt', value: 50}]` — HR 의 30/40 행이 제외됨을 데모
- `block.boundSlicers`: 유지 (slicer + timeline ids)
- callout 블록의 text 갱신 — ★ TableBlock 도 source 가 row 를 덮고 drill modal 이 hidden 컬럼까지 표시한다는 안내

### Sample 의 데모 시나리오
1. 슬라이서 / 타임라인 조작 → Pivot + Table + KpiCards 동시 재계산
2. Table 의 행 클릭 → TableDrillModal 이 그 source row 의 전체 컬럼 표시 (현재 sample 의 rows 는 모두 dept/date/amount 만 — 미래 cycle 에서 hidden 컬럼 행 추가 가능)
3. filters: amount>50 이 HR 행 (30, 40) 을 silently drop

## 검증
- vitest **2483/2483 pass** (회귀 0 — TableBlockEditor 테스트는 source 변경 없이 그대로 통과)
- typecheck clean
- ajv samples **17/17 valid**
- chunker `--check` exit 0

## 핵심 설계 결정

### 1. ChartSourcePanel 시그니처를 그대로 클론하지 않고 *적합한 부분만 선택*
ChartSourcePanel 의 `labelField` / `aggregations` 는 chart 의 시리즈 구조에만 의미. Table 은 block.headers 가 column projection 을 책임지므로 그 입력 자체가 없음. shared helper 로 추출하지 않고 각각 별도 컴포넌트 유지 (사용자 룰 — 단일 사용처 abstraction 금지).

### 2. flat + sparse 두 분기 모두에 panel 노출
sparse mode 에서 source 가 silently 무시되지만 (K 의 설계 결정), editor 에서는 source 입력을 허용. 사용자가 sparse → flat 전환 시 source 가 활성화되는 흐름을 매끄럽게 함.

### 3. `IGNORED — source overrides` placeholder
JSON 에 comment 가 없으므로 rows 의 값 자체를 명시적 placeholder 로. sample 을 읽는 LLM 이 "source 가 rows 를 override 한다" 는 사실을 즉시 인지.

### 4. filters: amount>50 데모 추가
schema 만으로는 의미가 추상적. 실제 row 가 제외되는 시나리오를 sample 에 포함 — viewer 가 8 → 6 rows 로 줄어드는 즉시 관찰 가능.

## 잔여 defer (L 이후)

| 항목 | 크기 |
|---|---|
| TableBlock filters[] editor UI (row repeater) | S |
| Sample 17 에 *hidden 컬럼* 이 있는 source row 추가 (drill modal 의 amber 배지 데모) | XS |
| Pie/Radar/Scatter drill (J defer 잔여) | M |
| Drill modal CSV export (4 modal 일괄) | S |
| ja/zh i18n 번들 | S |
| PyInstaller hidden import 수정 | M |

## 누적 (G+H+I+J+K+L)

| Cycle | Commit | 핵심 |
|---|---|---|
| G1 | a8e7d68 | Pivot DataSource ref |
| G2 | 9d1d673 | SlicerBlock + boundSlicers |
| G3 | f45c5b8 | viewer 가이드 (한) |
| G4 | b069cfe + 35a59cf | defer quad |
| H0+H1 | 1c6d6e2 | stale + hydration + i18n + sample |
| H2 | 6855285 | Chart boundSlicers + aggregator |
| H archive | 7831e79 | |
| I (a+b) | bfb7652 | Chart editor + KpiCards boundSlicers |
| I archive | a19ce8b | |
| J | 6722387 | Chart drill modal |
| J archive | 4b49ff6 | |
| K | 58f723c | TableBlock source + Table/Kpi drill |
| K archive | cbeb3fd | |
| **L** | **1846525** | TableBlock source picker UI + Sample 17 |

## cross-widget filter 완성도 (L 시점)

| Widget | source ref | boundSlicers | editor UI | drill modal |
|---|:---:|:---:|:---:|:---:|
| PivotTable | ✓ G1 | ✓ G2 | ✓ G1/G2 | ✓ |
| Table | ✓ G4 + K | ✓ G4 | **✓ L-1** | ✓ K-1 |
| Chart | ✓ H2 | ✓ H2 | ✓ I-a | ✓ J |
| KpiCards | ✓ I-b | ✓ I-b | ✓ I-b | ✓ K-2 |

**🟢 16/16 cell 100% 완성** (Table editor 의 source picker 까지 — L 트랙으로 마무리).
