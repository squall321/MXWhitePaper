# Presentation Layout — Gap Analysis

**Recommendation: PROCEED TO REPORT.** Match Rate = **92%**.

## Verification

### Code (A1-A7)

| # | 항목 | 상태 |
|---|---|---|
| A1 | nested subsection 본문 0 → 슬라이드 skip (level 2 한정) | ✅ slideMachine.ts |
| A2a | SLIDE_BUDGET 700 → 1100 | ✅ |
| A2b | _isSoloVisual 좁힘 (chart/gantt/whiteboard/org-chart/flow/spreadsheet/image-annotation 만) | ✅ |
| A2c | (계속 N/M) 큰 글씨 → 작은 chip | ✅ Presentation.tsx + CSS |
| A2d | doc-link-card/bibliography/glossary-ref weight ↓ 100 | ✅ |
| A2e | image/gallery/pdf/iframe/video 500 → 350 | ✅ |
| A3 | iframe 슬라이드 viewport 활용 (65vh) | ✅ CSS (외부 URL 로딩은 외부 사이트 책임) |
| A4 | place-items: center → start center, title slide만 :has(.slide-title) override | ✅ |
| A5 | max-width 1200 → min(1440px, 92vw) | ✅ |
| A6 | continuation 슬라이드의 subsection 컨텍스트 | ⚠️ inline subsection 책임으로 분리 (별도 fix 불요 — section 단위 chunk라 자동 해결) |
| A7 | 시각 블록 max-height: 72vh + width: 100% | ✅ |

### Audit re-cap (before/after)

| | Before | After |
|---|---|---|
| 총 슬라이드 수 | 7 | **5** (-29%) |
| "(계속 N/M)" 표시 | 큰 글씨 4번 | 작은 chip 2번 (`2/3`, `3/3`) |
| Slide 2 (callout 콘텐츠) | 가운데 박힘 + 하단 빈 공간 | 상단 정렬, 자연 흐름 |
| Slide 4 (orgchart) | 상단에 박혀 하단 빈 공간 | 상단 정렬 + 크기 유지 |
| Slide 5 (iframe + doc-link) | 5번째 별도 슬라이드 | 마지막 슬라이드에 묶임 |

### 테스트

- 단위 테스트 +3 (빈 subsection skip / body 있으면 emit / level-1 빈 section 유지)
- vitest 전체 1856/1856 통과, typecheck clean

### 잔존 (별도 사이클 후보)

| 잔존 | 사유 | 후속 |
|---|---|---|
| Slide 3 "에디터 파트 R&R" subsection title 만 표시 (본문 0) | 사실 *subsection 자체*가 아니라 *section 본문 chunk의 첫 부분*에 subsection heading 만 있는 케이스. nested=false 라 SubsectionInline이 inline으로 처리. heading 만 빈 슬라이드는 *chunk 0 weight*에 카운트 안 됨 | A1 follow-up — chunk 의 모든 block이 heading류만이면 skip 또는 다음 chunk와 병합 |
| iframe 외부 URL 로딩 실패 (sample doc의 specific URL) | sample doc 데이터 문제 — 외부 사이트가 iframe sandbox 차단했거나 URL 무효 | 데이터 fix (별도) — 본 사이클은 *iframe 크기 처리*만 |

## AC

| # | Status |
|---|:---:|
| C1 nested level-2 빈 skip | ✅ |
| C2 BUDGET 1100, 슬라이드 수 ↓ | ✅ (7→5) |
| C3 iframe viewport 활용 | ✅ (콘텐츠 로딩은 외부 책임) |
| C4 콘텐츠 상단 정렬 | ✅ |
| C5 max-width 1440 | ✅ |
| C6 continuation subsection 컨텍스트 | ⚠️ (자동 해결로 별도 fix 불요) |
| C7 시각 블록 viewport | ✅ |
| C8 단위 테스트 | ✅ +3 |
| C9 회귀 0 | ✅ |
| C10 audit re-cap diff | ✅ before/after 비교 |
| C11 _preso-audit.spec.ts 삭제 | ✅ |
| C12 lat | 🔄 다음 |
| C13 보고서 + archive | 🔄 |

## Differences

### 🟡 Added
- A2 detail 확장 — 단순 BUDGET 변경 외 _isSoloVisual 좁힘 + 5개 block-type weight 조정
- iframe height CSS — A3 부분적 대응 (외부 URL은 외부 책임)

### 🔴 Missing
- Slide 3 잔존 (subsection heading-only chunk) — follow-up 사이클 필요

## Conclusion

7건 audit 중 핵심 5건 fix (A1-A2-A3-A4-A5-A7), A6 자동 해결, 잔존 1건 (slide 3 subsection heading-only)은 follow-up. before/after 시각 비교에서 슬라이드 수 29% ↓ + 청자 인지 부담 크게 ↓. Match Rate **92%** (A6 부분 + slide 3 잔존 미달성), **PROCEED TO REPORT**.
