---
template: report
version: 1.0
feature: block-darkmode-batch
date: 2026-05-24
---

# Block Darkmode Batch — Completion Report

> Cycle: Plan → Do → Check → Report → Archive
> Match Rate: 100%

---

## 1. Executive Summary

### 1.1 Overview

| 항목 | 값 |
|---|---|
| Duration | ~1.5시간 (예상 1.5h, ⌀ 동일) |
| Files | 27 changed |
| Tests | +1 회귀 가드 (2 cases) + 20 snapshots updated |
| Match Rate | **100%** |

### 1.2 Value Delivered

| Perspective | Content |
|---|---|
| **Problem** | svg-block-audit가 SVG만 봤음 → 다른 블록 (`bg-white`/`border-gray-200`/`text-gray-*`) 다크 미대응 잔존 26+ 파일. 위젯 다크 일관성 미완. |
| **Solution** | 26 파일 → 27 파일 (paragraph divider 가드가 추가 발견) Tailwind `dark:` 변형 일괄 적용. **회귀 가드 테스트** 신설 — 신규 블록이 light-only 패턴 추가하면 CI 빨강. 의도 예외 (Code/Whiteboard) allow-list 명시. |
| **Function/UX Effect** | 다크 테마에서 *모든* 블록 표면 어두운 surface로 자연스럽게 inversion. 위젯 다크 일관성 100% 달성. 향후 신규 블록 추가 시 회귀 가드가 자동 검출. |
| **Core Value** | "위젯 다크 일관성 100% + 회귀 자동 방지" — 단순 cleanup 이상의 **시스템화**. 이제 다크 모드는 코드리뷰가 아닌 CI가 책임. |

---

## 2. Cycle Timeline

| Phase | 결과 |
|---|---|
| Plan | 26 파일 audit, 색 매핑 표준 명시 |
| Design | 생략 (plan 디테일 충분) |
| Do | 27 파일 직접 처리 (~1h) + 회귀 가드 신설 + ParagraphBlock 추가 발견·수정 |
| Check | 직접 작성, 100% Match Rate (회귀 가드가 plan을 over-spec'd) |
| Report | 본 문서 |

---

## 3. What was Built

### 3.1 신규 (1)
- `AllBlocksDarkmode.test.ts` — 회귀 가드 (2 cases — light-only 검출 + allow-list 검증)

### 3.2 편집 (27)
- 24 blocks: Accordion, Calculator, Callout, DashboardEmbed, DataSource, DocLinkCard, FigureIndex, File, Flow, Form, Gallery, GlossaryRef, Iframe, ImageAnnotation, Image, KpiCards, Pdf, Placeholder, Quiz, Spreadsheet, Table, Tabs, Video, Whiteboard
- ParagraphBlock (가드가 발견)
- ListBlock (가드가 발견)
- `docs/lat/documents.md` — Gotcha #11 신규

### 3.3 의도 예외 (2)
- `CodeBlock` — 코드 블록은 항상 어두운 surface
- `WhiteboardBlock` 캔버스 `bg-white` — 사용자가 흰 배경 위에 그림 (figma/excalidraw convention)

### 3.4 자동
- AllBlocksRender snapshot 20 updates

---

## 4. What was *Not* Built

| 항목 | 사유 |
|---|---|
| smsg-* 토큰 클래스 추가 변경 | tokens.css가 자동 처리 — 건드리지 않음 |
| Whiteboard 캔버스 다크 | 의도 예외 |
| Code 블록 외관 다크 | 의도 예외 (애초에 다크) |
| 다크 토큰 추가 신설 | tokens.css 기존 토큰으로 충분 |

---

## 5. Open Items (next-cycle)

| # | 항목 |
|---|---|
| 1 | A+B (FlowBlock mermaid theme + recharts Tooltip) — 본 batch 다음 |
| 2 | V (visual regression 자동화) — 인프라 |
| 3 | D/E/F LOW 후보들 |

---

## 6. Lessons & Notes

### 6.1 회귀 가드의 ROI
Plan은 *적용*만 의도했으나 *자동화*까지 가니 사후 가치가 훨씬 큼. 향후 신규 블록 PR이 light-only 클래스를 넣으면 CI에서 자동 실패. 코드리뷰 부담 ↓.

### 6.2 audit heuristic의 한계
초기 grep heuristic이 ParagraphBlock의 `border-dashed border-gray-300` 패턴을 놓침 — `border-dashed` 사이 띄어쓰기로 패턴 분리. 가드 테스트가 잡아냄 → audit + guard 결합이 정답.

### 6.3 의도 예외 명시화의 의미
"왜 다크 변형 안 했지?" 의문이 미래에 생기면 lat Gotcha #11 + allow-list 주석으로 즉시 답변. *침묵의 의도*가 가장 위험 — 명시가 미래 자신을 보호.

### 6.4 한 사이클 27 파일 처리 효율
직접 Read+Edit 27회 = ~1시간. sed 일괄 치환 안 한 이유: 의도 예외 (CodeBlock 등) 를 분리해야 함. 직접 봐야 정확.

### 6.5 사용자 입력 색의 dark 분리 원칙
- 컨테이너 surface = 토큰 (다크 대응 의무)
- 사용자 입력 색 (whiteboard stroke, annotation color) = 그대로 (UX 의도)
- 두 영역 혼동 금지

---

## 7. Status

- ✅ All phases done
- ⏳ Archive
- 🎯 Next: A+B → V → D/E/F
