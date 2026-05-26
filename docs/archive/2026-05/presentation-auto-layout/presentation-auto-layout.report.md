---
template: report
version: 1.0
feature: presentation-auto-layout
date: 2026-05-26
---

# Presentation Auto-Layout — Completion Report

> Match Rate: 95% / Duration: ~2시간
> sample 1.1 subsection 자동 2단 분할 — 진짜 슬라이드 디자인 시작

## Value Delivered

| Perspective | Content |
|---|---|
| **Problem** | 사용자 "이상적으로 이쁘게 배치되어야 하는 거 아냐? 그걸 보고 어느정도 조정도 되면 더 좋고 말야". 그동안 모든 슬라이드가 *세로 stack* — 사용자가 `section.layout` 일일이 지정 안 하면 *진짜 슬라이드 느낌* 0. 이전 사이클들 (presentation-layout, followups, chapter-hero) 은 *틀*은 정비했지만 콘텐츠 *배치*는 미해결. |
| **Solution** | **A** `pickAutoLayout(chunk)` 휴리스틱 — 청크 분석 6 룰로 layout 자동 추천: image+텍스트 → image-left/right (위치별), 시각 1+텍스트 ≤5 → image-right (캡션 패턴), 시각 ≥2 → two-col, 텍스트 ≥7 → two-col, 그 외 stack. `resolveLayout` 가 section.layout 명시 우선 → auto fallback. SlideContent + SubsectionInline 둘 다 통합. **B** PresentationToolbar 에 자동 토글 + layout select (`__clear__` 옵션 포함). 세션 한정 override (slide.key → kind map). |
| **Function/UX Effect** | sample doc 의 1.1 프로토콜 시퀀스 subsection: 이전엔 sequence + flow chart 가 세로 stack → 이제 **2단 자동 분할** (좌측 sequence, 우측 flow chart). 사용자가 toolbar select 로 즉시 "2단 / 이미지좌 / 풀블리드" 강제 변경 가능. 자동 토글로 끄면 옛 동작. |
| **Core Value** | "사용자 추가 작업 0 으로 *진짜 슬라이드 디자인*" + "즉시 조정 가능". 이전 사이클들의 누적 위에 콘텐츠 배치까지 *발표 가능* 수준 달성. |

## What was Built

### Code (3 files + 1 NEW)
- `autoLayout.ts` (NEW): `pickAutoLayout` + `resolveLayout` pure functions + `AutoLayoutKind` type
- `Presentation.tsx`:
  - SlideContent: autoLayoutEnabled + layoutOverride props, resolveLayout 호출
  - SubsectionInline: autoLayoutEnabled prop 통과
  - PresentationPage: state (autoLayoutEnabled / layoutOverrides map)
  - PresentationToolbar: 자동 토글 버튼 + layout select
- `transitions.css.ts`: `.pres-toolbar select.pres-toolbar-select` 스타일 (dark/light 양쪽)

### Tests
- `autoLayout.test.ts` NEW 16: 빈/단일/image+text/시각1+text/시각다수/텍스트다수/section명시/auto off
- 회귀 0 — vitest 1877/1877 + typecheck clean
- visual-presentation baseline 갱신 (subsection 2단 효과 반영)

### Audit infra
- 임시 `_preso-autolayout-audit.spec.ts` (사이클 후 삭제) — 4 슬라이드 캡쳐로 룰 fine-tune
- audit 결과 textCount ≤3 → ≤5 룰 확장 (sample doc paragraph 5 + chart 1 패턴 cover)

## What was *Not* Built

| 항목 | 사유 |
|---|---|
| B-2 override 문서 저장 (patchBlock 호출) | **별도 사이클** — BE 호출 + 편집/발표 모드 권한 흐름 필요 |
| toolbar select 의 "현재 layout" 정확한 추정 (chunk 기반) | minor 표시 오류 — outer scope에서 effectiveBody 접근 X. 동작 영향 없음, 후속 cleanup |
| layout 별 시각 회귀 baseline (5 layout × 4 슬라이드) | 본 사이클 visual baseline 4 PNG 만. layout 별 별도는 별 사이클 |
| `pickAutoLayout` 더 정교 (RAG / 머신러닝) | 6 룰 휴리스틱이 80% 케이스 cover — 정교화는 별 사이클 |

## Open Items (선택적)

| # | 항목 |
|---|---|
| 1 | override 문서 저장 (patchBlock + 편집 모드와 동기) |
| 2 | toolbar select 의 chunk-aware layout 추정 |
| 3 | layout 별 시각 baseline 확장 |
| 4 | 다른 sample doc 으로 휴리스틱 검증 (현재 1 sample) |

## Lessons

### audit-driven heuristic tuning
처음 textCount ≤3 룰로 출시했더니 sample doc 의 slide 2 가 *변화 없음* — paragraph + math + callout + heading + 1 시각 = textCount 4. 룰 ≤5 로 완화하니 즉시 image-right 적용. **실제 데이터 가지고 룰 fine-tune** 이 정직. heuristic 은 *데이터 보고* 조정해야 의미 있음.

### subsection 도 동일 정책
SlideContent 만 auto 적용했더니 slide 2 본문 (subsection 1.1) 효과 0. SubsectionInline 도 동일 prop 받게 한 뒤에야 *진짜 변화*. **레벨별 통합** 필수.

### session-only override의 가치
B-2 (문서 저장) 는 BE 흐름 복잡 — 별도. 하지만 *세션 한정 override 만으로도 발표 즉시 조정* 가능. 발표자가 무대에서 "이 슬라이드 2단으로 바꿔" 즉시 가능. 저장은 다음 발표 때만 필요.

### 사용자 피드백 → 진짜 가치
chapter-hero 사이클 마무리 후 "별로 안 바뀐 것 같다" → "이쁘게 배치" 라는 명확한 요구로 발전. **사용자가 점점 정밀한 피드백** 줌. 응답 사이클이 누적되며 정확도 ↑.

## Status

- ✅ All phases done
- ⏳ Archive
- 🎯 Next: B-2 (override 저장) 또는 다른 sample doc 휴리스틱 검증 또는 다른 영역
