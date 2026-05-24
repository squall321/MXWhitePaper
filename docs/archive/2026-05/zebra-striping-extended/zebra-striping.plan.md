# Zebra Striping — Planning Document

> **Summary**: `zebra.ts` 유틸을 table/spreadsheet 외 행-기반 위젯
> (list / kpi-cards / bibliography / figure-index) 로 일관 확장. 사용자가
> 이미 익숙한 stripe 토글 UX를 그대로 가져온다. FE 단독, schema add-only.
>
> **Project**: MX White Paper
> **Feature**: zebra-striping
> **Version**: 0.1.0
> **Date**: 2026-05-24
> **Status**: Draft
> **Previous**: 없음 (zebra 유틸 자체는 widget-integrity-pass 시리즈에서 도입,
> 현재 table + spreadsheet 한정)

---

## Executive Summary

| Perspective | Content |
|---|---|
| **Problem** | zebra-striping은 table/spreadsheet에만 적용. 똑같이 행 단위로 늘어선 list(번호/체크박스 모드 ≥5행)·kpi-cards(3-col 이상 grid)·bibliography(번호 목록)·figure-index(그림/표/차트 목차)는 행이 늘면 가독성이 급락하는데도 stripe 미지원 — 사용자 입장에서 "왜 이 블록만 안 됨?" 일관성 부재. |
| **Solution** | `getZebraClass()` 시그니처를 4개 신규 blockType (list / kpi-cards / bibliography / figure-index) 로 확장 + 각 블록 뷰에 1줄씩 적용 + 옵션 토글 UI 추가. tablePresets 모델 (옵션 객체 안 `stripe?: boolean` 키, default ON, `false` 만 OFF) 그대로 재사용. 색상 토큰은 블록 종류별 의미에 맞춰 분리 (kpi=blue-050, list/bibliography/figure-index=gray-050). |
| **Function/UX Effect** | 사용자가 list/kpi/bibliography/figure-index 옵션 패널에서 "줄무늬" 체크박스를 toggle하면 즉시 반영. 긴 항목 목록(예: 참고문헌 30건, 그림 목차 40개)의 가독성이 표 수준으로 향상. 다크 모드 자동 대응 (기존 토큰 사용). |
| **Core Value** | "stripe는 행이 있는 모든 위젯에서 동일하게 동작한다" — UX 일관성 확보. zebra.ts 가 진정한 *공통 유틸*로 자리잡고 후속 행-기반 위젯 추가 시에도 1줄로 끝남. |

---

## 1. Overview

### 1.1 Purpose

zebra-striping을 *행이 늘어서는 모든 본문 블록*의 1급 기능으로 격상.
현재 table/spreadsheet에만 있어 길이가 긴 list/kpi-cards/bibliography/
figure-index는 사용자가 직접 ad-hoc CSS를 넣어야 함 — 이 마찰을
제거하고, zebra.ts를 공통 행-스타일 유틸의 단일 진실로 만든다.

### 1.2 본 사이클 대상 (4 블록)

| # | 블록 | 현재 렌더 (행 단위) | 적용 위치 |
|---|---|---|---|
| Z1 | `list` | `<ul>` 안 `<li>` (`space-y-1`) — numbered/checklist/bulleted 3종 모두 동일 | `ListBlockView` `<li>` className |
| Z2 | `kpi-cards` | `<ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4">` 안 `<li>` 카드 | `<li>` className — *행 인덱스 = Math.floor(idx / cols)* |
| Z3 | `bibliography` | `<ol>` 안 `<li>` (번호 목록) | `<li>` className |
| Z4 | `figure-index` | 종류별 그룹 (image/table/chart) `<ol>` 안 `<li>` — *런타임 DOM 스캔으로 entries 생성, dedicated editor 없음* | `<li>` className. 옵션 토글은 generic block edit 패널 (또는 새 mini-editor) 에 추가 |

### 1.3 본 사이클 *제외* (근거 명시)

| 블록 | 사유 |
|---|---|
| `gallery` | 이미지 카드 grid — 행 zebra는 시각적으로 카드 자체 디자인을 깬다 |
| `accordion` | collapsible 행, 한 번에 1~몇 개만 펼쳐짐. stripe 의미 약함 |
| `gantt` | SVG 타임라인. stripe는 별도 (행 배경) — 단독 작은 사이클 후보 |
| `org-chart` / `flow` | 그래프, 행 개념 없음 |
| `quiz` / `form` | 인터랙티브 위젯, 답 영역 zebra는 오히려 혼란 |
| `tabs` / `columns` | 컨테이너, 행이 아니라 패널 |

### 1.4 Decisions

| # | 결정 | 값 |
|---|---|---|
| 1 | 작업 방식 | 직접 순차 (4 블록 + 옵션 패널 + 테스트). 에이전트 안 씀 — pass-3·pass-4 패턴 |
| 2 | 옵션 위치 | 각 블록의 schema에 `options: { stripe?: boolean }` 추가. table/spreadsheet 패턴 그대로 |
| 3 | 기본값 | stripe = ON (`options.stripe !== false`). table/spreadsheet 와 동일 contract |
| 4 | 색상 토큰 | kpi-cards = `var(--smsg-blue-050)` (spreadsheet와 동일 — "데이터 카드" 의미), 나머지 3종 = `var(--smsg-gray-050)` (table과 동일 — "본문 목록") |
| 5 | kpi-cards 행 인덱스 | 단순 `nth-of-type(2n)` — 모든 viewport에서 ON. 사용자에겐 "한 카드 건너 한 카드 음영"으로 보임. md(4-col) 에선 행/열로 봤을 때 *체크무늬*가 되지만 카드 자체가 음영/border를 가져 가독성에 충분히 도움. ResizeObserver 분기는 yagni — Q1 결정 (design 단계 결과 단순화) |
| 6 | list 적용 조건 | 어떤 모드든 동일 (numbered/checklist/bulleted 3종). 단 *중첩(depth ≥ 1) 항목은 stripe 안 적용* — 중첩 들여쓰기와 배경이 겹치면 보기 안 좋음. depth=0 만 |
| 7 | zebra.ts 확장 | `ZebraBlockType` union에 `'list'\|'kpi-cards'\|'bibliography'\|'figure-index'` 추가. `STRIPE_CLASSES` map에 색 토큰 추가. 함수 시그니처 불변 |
| 8 | schema 변경 | document.json — list/kpi-cards/bibliography/figure-index 블록에 `options?: { stripe?: boolean }` (add-only optional). `pnpm schema:gen` 으로 TS+Pydantic 재생성 |
| 9 | 옵션 토글 UI | 공통 컴포넌트 `<ZebraToggle blockType=... options=... onChange=... />` 1개 신설 (`features/editor/blocks/ZebraToggle.tsx`). label "줄무늬". 패턴은 `SpreadsheetBlockEditor` `data-spreadsheet-stripe-toggle` 일관 — `data-zebra-toggle-{blockType}` attribute 부여. 4번 복제 대신 한 곳 — Q3 결정 (design 단계 결과: 옵션 패널 자체가 없는 블록이 3/4 라서 공통화 이점 큼) |
| 10 | export 영향 | docx/pptx export: list는 numbering 그대로, stripe는 *web 전용 시각 효과*로 한정. native shading 매핑 안 함 (yagni — 사용자가 export 시 zebra를 요구한 사례 없음). html export는 자동 적용 (className 그대로 출력) |
| 11 | 테스트 전략 | zebra.ts 단위 테스트 4 케이스 추가 (각 블록 type별 색 + OFF 동작). Editor 토글 통합 테스트 4 (각 블록당 1 — 체크박스 클릭 → onChange options.stripe 호출). 뷰 회귀 테스트 2 (list odd/even className, bibliography odd className) |
| 12 | matchRate 기준 | 90% |
| 13 | lat 갱신 | `docs/lat/documents.md` (block schema 옵션 표) 와 신규 `docs/lat/blocks-styling.md` (zebra 통합 정책) — *후자가 필요한지는 design 단계에서 판단* |
| 14 | LLM rules 갱신 | `docs/llm-widgets-via-api.md` 의 list/kpi-cards/bibliography/figure-index 섹션에 `options.stripe` 필드 1줄씩 추가 |

### 1.5 Acceptance Criteria

1. **C1**: list 블록 옵션 패널에 "줄무늬" 체크박스 노출, toggle 시 odd 행 (`<li>`, depth=0만) gray-050 배경. 중첩 행은 영향 없음.
2. **C2**: kpi-cards 블록 옵션 패널에 "줄무늬" 체크박스 노출, toggle 시 모든 viewport에서 `:nth-of-type(2n)` `<li>` blue-050 배경 (카드 단위 음영, 그리드 행 단위 아님 — 정확도보다 가독성).
3. **C3**: bibliography 블록 옵션 패널에 "줄무늬" 체크박스 노출, toggle 시 odd `<li>` gray-050.
4. **C4**: figure-index 블록 옵션 패널에 "줄무늬" 체크박스 노출, toggle 시 종류별 그룹 `<ol>` 내 odd `<li>` gray-050.
5. **C5**: 기본값은 ON (옛 문서에서 `options.stripe` 미지정 → stripe 켜진 상태로 렌더). 명시적 `false`만 OFF.
6. **C6**: `getZebraClass('list'\|'kpi-cards'\|'bibliography'\|'figure-index', ...)` 가 zebra.ts에서 동작 + 4 신규 단위 테스트.
7. **C7**: 회귀 0 — table/spreadsheet 기존 zebra 동작 / list-numbered numbering / kpi delta 색 / bibliography 링크 / figure-index 토글 등 모두 유지.
8. **C8**: 다크 모드에서도 자동 토큰 적용 (`tokens.css` 의 `--smsg-gray-050` / `--smsg-blue-050` dark 변형이 이미 있음).
9. **C9**: 신규 테스트 추가 (zebra.ts 4 + Editor 통합 4 + view 회귀 2 = **10**).
10. **C10**: lat / LLM rules 동기화.
11. **C11**: 사이클 보고서 (analysis + report) 작성 후 archive.

---

## 2. Scope & Out-of-scope

### 2.1 In-scope

- 4 블록 (list / kpi-cards / bibliography / figure-index) FE 뷰 + 에디터 토글
- zebra.ts 유틸 확장 (BlockType union + 색 map)
- document.json 스키마 4개 위치에 `options.stripe?` 추가 → schema:gen
- 단위/통합/뷰 테스트 10건
- lat documents.md + LLM widgets rules 동기화

### 2.2 Out-of-scope

- gantt zebra (별도 사이클 후보)
- gallery / accordion / quiz / form / tabs / columns (1.3 근거)
- docx/pptx native shading 매핑 (yagni)
- 색상 사용자 커스텀 (현재 토큰 고정 — 후속 사이클)
- 컬럼 수 동적 추적 (ResizeObserver) — kpi-cards는 md 이상 4-col 기준 고정

---

## 3. Risks & Mitigations

| 위험 | 영향 | 대응 |
|---|---|---|
| kpi-cards가 viewport별로 grid 컬럼 수 변함 → zebra 행이 시각적으로 안 맞음 | 사용자가 "왜 줄이 어긋남?" | sm/mobile에서는 stripe OFF (Decision #5). md 이상 4-col 기준만 적용 |
| list의 numbered/checklist 모드는 marker (1./☐) 가 왼쪽에 별도 영역 → 배경이 marker까지 칠해지는지 확인 필요 | 디자인 깨짐 | `<li>` 전체에 className 적용, marker는 `<span>`이 inline-block이므로 배경 위로 보임. 시각 확인 + snapshot 테스트 |
| 다크 모드에서 stripe 대비가 너무 약/강함 | UX 후퇴 | `tokens.css` 기존 정의 재사용 — table/spreadsheet 에서 이미 검증된 값 |
| schema:gen 후 Pydantic 검증 강화로 옛 문서 (`options` 없음) 가 깨짐 | 데이터 손실 | `options?` optional + `stripe?` optional. 기존 문서 영향 0 (이미 검증된 패턴) |
| LLM이 새 옵션을 모름 → 생성 docx에 항상 stripe 미적용 | 단순 default 동작 (= ON) | 기본값 ON이라 미지정도 정상. rules 1줄 추가는 best-effort |

---

## 4. Estimate

| 작업 | LOC | 시간 |
|---|---|---|
| schema (document.json 4곳) + `pnpm schema:gen` | ~30 | 15분 |
| zebra.ts 확장 + 단위 테스트 4 | ~40 | 20분 |
| ListBlockView className 1줄 + ListBlockEditor 토글 UI | ~40 | 20분 |
| KpiCardsBlock className (nth-of-type) + Editor 토글 | ~60 | 30분 (CSS 분기 검증) |
| BibliographyBlock className + Editor 토글 | ~30 | 15분 |
| FigureIndexBlock className + Editor 토글 | ~40 | 20분 |
| Editor 통합 테스트 4 + view 회귀 2 | ~120 | 40분 |
| lat documents.md 갱신 + LLM rules 갱신 | ~20 | 10분 |
| 회귀 확인 (table/spreadsheet/list/bibliography/figure-index 기존 테스트) + UI 시각 확인 | — | 30분 |
| **합계** | **~380** | **~3시간** |

---

## 5. Plan → Design 핸드오프

design 단계에서 추가 결정 필요:

1. **zebra.ts 시그니처 변경 방식** — 4 신규 타입을 그냥 union에 추가할지, 아니면 `STRIPE_CLASSES` 외부 주입 가능하게 일반화할지 (yagni 가능성 ↑)
2. **kpi-cards CSS 구체화** — `md:[&:nth-child(4n+3)]:bg-... md:[&:nth-child(4n+4)]:bg-...` 같은 Tailwind arbitrary selector 가 동작하는지 확인. 안 되면 styled className 별도 정의
3. **옵션 패널 UI 통합** — 4 블록의 *Editor* 가 옵션 패널 컴포넌트를 각자 갖는지, 공통 컴포넌트가 있는지 확인. 공통화 가능하면 `<ZebraToggle blockType="list" options={...} onChange={...} />` 하나로 끝남 (단 yagni 주의 — 4번 반복도 30 LOC)
4. **블록 type별 토큰 매핑** — Decision #4 의 매핑이 디자이너/사용자 선호와 일치하는지 (`spreadsheet`=blue, `kpi`=blue 동일성). 디자인 시스템 문서 (`tokens.css`) 참조

---

## 6. References

- 기존 구현: [`apps/web/src/features/editor/blocks/zebra.ts`](../../../apps/web/src/features/editor/blocks/zebra.ts)
- 기존 테스트: [`apps/web/src/features/editor/blocks/__tests__/zebra.test.ts`](../../../apps/web/src/features/editor/blocks/__tests__/zebra.test.ts)
- 기존 토글 UI 패턴: `SpreadsheetBlockEditor.tsx:202-208`
- 기존 적용 패턴: `TableBlockEditor.tsx:337-340`, `TableBlock.tsx:194`
- 스키마: `packages/shared/schemas/document.json` (ListBlock / KpiCardsBlock / BibliographyBlock / FigureIndexBlock 정의)
- lat: [`docs/lat/documents.md`](../../lat/documents.md)
- LLM rules: [`docs/llm-widgets-via-api.md`](../../llm-widgets-via-api.md)
- 토큰: `apps/web/src/styles/tokens.css` (`--smsg-gray-050`, `--smsg-blue-050`)

---

## 7. Open Questions

| # | 질문 | 결정 (design 단계 완료) |
|---|---|---|
| Q1 | kpi-cards mobile 동작? | **모든 viewport에서 `:nth-of-type(2n)`** — 카드 단위 음영. ResizeObserver 분기 yagni. (Decision #5 갱신됨) |
| Q2 | bibliography 그룹별 카운터 리셋 필요? | **N/A** — bibliography schema에 그룹 개념 없음(entries 평탄 배열, title 1개). figure-index는 그룹별 `<ol>` 이 분리되어 있어 인덱스 자동 리셋. |
| Q3 | Editor 공통화 vs 4번 복제? | **공통화** — `<ZebraToggle>` 1 컴포넌트. 옵션 패널 자체가 없는 블록이 3/4. (Decision #9 갱신됨) |
| Q4 | export 정책? | docx/pptx **stripe 무시** (FE 시각 효과). html export는 className 그대로 출력 → 자동 적용. md export는 plain — 무시. (Decision #10 그대로) |
