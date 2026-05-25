---
template: report
version: 1.0
feature: presentation-layout
date: 2026-05-25
---

# Presentation Layout — Completion Report

> Match Rate: 92% / Duration: ~2시간
> 7 → 5 슬라이드 (-29%), 시각 흐름 자연 ↑, audit-driven fix

## Value Delivered

| Perspective | Content |
|---|---|
| **Problem** | 사용자: "배치가 제일 거슬려" (프레젠테이션 전환 시). Playwright로 sample doc의 8 슬라이드 캡처 → 7개 거슬림 패턴 발견. 빈 슬라이드 / "(계속 5번)" 과다 / iframe 빈 박스 / 가운데 박힘 / 좌우 빈 공간 / 시각 블록 작음. |
| **Solution** | slideMachine 의 빈 nested subsection skip + BUDGET 700→1100 + solo-visual 좁힘 + (계속) 작은 chip + 시각 블록 weight 350 / Presentation CSS의 place-items, max-width 1440, 시각 블록 viewport 활용 (chart/gantt/iframe 등 width 100% + 72vh). Playwright audit script로 before/after 시각 비교. |
| **Function/UX Effect** | sample doc 슬라이드 수 **7 → 5장** (-29%). "(계속 N/M)" 큰 글씨 → 작은 chip (2/3 형태). 콘텐츠 상단 정렬로 자연 흐름. 시각 자료 (orgchart 등) viewport 가득. 청자 인지 부담 ↓. |
| **Core Value** | "문서 → 슬라이드 자동 변환의 *발표 가능 수준*" — 지금까지 거친 변환이 audit-driven 7건 fix로 정제. **다른 백서도 한 번 만들면 그대로 발표**. |

## What was Built

### Code
- `slideMachine.ts`:
  - `_blockWeight`: doc-link-card/bibliography/glossary-ref 100 / 시각 블록 350 / image류 350
  - `_isSoloVisual`: chart/gantt/whiteboard/org-chart/flow/spreadsheet/image-annotation 만 (iframe/video/gallery/pdf/kpi-cards 제외)
  - `SLIDE_BUDGET`: 700 → 1100
  - `buildSlides`: nested level 2 본문 0 → skip
- `Presentation.tsx`:
  - (계속 N/M) 텍스트 → `<span class="slide-cont-chip">` 작은 chip
  - CSS: `place-items: start center` + title slide만 `:has(.slide-title) { place-items: center }`
  - CSS: `.slide-body max-width: min(1440px, 92vw)`
  - CSS: `[data-block-type="chart/gantt/org-chart/whiteboard/flow/iframe/video/image-annotation"] width: 100%, max-height: 72vh, iframe height: 65vh`
  - CSS: `.slide-cont-chip` 스타일 (작은 chip)

### Tests
- 단위 +3 (slideMachine):
  - nested level 2 빈 subsection skip
  - body 있는 subsection 정상 emit
  - level 1 빈 section 유지 (chapter divider)
- 전체 1856/1856 통과

### Audit infra
- 임시 `_preso-audit.spec.ts` (사이클 후 삭제) — 8 슬라이드 캡처해 before/after 비교
- `/tmp/preso-audit-before/` + `/tmp/preso-audit/` 비교

## What was *Not* Built

| 항목 | 사유 |
|---|---|
| Slide 3 잔존 (subsection heading-only chunk) | follow-up 사이클 — chunk 분할 시 heading만 있는 chunk 다음과 병합 로직 |
| iframe 외부 URL 실제 로딩 | 외부 사이트 sandbox/CORS 책임 — sample doc 데이터 수정으로 우회 |
| 영구 visual regression baseline | visual-regression 사이클 (desktop만, presentation route 별도 추가) |
| presentation-mobile audit | 본 사이클은 desktop 1440x900. mobile presentation은 별도 |

## Open Items (next-cycle)

| # | 항목 |
|---|---|
| 1 | subsection heading-only chunk 다음과 병합 |
| 2 | iframe 외부 URL fallback (로딩 실패 시 placeholder) |
| 3 | presentation visual regression baseline (5 슬라이드) |
| 4 | mobile presentation audit |

## Lessons

### Audit-driven 패턴
"배치가 거슬려" → Playwright로 실제 캡처 → 7개 발견 → fix 후 재캡처 비교. **단순 grep heuristic으로 못 보던 진짜 시각 문제** 잡힘.

### BUDGET 추정의 한계
weight 추정 (글자 수 기반) ≠ 실제 화면 점유. 700 → 1100으로 ↑ + solo-visual 좁힘이 본 사이클 win. 진짜 정확한 측정은 DOM 측정 (offsetHeight) 필요하지만 그건 expensive — heuristic 보정으로 80% 해결.

### "(계속 N/M)" UX
같은 제목 5번 반복 → 큰 글씨에 섞으면 청자 인지 부담. 작은 chip + index만 (`2/3`) 이 발표 흐름 자연. 텍스트 vs 시각 단서의 위계 차이.

### audit script as throwaway
visual-regression 사이클의 baseline 시스템과 별도로 *임시 캡처 스크립트* 가 fix-cycle 안에서 큰 도움. 사이클 종료 시 삭제.

## Status

- ✅ All phases done
- ⏳ Archive
- 🎯 Next: slide 3 잔존 follow-up (사용자 우선순위 시)
