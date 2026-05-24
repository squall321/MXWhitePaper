---
template: design
version: 1.0
feature: gantt-darkmode
date: 2026-05-24
project: MX White Paper
---

# Gantt Darkmode — Design Document

> **Planning Doc**: [gantt-darkmode.plan.md](../../01-plan/features/gantt-darkmode.plan.md)
> **Status**: Draft

---

## 0. Recap

- D1 단일 갭 — GanttBlock SVG 5 hex + figure className 다크 토큰화
- 새 토큰 신설 X, schema 무변경, options 무관
- 검증된 패턴 2개 사용:
  - SVG: `fill="var(--smsg-...)"` 직접 (Tailwind 무관, JIT 위험 0)
  - figure: `dark:` Tailwind 변형 (RestrictedBlockPlaceholder.tsx 검증)
- LOC ~30, 시간 ~1h

---

## 1. 파일 구조

```
apps/web/src/
├── components/blocks/
│   ├── GanttBlock.tsx                       # EDIT — 5 hex + figure className
│   └── __tests__/
│       ├── GanttBlock.darkmode.test.tsx     # NEW — 토큰 참조 등장 검증 (1 케이스)
│       ├── GanttBlock.zebra.test.tsx        # EDIT — fill 검증 hex → var 갱신
│       └── __snapshots__/AllBlocksRender.test.tsx.snap  # auto-update
├── features/editor/blocks/
│   └── zebra.ts                             # EDIT — STRIPE_CLASSES['gantt'] 주석 1줄 update

docs/lat/documents.md                        # EDIT — GanttBlock entry 한 줄 갱신
```

**파일 수**: 신규 1 + 편집 4 = **5 files**. LOC 추정 plan 그대로 ~30.

---

## 2. GanttBlock.tsx 패치

### 2.1 figure 배경/테두리

```diff
-    <figure className="overflow-x-auto rounded border border-gray-200 bg-white p-2">
+    <figure className="overflow-x-auto rounded border border-gray-200 bg-white p-2 dark:border-gray-700 dark:bg-gray-900">
```

### 2.2 SVG 색 (5곳)

```diff
-        {/* zebra rows */}
         {stripeOn &&
           tasks.map((_, idx) =>
             idx % 2 === 1 ? (
               <rect
                 key={`zebra-${idx}`}
                 data-gantt-zebra-row
                 x={0}
                 y={idx * rowH + 4}
                 width={totalW}
                 height={rowH}
-                fill="#F9FAFB"
+                fill="var(--smsg-gray-050)"
               />
             ) : null,
           )}
         {/* axis line */}
         <line
           ...
-          stroke="#E5E7EB"
+          stroke="var(--smsg-gray-200)"
         />
         {tasks.map((t, idx) => {
           ...
           return (
             <g key={idx}>
-              <text x={4} y={y + 14} fontSize={11} fill="#1A1A1A">
+              <text x={4} y={y + 14} fontSize={11} fill="var(--smsg-gray-900)">
                 {t.name}
               </text>
-              <rect x={x} y={y} width={w} height={rowH - 8} fill="#2E5BFF" rx={2} />
+              <rect x={x} y={y} width={w} height={rowH - 8} fill="var(--smsg-blue-500)" rx={2} />
               {progressW > 0 && (
-                <rect x={x} y={y} width={progressW} height={rowH - 8} fill="#1428A0" rx={2} />
+                <rect x={x} y={y} width={progressW} height={rowH - 8} fill="var(--smsg-blue-700)" rx={2} />
               )}
             </g>
           )
         })}
```

### 2.3 동작 원리

- SVG `fill="var(...)"` / `stroke="var(...)"` 는 브라우저 컴퓨티드 스타일에서 CSS 변수 해석 → tokens.css의 light 값 또는 `.dark` 값으로 자동 치환
- light: `--smsg-gray-050` = `#F9FAFB` (= 기존 hex 동일)
- dark: `--smsg-gray-050` = `#111827` (deepest panel)
- 시각 회귀 0 (light) + 다크 자동 적용

---

## 3. zebra.ts 주석 갱신

```diff
   // gantt is an SVG block — its rows are painted via inline `<rect
-  // fill="#F9FAFB">` (Tailwind gray-50 hex equivalent), not a className.
+  // fill="var(--smsg-gray-050)">` (token reference for darkmode), not a className.
   // The entry below exists so ZebraToggle and the exhaustive type check
   // accept blockType="gantt"; the value is intentionally unused by
   // GanttBlockView.
   gantt: 'bg-gray-50',
```

---

## 4. 테스트 매트릭스

| 파일 | 신규/편집 | 케이스 수 | 시나리오 |
|---|---|---|---|
| `__tests__/GanttBlock.darkmode.test.tsx` | NEW | 1 | SVG에 `var(--smsg-blue-500)` `var(--smsg-gray-900)` 등 5개 토큰 모두 등장 + figure className에 `dark:bg-gray-900` |
| `__tests__/GanttBlock.zebra.test.tsx` | EDIT | 변경 0 | `fill="#F9FAFB"` → `fill="var(--smsg-gray-050)"` 로 expect 수정 |
| AllBlocksRender snapshot | EDIT | 1 update | hex → var 변환 |

**합계**: 신규 1 + 편집 2 (테스트 fixture 갱신 포함). plan 매트릭스 그대로.

---

## 5. 회귀 영향 분석

| 위험 | 영향 | 대응 |
|---|---|---|
| zebra.test.tsx의 `expect(html).toContain('fill="#F9FAFB"')` 깨짐 | 테스트 빨강 | expect 를 `fill="var(--smsg-gray-050)"` 로 갱신 (1줄) |
| AllBlocksRender snapshot 깨짐 | 테스트 빨강 | `pnpm vitest run -u` 로 갱신 (gantt 1) |
| 라이트 모드 픽셀 변화 | 시각 회귀 | 0 — light 토큰 값이 기존 hex와 동일 |
| 다크 모드 미적용 환경 (테마 OFF) | 영향 0 | CSS 변수 default가 light → 라이트 모드와 동일 |
| 옛 GanttBlock 사용처 (export 등) 영향 | 영향 0 | export는 BE Python (별도 placeholder), FE SVG와 무관 |

---

## 6. lat 갱신

`docs/lat/documents.md` 의 GanttBlock entry — 한 줄만 추가:

```diff
 - `GanttBlock` — `tasks[]` (`{name, start, end, progress?}`), `options.stripe?`
   (default `true`, SVG `<rect fill="#F9FAFB">` 로 task row 음영 — `<rect>`는
   SVG 첫 자식이라 axis line / 막대 뒤에 paint).
+  다크 모드 자동 대응 (모든 fill/stroke 가 `var(--smsg-...)` 토큰 — tokens.css
+  `.dark` 변형 자동 치환).
```

---

## 7. 작업 순서 (Do)

1. **GanttBlock.tsx** — 5 SVG fill/stroke 교체 + figure className dark 변형 추가
2. **zebra.ts** — `STRIPE_CLASSES['gantt']` 주석 1줄 갱신
3. **GanttBlock.zebra.test.tsx** — fill expect `#F9FAFB` → `var(--smsg-gray-050)`
4. **GanttBlock.darkmode.test.tsx** 신설 — 토큰 + dark className 검증 1 케이스
5. **vitest run -u** — AllBlocksRender snapshot 갱신
6. **vitest run + typecheck + API pytest** — 전체 통과
7. **lat documents.md** 한 줄 갱신
8. **단일 커밋** — `feat(blocks): gantt darkmode — SVG/figure 토큰화`

---

## 8. Open Items

| # | 항목 | 결정 |
|---|---|---|
| O1 | 다크 모드 시각 확인 — 브라우저 manual 테스트 | Do 단계 마지막 |
| O2 | gantt-zebra.report.md의 darkmode candidate 항목을 retro 검증 | Report 단계 |

---

## 9. Acceptance 재확인

Plan §1.5 C1~C9 그대로 만족.
