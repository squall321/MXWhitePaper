# block-audit-c4 — Completion Report

## Executive Summary
| | |
|---|---|
| **Feature** | Block audit Cycle 4 — i18n 일관성 + 보조 a11y/UX (S 7건) |
| **Completion** | 2026-05-30 |
| **Match Rate** | 100% (7/7 갭) |

### Value Delivered

| Perspective | Outcome |
|---|---|
| Problem | 4 editor + 1 viewer 에 한국어 하드코딩, List Arrow 키 미동작, Heading4 inline lvl=2 가 outline 오염, Code clipboard 실패 silent |
| Solution | useT 도입 (16 i18n key 신설) + List ArrowUp/Down focus 이동 + Heading4 semantic h4 강제 + Code copy error aria-live 알림 |
| Function/UX | 영문 locale 정상 동작, SR outline 정확, 키보드 nav 자연스러움, clipboard 실패 인지 가능 |
| Core Value | block audit 132 finding 중 i18n/a11y 묶음 진척 — 영문 사용자 + a11y 사용자에게 즉시 체감 |

## 7 갭 결과

| ID | 블록 | Fix |
|---|---|---|
| HD4-01 | Heading4BlockEditor | useT (changeLog/label/ariaLevel/placeholder) |
| QTE-01 | QuoteBlockEditor | useT (changeLog/ariaText/textPlaceholder/ariaCite/citePlaceholder) |
| CLO-03 | CalloutBlock viewer | useT (variant label + cycleAria) — VARIANT_STYLES label → labelKey |
| SPC-03 | SpacerBlockEditor | useT (changeLog/label/ariaSize) |
| LST-02 | ListBlockEditor | ArrowUp/Down → prev/next item focus (Tab/Enter/Backspace 보존) |
| HD4-02 | Heading4Block viewer | semantic 항상 `<h4>` (outline 안전), `data-heading4-visual-level` + sizeClass 분기. dark:text-gray-100 같이 추가 |
| COD-02 | CodeBlock viewer | clipboard catch → setCopyError + role=status aria-live="polite" 알림 (3초 자동 제거) |

## 구현 위치

- `apps/web/src/lib/i18n/ko.ts` + `en.ts` — 16 신규 key
- `apps/web/src/components/blocks/CalloutBlock.tsx` (CLO-03)
- `apps/web/src/components/blocks/CodeBlock.tsx` (COD-02)
- `apps/web/src/components/blocks/Heading4Block.tsx` (HD4-02)
- `apps/web/src/features/editor/blocks/Heading4BlockEditor.tsx` (HD4-01)
- `apps/web/src/features/editor/blocks/QuoteBlockEditor.tsx` (QTE-01)
- `apps/web/src/features/editor/blocks/SpacerBlockEditor.tsx` (SPC-03)
- `apps/web/src/features/editor/components/ListBlockEditor.tsx` (LST-02)
- `__snapshots__/AllBlocksRender.test.tsx.snap` — Heading4 h3 → h4 의도된 갱신

## 검증

- typecheck clean
- web vitest **2381 / 2381** — 회귀 0
- AllBlocksRender snapshot 갱신 (Heading4 가 의도된 변경)

## 작업 방식 회고

- Workflow 가 rate limit 으로 2회 즉시 실패 (subagent_tokens 0)
- 직접 작업 폴백 — 7 갭 명세 명확해 grep + Edit 으로 ~30분 완료
- 같은 갭이 audit 결과 input 에 풍부 (코드 line 명시) → 추측 없이 정확한 fix

## 후속 (C5)

- 나머지 19 블록 정밀 audit (이번 audit input truncated)
- 구조적 개선 5건 (sparse 정책 / cap override / Chart drift / IA-01 non-scaling-stroke 등)

## 다음 단계

1. push 후 C5 audit 시작 (별도 사이클)
2. 누적 archive 52 → 53
