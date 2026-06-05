# n-ultrareview — Completion Report

## Executive Summary
| | |
| --- | --- |
| **Feature** | N 트랙 (commit `d9f3934`) 의 adversarial review + confirmed bug 4 fix |
| **Completion** | 2026-06-05 |
| **Match Rate** | 100% (4/4 confirmed bug fixed) |
| **Review workflow** | 6 skeptic (3 lens × 2 skeptic) + synthesizer |
| **Fix commit** | `cf3cfe3` |

### Value Delivered

| Perspective | Outcome |
| --- | --- |
| Problem | N 트랙이 land 직후 "16/16 capability 100% 완성" 으로 보였으나 자체 검증만으로는 silent bug + a11y 격차를 감지 못 함 |
| Solution | 6 adversarial skeptic 이 3 lens (correctness/edge-cases/UX) 로 reefutation. 4 confirmed bug (high severity 2 + medium 2) 발견 → 모두 fix |
| Function/UX | Scatter drill 정상 동작 (이전엔 silent no-op), 화면 리더 사용자 접근성, copy 버튼 race 해소, 빈 라벨 보호 |
| Core Value | "ship it" 신뢰성 ↑. ultra-review 가 *실제 silent bug* 를 찾았음을 증명 |

## Review workflow 구조

```
Phase 1: Review (6 agents 병렬)
├── lens 1: correctness
│   ├── skeptic 1: high-severity refutation
│   └── skeptic 2: medium/low subtle issues
├── lens 2: edge cases
│   ├── skeptic 1: high-severity
│   └── skeptic 2: medium/low
└── lens 3: UX/a11y
    ├── skeptic 1: high-severity
    └── skeptic 2: medium/low

Phase 2: Synthesize (1 agent)
└── 6 verdict consolidation → prioritized action plan
```

## Confirmed bugs (fixed in `cf3cfe3`)

### Fix A — Scatter drill silent no-op (High)
- **File**: `apps/web/src/components/blocks/ChartBlock.tsx`
- **Bug**: `d.x` 가 recharts 3.x 의 `ScatterPointItem.x` — *pixel coord of wrapping rect top-left*. `block.data.labels[d.x]` 는 항상 undefined → drill 미동작.
- **Verification**: `node_modules/.../recharts/types/cartesian/Scatter.d.ts` 의 type 정의 직접 확인. correctness-2 skeptic 가 정확히 지목.
- **Fix**: `d.payload.x` 사용 + `Number.isInteger` 가드 + empty/null label 거부.

### Fix B — Copy-flash setTimeout race + unmount warning (Medium)
- **File**: `apps/web/src/components/blocks/DrillExportControls.tsx`
- **Bug**: bare `setTimeout(..., 1500)` 가 ref 없이 발사 → rapid double-click 시 1st timer 가 2nd flash 를 일찍 reset / modal close 시 setState-on-unmounted warning.
- **Fix**: `useRef<number | null>` 에 timer id 저장 + `useEffect` cleanup 으로 unmount 시 clearTimeout + schedule 시 직전 timer cancel.

### Fix C — Emoji button a11y gap (High a11y)
- **File**: `apps/web/src/components/blocks/DrillExportControls.tsx`
- **Bug**: 화면 리더가 "📥" 를 "down arrow" 로 읽음 + button label 자체가 SR 에 부족 ("CSV" 만). copy state 변화 (`✓ 복사됨` / `⚠ 실패`) 가 시각적 only — SR 무피드백.
- **Fix**: emoji `<span aria-hidden>` wrap + button 자체에 `aria-label` ("UTF-8 BOM 포함 CSV 다운로드" 등) + `<span role="status" aria-live="polite" className="sr-only">` 로 copy state mirror.

### Fix D — Empty-string label drill (Medium)
- **File**: `apps/web/src/components/blocks/ChartBlock.tsx`
- **Bug**: `handlePieClick` 의 `d?.name === undefined` 가 `d.name=''` 통과 → 빈 라벨 drill modal + 빈 filename. `handleChartClick` 도 background click 시 `e==null` 또는 `activeLabel==''` 가능.
- **Fix**: 두 곳 모두 `label == null || String(label) === ''` 패턴으로 강화.

## Suspected issues (worth verifying — 별도 cycle)

| ID | 영역 | 비고 |
|---|---|---|
| S1 | BOM 이 first header cell 에 묶임 | Python `csv.DictReader` / Go 같은 strict parser 는 BOM 을 header[0] 에 유지. 의도 확인 후 문서화 |
| S2 | `execCommand` fallback 미 verify | `tsvAndClipboard.test.ts` 가 modern path 만 통과시킴. throw mock 으로 fallback 검증 추가 |
| S3 | `drillSingleRowToCsv` 헤더 컬럼 충돌 | user 데이터 field 가 `'field'` 또는 `'value'` 일 때 컬럼 명 shadow |
| S4 | ECharts engine 의 drill 부재 | 사용자 hint 없음 — UI badge 추가 |
| S5 | Pie/Radar cursor:pointer 가 Legend 까지 적용 | Pie/Radar `<Pie>` 자체에만 cursor 부착 |
| S6 | N-3 PyInstaller 가 CI 가 아닌 local dry-run | make/CI target 으로 자동화 |

## Refuted / non-issues
- `copyToClipboard` non-secure-context error handling — 이미 try/catch.
- `xy-line` / `boxplot` drill 제외 — data shape 차이로 의도적, 정상 design 결정.

## Defer items (low priority, 11개)
- i18n hook 추출
- 1.5s → 2.5-3s flash + motion-safe
- WCAG target size (≥24×24)
- tsvCell regex 확장 (`\v\f\x00`)
- `rowsToTsv` trailing CRLF
- native title → focusable Tooltip
- 키보드 alternative for chart drill
- Playwright mobile-viewport test
- buildCsv/buildTsv memoization
- TableBlock single-row export `fields.length > 0` 가드
- Scatter Number.isInteger 추가 (이미 Fix A 에 포함)

## 검증
- vitest **2512/2512 pass** (이전 2507 + 5 신규 — aria-label, aria-live, Fix B 패턴 검증, emoji 매칭 갱신)
- typecheck clean
- 4 fix 모두 commit 된 상태

## 핵심 인사이트

### 1. Ultra-review 는 *self-claimed 100%* 를 정직하게 검증
N 트랙 archive report 가 "16/16 cell 100% 완성" 으로 자축했지만 실제로는 **Scatter drill 이 silent broken**. 자체 SSR test 로 적발 불가능 (TS type 만으로는 recharts 3.x 의 `ScatterPointItem.x` 의미 변화 추적 안 됨).

### 2. Diversity-lens 가 redundancy 보다 catch rate 높음
같은 lens 의 2 skeptic 이 같은 bug 를 cross-check (Fix A 는 correctness-1 + correctness-2 둘 다 잡음). 다른 lens 가 *다른 buge* 잡음 (UX skeptic 만 a11y 적발).

### 3. 패턴 매칭 test 가 실용적 fallback
Fix B 의 timer cleanup 패턴은 fake-timer + RTL 없이는 단위 test 어려움. `readFileSync` + regex 매칭으로 *코드 구조* 자체를 lock — 미래 누가 useRef 를 제거하면 test 가 fail. 행위 test 의 대안.

## 누적 (G→N + ultrareview)

| Cycle | Commit |
|---|---|
| G1~N | a8e7d68 → d9f3934 |
| N archive | 54218b2 |
| **N ultra-review fixes** | **cf3cfe3** |
