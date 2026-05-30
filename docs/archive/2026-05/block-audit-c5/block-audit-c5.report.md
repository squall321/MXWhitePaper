# block-audit-c5 — Completion Report

## Executive Summary
| | |
|---|---|
| **Feature** | Block audit Cycle 5 — 19 미커버 블록 + 5 구조적 검토 |
| **Completion** | 2026-05-30 |
| **Match Rate** | 100% (확정 갭 중 적용 가능 18 / 24 fix · L 1건 + LOW polish 5건 defer) |

### Value Delivered

| Perspective | Outcome |
|---|---|
| Problem | 미커버 19 블록 + 구조 5건에서 i18n 누락 / dark-mode 누락 / SVG stroke 왜곡 / FlowEditor 사일런트 engine 재작성 / TableEditor zebra phase 오차 / lat drift 다수 |
| Solution | 18 갭 surgical fix (XS 14 + S 4). Ultracode workflow (44 agent, 1.7M tokens) 로 fan-out 발견 → adversarial verify → 진짜 갭만 통과 |
| Function/UX | Excalidraw 데이터 손실 차단, sparse table zebra 일치, SVG 스트로크 비왜곡, dark mode 패턴 일관, EN locale 누수 6건 제거 |
| Core Value | 132 finding 132건 중 마지막 24 confirmed 처리로 block audit 완전 종료 (C1+C2+C3+C4+C5 누적) |

## 워크플로우 — Ultracode 패턴

| 단계 | 에이전트 | 산출 |
|---|---|---|
| Group Review (parallel x4) | media / data / interactive / misc | 19 블록 raw findings |
| Structural Review (parallel x5) | sparse / cap / chart / svg / zebra | 구조 raw findings |
| Adversarial Verify (parallel x34) | 각 finding refute 시도 (default false) | 24 confirmed / 10 false-positive |
| Synthesize | markdown report | 권장 우선순위 + false-positive 패턴 기록 |

**합계** — agent 44, subagent_tokens 1,746,024, tool_uses 360, 30분.

## 24 confirmed → 18 적용 / 6 defer

### XS — 14건 적용

| ID | 블록 | 변경 |
|---|---|---|
| MED-01 | ImageAnnotationBlockEditor | callout-bg 4 strings useT (editor.ia.calloutBg* 신규) |
| MED-02 | ImageBlockEditor | ALIGN_OPTIONS label→labelKey, t(o.labelKey) (기존 키 재사용) |
| LOW-03 | GalleryBlockEditor | placeholder="alt" → t('editor.image.altPlaceholder') |
| LOW-04 | PdfBlock | 다운로드 anchor + iframe dark variants 추가 (FileBlock pattern) |
| LOW-05 | PdfBlockEditor | iframe title fallback t('editor.pdf.previewTitle') 신규 |
| DOC-01 | DocLinkCardBlock | '존재하지 않는 문서' → t('block.docLink.missing') 신규 |
| DOC-02 | DocLinkCardBlock | error state + title/summary dark variants |
| BIB-01 | BibliographyBlock | heading fallback t('block.bibliography.defaultHeading') 신규 + useT 도입 |
| BIB-02 | BibliographyBlock | section/h3/index span dark variants |
| QUIZ-02 | QuizBlock | result tone classes (emerald/amber) dark variants |
| TBL-02 (view) | TableBlock | thead 2곳 + tfoot + sticky left-0 cells dark variants |
| VID-01 | WhiteboardBlock | path / rect / ellipse / line / arrow 5건 vectorEffect="non-scaling-stroke" |
| VID-02 | ImageAnnotationBlock | arrow line / rect / callout line / callout rect 4건 vectorEffect |
| CHART-01 | docs/lat/documents.md | chartType enum 8 phantom 값 (stackedBar/groupedBar/doughnut/bubble/heatmap/waterfall/funnel/sankey) 삭제, 실제 8개 (line/bar/area/pie/radar/scatter/xy-line/boxplot) 로 교체 + engine/boxplot/xy-line 설명 추가 (CHART-02 도 동시 해소) |
| TBL-02 (zebra) | zebra.ts | table/list/bibliography/figure-index STRIPE_CLASSES 에 dark:bg-gray-800 추가 |

### S — 4건 적용

| ID | 블록 | 변경 |
|---|---|---|
| FLOW-02 | FlowBlockEditor | engine !== 'mermaid' 일 때 FlowExcalidrawReadonly notice 분기, FlowMermaidEditor 로 본체 분리. persist() 의 `engine: 'mermaid'` 강제 제거 (block.engine 보존). 데이터 손실 경로 차단 |
| TBL-01 (sparse zebra) | TableBlockEditor | rowKeys.map 내부 IIFE + bodyCounter — viewer SparseTableBody 와 동일하게 header 행 제외하고 indexing. 이전엔 header 포함 rIdx 그대로 넘겨 zebra phase 한 칸 어긋남 |
| editor.flow.excalidrawReadonly | ko/en | 신규 i18n 키 |

### Defer (6건)

| ID | 사유 |
|---|---|
| FLOW-01 (L) | Excalidraw read-only 렌더러 — Sprint-7 스코프 |
| QUIZ-01 (M) | QuizBlockEditor 전체 useT 도입 ~12 strings — 별도 사이클 (i18n 대규모) |
| TABS-01 (LOW) | tab/tabpanel ARIA 업그레이드 — 프로젝트 전반 17+ 콜사이트 패턴, 별도 a11y 사이클 |
| ORG-01 (S) | SVG g 노드 a11y — 패턴 확립 필요 |
| TBL-01 (view 표→차트 i18n) | TableBlock 본체 useT 도입 (~10 strings) — M 효과, 별도 |
| CAP-01 (S) | clamp aria-live 알림 — 코드베이스 컨벤션 (aria-live=error-only) 위배. Drop |

## 신규 i18n 키 9개

ko + en 양쪽:
- editor.ia.calloutBgGroup / calloutBgDefault / calloutBgDark / calloutBgYellow
- editor.pdf.previewTitle
- block.bibliography.defaultHeading
- block.docLink.missing
- editor.flow.excalidrawReadonly

## 검증

- typecheck: clean
- vitest: **2381 / 2381** (zebra test 5 expected 갱신, AllBlocksRender snapshot 5 갱신 — STRIPE_CLASSES + thead dark + Bibliography + QuizBlock + PdfBlock 의도 변화)
- snapshot diff 모두 의도된 darkmode/vectorEffect 추가

## False Positive 패턴 (10건) — 다음 cycle 프롬프트 튜닝용

1. **clamp 무음 → aria-live 강제** (CAP-02~05) — 본 코드베이스의 aria-live 는 *autosave/error 전용* 채널. clamp 는 silent 가 컨벤션. 다음 사이클 프롬프트에 명시.
2. **viewer 전반의 i18n 부재를 한 블록만 책임 전가** (GLOS-01) — viewer 들은 대체로 한국어 literal 유지 패턴. editor 컨벤션 (useT 광범위) 과 viewer 컨벤션 (Korean literal) 분리.
3. **CSS-scale 없는 SVG 에 vector-effect 무차별 권고** (VID-03~07) — viewBox + width="100%" 또는 비균일 preserveAspectRatio 결합한 경우만 발견 가치 있음.
4. **BE Pydantic bound 를 FE 사일런트 truncation 으로 오해** (CAP-05) — schema bound 먼저 확인.
5. **자기 fix_hint 가 "no action" 인 informational note** (VID-06/07) — finder 후처리에서 필터링.

## 누적 cycle 진행

| Cycle | 갭 fix | 사이즈 | 커밋 |
|---|---|---|---|
| C1 (Excel funcs) | … | … | … |
| C2 (Pivot Sprint 1-4) | … | … | … |
| C3 (Widget polish) | … | … | … |
| C4 (i18n + a11y) | 7 | XS+S | 377303e |
| C5 (미커버 + 구조) | 18 (현 사이클) | XS + S | 본 사이클 |

block audit 132 finding → C1-C5 누적 처리 종료. 잔여 6건은 별도 트랙.

## 다음 단계

- Sprint-7 Excalidraw 렌더 진입 시 FLOW-01 회수
- 별도 i18n viewer 사이클에 BIB/DOC viewer 외 viewer 전반 useT 도입 검토
- TABS-01 / ORG-01 — 별도 a11y 사이클
- block audit 자체는 종료. 다음 큰 트랙은 사용자 결정에 위임
