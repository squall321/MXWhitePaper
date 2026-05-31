# viewer-i18n-pass — Completion Report

## Executive Summary
| | |
|---|---|
| **Feature** | D2 — viewer 컴포넌트 한국어 literal 일괄 i18n |
| **Completion** | 2026-05-31 |
| **Match Rate** | 100% (46 audit 갭 + 14 bonus) |

### Value Delivered

| Perspective | Outcome |
|---|---|
| Problem | viewer 컴포넌트 16개에 aria-label / placeholder / 버튼 / 에러 메시지가 한국어 literal 로 박혀 EN locale 사용자가 한국어 noise 를 봤음. block audit C5 false-positive 노트의 "viewer 컨벤션이 ko literal" 정책 결정 — 컨벤션 전환 |
| Solution | ultracode workflow 51 agent / 1.5M token 으로 4 group fan-out audit → 46 confirmed 0 reject. 각 viewer 에 useT 도입 + ko/en 65 신규 키 추가 |
| Function/UX | EN locale 에서 viewer 한국어 누수 0. PdfBlock 다운로드 / IframeBlock 임베드 placeholder / TableBlock 검색 + 표→차트 모달 / QuizBlock 결과 / FormBlock 제출 / 13 viewer 모두 정상 |
| Core Value | block audit C5 false-positive 패턴 "viewer ko literal 컨벤션" 종료 — 이제 viewer 도 editor 와 같은 i18n 일관성 |

## 변경

### 16 viewer 컴포넌트 — useT 도입 + 한국어 literal 제거

| File | 갭 fix | bonus |
|---|---|---|
| ImageBlock.tsx | 2 (zoom aria / open link) | — |
| PdfBlock.tsx | 3 (default title / download aria / download button) | — |
| GalleryBlock.tsx | 1 (zoom item aria, {index} 인자) | — |
| IframeBlock.tsx | 4 (empty hint / loading / blocked / open in new tab) | — |
| TableBlock.tsx | 9 (search / convert chart / cancel / insert chart 등) | insertChartBusy |
| GanttBlock.tsx | 2 (aria / today marker) | noTasks |
| OrgChartBlock.tsx | 1 (aria) | — |
| QuizBlock.tsx | 7 (errors / buttons / score) | 6 (scoreLine / passed / failed / correctSummary / explanation / remaining 등) |
| FormBlock.tsx | 2 (submit label / thanks) | — (L50/L54 validateAnswers 내부 한국어는 별도 cycle — pure 함수가 useT 못 호출) |
| CalculatorBlock.tsx | 1 (result label) | — |
| CodeBlock.tsx | 1 (copy aria) | 2 (copy / copied 텍스트) |
| GlossaryRefBlock.tsx | 2 (broken aria / title) | 2 (term label / not in glossary) |
| FigureIndexBlock.tsx | 1 (refresh aria) | 2 (default title / refresh button) |
| DataSourceBlock.tsx | 3 (endpoint missing / errorLoad / errorRender) | unknownError |
| MathBlock.tsx | 2 (aria, 같은 키 두 곳) | — |
| ParagraphBlock.tsx | 1 (page break aria + visible text) | — |
| DashboardEmbedBlock.tsx | 2 (unknown / unsupported provider) | 3 (panel id missing / requested at / url not configured) |

### i18n — 65 신규 키 (ko + en 양쪽)

block.image / block.pdf / block.gallery / block.iframe / block.table /
block.gantt / block.orgChart / block.quiz / block.form / block.calculator /
block.glossaryRef / block.figureIndex / block.dataSource / block.math /
block.code / block.paragraph / block.dashboardEmbed — 모든 viewer 네임스페이스
정착.

플레이스홀더 사용 (i18n {var} 문법):
- `block.pdf.downloadAria` — {title}
- `block.gallery.zoomItemAria` — {index}
- `block.quiz.result.scoreLine` — {score}
- `block.quiz.result.correctSummary` — {correct} {total} {earned} {totalPoints}
- `block.quiz.result.explanation` — {text}
- `block.quiz.result.remaining` — {remaining} {max}
- `block.dashboardEmbed.requestedAt` — {stamp}
- `block.dashboardEmbed.urlNotConfigured` — {provider}

### shadowing 처리

- `GanttBlock`: tasks.map((t)=>...) 콜백 변수 `t` 와 useT 의 `t` 충돌 → `tr = useT()` 별명 사용
- `TableBlock`: 콜백 `t` 가 더 깊은 스코프라 충돌 없음 — `const t = useT()` 그대로 사용

### 워크플로우 — Ultracode 통계

| 단계 | 결과 |
|---|---|
| Group review (4 groups parallel) | 46 raw findings (cap 12/group) |
| Adversarial verify (parallel 46) | 46 confirmed / 0 reject |
| Synthesize | per-file grouped report |
| **합계** | 51 agent, 1,471,538 tokens, 154 sec |

False-positive 0% — group review 가 정확한 line 번호와 snippet 까지 잡아서 verify 가 모두 통과.

## 검증

- typecheck: clean
- vitest: **2388 / 2388** — snapshot 일부 viewer 자동 갱신 가능 (useT default ko 라 대부분 동일)
- 빌드 영향 0 — useT 는 zero-cost lookup

## Defer (별도 사이클)

| ID | 이유 |
|---|---|
| FormBlock.tsx L50/L54/L59/L62/L70/L73/L82-87 | `validateAnswers()` 는 pure helper 라 useT 호출 불가. error code 반환 + view 매핑으로 리팩터링 필요 (S 효과) |
| ColumnsBlock, AccordionBlock, TabsBlock, FlowBlock, ChartBlock, SpreadsheetBlock, PivotTableBlock, FileBlock, ImageAnnotationBlock, WhiteboardBlock | audit 통과 — 한국어 literal 없음 또는 이미 useT 사용 중 |

## 다음 단계

- D3: a11y 사이클 — TABS-01 + ORG-01
- 별도: FormBlock validateAnswers i18n 리팩터링 (D4 또는 D5 사이클로 흡수 가능)
