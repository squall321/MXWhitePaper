---
template: design
version: 1.0
feature: gantt-zebra
date: 2026-05-24
project: MX White Paper
---

# Gantt Zebra — Design Document

> **Planning Doc**: [gantt-zebra.plan.md](../../01-plan/features/gantt-zebra.plan.md)
> **Status**: Draft

---

## 0. Recap (Plan에서)

- Z1 단일 갭 — GanttBlock SVG에 task row 단위 zebra `<rect>` 1줄 추가
- 기본 ON, `options.stripe === false` 일 때만 OFF (zebra-striping-extended contract 그대로)
- 색: `#F9FAFB` 하드코딩 (gray-50 등가). `STRIPE_HEX` map 신설 yagni (Q2)
- `<ZebraToggle>` 공통 컴포넌트 그대로 재사용 — `ZebraBlockType` union에 `'gantt'` 추가
- export 무관 (gantt는 BE export 마커만 단순 placeholder)
- LOC ~125, 시간 ~1.5h

---

## 1. 파일 구조

```
apps/web/src/
├── features/editor/blocks/
│   ├── zebra.ts                            # EDIT — ZebraBlockType union +1, STRIPE_CLASSES +1
│   ├── GanttBlockEditor.tsx                # EDIT — header row에 <ZebraToggle> 1줄
│   └── __tests__/
│       ├── zebra.test.ts                   # EDIT — gantt case 1 추가 (총 11)
│       └── GanttBlockEditor.test.tsx       # EDIT — 토글 노출 통합 테스트 +1
├── components/blocks/
│   ├── GanttBlock.tsx                      # EDIT — SVG zebra <rect> 삽입 + import getZebraClass
│   └── __tests__/
│       └── GanttBlock.zebra.test.tsx       # NEW — view 회귀 2 케이스
└── (없음 — schema는 packages/shared)

packages/shared/
└── schemas/document.json                   # EDIT — GanttBlock 에 options.stripe? optional

apps/api/
└── (자동) app/schemas/document.py          # pnpm schema:gen 으로 재생성
```

**파일 수**: 신규 1 + 편집 5 = **6 files**. LOC 추정 plan 그대로 ~125.

---

## 2. zebra.ts 시그니처

```diff
 export type ZebraBlockType =
   | 'table'
   | 'spreadsheet'
   | 'list'
   | 'kpi-cards'
   | 'bibliography'
   | 'figure-index'
+  | 'gantt'

 const STRIPE_CLASSES: Record<ZebraBlockType, string> = {
   table: 'bg-gray-50',
   spreadsheet: 'bg-[var(--smsg-blue-050)]',
   list: 'bg-gray-50',
   'kpi-cards': 'bg-[var(--smsg-blue-050)]',
   bibliography: 'bg-gray-50',
   'figure-index': 'bg-gray-50',
+  // SVG 블록 — className은 ZebraToggle 의 type 완전성 위해 등록만,
+  // 실제 GanttBlockView 는 <rect fill="#F9FAFB"> 인라인 사용.
+  gantt: 'bg-gray-50',
 }
```

`getZebraClass()` 시그니처/본문 변경 없음. `STRIPE_CLASSES['gantt']` 자체는 실사용 없음 (SVG에는 className이 안 먹히므로 fill hex 인라인). 하지만 `Record<ZebraBlockType, string>` 의 TS exhaustive 검증 + ZebraToggle 이 6→7 type 지원하려면 map에 entry가 필요. **dummy entry 1줄 비용 < `STRIPE_HEX` 별도 map 도입 비용** (Q2 결론).

---

## 3. `<ZebraToggle>` 변경

**없음** — `blockType: ZebraBlockType` 가 union 확장으로 자동 7-type 지원.
`<ZebraToggle blockType="gantt" ... />` 호출만 추가하면 끝.

---

## 4. GanttBlock View 패치

### 4.1 Schema (document.json)

```diff
 "GanttBlock": {
   "type": "object",
   "required": ["type", "id", "tasks"],
   "additionalProperties": false,
   "properties": {
     "type":  { "const": "gantt" },
     "id":    { "$ref": "#/$defs/Ulid" },
     "tasks": { "type": "array", "items": { ... } },
+    "options": {
+      "type": "object",
+      "additionalProperties": false,
+      "description": "표시 옵션. 모두 optional, default 동작은 ON.",
+      "properties": {
+        "stripe": {
+          "type": "boolean",
+          "default": true,
+          "description": "task row 단위 zebra-striping (label 영역 포함 전체 행)."
+        }
+      }
+    },
     "meta": { "$ref": "#/$defs/BlockMeta" }
   }
 }
```

### 4.2 View (GanttBlock.tsx)

**Z-order 결정 (Plan Decision #5 그대로)**:

```text
SVG paint 순서:
  1. zebra <rect> 그룹 (행 단위 음영)        ← 가장 뒤
  2. axis line                                 ← zebra 위
  3. tasks <g> (text + bar + progress)         ← 가장 앞
```

**Q1 결론** — label 영역까지 zebra 칠함 (행 단위 시각 명확성 우선). `x=0, width=totalW`.

**Q2 결론** — `STRIPE_HEX` map 신설하지 않음. 인라인 `fill="#F9FAFB"` 한 곳에만 등장 → 별도 상수 추출 불요.

**구체 코드**:

```diff
 import type { GanttBlock } from '@/types/document'
+import { getZebraClass } from '@/features/editor/blocks/zebra'

 export function GanttBlockView({ block }: { block: GanttBlock }) {
   if (block.tasks.length === 0) {
     return <p className="text-xs text-gray-500">작업 없음</p>
   }

   const tasks = block.tasks.map((t) => ({ ... }))
   ...
   const rowH = 24
   const labelW = 140
   const barAreaW = 360
   const totalW = labelW + barAreaW + 16
   const totalH = tasks.length * rowH + 24

+  const stripeOn = block.options?.stripe !== false

   return (
     <figure className="overflow-x-auto rounded border border-gray-200 bg-white p-2">
       <svg width={totalW} height={totalH} viewBox={...} role="img" aria-label="Gantt 차트">
+        {/* zebra rows — paint first so they sit behind axis + bars */}
+        {stripeOn &&
+          tasks.map((_, idx) =>
+            idx % 2 === 1 ? (
+              <rect
+                key={`zebra-${idx}`}
+                data-gantt-zebra-row
+                x={0}
+                y={idx * rowH + 4}
+                width={totalW}
+                height={rowH}
+                fill="#F9FAFB"
+              />
+            ) : null,
+          )}
         {/* axis line */}
         <line ... />
         {tasks.map((t, idx) => (
           <g key={idx}> ... </g>
         ))}
       </svg>
     </figure>
   )
 }
```

- **y 좌표**: `idx * rowH + 4` — Plan은 행 전체를 권장했으나, task bar y는 `idx * rowH + 8`이라 `+4`는 *행 상단 여백을 절반만 포함*. 정확히는 `idx * rowH` (행 시작점 그대로) 가 가장 정직하나, axis line이 `totalH - 16` (마지막 행 아래 16px)에 있고 첫 행이 y=8부터라 *상단 4px / 하단 4px 여백을 남기는* `+4`가 시각적으로 더 깔끔. **결정**: `+4`.
- **height**: `rowH` (= 24px). 다음 zebra rect와 정확히 맞닿음 (idx 0은 비고, idx 1이 24~48, idx 3이 72~96 — 사이 회색 구역이 한 행 건너 한 행).
- `getZebraClass()` import 는 unused 라 *제거*. zebra.ts의 `STRIPE_CLASSES['gantt']` 엔트리는 ZebraToggle/exhaustive 위한 type-only. 본 View는 옵션 boolean 만 직접 읽고 fill 하드코딩.

> 사실 `getZebraClass` import 없이도 동작 — `stripeOn = block.options?.stripe !== false` 한 줄로 자급자족. import 빼는 게 더 깨끗. **수정**: import 안 함.

### 4.3 Editor (GanttBlockEditor.tsx)

`tasksHeader` 옆 (현재 `<button>` 추가 옆)에 `<ZebraToggle>` 1줄:

```diff
 import { GanttBlockView } from '@/components/blocks/GanttBlock'
+import { ZebraToggle } from './ZebraToggle'

 ...

       <div className="flex items-center justify-between">
         <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
           {t('editor.gantt.tasksHeader', { n: local.tasks.length })}
         </p>
-        <button ...>
-          {t('editor.gantt.addTask')}
-        </button>
+        <div className="flex items-center gap-2">
+          <ZebraToggle
+            blockType="gantt"
+            options={local.options}
+            onChange={({ stripe }) =>
+              void push({ ...local, options: { ...local.options, stripe } })
+            }
+          />
+          <button ...>
+            {t('editor.gantt.addTask')}
+          </button>
+        </div>
       </div>
```

`push(...)` 가 이미 전체 next 객체 patch라 옵션 별도 함수 불요.

---

## 5. 호출 흐름

zebra-striping-extended 와 동일:

```
ZebraToggle onChange  ─►  push({ ...local, options:{stripe:v} })
                                 │
                                 ▼  (즉시 — gantt editor의 push 는 디바운스 없음)
                          patchBlock(slug, id, next, etag, ...)
                                 │
                                 ▼
                          FastAPI /documents/{slug}/blocks/{id}
                                 │
                                 ▼
                          Pydantic 검증 (options.stripe? 통과)
                                 │
                                 ▼
                          applyServerSnapshot ─► re-render
                                 │
                                 ▼
                          View: stripeOn 계산 ─► <rect> 그룹 paint
```

Round-trip: `options.stripe` 는 단순 boolean — JSON 직렬화 무손실. DOCX/PPTX export 시 보존 안 됨 (Plan Out-of-scope).

---

## 6. 테스트 매트릭스

| 파일 | 신규/편집 | 케이스 수 | 시나리오 |
|---|---|---|---|
| `__tests__/zebra.test.ts` | EDIT | +1 | gantt blockType 색 (bg-gray-50) + OFF + universal-map 케이스가 자동 7-type 확장 |
| `__tests__/GanttBlockEditor.test.tsx` | EDIT | +1 | `data-zebra-toggle="gantt"` 노출 |
| `components/blocks/__tests__/GanttBlock.zebra.test.tsx` | NEW | 2 | default ON 시 zebra `<rect>` 카운트 (4 tasks → 2 rect, 5 tasks → 2 rect) + OFF 시 0 rect |
| **합계** | | **4** | (Plan과 동일 4건) |

### 6.1 detail — GanttBlock.zebra.test.tsx

```tsx
describe('<GanttBlockView /> zebra-striping', () => {
  it('default ON — odd rows get a <rect data-gantt-zebra-row>', () => {
    const block: GanttBlock = {
      type: 'gantt',
      id: '...',
      tasks: [
        { name: 'A', start: '2026-01-01', end: '2026-01-05' },
        { name: 'B', start: '2026-01-02', end: '2026-01-06' },
        { name: 'C', start: '2026-01-03', end: '2026-01-07' },
        { name: 'D', start: '2026-01-04', end: '2026-01-08' },
      ],
    }
    const html = renderToStaticMarkup(<GanttBlockView block={block} />)
    const matches = html.match(/data-gantt-zebra-row/g) ?? []
    expect(matches.length).toBe(2)  // idx 1, idx 3
    expect(html).toContain('fill="#F9FAFB"')
  })

  it('options.stripe=false suppresses every zebra rect', () => {
    const block: GanttBlock = { ...prevBlock, options: { stripe: false } }
    const html = renderToStaticMarkup(<GanttBlockView block={block} />)
    expect(html).not.toContain('data-gantt-zebra-row')
  })
})
```

---

## 7. 회귀 영향 분석

| 위험 | 영향 | 대응 |
|---|---|---|
| 기존 GanttBlockView snapshot (AllBlocksRender.test.tsx) | 깨짐 (zebra rect 추가) | `pnpm vitest run -u` 로 갱신 — zebra-striping-extended 와 동일 (그때 2 snapshot 갱신했음) |
| 기존 GanttBlockEditor.test.tsx | 영향 0 (zebra 토글 단순 추가) | 새 케이스 1만 추가, 기존 케이스는 그대로 통과 |
| Pydantic 옛 문서 호환 | 영향 0 | `options?` optional + 기존 6 블록과 동일 패턴 |
| SVG z-order 깨져 막대 가림 | 시각 손실 | zebra rect 를 SVG 의 *첫 자식*으로 — paint order 보장 |
| `STRIPE_CLASSES['gantt']` dummy entry가 미래에 className으로 잘못 쓰임 | 잠재 버그 | 코드 주석 한 줄 명시 (Section 2의 inline comment) |

---

## 8. lat / LLM rules 동기화

### 8.1 `docs/lat/documents.md`

- `GanttBlock` 항목 (현재 짧음 — `kinds?` 가 아닌 `tasks[]`)에 `options.stripe?` 1줄 추가
- "zebra `options.stripe` 기본 ON" Gotcha (#10) 의 *6 종 → 7 종* 으로 갱신:
  ```diff
  -10. **zebra `options.stripe` 기본은 `true`** — table/spreadsheet/list/kpi-cards/
  -    bibliography/figure-index 6 종 모두 동일 contract: ...
  +10. **zebra `options.stripe` 기본은 `true`** — table/spreadsheet/list/kpi-cards/
  +    bibliography/figure-index/gantt 7 종 모두 동일 contract: ...
  ```
- 마지막 줄 "table/spreadsheet 만 docx 등 export 에 반영, 나머지 5 종은 FE-only 시각 효과" → "**나머지 5 종**" 도 → "**나머지 5 종 + gantt는 SVG paint** (FE-only)" 같은 식으로 갱신

### 8.2 `docs/llm-widgets-via-api.md`

- §3.11 `gantt` 섹션 (현재 11번째)에 stripe 한 줄:
  ```
  선택적 `options.stripe` (boolean, default `true`) — task row 단위 zebra
  (label 영역 포함).
  ```
- 마지막 §3.22 의 "★ zebra-striping 6 종" → **7 종** 으로 숫자 갱신 + `gantt` 추가

---

## 9. 작업 순서 (Do 단계 가이드)

1. **schema** — document.json `GanttBlock` 에 `options.stripe?` 추가 + `pnpm schema:gen` (TS+Pydantic 둘 다)
2. **zebra.ts** — union +1, map +1 (with comment), 단위 테스트 +1
3. **GanttBlock.tsx** — `stripeOn` 변수 + zebra rect map (SVG 첫 자식으로) + Plan §3 시각 검증
4. **GanttBlockEditor.tsx** — header row 안 `<ZebraToggle>` 1줄
5. **GanttBlock.zebra.test.tsx** — view 회귀 2 케이스 (count + OFF)
6. **GanttBlockEditor.test.tsx** — editor 통합 +1 케이스
7. **`pnpm typecheck` + `pnpm vitest run`** — 전체 통과. snapshot 1 갱신 예상 (gantt)
8. **API pytest sanity** — `apptainer exec instance://mxwp_api ... pytest`
9. **lat documents.md + LLM widgets rules 갱신**
10. **단일 커밋** — `feat(blocks): gantt zebra — 7번째 블록 row stripe`

---

## 10. Open Items (Do 단계로 넘김)

| # | 항목 | 결정 시점 |
|---|---|---|
| O1 | snapshot 갱신 후 시각 회귀 — gantt가 단일 컴포넌트라 영향 적지만 AllBlocksRender 통합 회귀 한 번 더 확인 | Do 단계 |
| O2 | i18n 키 `editor.gantt.stripeLabel` 신설? | ZebraToggle 의 기본 label "줄무늬" 사용 — 별도 i18n 키 yagni (Do 단계 즉결) |

---

## 11. Acceptance 재확인

Plan §1.5 C1~C10 그대로 — 본 design 으로 모두 만족. 추가 분석 없음.
