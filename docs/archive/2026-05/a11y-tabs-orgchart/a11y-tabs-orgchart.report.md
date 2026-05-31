# a11y-tabs-orgchart — Completion Report

## Executive Summary
| | |
|---|---|
| **Feature** | D3 — TabsBlock WAI-ARIA tabs pattern + OrgChartBlock SVG 키보드 nav |
| **Completion** | 2026-05-31 |
| **Match Rate** | 100% (TABS-01 + ORG-01 audit C5 defer 해소) |

### Value Delivered

| Perspective | Outcome |
|---|---|
| Problem | TabsBlock 은 role=tab + aria-selected 만 있고 tabpanel/aria-controls/roving tabindex/키보드 nav 누락. OrgChartBlock 의 노드는 hover-only 라 키보드 사용자가 descendant-highlight 못 봄 |
| Solution | TabsBlock: tablist id, tab id+aria-controls, tabpanel role+aria-labelledby+tabIndex, roving tabindex (active=0/inactive=-1), ← → Home End 키. OrgChart: 각 <g> 노드에 tabIndex=0 + role=button + aria-label(label/role) + onFocus/Blur=setHoverId mirror + Esc=clear |
| Function/UX | 키보드 사용자가 ←→ 로 탭 이동 + Home/End 양끝점, Tab 으로 OrgChart 들어가서 노드 포커스 시 mouse hover 와 같은 descendant highlight. 스크린리더가 "조직도, CEO Chief, 버튼" 으로 인식 |
| Core Value | block audit C5 defer-항목 2건 (TABS-01 17 콜사이트 패턴 + ORG-01) 회수. 두 widget WCAG 2.1 keyboard navigability 완성 |

## 변경

### 1) TabsBlock — WAI-ARIA tabs pattern (TABS-01)

`apps/web/src/components/blocks/TabsBlock.tsx`

- `tablist id={tabs-${block.id}}` — outer container
- 각 tab: `id={tabs-${id}-tab-${i}}`, `aria-controls={panelId}`,
  `tabIndex={isActive ? 0 : -1}` (roving)
- 단일 tabpanel: `id={panelId}`, `role=tabpanel`,
  `aria-labelledby={active tab id}`, `tabIndex=0`
- 키보드: ← → Home End — `focusTab(i)` 가 setActive + `queueMicrotask`
  로 다음 frame 의 focus 호출 (roving tabindex 가 막 갱신된 직후)
- `type=button` 명시 (form submit 방지)
- focus-visible ring 으로 panel 자체도 키보드 nav 가능

### 2) OrgChartBlock — keyboard-accessible nodes (ORG-01)

`apps/web/src/components/blocks/OrgChartBlock.tsx`

- 각 노드 `<g>` 에 `tabIndex=0` + `role="button"`
- `aria-label`: `role` 있으면 `"{label} — {role}"`, 없으면 `{label}`
- `onFocus={setHoverId(id)}` + `onBlur={setHoverId(null)}` — mouse hover
  의 descendant highlight effect 를 키보드 사용자에게도 노출
- `onKeyDown=Escape` 시 blur + 하이라이트 해제
- `cursor: default` 로 마우스 사용자 클릭 affordance 오해 방지 (실제
  클릭 action 은 없음, 시각화 도구로만 동작)

### 3) 테스트

- `TabsBlock.a11y.test.tsx` (4): tablist + ids + aria-controls, tabpanel
  + aria-labelledby, roving tabindex, empty fallback
- `OrgChartBlock.a11y.test.tsx` (2): 모든 노드 tabIndex/role/aria-label
  검증, svg role=img + 차트 aria-label 유지
- `AllBlocksRender` 의 tabs / org-chart snapshot 2건 의도된 갱신

## 검증

- typecheck: clean
- vitest: **2394 / 2394** (+6 신규 + 2 snapshot 갱신)
- SSR-only 테스트 패턴 (`renderToStaticMarkup`) 으로 키보드 동작 직접 못 검증 →
  마크업 (tabindex / role / aria-* 속성) 으로 a11y 계약 검증

## Defer (별도 사이클)

| ID | 이유 |
|---|---|
| TabsBlock 키보드 nav 통합 테스트 | jsdom + dispatchEvent 로 실제 ←→ 동작 검증은 @testing-library/react 미설치라 불가. Playwright E2E 사이클로 흡수 |
| OrgChart 노드 클릭 액션 | 현재 hover/focus → highlight 만 가능. 클릭 시 detail panel 등은 별도 기능 사이클 |

## 다음 단계

- D4: editor i18n 마저 — QUIZ-01 + TBL-01 view + FormBlock validateAnswers refactor
- D5: UX 폴리시 + lat sweep
