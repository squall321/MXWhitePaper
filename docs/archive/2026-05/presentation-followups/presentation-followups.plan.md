# Presentation Follow-ups — Planning Document

> **Summary**: presentation-layout 사이클의 *Open Items 4건* 통합 사이클 —
> slide-3 잔존 / iframe placeholder / visual regression baseline / mobile audit.
>
> **Date**: 2026-05-25

---

## Executive Summary

| Perspective | Content |
|---|---|
| **Problem** | presentation-layout 사이클이 7→5 슬라이드 줄였으나 4개 Open Items 잔존: (1) slide-3 잠재 "에디터 파트 R&R" 소제목+빈 슬라이드 1건, (2) iframe 외부 URL silent fail → 빈 박스, (3) presentation 영구 visual regression 미설정, (4) mobile presentation 동작 미확인. |
| **Solution** | (1) `_isSoloVisual` 직전 heading-4 도 caption으로 흡수 + SubsectionInline body=0 skip. (2) IframeBlock에 4초 timeout placeholder + "새 탭" 버튼. (3) visual-presentation.spec.ts 신설 (4 baseline). (4) Playwright mobile audit → padding clamp + toolbar 충돌 해소. |
| **Function/UX Effect** | (1) sample 슬라이드 5→**4**장 (-20% 추가). (2) iframe 차단 시 친절한 안내. (3) 향후 변경 자동 검출. (4) mobile (375px) 에서도 콘텐츠 잘림 없이 자연스러운 발표 모드. |
| **Core Value** | "presentation 모드 *완성도*" — presentation-layout 의 큰 win 위에 디테일 4건 마무리. 자동 가드로 회귀 방지. |

---

## 1. Scope — 4 통합

| # | 갭 | 작업량 |
|---|---|---|
| F1 | slide-3 잔존 — `_isSoloVisual` caption 확장 + SubsectionInline skip | ~30 LOC + 단위 +2 |
| F2 | IframeBlock placeholder fallback — 4s timeout + "새 탭" | ~80 LOC + SSR 단위 +4 |
| F3 | visual-presentation.spec.ts — 4 슬라이드 baseline | ~60 LOC + 4 PNG |
| F4 | mobile presentation — padding clamp + toolbar 충돌 fix | ~10 LOC + audit 캡쳐 |

## 2. Decisions

| # | 결정 | 값 |
|---|---|---|
| 1 | F1 caption — heading-4 만? heading + paragraph 페어도? | 둘 다 — while loop 로 최대 2 블록 흡수 (소제목+한줄+시각자료 패턴) |
| 2 | F1 SubsectionInline body=0 skip — subsection 도 child=0 일 때만? | 둘 다 0 일 때만 (자식 있으면 inline 헤딩 유지) |
| 3 | F2 timeout | 4초 — 느린 사이트 false-positive 가능하지만 placeholder는 iframe 위 overlay라 실 로딩 성공 시 가려짐 |
| 4 | F2 placeholder UX | loading 상태 ("불러오는 중") + blocked 상태 ("표시할 수 없습니다 + 새 탭에서 열기") |
| 5 | F3 spec 구조 | 1 test 1 login + keyboard nav 4 capture (4 test 분리 시 login redirect race) |
| 6 | F3 baseline location | `visual-presentation.spec.ts-snapshots/` (Playwright 기본, visual-darkmode 패턴 그대로) |
| 7 | F4 padding | `max(60px, clamp(16px, 5vh, 56px)) clamp(16px, 5vw, 80px) clamp(16px, 5vh, 56px)` — padding-top은 toolbar 충돌 위해 60px 최소 보장 |
| 8 | F4 iframe height | `clamp(220px, 65vh, 720px)` (mobile 433px → ~280px) |
| 9 | matchRate | 90% |

## 3. AC

1. F1: sample 슬라이드 5→4장 + slide 3 헤딩-only 사라짐
2. F2: src-iframe SSR에 placeholder overlay + hostname + loading 메시지
3. F2: 4초 후 loaded 안 됐으면 blocked + "새 탭" 버튼
4. F3: visual-presentation baseline 4 PNG 생성, 재실행 deterministic
5. F4: mobile (375px) slide 2 콘텐츠 잘림 없음
6. F4: toolbar (top fixed) 와 제목 겹침 없음
7. 단위 +6 (F1 +2, F2 +4)
8. 회귀 0 — 1862/1862 + typecheck clean + AllBlocksRender snapshot 1 update
9. desktop visual-presentation baseline 갱신 (padding 변경 영향)
10. lat visual-regression.md 갱신
11. _preso-audit.spec.ts / _preso-mobile-audit.spec.ts 삭제
12. 사이클 보고서 + archive

## 4. Estimate

| 작업 | 시간 |
|---|---|
| F1 코드 + 단위 + audit 재캡쳐 | 30분 |
| F2 코드 + 단위 + AllBlocksRender snapshot | 30분 |
| F3 spec + baseline 생성 + deterministic 확인 | 25분 |
| F4 mobile audit + padding fix + 재캡쳐 + desktop baseline 갱신 | 25분 |
| lat + commit + archive | 15분 |
| **합계** | **~2시간** |

## 5. Risks

| 위험 | 대응 |
|---|---|
| F1 heading-4 caption이 너무 적극적 — heading 만으로 1 슬라이드 의도된 케이스 깨질 수도 | _isSoloVisual 직전이 heading 뿐일 때만 흡수 — heading 단독 슬라이드는 그 직전이 solo-visual 아니라 유지 |
| F2 4초 timeout false-positive (느린 사이트가 loaded 안 됨으로 오인) | placeholder 는 iframe 위 overlay라 실 로딩 성공 시 자동 가려짐. user는 placeholder 본 후 콘텐츠 도착 시 자연 전환 |
| F3 baseline이 font/mermaid id로 비결정적 | maxDiffPixelRatio 0.02 + 4초 settle. 처음 deterministic 검증 |
| F4 padding-top 60px 보장이 desktop에서 과한 padding 됨 | `max()` 라 desktop은 56px (clamp 상한) 가까이 — 영향 미미 |
