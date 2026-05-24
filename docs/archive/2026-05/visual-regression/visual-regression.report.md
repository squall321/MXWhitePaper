---
template: report
version: 1.0
feature: visual-regression
date: 2026-05-24
---

# Visual Regression — Completion Report

> Cycle: Plan → Do → Check → Report → Archive
> Match Rate: 100%

---

## 1. Executive Summary

### 1.1 Overview

| 항목 | 값 |
|---|---|
| Duration | ~35분 (예상 1h, ⌀ 42% 효율) |
| Files | spec 1 + baseline PNG 2 + lat 1 신설 + lat README index 1 줄 |
| Match Rate | **100%** |

### 1.2 Value Delivered

| Perspective | Content |
|---|---|
| **Problem** | 6 다크모드 사이클 (chart/gantt/orgchart/svg-audit/block-batch/chart-libs) 의 검증이 manual. 코드 패턴 가드는 *패턴*만 잡고 *실제 픽셀 깨짐*은 못 막음. mermaid 다이어그램 색, recharts tooltip, ECharts dispose+init, SVG var 해석 등은 manual 외 검증 불가였음. |
| **Solution** | Playwright `toHaveScreenshot()` PoC — sample 문서 (`white-paper-realtime-edit-design`) 의 light + dark 페이지 캡처 2 케이스. baseline PNG 2개 git commit. host 실행 검증 (apptainer chromium 환경 미비는 lat 명시). |
| **Function/UX Effect** | 향후 chart/mermaid/recharts 라이브러리 다크 회귀를 *코드 머지 전*에 검출. baseline 갱신 명령 1줄. 사람 시각 검수는 의도적 변경 시만. |
| **Core Value** | "다크모드 시리즈 픽셀 검증 자동화 기반" — 인프라 자산. 6 사이클의 manual 검증 부담을 자동화로 전환. 다음 사이클 (visual-regression-ci) 에서 GitHub Actions 통합. |

---

## 2. What was Built

### 2.1 신규 (4 + 1)
- `apps/web/tests/e2e/visual-darkmode.spec.ts` — PoC spec
- `apps/web/tests/e2e/visual-darkmode.spec.ts-snapshots/doc-light-chromium-desktop-linux.png` — baseline
- `apps/web/tests/e2e/visual-darkmode.spec.ts-snapshots/doc-dark-chromium-desktop-linux.png` — baseline
- `docs/lat/visual-regression.md` — 인프라 가이드
- `docs/lat/README.md` — 인덱스 1줄 추가

### 2.2 확인
- baseline 재실행 deterministic (3.x 초)
- e2e 기존 spec 회귀 0
- host 실행 검증 완료

---

## 3. What was *Not* Built

| 항목 | 사유 |
|---|---|
| CI workflow 통합 | out-of-scope §1.2. baseline 안정화 + font 결정성 후 별도 사이클 (visual-regression-ci) |
| 모든 블록 타입 spec | yagni — 1 sample 문서로 다크모드 시리즈 커버. 후속 사이클로 분리 |
| apptainer 안 chromium 실행 | libglib 누락. host 실행으로 우회 (lat 명시). 별도 컨테이너 이미지 사이클 필요 |
| mermaid id deterministic mock | maxDiffPixelRatio 0.02로 false-positive 흡수. 더 엄격해지면 별도 |
| tablet/mobile viewport baseline | baseline 폭증 위험. PoC 사이클은 desktop만 |

---

## 4. Open Items (next-cycle)

| # | 항목 |
|---|---|
| 1 | visual-regression-ci — GitHub Actions workflow + Playwright Docker image |
| 2 | spec coverage 확장 — block-type별 sample 문서 |
| 3 | mermaid id deterministic mock |
| 4 | tablet/mobile viewport baseline |
| 5 | apptainer 안 chromium 실행 (libglib 추가 이미지) |

---

## 5. Lessons

### 5.1 host vs apptainer 실행
e2e가 *live stack* (web 5173 + api 8800) 만 의존하고 *spec 실행 자체는 host* 에서 — playwright 의 chromium 의존성 (libglib, libnss 등) 이 apptainer mxwp_web 이미지에 없어 컨테이너 안 실행 실패. host pnpm 으로 직접 실행이 가장 깨끗. 이 패턴은 e2e 전체에 동일 — lat README 갱신 필요할 수도.

### 5.2 maxDiffPixelRatio 0.02 의 의미
mermaid random id + recharts ResponsiveContainer 측정 미세 차이를 흡수. 너무 낮으면 false-positive, 너무 높으면 진짜 회귀 놓침. 0.02 (2%) 가 PoC sweet spot. 안정화 후 조정.

### 5.3 PoC 사이클의 가치
인프라 사이클은 보통 "큰 작업"으로 보이지만 PoC 1 케이스로 *기반 + 가이드 + lat* 만 마련하면 ~35분. 후속 사이클이 그 위에 1 케이스씩 추가 = 점진 확장. "한 번에 다 하자" 보다 효율적.

### 5.4 6 다크모드 사이클의 회수
manual 검증 부담이 picture 1 = 1000 단어 효율로 자동화. mermaid theme 재초기화 / recharts tooltip / ECharts dispose+init / SVG var 4 카테고리 모두 한 spec으로 검증.

---

## 6. Status

- ✅ All phases done
- ⏳ Archive
- 🎯 Next: D/E/F (LOW priority items) or 다른 영역
