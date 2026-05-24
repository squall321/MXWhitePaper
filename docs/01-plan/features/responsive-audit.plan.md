# Responsive Audit — Planning Document

> **Summary**: 데스크탑 위주 설계의 mobile/tablet 깨짐 패턴 audit. heuristic
> grep으로 5개 영역 식별, top 3 critical fix + 회귀 가드 신설.
>
> **Date**: 2026-05-24

---

## Executive Summary

| Perspective | Content |
|---|---|
| **Problem** | 다크 사이클로 색 일관성은 100% 달성. 하지만 mobile (375px) 에서 *레이아웃* 깨지는 컴포넌트 다수 잠재 — e2e `responsive.spec.ts` 가 AppShell만 검증, 블록/모달 내부 미검증. heuristic grep 결과 5개 위반 패턴. |
| **Solution** | Top 3 critical 직접 fix (ConflictMergeModal / ChartBlockEditor stats / ImageBlockEditor size picker) + 회귀 가드 테스트 (light-only `grid-cols-N` 검출 패턴 — block-darkmode-batch 패턴 재사용) + lat 1 줄로 *반응형 컨벤션* 정착. |
| **Function/UX Effect** | Mobile에서 conflict merge 가능 (현재 3-col 텍스트 깨짐) / chart 편집기 stats input 가독 / image size 5 picker 적절히 wrap. 전반 mobile UX 향상. |
| **Core Value** | "다크 일관성 다음 = 반응형 일관성" — 동일 패턴 (audit → fix → 회귀 가드). 패턴이 *반복 가능 자산* 으로 검증됨. |

---

## 1. Audit 결과

### 1.1 5개 패턴 발견

| # | 위치 | 문제 | 우선순위 |
|---|---|---|---|
| R1 | `ConflictMergeModal.tsx:387` `grid-cols-3` | mobile 3-col conflict 진단 불가능 | **HIGH** (critical) |
| R2 | `ChartBlockEditor.tsx:1238` `grid-cols-2` (stats panel) | mobile에서 2열 input 너무 좁음 | MED |
| R3 | `ImageBlockEditor.tsx:506` `grid-cols-5` (size picker) | mobile에서 5개 압축 | MED |
| R4 | `TableBlock.tsx:502` + `TableBlockEditor.tsx:327/489` `min-w-[480px]` | 작은 표도 480px 강제 — mobile 가로 스크롤 부담 | LOW (대형 표엔 OK) |
| R5 | `BlockInsertPalette.tsx:495` `grid-cols-4` | mobile에서 4-col이 좁을 수도 | LOW (이미 검토됨) |

### 1.2 본 사이클 범위 — Top 3 (R1+R2+R3)

R4: TableBlock 의도 (대형 표 가독성) 우선 — 변경하면 작은 표는 좋아지지만 큰 표가 cramped. 별도 분석 사이클로
R5: BlockInsertPalette 는 *팔레트 카드* 위주 — 별도 mobile UX 사이클

### 1.3 회귀 가드

`AllBlocksDarkmode.test.ts` 패턴 재사용 — `AllBlocksResponsive.test.ts` 신설:
- 모든 block 파일에서 `grid-cols-[N]` 사용 시 같은 className에 `sm:`/`md:` 변형 또는 `sm:grid-cols-N` 동반 검출
- allow-list: 의도적 fixed grid (예: GalleryBlock 의 grid는 자체 책임)

---

## 2. Decisions

| # | 결정 | 값 |
|---|---|---|
| 1 | R1 (Modal) fix | `grid-cols-3` → `grid-cols-1 md:grid-cols-3`. 768px 미만은 stacked 진단 |
| 2 | R2 (chart stats) fix | `grid-cols-2` → `grid-cols-1 sm:grid-cols-2`. 640px 미만 stacked |
| 3 | R3 (image size) fix | `grid-cols-5` → `grid-cols-3 sm:grid-cols-5`. 375px에 3개씩 wrap |
| 4 | 회귀 가드 | block 파일 전수 grep — light-only `grid-cols-[2-9]` 패턴 검출. allow-list (의도 예외) |
| 5 | matchRate | 90% |

---

## 3. AC

1. **R1**: ConflictMergeModal mobile (375px) 에서 1-col stacked
2. **R2**: ChartBlockEditor stats panel mobile에서 1-col stacked
3. **R3**: ImageBlockEditor size picker mobile에서 3-col wrap
4. **C4**: 회귀 가드 `AllBlocksResponsive.test.ts` 신설 — 향후 light-only grid-cols 검출
5. **C5**: 회귀 0 — vitest/typecheck 통과
6. **C6**: e2e responsive.spec.ts 회귀 0
7. **C7**: lat documents.md 반응형 컨벤션 1 줄
8. **C8**: 사이클 보고서 + archive

---

## 4. Risks

| 위험 | 대응 |
|---|---|
| AllBlocksRender snapshot 깨짐 | `-u` 갱신 (3 컴포넌트만) |
| 회귀 가드 false-positive | allow-list 빈 시작 — 발견 시 사유 명시 후 추가 |
| ConflictMergeModal mobile 동작 — 3-col 진단의 *동시 비교* 의도가 mobile에서 잃을 수도 | stacked가 *비교 가능* (스크롤로). 데스크탑 사용자에 영향 0 (md+ 그대로) |

---

## 5. Estimate

| 작업 | 시간 |
|---|---|
| 3 fix (각 1-2줄) + snapshot 갱신 | 15분 |
| 회귀 가드 신설 | 20분 |
| typecheck + vitest | 5분 |
| lat 1 줄 + commit + archive | 10분 |
| **합계** | **~50분** |
