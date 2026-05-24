# Gantt Zebra — Planning Document

> **Summary**: zebra-striping-extended 의 7번째 블록 — GanttBlock 의 task row에
> `<rect>` 1줄 추가로 zebra 배경. SVG 한 장에 그려지는 단일 컴포넌트라
> CSS 분기 없이 끝.
>
> **Project**: MX White Paper
> **Feature**: gantt-zebra
> **Version**: 0.1.0
> **Date**: 2026-05-24
> **Status**: Draft
> **Previous**: zebra-striping-extended (`docs/archive/2026-05/zebra-striping-extended/`)

---

## Executive Summary

| Perspective | Content |
|---|---|
| **Problem** | Gantt 차트는 task 가 10개 이상이면 어느 행을 보고 있는지 시각 흐름이 끊긴다. zebra-striping-extended 가 6 위젯에 stripe를 도입했지만 gantt는 SVG 단일 컴포넌트라 별도 사이클로 분리됨. 그 단일 블록 미적용 = "거의 다 됐는데 하나 빠짐" UX 결손. |
| **Solution** | `GanttBlockView` SVG 안에 task row 단위 `<rect>` 1줄을 axis line 앞·막대 뒤에 삽입 (z-order 정확). `getZebraClass()` 는 className 반환이라 SVG 와 mismatch — `STRIPE_COLORS` map (hex) 을 zebra.ts 에 추가하거나 그냥 `'#F9FAFB'` (= gray-50) 하드코딩 1줄. 새 옵션은 schema의 `options.stripe?` add-only. |
| **Function/UX Effect** | task 가 5개 이상인 gantt에서 행 구분이 즉시 명확해짐. 다크모드 대응은 *별도* (gantt는 현재 다크모드 자체 미지원 — `fill="#1A1A1A"` 등 하드코딩). 본 사이클은 light mode 한정. |
| **Core Value** | "zebra가 row-based widget 7/7에 일관" — UX 일관성 100%. 향후 row-widget 추가시 1-2줄로 끝나는 패턴 검증 완료. |

---

## 1. Overview

### 1.1 Purpose

GanttBlock 행 가독성 강화 + zebra-striping-extended 사이클이 의도적으로 미룬
"SVG 블록 zebra" 부분을 닫음.

### 1.2 본 사이클 처리 갭 (1건)

| # | 갭 | 출처 | 작업량 |
|---|---|---|---|
| Z1 | GanttBlock 의 task row 단위 zebra-striping (SVG `<rect>`) | zebra-striping-extended cycle out-of-scope | ~80 LOC + tests |

### 1.3 본 사이클 *제외* (근거)

| 항목 | 사유 |
|---|---|
| Gantt 다크 모드 대응 | gantt 자체가 light-mode 하드코딩 (`fill="#1A1A1A"`) — 별도 사이클 |
| 다른 SVG 블록 (org-chart, flow) | row 개념 약함 — zebra 의미 부족 |
| zebra 색 사용자 커스텀 | zebra-striping-extended 의 next-cycle 후보, 별도 |
| Gantt task drag UX (G1) | gantt-audit MED, 별도 단독 사이클 |
| Gantt today marker (G4) | gantt-audit LOW, 별도 작은 사이클 |

### 1.4 Decisions

| # | 결정 | 값 |
|---|---|---|
| 1 | 작업 방식 | 직접 순차 (단일 컴포넌트 + editor 토글 + 테스트). 에이전트 안 씀 — pass-3·pass-4·zebra-striping-extended 패턴 |
| 2 | 옵션 위치 | GanttBlock schema에 `options: { stripe?: boolean }` 추가. 6개 기존 블록 패턴 그대로 |
| 3 | 기본값 | stripe = ON (`options.stripe !== false`). zebra-striping-extended 와 동일 contract |
| 4 | 색상 | `'#F9FAFB'` (= Tailwind `bg-gray-50` hex 등가). SVG `<rect fill>` 직접 — `getZebraClass()` 는 className 반환이라 SVG에 부적합. **결정 근거**: zebra.ts 일반화 vs. 하드코딩 — 본 사이클은 *하드코딩*. 추후 또 SVG 블록이 zebra를 받으면 그때 `STRIPE_HEX` map 추가 (yagni) |
| 5 | z-order | task row `<rect>` 는 ① axis line 보다 *뒤*, ② task 막대 (`<rect fill="#2E5BFF">`) 보다 *뒤*. SVG 는 그리는 순서가 z-order → zebra rect 를 `tasks.map` *앞*에 별도 `tasks.map` 으로 추가 (paint 순서 보장) |
| 6 | 행 인덱스 기준 | `idx % 2 === 1` (zebra-striping-extended와 동일). 첫 데이터 행(idx=0)은 깨끗 |
| 7 | rect 좌표 | x=0 (labelW 포함, label까지 음영), y=`idx * rowH`, width=totalW, height=rowH. label 영역까지 음영 들어가야 행 단위가 명확 |
| 8 | 옵션 토글 UI | `<ZebraToggle blockType="gantt" ... />` 공통 컴포넌트 재사용. `ZebraBlockType` union에 `'gantt'` 추가 + `STRIPE_CLASSES` 에 `gantt: 'bg-gray-50'` (사용은 안 하지만 type 완전성 위해 — 또는 zebra.ts 의 union 만 확장하고 map 생략 옵션 검토). **결정**: union+map 둘 다 추가, ZebraToggle 도 별 변경 없이 동작 (className 사용 안 해도 무방) |
| 9 | schema 변경 | document.json — GanttBlock 에 `options?: { stripe?: boolean }` (add-only optional). `pnpm schema:gen` 으로 TS+Pydantic 재생성 |
| 10 | 테스트 전략 | View 회귀 테스트 2 (default ON 시 zebra `<rect>` n/2 개, stripe=false 시 0개). zebra.ts 단위 테스트 1 (gantt blockType). Editor 통합 테스트 1 (토글 노출). 합계 4건 |
| 11 | matchRate 기준 | 90% |
| 12 | lat 갱신 | `docs/lat/documents.md` (GanttBlock 항목에 stripe 한 줄, zebra Gotcha 표 7-종으로 갱신) |
| 13 | LLM rules 갱신 | `docs/llm-widgets-via-api.md` §3.11 gantt 섹션에 `options.stripe` 1줄 |

### 1.5 Acceptance Criteria

1. **C1**: Gantt 블록 옵션 패널에 "줄무늬" 체크박스 노출
2. **C2**: 토글 ON 시 task row 단위로 `<rect fill="#F9FAFB">` 가 odd 행에 삽입됨 (label 영역 포함 totalW)
3. **C3**: 토글 OFF 시 zebra `<rect>` 0개
4. **C4**: 기본값 ON — 옛 문서 (`options` 없음) 도 stripe 적용
5. **C5**: z-order 올바름 — zebra rect 는 axis line 과 task 막대 *뒤*에 (시각 검증)
6. **C6**: `getZebraClass('gantt', ...)` 가 zebra.ts에서 동작 + 단위 테스트 1
7. **C7**: 회귀 0 — 기존 task 막대 / progress overlay / name text / axis line 모두 그대로
8. **C8**: 신규 테스트 4건 (zebra.ts 1 + view 2 + editor 1)
9. **C9**: lat + LLM rules 동기화
10. **C10**: 사이클 보고서 (analysis + report) 작성 후 archive

---

## 2. Scope & Out-of-scope

### 2.1 In-scope

- `GanttBlockView` SVG zebra `<rect>` 삽입
- `GanttBlockEditor` 토글 UI (`<ZebraToggle>` 1줄)
- `zebra.ts` ZebraBlockType union에 'gantt' 추가 (+ `STRIPE_CLASSES` map)
- `document.json` `GanttBlock` 에 `options.stripe?` add-only optional
- 테스트 4건
- lat + LLM rules 1줄씩

### 2.2 Out-of-scope

- 다크 모드 (gantt 자체가 light-mode 하드코딩)
- 색 커스텀 (별도 사이클 후보)
- 다른 SVG 블록 zebra (row 개념 약함)
- gantt UX 개선 (drag, today marker, dependencies — 별도)
- docx/pptx export 매핑 (Gantt는 export 자체가 단순 placeholder)

---

## 3. Risks & Mitigations

| 위험 | 영향 | 대응 |
|---|---|---|
| SVG paint 순서 잘못 — zebra가 task 막대 위에 그려져 막대를 가림 | 가시성 손실 | Decision #5 — zebra rect 를 별도 `tasks.map` *앞에* 그림 (axis line 보다도 앞이라 axis line 도 가리지 않음 — axis는 *zebra 후*에 그려야 함). View 코드 순서: zebra rect → axis line → task g |
| label 영역까지 음영 ON 시 text 가독성 저하 | 텍스트 불명확 | `fill="#1A1A1A"` (검정 가까운 dark) vs `fill="#F9FAFB"` (거의 흰색) — 충분한 contrast, AA 통과 |
| pnpm schema:gen 후 옛 문서 (`options` 없음) 깨짐 | 데이터 fetch 실패 | `options?` optional + `additionalProperties: false` 안에서 `stripe?` optional — 기존 6 블록 검증된 패턴 |
| ZebraToggle 의 `STRIPE_CLASSES` 가 SVG에서 unused — TS exhaustive 검증 무력화 | 후속 변경 시 발견 어려움 | map에 `gantt: 'bg-gray-50'` 더미 입력 (className 자체는 미사용). 향후 SVG zebra 가 늘면 그때 `STRIPE_HEX` 별도 map |
| 색상 hex `#F9FAFB` 가 `bg-gray-50` 토큰과 미세 다름 | 시각 불일치 | Tailwind `gray-50` = `oklch(0.985 0.002 247.84)` ≈ `#F9FAFB`. 1단위 차이는 시각적 감지 불가. 정확한 동기화 원하면 `tokens.css` 의 CSS 변수를 SVG `<use>` 로 참조 가능하나 yagni |

---

## 4. Estimate

| 작업 | LOC | 시간 |
|---|---|---|
| schema (document.json 1곳) + `pnpm schema:gen` | ~15 | 5분 |
| zebra.ts union+map 1줄씩 + 단위 테스트 1 | ~10 | 5분 |
| GanttBlock.tsx — zebra rect 삽입 + z-order 보장 | ~15 | 15분 |
| GanttBlockEditor.tsx — `<ZebraToggle>` 1줄 + persist options | ~15 | 10분 |
| view 회귀 테스트 2 | ~40 | 20분 |
| editor 통합 테스트 1 | ~20 | 10분 |
| lat documents.md + LLM widgets rules 갱신 | ~10 | 5분 |
| 회귀 확인 (전체 vitest + typecheck) + UI 시각 확인 | — | 20분 |
| **합계** | **~125** | **~1.5시간** |

---

## 5. Plan → Design 핸드오프

design 단계에서 추가 결정 필요:

1. **GanttBlockEditor 의 옵션 토글 위치** — 현재 editor 의 toolbar 구조 확인 후 결정 (header row vs separate row). 기존 6 블록은 다 다른 위치에 둠
2. **zebra rect의 y 좌표** — `idx * rowH + 8 - 4` (task bar y - 4) 인지 `idx * rowH` (행 전체) 인지 — design 단계에서 시각 확인 후 결정. Plan은 "행 전체" 권장
3. **SVG `<defs>` 로 색 상수 추출**? — yagni 가능성 ↑. 한 줄에 두 번 쓰일 정도면 직접 인라인이 더 읽기 쉬움

---

## 6. References

- 직전 사이클: `docs/archive/2026-05/zebra-striping-extended/zebra-striping.report.md`
- 공통 유틸: `apps/web/src/features/editor/blocks/zebra.ts`
- 공통 UI: `apps/web/src/features/editor/blocks/ZebraToggle.tsx`
- 대상: `apps/web/src/components/blocks/GanttBlock.tsx` (66 LOC)
- 에디터: `apps/web/src/features/editor/blocks/GanttBlockEditor.tsx` (200 LOC)
- 스키마: `packages/shared/schemas/document.json` (GanttBlock 660-682)
- gantt-audit: `docs/03-analysis/gantt-audit.md` (zebra 미언급 — 본 작업이 음영 측면 첫 사이클)

---

## 7. Open Questions

| # | 질문 | 결정 시점 |
|---|---|---|
| Q1 | label 영역까지 zebra 칠하기 vs. bar area만? | design 단계 (Plan은 "전체" 권장 — 행 단위 시각이 명확하므로) |
| Q2 | `STRIPE_HEX` map 신설 vs. View 컴포넌트 인라인 hex? | design 단계 (yagni 우선) |
| Q3 | docx export marker에 stripe 정보 포함? | sign-off — 본 사이클 default NO (Out-of-scope §2.2) |
