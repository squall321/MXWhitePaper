# Presentation Layout — Planning Document

> **Summary**: 라이브 8장 audit 결과 7개 "거슬림" 패턴 발견. 통합 fix —
> 빈 슬라이드 / (계속 N/M) 과다 / iframe 빈 박스 / 레이아웃 / 시각 블록 자동 확장.
>
> **Date**: 2026-05-25

---

## Executive Summary

| Perspective | Content |
|---|---|
| **Problem** | Presentation 모드 (`/present/:slug`) 가 *작동은 하지만 거슬리는 배치 다수* — Playwright로 8 슬라이드 캡처해 시각 점검한 결과 7개 패턴 발견. 가장 심한 건 (1) 본문 없는 nested section이 *빈 슬라이드* 생성 (2) weight 추정이 보수적이라 같은 제목 "(계속 N/M)" 5번 반복 (3) iframe 콘텐츠 빈 박스 (silent fail). |
| **Solution** | 7건 통합 fix: slideMachine 의 chunk 분할 + BUDGET + (계속) 라벨 / Presentation CSS의 `place-items` 정렬 / SlideBlockRenderer 의 iframe 우회 / 시각 블록 max-height 확장. audit 스크립트 재실행으로 before/after 비교 + 단위 테스트. |
| **Function/UX Effect** | 빈 슬라이드 사라짐 / 같은 제목 반복 → 자연스럽게 묶임 / iframe 정상 표시 / 슬라이드 콘텐츠 가운데가 아닌 *위쪽 정렬* 자연 흐름 / 시각 블록 슬라이드 viewport 가득 차게. 청자 인지 부담 ↓. |
| **Core Value** | "프레젠테이션 모드를 *발표 가능한 수준*으로" — 지금까지 *문서 → 슬라이드* 전환의 자동 변환이 거칠었음. 7건 fix로 문서 한 번 만들면 *그대로 발표 가능*. |

---

## 1. Audit 결과 (Playwright 8 slides)

### 1.1 발견 7건

| # | 위치 | 증상 | 우선순위 |
|---|---|---|---|
| A1 | slideMachine `buildSlides` | nested subsection 본문 없어도 빈 슬라이드 생성 (slide 3) | HIGH |
| A2 | `SLIDE_BUDGET = 700` + `_isSoloVisual` | 시각 블록 + iframe + doc-link-card 각각 단독 → "(계속 N/M)" 5번 | HIGH |
| A3 | iframe 빈 박스 (slide 6) | sandbox/CSP/SlideBlockRenderer 영향 (조사 필요) | HIGH |
| A4 | `.slide place-items: center` | 짧은 콘텐츠가 가운데 → 하단 거대 빈 공간 | MED |
| A5 | `.slide-body max-width: 1200px` | 좌우 240px 낭비 + 콘텐츠 좌측 정렬 보임 | MED |
| A6 | chunk 분할 시 subsection.title 첫 chunk 에만 | "(계속 2/5)" 슬라이드에 컨텍스트 사라짐 | MED |
| A7 | 시각 블록 (chart h-72/orgchart) 작음 | read-mode 사이즈 그대로, 슬라이드 viewport 활용 X | LOW |

### 1.2 Audit 인프라

- `apps/web/tests/e2e/_preso-audit.spec.ts` (임시) — 8 슬라이드 캡처 spec
- `/tmp/preso-audit/slide-01.png ~ 08.png` — before baseline
- fix 후 동일 spec 재실행해 after 캡처 + 시각 diff (visual-regression 사이클의 baseline 시스템 활용 안 함 — temp)
- **사이클 종료 시 _preso-audit.spec.ts 삭제** (one-shot tool)

---

## 2. Decisions

| # | 항목 | 결정 |
|---|---|---|
| 1 | A1: 빈 chunk 처리 | `chunkBlocksForSlides` 가 빈 배열 반환 시 슬라이드 생성 X (subsection 자체 미생성). nested subsection이 본문 0이고 자식 subsection도 없으면 skip |
| 2 | A2: BUDGET 조정 | `SLIDE_BUDGET = 700` → `1100` (40% ↑). 모니터 1080p 화면 더 활용. `_blockWeight` 의 시각 블록 weight `500` → `350` (그래도 단독은 유지) |
| 3 | A2: (계속) 라벨 | "(계속 N/M)" → continuation > 0 시 작은 글씨 (h2 옆 chip), 메인 타이틀은 동일 깔끔히 |
| 4 | A2: solo-visual 완화 | doc-link-card, bibliography는 solo X — 텍스트와 함께 묶임. 진짜 solo는 chart/gantt/whiteboard/image |
| 5 | A3 iframe 조사 | SlideBlockRenderer가 iframe 그대로 통과인지 확인. height 0 가능성 / sandbox 차단 가능성 |
| 6 | A4: place-items | `place-items: center` → `place-items: start center` (가로 가운데, 세로 위쪽). 짧은 콘텐츠가 위로 정렬 — 위쪽 padding은 56px 그대로라 깔끔 |
| 7 | A5: max-width | `max-width: 1200px` → `1440px` (16:9 비율 살리고 시각 자료 공간 ↑). 텍스트 가독성 위해 inner paragraph는 max-width 자체 (~80ch) 유지 |
| 8 | A6: subsection title | chunk 분할 후에도 *첫 슬라이드만* subsection title — 이건 정상. 단 chunk가 5개로 분할되면 "(계속 4/5)" 슬라이드에 "이 그림이 무엇 설명?" 컨텍스트 사라짐. → subsection title 을 *모든 continuation 슬라이드에* heading 위 작은 텍스트로 표시 |
| 9 | A7: 시각 블록 자동 확장 | `.slide-section .prose-slide [data-block-type="chart"], [data-block-type="gantt"], [data-block-type="org-chart"], [data-block-type="whiteboard"] { width: 100%; max-height: 75vh }` — slide-body가 가득 차게 + max-height로 가로/세로 비율 맞춤. img 도 max-height: 60vh → 75vh |
| 10 | 테스트 | A1 단위 (빈 subsection skip), A2 단위 (BUDGET 적용 후 chunk 수 감소 확인), A4-A7 visual diff |
| 11 | matchRate | 90% |

---

## 3. Acceptance Criteria

1. **C1**: nested subsection 본문 0 → 슬라이드 생성 X (A1)
2. **C2**: BUDGET 1100 적용 후 audit re-cap에서 slide 5장 이하로 줄어듬 (A2)
3. **C3**: iframe 슬라이드에 실제 콘텐츠 표시 (A3)
4. **C4**: 짧은 콘텐츠도 슬라이드 상단 정렬 (A4)
5. **C5**: max-width 1440px, 시각 자료 좌우 공간 활용 (A5)
6. **C6**: continuation 슬라이드에 subsection 컨텍스트 (A6)
7. **C7**: 시각 블록 (chart/gantt/orgchart) slide-body 가득 (A7)
8. **C8**: 단위 테스트 — buildSlides 빈 subsection skip + BUDGET 1100 적용 (~3 케이스)
9. **C9**: 회귀 0 — vitest 전체 + 기존 slideMachine 테스트 통과
10. **C10**: audit spec 재실행 → 8 → ~4-5 슬라이드로 감소 + 시각 비교
11. **C11**: `_preso-audit.spec.ts` 삭제 (one-shot)
12. **C12**: lat presentation 항목 갱신 (없으면 신설)
13. **C13**: 사이클 보고서 + archive

---

## 4. Estimate

| 작업 | 시간 |
|---|---|
| A1 빈 chunk skip + 단위 테스트 | 15분 |
| A2 BUDGET 조정 + solo-visual 완화 + (계속) chip + 단위 테스트 | 30분 |
| A3 iframe 조사 + fix | 30분 |
| A4-A6 Presentation CSS 조정 + subsection title persist | 30분 |
| A7 시각 블록 viewport 확장 CSS | 10분 |
| audit re-cap + 시각 검증 | 15분 |
| 전체 vitest + typecheck | 10분 |
| lat 신설/갱신 + commit + archive | 15분 |
| **합계** | **~2.5시간** |

---

## 5. Risks

| 위험 | 대응 |
|---|---|
| BUDGET 1100으로 ↑ 후 *큰* 슬라이드가 viewport 넘침 | `.slide overflow: auto` 그대로 — 스크롤 가능. 단 발표 중 스크롤은 어색 → audit 재캡처에서 검증 |
| iframe sandbox 우회가 보안 약점 | sandbox 유지, src URL이 실제로 로드 가능한 도메인인지만 확인. CORS는 외부 사이트 책임 |
| place-items 변경으로 title slide (가운데 정렬 의도) 영향 | `.slide-title` 자체에 `place-items: center` override (title slide만) |
| max-width 1440px 으로 ↑ 후 1080p 모니터에서 좌우 여백 사라짐 | 정확히 16:9 활용 의도. 더 작은 화면 (laptop) 은 vw 단위로 자연 축소 (`max-width: min(1440px, 90vw)`) |
| subsection title persist가 너무 시끄러움 | "(계속)" chip 옆에 작은 글씨로 — heading 크기와 명확 위계 차이 |
| audit spec 삭제 깜빡 | C11에 explicit + commit에 -delete 같이 |
