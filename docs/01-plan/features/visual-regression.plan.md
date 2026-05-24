# Visual Regression — Planning Document

> **Summary**: Playwright `toHaveScreenshot()` 기반 시각 회귀 PoC. light + dark
> 각 1 케이스로 시작 — 다크모드 시리즈 (chart/gantt/orgchart/block/chart-libs)
> 자동 검증. 인프라 사이클이라 spec 제한적, 후속 확장은 다음 사이클.
>
> **Project**: MX White Paper
> **Date**: 2026-05-24

---

## Executive Summary

| Perspective | Content |
|---|---|
| **Problem** | 6 다크모드 사이클의 검증이 manual (브라우저 토글). 회귀 가드는 *코드 패턴*만 검출 — 실제 픽셀 깨짐은 못 막음. mermaid theme 재초기화, recharts tooltip 색, ECharts dispose+init 같은 라이브러리 동작은 manual 외 검증 불가였음. |
| **Solution** | Playwright `toHaveScreenshot()` PoC — 1 spec, 2 케이스 (light + dark) — 차트가 들어있는 sample 문서 1개 페이지 캡처. CI 통합은 baseline 안정화 후 (다음 사이클). 본 사이클은 *기반 + 1 사례*. |
| **Function/UX Effect** | 다음 사이클부터 다크 라이브러리 회귀를 *코드 머지 전*에 검출. baseline 변경 시 PR에 diff 이미지 첨부로 사람 검수. mermaid/recharts/echarts/svg 모두 실 픽셀 검증. |
| **Core Value** | "다크모드 시리즈 검증 자동화 기반 마련" — 인프라 자산. 향후 모든 UI 변경에 시각 회귀 안전망. |

---

## 1. Overview

### 1.1 Scope (PoC 한정)

| # | 항목 | 작업량 |
|---|---|---|
| V1 | `tests/visual/` 디렉토리 신설 + Playwright 설정 확장 | ~10 LOC |
| V2 | sample 문서 1개의 chart/gantt/orgchart 페이지 캡처 spec — light + dark 2 케이스 | ~60 LOC |
| V3 | baseline screenshots/ 자동 생성 (첫 run) + git에 commit | — |
| V4 | docs/lat/visual-regression.md 신설 — 다음 사이클에서 case 추가하는 방법 | ~50 LOC |

### 1.2 본 사이클 *제외*

| 항목 | 사유 |
|---|---|
| CI workflow (.github/workflows) | 본 사이클은 *로컬 PoC 검증* — CI는 baseline 안정화 + 픽셀 tolerance 조정 후 |
| 모든 블록 타입 캡처 | yagni — 1 sample 문서로 chart/mermaid/gantt 커버. 나머지는 후속 |
| 픽셀 tolerance 자동 fine-tune | default 0.2 사용 (Playwright 기본) |
| docker container 안 캡처 (deterministic font) | apptainer 기반이라 host 의존성. CI 안정화 후 |

### 1.3 Decisions

| # | 결정 | 값 |
|---|---|---|
| 1 | spec 위치 | `apps/web/tests/visual/darkmode.spec.ts` (e2e와 분리 — playwright config grep으로 인식 가능) |
| 2 | baseline 디렉토리 | spec 옆 `__screenshots__/` (Playwright 기본) |
| 3 | sample 문서 | 기존 e2e 픽스처 재사용 또는 mock 문서 1개 신설 |
| 4 | dark mode 토글 | `page.addInitScript(() => document.documentElement.classList.add('dark'))` 같은 패턴 — ThemeProvider 가 mount 전 |
| 5 | tolerance | Playwright default (`maxDiffPixelRatio: 0.01`) — 안정화 후 조정 |
| 6 | baseline regen 명령 | `pnpm playwright test --update-snapshots tests/visual` 로컬 |
| 7 | font 결정성 | Pretendard Variable 사용 — host 환경 dependency. CI 안정화는 별도 |
| 8 | matchRate 기준 | 90% — PoC 사이클이라 spec 1개도 통과로 인정 |

### 1.4 Acceptance Criteria

1. **C1**: `tests/visual/darkmode.spec.ts` 신설 — light/dark 각 1 케이스
2. **C2**: baseline screenshot 생성 + git commit
3. **C3**: 재실행 시 통과 (deterministic)
4. **C4**: `lat/visual-regression.md` 신설 — 사용/확장 가이드
5. **C5**: e2e 기존 spec 회귀 0
6. **C6**: 사이클 보고서 + archive

---

## 2. Risks

| 위험 | 대응 |
|---|---|
| 다크 토글이 ThemeProvider mount 이전 적용 안 됨 | addInitScript로 mount 전 html.classList 직접 조작 |
| font rendering이 host마다 미세 다름 | 본 사이클은 단일 host 검증만 — CI font 결정성은 별도 |
| Playwright config가 visual spec을 e2e와 같이 실행 → 매번 baseline 비교 | testDir 분리 또는 별도 명령 (`playwright test tests/visual`) |
| baseline image 가 git 비대 | PNG 압축 + tolerance로 false positive 최소화 |
| mermaid가 random id 생성 → 매번 SVG 변함 | mermaid id를 deterministic 으로 override 필요 (mock 또는 spec setup) |

---

## 3. 작업 순서

1. `tests/visual/` 디렉토리 신설
2. `darkmode.spec.ts` — light/dark 페이지 캡처 2 케이스
3. 첫 실행으로 baseline 생성
4. baseline 확인 (시각 review) + git add
5. 재실행 → 통과 확인
6. `lat/visual-regression.md` 신설
7. typecheck (e2e spec은 typecheck 대상 아닐 가능성)
8. 단일 commit + archive

---

## 4. Estimate

| 작업 | LOC | 시간 |
|---|---|---|
| spec + setup | ~80 | 30분 |
| baseline 생성 + 검토 | — | 10분 |
| lat 신설 | ~50 | 15분 |
| commit + archive | — | 5분 |
| **합계** | **~130** | **~1시간** |
