# Presentation Auto-Layout — Planning Document

> **Summary**: 사용자 "이상적으로 이쁘게 배치되어야 하지 않냐 + 보고 조정도 되면 좋고"
> 피드백. 그동안 모든 슬라이드가 *세로 stack* 만 — 진짜 "발표 디자인" 아님. 청크
> 분석 기반 auto-layout 휴리스틱 + 슬라이드 모드 toolbar의 layout override 둘 다 도입.
>
> **Date**: 2026-05-26

## Executive Summary

| Perspective | Content |
|---|---|
| **Problem** | presentation-layout / followups / chapter-hero 사이클들로 *틀*은 정비됐지만 *콘텐츠 배치*는 여전히 세로 stack 만. 슬라이드 같지 않음. 사용자가 `section.layout` 을 일일이 지정해야 2단/이미지좌우/풀블리드 같은 layout 사용 가능 — 대부분 안 함. |
| **Solution** | **A** chunk(=한 슬라이드 블록 배열) 분석으로 적절한 layout 자동 추천 (`pickAutoLayout`): 시각 다수 → 2단, 시각 1+텍스트 ≤5 → image-right (캡션 패턴), image+텍스트 → image-left/right (image 위치 따라). **B** 발표 모드 toolbar에 자동 토글 + layout 강제 변경 select. 세션 한정 override (저장은 별도 사이클). |
| **Function/UX Effect** | sample doc의 1.1 프로토콜 시퀀스 subsection: stack → **2단** (sequence + flow chart 좌우 자동). 사용자가 toolbar 드롭다운에서 즉시 "2단 / 이미지좌 / 풀블리드" 강제 변경 가능. autoLayout off 시 옛 동작. |
| **Core Value** | "발표 모드의 *진짜* 디자인 변화" — 사용자가 추가 작업 0으로 콘텐츠 분석 기반 자동 배치. 추가로 직접 조정도 가능. 이제 슬라이드가 *진짜 슬라이드 같음*. |

## Decisions

| # | 항목 | 결정 |
|---|---|---|
| 1 | A: 휴리스틱 위치 | `features/presentation/autoLayout.ts` (pure). slideMachine과 분리 |
| 2 | A: 룰 우선순위 | (1) 1 블록 → stack, (2) image+텍스트 → image 위치별 left/right, (3) 시각 1 + 텍스트 ≤5 → image-right, (4) 시각 ≥2 → two-col, (5) 텍스트 ≥7 + 시각 0 → two-col, (6) default stack |
| 3 | A: section.layout 명시 우선 | 사용자가 layout 지정했으면 그것 우선 (resolveLayout) — 의도 존중 |
| 4 | B: state 위치 | PresentationPage useState — 세션 한정 (저장 X). slide.key → AutoLayoutKind map |
| 5 | B: toolbar UI | 1 button (자동 on/off) + 1 select (현재 슬라이드 layout, `__clear__` 옵션 포함) |
| 6 | B-2 (저장) | **out-of-scope** — `patchBlock` BE 호출 + 권한 흐름 별도 사이클 |
| 7 | SubsectionInline 도 auto | 동일 — autoLayoutEnabled prop 전달 |
| 8 | title-only layout 처리 | 분기 그대로 (본문 hide). chapter-divider 패턴 |
| 9 | matchRate | 90% |

## AC

1. `pickAutoLayout` 6 룰 + `resolveLayout` wrapper 단위 테스트 16
2. SlideContent autoLayoutEnabled + layoutOverride prop 받음
3. SubsectionInline 도 autoLayoutEnabled 받아 동일 동작
4. PresentationToolbar 에 자동 토글 + layout select
5. sample doc 1.1 subsection 이 2단으로 자동 분할
6. 회귀 0 — vitest 1877/1877 + typecheck clean
7. visual-presentation baseline 갱신
8. lat 갱신
9. 사이클 보고서 + archive

## Estimate

| 작업 | 시간 |
|---|---|
| autoLayout.ts + 단위 16 | 30분 |
| Presentation.tsx 통합 (SlideContent + SubsectionInline + toolbar) | 40분 |
| audit 캡쳐 + 룰 fine-tune (textCount ≤3 → ≤5) | 20분 |
| visual baseline + typecheck + vitest | 10분 |
| commit + archive | 10분 |
| **합계** | **~2시간** |
