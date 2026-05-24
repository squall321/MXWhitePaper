---
template: design
version: 1.0
feature: zebra-striping
date: 2026-05-24
project: MX White Paper
---

# Zebra Striping — Design Document

> **Planning Doc**: [zebra-striping.plan.md](../../01-plan/features/zebra-striping.plan.md)
> **Status**: Draft

---

## 0. Recap (Plan에서)

- 4 블록 (list / kpi-cards / bibliography / figure-index) 에 zebra-striping 확장
- 기본 ON, `options.stripe === false` 일 때만 OFF (table/spreadsheet contract 그대로)
- 색 토큰: kpi-cards=blue-050 / 나머지=gray-050 / dark-mode 자동
- 공통 `<ZebraToggle>` 컴포넌트로 토글 UI 1 곳에 모음
- export: docx/pptx/md 무시, html 자동 적용 (className 그대로)
- LOC 추정 ~380, 시간 ~3시간

---

## 1. 파일 구조

```
apps/web/src/
├── features/editor/blocks/
│   ├── zebra.ts                            # EXTEND — ZebraBlockType union + STRIPE_CLASSES map
│   ├── ZebraToggle.tsx                     # NEW   — 공통 토글 UI 컴포넌트
│   ├── KpiCardsBlockEditor.tsx             # EDIT  — toolbar에 <ZebraToggle> 1줄
│   ├── BibliographyBlockEditor.tsx         # EDIT  — toolbar에 <ZebraToggle> 1줄
│   ├── FigureIndexBlockEditor.tsx          # NEW   — mini editor (title + kinds + <ZebraToggle>)
│   └── __tests__/
│       ├── zebra.test.ts                   # EDIT  — 신규 4 케이스 (4 blockType 색)
│       ├── ZebraToggle.test.tsx            # NEW   — 토글 클릭 → onChange options.stripe
│       ├── KpiCardsBlockEditor.test.tsx    # EDIT  — 토글 통합 (이미 파일 있으면)
│       ├── BibliographyBlockEditor.test.tsx# EDIT  — 토글 통합
│       └── FigureIndexBlockEditor.test.tsx # NEW   — 토글 통합
├── features/editor/components/
│   └── ListBlockEditor.tsx                 # EDIT  — toolbar에 <ZebraToggle> 1줄
├── features/editor/registry.ts (또는 blocknote-config.ts)
│                                            # EDIT  — figure-index → FigureIndexBlockEditor 매핑
├── components/blocks/
│   ├── ListBlock.tsx                       # EDIT  — <li> className에 getZebraClass()
│   ├── KpiCardsBlock.tsx                   # EDIT  — <li> className에 getZebraClass()
│   ├── BibliographyBlock.tsx               # EDIT  — <li> className에 getZebraClass()
│   ├── FigureIndexBlock.tsx                # EDIT  — <li> className에 getZebraClass()
│   └── __tests__/
│       ├── ListBlock.zebra.test.tsx        # NEW   — odd 행 className 회귀
│       └── BibliographyBlock.zebra.test.tsx# NEW   — odd 행 className 회귀
└── (없음 — schema는 packages/shared)

packages/shared/
└── schemas/document.json                   # EDIT  — 4 블록 정의에 options.stripe? optional 필드

apps/api/
└── (자동) app/schemas/document.py          # `pnpm schema:gen` 으로 재생성
```

**파일 수**: 신규 4 + 편집 11 = **15 files** (테스트 포함). LOC 추정 plan 그대로 ~380.

---

## 2. zebra.ts 시그니처

```ts
// BEFORE
export type ZebraBlockType = 'table' | 'spreadsheet'

const STRIPE_CLASSES: Record<ZebraBlockType, string> = {
  table: 'bg-gray-50',
  spreadsheet: 'bg-[var(--smsg-blue-050)]',
}

export function getZebraClass(
  blockType: ZebraBlockType,
  opts: ZebraOpts | undefined,
  rowIndex: number,
): string {
  const stripe = opts?.stripe !== false
  if (!stripe) return ''
  return rowIndex % 2 === 1 ? STRIPE_CLASSES[blockType] : ''
}

// AFTER
export type ZebraBlockType =
  | 'table'
  | 'spreadsheet'
  | 'list'
  | 'kpi-cards'
  | 'bibliography'
  | 'figure-index'

const STRIPE_CLASSES: Record<ZebraBlockType, string> = {
  table:           'bg-gray-50',
  spreadsheet:     'bg-[var(--smsg-blue-050)]',
  list:            'bg-gray-50',
  'kpi-cards':     'bg-[var(--smsg-blue-050)]',
  bibliography:    'bg-gray-50',
  'figure-index':  'bg-gray-50',
}

// getZebraClass 시그니처/본문 변경 없음 — 새 type 만 union에 추가되었으므로
// 기존 호출자(TableBlock, SpreadsheetBlockEditor 등)는 영향 0.
```

**불변식 확인**:
- 함수는 pure — `rowIndex` 입력만 보고 className 출력
- `opts?.stripe !== false` 가 ON/OFF 단일 분기 — 옛 문서 (`options` 없음 또는 `stripe` 미지정) 도 ON 유지
- `rowIndex % 2 === 1` (= 1-indexed 짝수 행) 가 stripe 받음 — 사용자가 보는 *첫 데이터 행*은 깨끗

---

## 3. `<ZebraToggle>` 공통 컴포넌트

### 3.1 API

```tsx
// apps/web/src/features/editor/blocks/ZebraToggle.tsx

import type { ZebraBlockType } from './zebra'

interface Props {
  /** 어느 블록에 부착되는지 — `data-zebra-toggle-{blockType}` attribute로 직렬화 */
  blockType: ZebraBlockType
  /** 현재 블록의 options 객체 (없으면 undefined) */
  options: { stripe?: boolean } | undefined
  /** options.stripe 변경 시 호출. 호출자가 patch + persist 책임 */
  onChange: (next: { stripe: boolean }) => void
  /** 짧은 label override (기본 "줄무늬") */
  label?: string
}

export function ZebraToggle({
  blockType, options, onChange, label = '줄무늬',
}: Props): JSX.Element
```

### 3.2 마크업 (SpreadsheetBlockEditor 패턴 통일)

```tsx
<label
  data-zebra-toggle={blockType}
  className="flex items-center gap-1 text-xs text-gray-600"
>
  <input
    type="checkbox"
    checked={options?.stripe !== false}
    onChange={(e) => onChange({ stripe: e.target.checked })}
    aria-label={`${label} 표시`}
  />
  {label}
</label>
```

**Pre-existing `SpreadsheetBlockEditor` 의 `data-spreadsheet-stripe-toggle` 처리**: 기존 코드 그대로 두고 (E2E 테스트 호환), 새 컴포넌트는 `data-zebra-toggle={blockType}` 컨벤션. 이후 SpreadsheetBlockEditor 도 `<ZebraToggle>` 로 점진 마이그 가능 — 본 사이클 out-of-scope.

### 3.3 단위 테스트 (`ZebraToggle.test.tsx`, 4 케이스)

| # | 케이스 | 기대 |
|---|---|---|
| 1 | `options=undefined` → checked=true (default ON) | `<input checked>` rendered |
| 2 | `options.stripe=false` → checked=false | `<input>` not checked |
| 3 | 체크박스 click → `onChange({stripe: !prev})` 1회 호출 | spy 인자 검증 |
| 4 | `data-zebra-toggle={blockType}` attribute 확인 | each blockType별 1 케이스로 묶음 (parametrize) |

---

## 4. 블록별 통합 패치

### 4.1 ListBlock (`ListBlock.tsx` View + `ListBlockEditor.tsx` Editor)

**스키마 (document.json)**:

```diff
 "ListBlock": {
   "type": "object",
-  "required": ["type", "id", "style", "items"],
+  "required": ["type", "id", "style", "items"],
   "additionalProperties": false,
   "properties": {
     "type":  { "const": "list" },
     "id":    { "$ref": "#/$defs/Ulid" },
     "style": { "enum": ["bullet", "number", "check"] },
     "items": { "type": "array", "items": { "type": "string" } },
+    "options": {
+      "type": "object",
+      "additionalProperties": false,
+      "properties": {
+        "stripe": { "type": "boolean", "default": true,
+          "description": "행 단위 zebra-striping (default ON). false 일 때만 OFF." }
+      }
+    },
     "meta":  { "$ref": "#/$defs/BlockMeta" }
   }
 }
```

**View (`ListBlock.tsx`)**:

`enriched.map(({ raw, depth, idx, ... }) => <li>)` 에서:

```tsx
const zebra = depth === 0
  ? getZebraClass('list', block.options, dataIdx)
  : ''
// className 조립: 기존 className + ` ${zebra}` (zebra 빈 문자열이면 영향 0)
```

- **`depth === 0` 만 stripe** — 중첩 항목은 들여쓰기와 배경이 겹치면 보기 안 좋음 (Decision #6)
- `dataIdx` 는 *depth=0 항목 한정 카운터* — 중첩 항목은 부모 인덱스에 영향 주지 않음

**Editor (`ListBlockEditor.tsx`)**:

기존 toolbar 끝에 `<ZebraToggle blockType="list" options={local.options} onChange={...} />` 1줄. patch는 `schedule({...local, options: {...local.options, stripe: v}})`.

### 4.2 KpiCardsBlock

**스키마**:

```diff
 "KpiCardsBlock": {
   ...
   "properties": {
     "type":  { "const": "kpi-cards" },
     ...
     "items": { ... },
+    "options": {
+      "type": "object",
+      "additionalProperties": false,
+      "properties": {
+        "stripe": { "type": "boolean", "default": true }
+      }
+    },
     "meta": { "$ref": "#/$defs/BlockMeta" }
   }
 }
```

**View (`KpiCardsBlock.tsx`)**:

```tsx
const opts = block.options
{block.items.map((item, idx) => {
  const zebra = getZebraClass('kpi-cards', opts, idx)
  return (
    <li key={idx} className={`rounded border border-gray-200 ${zebra || 'bg-white'} p-3 shadow-sm`}>
      ...
```

- 카드 단위 `:nth-of-type(2n)` (Decision #5) — `idx % 2 === 1` 가 그대로 그 효과
- 카드는 원래 `bg-white` 가 있었으므로 zebra 클래스가 그것을 덮어쓰도록 클래스 순서 신경

**Editor (`KpiCardsBlockEditor.tsx`)**:

toolbar에 `<ZebraToggle blockType="kpi-cards" options={local.options} onChange={...} />`.

### 4.3 BibliographyBlock

**스키마**:

```diff
 "BibliographyBlock": {
   ...
   "properties": {
     ...
     "entries": { ... },
+    "options": {
+      "type": "object",
+      "additionalProperties": false,
+      "properties": {
+        "stripe": { "type": "boolean", "default": true }
+      }
+    },
     "meta": { "$ref": "#/$defs/BlockMeta" }
   }
 }
```

**View (`BibliographyBlock.tsx`)**:

`<ol>` 안 `<li>` 에서:

```tsx
const zebra = getZebraClass('bibliography', block.options, idx)
<li className={`leading-6 ${zebra}`}>...</li>
```

**Editor (`BibliographyBlockEditor.tsx`)**:

기존 placeholder 영역에 `<ZebraToggle blockType="bibliography" ... />` 추가.

### 4.4 FigureIndexBlock

가장 까다로움 — **dedicated editor 없고 entries는 런타임 DOM 스캔**.

**스키마**:

```diff
 "FigureIndexBlock": {
   ...
   "properties": {
     "type":  { "const": "figure-index" },
     "id":    { "$ref": "#/$defs/Ulid" },
     "title": { ... },
     "kinds": { ... },
+    "options": {
+      "type": "object",
+      "additionalProperties": false,
+      "properties": {
+        "stripe": { "type": "boolean", "default": true }
+      }
+    },
     "meta":  { "$ref": "#/$defs/BlockMeta" }
   }
 }
```

**View (`FigureIndexBlock.tsx`)**:

```tsx
{grouped.map((g) => (
  ...
  <ol className="ml-3 list-decimal text-gray-700">
    {g.entries.map((e, idx) => {
      const zebra = getZebraClass('figure-index', block.options, idx)
      return (
        <li key={`${e.kind}-${e.n}`} className={zebra}>
          ...
        </li>
      )
    })}
  </ol>
  ...
))}
```

- *그룹별로 인덱스 리셋* — 각 `<ol>` 의 `g.entries.map((e, idx))` 가 그룹 한정 카운터 (Plan Q2 결정)

**Editor 신설 (`FigureIndexBlockEditor.tsx`)**:

현재 figure-index는 dedicated editor가 없음 — 즉 일반 block 편집 인터페이스 외에 옵션을 손볼 곳이 없다. Plan Z4 요구 ("옵션 패널 노출") 충족을 위해 *작은* editor 신설:

```tsx
// apps/web/src/features/editor/blocks/FigureIndexBlockEditor.tsx (NEW)

interface Props {
  slug: Slug
  block: FigureIndexBlock
}

export function FigureIndexBlockEditor({ slug, block }: Props) {
  const [local, setLocal] = useState<FigureIndexBlock>(block)
  // ... etag/persist 패턴은 다른 editor 들과 동일 (800ms debounce)

  return (
    <div data-figure-index-editor className="space-y-2 rounded border border-gray-200 bg-white p-2">
      <input
        type="text"
        value={local.title ?? ''}
        placeholder="그림 목차"
        onChange={(e) => schedule({...local, title: e.target.value || undefined})}
        className="..."
      />
      <ZebraToggle
        blockType="figure-index"
        options={local.options}
        onChange={({ stripe }) => schedule({ ...local, options: { ...local.options, stripe } })}
      />
      <details>
        <summary>미리보기</summary>
        <FigureIndexBlockView block={local} />
      </details>
    </div>
  )
}
```

**editor 등록**: `blocknote-config.ts` 또는 block-editor registry에 `'figure-index' → FigureIndexBlockEditor` 매핑. 기존 registry 위치는 design 진행 중 확인 — registry 한 줄 추가로 끝.

> *주의*: figure-index editor에 title/kinds 같은 *다른* 기존 기능까지 굳이 노출할 필요는 없으나, 기존 사용자가 title을 못 바꾼다는 회귀가 생기면 곤란하므로 title 1개는 같이 넣음. kinds 편집은 본 사이클 out-of-scope (있으면 좋지만 plan 380 LOC 예산 초과).

---

## 5. 호출 흐름

```
[User checks toggle]
       │
       ▼
ZebraToggle onChange  ─►  blockEditor.schedule({...block, options:{stripe:v}})
                                     │
                                     ▼
                              800ms debounce
                                     │
                                     ▼
                              patchBlock(slug, id, {options}, etag)
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
                            View: getZebraClass(...) ─► className
```

**Round-trip**: `options.stripe` 는 단순 boolean — JSON 직렬화/역직렬화 무손실. DOCX/PPTX import 시엔 보존 안 됨 (FE 시각 효과). DOCX export 도 무시 (Decision #10).

---

## 6. 테스트 매트릭스

| 파일 | 신규/편집 | 케이스 수 | 시나리오 |
|---|---|---|---|
| `__tests__/zebra.test.ts` | EDIT | +4 | 각 신규 blockType별 STRIPE_CLASSES 검증 (list=gray, kpi=blue, bibliography=gray, figure-index=gray) + OFF 동작 1 + default ON 1 |
| `__tests__/ZebraToggle.test.tsx` | NEW | 4 | default ON / OFF / click→onChange / data-attribute |
| `__tests__/KpiCardsBlockEditor.test.tsx` | EDIT (or NEW) | +1 | toggle click → persist payload 검증 |
| `__tests__/BibliographyBlockEditor.test.tsx` | EDIT (or NEW) | +1 | 동일 |
| `__tests__/FigureIndexBlockEditor.test.tsx` | NEW | +1 | 동일 |
| `__tests__/ListBlockEditor.test.tsx` | EDIT (있으면) | +1 | 동일 |
| `components/blocks/__tests__/ListBlock.zebra.test.tsx` | NEW | 2 | odd 행 className gray-50 + depth≥1 자식은 stripe 없음 |
| `components/blocks/__tests__/BibliographyBlock.zebra.test.tsx` | NEW | 1 | odd 행 className gray-50 |
| **합계** | | **15** | (Plan에서 10 추정 → design 단계에서 +5: editor 토글 통합 4, view zebra 1) |

---

## 7. 회귀 영향 분석

| 위험 | 영향 | 대응 |
|---|---|---|
| Pydantic 재생성 후 옛 문서 (`options` 없음) 에 valid 검증 실패 | 데이터 fetch 실패 | `options` 자체가 optional + `additionalProperties: false` 안에서 `stripe`만 optional이라 옛 문서 `{type:'list', items:[...]}` 그대로 통과 |
| zebra.ts 단위 테스트가 union 추가로 컴파일 실패 | CI 빨강 | 새 case 추가하면 통과. TypeScript는 missing key 컴파일 에러 줘서 STRIPE_CLASSES 누락 즉시 발견 |
| ListBlock 의 nested 항목 indexing이 zebra 카운터를 깨뜨림 | 시각 어긋남 | `depth === 0` gate + `dataIdx` 별도 카운터로 분리 (4.1 참조) |
| KpiCards grid 컬럼 수가 viewport별로 변해 zebra 행이 어긋남 | 시각 불일치 | "정확한 행 단위 stripe" 가 아닌 "카드 단위 음영" 으로 정의 (Decision #5). 사용자 onboarding 메시지 불필요 — UI 자체로 자명 |
| FigureIndex editor가 신설되면서 기존 placeholder 동작과 충돌 | 일반 block 편집 UI 깨짐 | registry에 매핑 추가 — registry가 매핑 없을 때 fallback (placeholder/제너릭) 로 가던 동작 유지. 회귀 0 |
| Bibliography가 카테고리 그룹을 가져 zebra 인덱스가 그룹별로 리셋 안 됨 | 사용자 혼란 | Plan Q2 결정: bibliography schema에 그룹 개념 없음. entries는 평탄 배열 — 단일 카운터 정상 |
| LLM 이 새 옵션을 모름 → 생성 docx에 항상 stripe 미적용 | 단순 default 동작 (= ON) | 기본값 ON이라 미지정도 정상 (rules 1줄 추가는 best-effort) |
| 다크 모드에서 stripe 가 너무 진함/연함 | UX 후퇴 | `--smsg-gray-050` / `--smsg-blue-050` 의 dark 변형은 table/spreadsheet에서 이미 검증됨 |

---

## 8. lat / LLM rules 동기화

### 8.1 `docs/lat/documents.md`

- Block schema 표에 `list / kpi-cards / bibliography / figure-index` 의 `options.stripe?` 1줄씩 추가
- "options 컨벤션" 절(있으면)에 `stripe` 가 *공통 옵션 키*임을 한 줄 명시 (`zebra.ts` 가 dispatcher)

### 8.2 `docs/llm-widgets-via-api.md`

- list / kpi-cards / bibliography / figure-index 섹션의 "options" 표에 `stripe: bool (default true) — 행 zebra-striping toggle` 1줄씩

### 8.3 `docs/lat/charts.md`

- 영향 없음 (chart는 행 없음)

### 8.4 신규 lat 문서?

`docs/lat/blocks-styling.md` 신설 여부 — **유보**. zebra.ts 가 단일 파일이고 dispatcher 단순. blocks-styling 신설은 다른 횡단 styling 옵션 (밀도, 격자선, sticky 등) 이 더 모이면 그때 (다음 사이클 후보).

---

## 9. 작업 순서 (Do 단계 가이드)

1. **schema** — document.json 4 곳 편집 + `pnpm schema:gen` 실행 → 컴파일 에러 없음 확인
2. **zebra.ts** — type union + STRIPE_CLASSES map 확장 + 단위 테스트 4 (TypeScript 컴파일이 누락 발견)
3. **ZebraToggle.tsx** 신설 + 단위 테스트 4
4. **ListBlock.tsx + ListBlockEditor.tsx** — View className + Editor 토글
5. **KpiCardsBlock + Editor** — 동일
6. **BibliographyBlock + Editor** — 동일
7. **FigureIndexBlock + Editor 신설 + registry 매핑** — 가장 신중히
8. **view 회귀 테스트 2** (ListBlock.zebra, BibliographyBlock.zebra)
9. **editor 통합 테스트 4** (각 editor당 1)
10. **`pnpm test` + `pnpm typecheck`** — 전체 통과
11. **수동 UI 확인** — 4 블록 각각 토글 ON/OFF 시각 확인, 다크 모드 토글
12. **lat documents.md + LLM widgets rules 갱신**
13. **단일 커밋** — `feat(blocks): zebra-striping — list/kpi-cards/bibliography/figure-index 확장`

---

## 10. Open Items (Do 단계로 넘김)

| # | 항목 | 결정 시점 |
|---|---|---|
| O1 | block-editor registry 정확한 위치 (`blocknote-config.ts` 인지, 별도 registry 인지) | Do 단계 (코드 보고 즉결) |
| O2 | `ListBlockEditor` 이미 test 파일이 있는지 — 없으면 신설 vs 있는 파일에 +1 | Do 단계 |
| O3 | `KpiCardsBlockEditor` / `BibliographyBlockEditor` toolbar 위치 — header 줄에 inline인지 별도 옵션 패널인지 | Do 단계 (컴포넌트 직접 확인) |
| O4 | FigureIndexBlockEditor에 kinds 편집 UI 같이 넣을지 | Do 단계 (LOC 예산 초과 시 yagni — Open) |

---

## 11. Acceptance 재확인

Plan §1.5 의 C1~C11 그대로 — 본 design 으로 모두 만족 가능. 추가 분석 없음.
