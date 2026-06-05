# n-self-ultrareview — Completion Report

## Executive Summary
| | |
| --- | --- |
| **Feature** | N self ultra-review — `cf3cfe3 + 7edf2b2` 가 도입한 regression 6 fix |
| **Completion** | 2026-06-05 |
| **Match Rate** | 100% (6/6 confirmed regression fixed) |
| **Workflow** | 4 skeptic × 2 lens (correctness + edge-case regression) |
| **Synth result** | rate-limited → 3 verdict 직접 추출 후 수동 synthesize |
| **Fix commit** | `9db96ca` |

### Value Delivered

| Perspective | Outcome |
| --- | --- |
| Problem | 1차 ultra-review (cf3cfe3) + suspected 일괄 (7edf2b2) 가 land 했지만 *그 fix 들이 새 bug 도입했는지* 자체 검증 없음 |
| Solution | 자기 검증 워크플로우 — 2 lens (correctness regression + edge-case regression) × 2 skeptic 가 fix 들을 reefutation. 3 verdict 완료 (synth + 1 skeptic 은 rate-limited) → 6 confirmed regression 적발 → fix |
| Function/UX | recharts 가 `<Pie>`/`<Radar>` 의 `style` 을 drop → cursor:pointer 정상 작동, lat 문서 drift 정정, edge-case 가드 강화 |
| Core Value | "fix-introduces-fix" 사이클 차단. 코드 변경 → 즉시 self-review 가 자동화될 수 있음을 증명 |

## 발견된 regressions (모두 fixed in `9db96ca`)

### F1 — recharts 의 `<Pie>` / `<Radar>` style prop drop (High)
- **Severity**: High | **Complexity**: S
- **File**: `ChartBlock.tsx` (Pie + Radar branch)
- **Bug**: S5 가 `<Pie style={cursorStyle}>` 로 cursor 를 부착했지만 recharts 3.8.1 의 `adaptEventsOfChild` (util/types.js:174-187) 가 event prop 만 forward → `style` silently dropped. **cursor:pointer 가 실제로는 적용 안 됨**.
- **Verification**: skeptic 가 `node_modules/.pnpm/recharts@3.8.1.../es6/polar/Pie.js:612-621` + `Radar.js:393-397` 코드 직접 인용.
- **Fix**: `<PieChart className="cursor-pointer [&_.recharts-legend-wrapper]:cursor-default">` — root 에 cursor 부착 + Tailwind child-selector 로 Legend 만 default. RadarChart 도 동일 패턴.

### F2 — lat doc drift (Medium)
- **File**: `docs/lat/documents.md:343`
- **Bug**: S3 가 `'field'/'value'` → `'__field__'/'__value__'` rename 했는데 lat 의 N 항목 본문은 "field,value 두 컬럼" 으로 유지. CLAUDE.md 룰: "코드 변경 시 같은 commit 에 lat 갱신" 위반.
- **Fix**: lat 본문에 `__field__`/`__value__` 명시 + collision 한계 주석.

### F3 — Scatter idx range guard (Medium)
- **File**: `ChartBlock.tsx` (Scatter branch handlePointClick)
- **Bug**: Fix A 의 `Number.isInteger(idx)` 만으론 음수 / `labels.length` 이상 통과. `block.data.labels[idx]` 가 `undefined` → `String(undefined) === 'undefined'` (not `''`) 가 빈 문자열 가드를 통과 → `onLabelClick('undefined')` 발사 → drill modal 이 빈 라벨로 열림.
- **Fix**: `idx < 0 || idx >= block.data.labels.length` 추가.

### F4 — ECharts hint badge pointer-events (Medium)
- **File**: `ChartBlock.tsx` (ECharts branch)
- **Bug**: S4 의 amber badge 가 `absolute right-2 top-2 z-10` — ECharts 의 legend/title (top-right 위치) 위에 떠 클릭 가로챔.
- **Fix**: `pointer-events: none` 추가 — title tooltip 은 hover-only 라 영향 없음.

### F5 — Makefile pipefail + .PHONY (Medium)
- **File**: `Makefile`
- **Bug**: S6 의 `pyinstaller-smoke` target 이 `tail -20` 파이프로 build.py exit code 삼킴 (`bash -lc` 가 pipefail 미적용). `.PHONY` 에 누락.
- **Fix**: `set -o pipefail;` prefix + `--clean` 추가 (stale work-dir drift 회피) + `.PHONY` 에 등록.

### F6 — test try/finally cleanup (Low)
- **File**: `apps/web/src/lib/__tests__/tsvAndClipboard.test.ts`
- **Bug**: S2 의 execCommand fallback test 가 mock 복원을 try/finally 없이 함 → assertion 실패 시 `navigator.clipboard` + `document.execCommand` mock 이 다른 test 로 누수.
- **Fix**: `try { ... } finally { restore }` 로 wrap.

## 검증
- vitest **2513/2513 pass** (이전 = 동일 + 회귀 0 + try/finally 가 동작 보존)
- typecheck clean
- chunker `--check` exit 0

## 핵심 인사이트

### 1. recharts API 의 silent contract — type 만으로는 부족
TS type 은 `style?: CSSProperties` 으로 허용하지만 *runtime 에 drop* 되는 prop 이 있음 (adaptEventsOfChild 가 event 만 통과). type 정의 외에 *프레임워크 소스* 까지 inspect 해야 정확. 자체 SSR test 로는 못 잡고 — adversarial skeptic 가 `node_modules` 까지 들춰서 발견.

### 2. fix 가 fix 를 만든다 — meta-loop 필요성
1차 ultra-review (cf3cfe3) 가 N 의 4 bug fix. suspected (7edf2b2) 가 6 더. self-review 가 *그 fix 들이* 새 6 regression 도입 발견. *meta* 사이클이 없으면 silent debt 누적.

### 3. lat drift 가 회귀 lens 의 자연 catch
F2 는 정말 사소해 보이지만 — claude.md 룰 위반. 자동 enforcement 없는 룰은 self-review 가 catch 해야. 코드 일관성 보호.

### 4. range guard 의 *empty-string!=='undefined'* 함정
JavaScript 의 `String(undefined) === 'undefined'` 가 truthy 라 *empty 가드를 통과*. Fix D 의 `String(label) === ''` 패턴이 undefined 를 그대로 string 화하면 drill 호출. Fix A 같은 numeric idx → label 매핑은 *range check* 와 *truthy check* 둘 다 필요.

### 5. Rate-limited synthesizer 의 graceful fallback
synth agent 가 rate-limited 됐지만 verdict 3/4 가 완료 → transcript jsonl 에서 직접 추출 → 수동 synthesize. multi-agent workflow 의 *robustness*: 부분 실패에서도 출력 회수 가능.

## 누적 (G→N + ultra-review meta-loop)

| Cycle | Commit |
|---|---|
| G1~N | a8e7d68 → d9f3934 |
| N archive | 54218b2 |
| **N ultra-review 1차** | **cf3cfe3** (4 confirmed) |
| **N suspected 일괄** | **7edf2b2** (6 suspected fix) |
| Ultra-review archive | 07c897a |
| **N self ultra-review** | **9db96ca** (6 regression fix) |

## 잔여 (이 사이클 이후, 글로벌 i18n 제외)

| 항목 | Severity | 비고 |
|---|---|---|
| `__field__`/`__value__` 도 실제 user data 와 collision 가능 | Low | unicode private-use char 로 강화 가능 (defer) |
| Drill 의 CHANGELOG note (old `field,value` parser breakage) | Low | 외부 consumer 가 unknown 이라 defer |
| 1.5s flash → 2.5-3s + motion-safe | Low | defer polish |
| WCAG target size ≥ 24×24 | Low | defer polish |
| Tooltip 컴포넌트로 replace native title | Low | defer polish |
| Memoize buildCsv/buildTsv for >10k rows | Low | defer polish |
