# Zebra Striping for Table & Spreadsheet Blocks — Design Document

> **Plan**: [[../../01-plan/features/zebra-striping.plan.md]]
> **Feature**: zebra-striping
> **Version**: 0.1.0
> **Date**: 2026-05-18
> **Status**: Draft

---

## 0. Open Questions 결론

| # | Plan의 질문 | 결론 |
|---|---|---|
| Q1 | spreadsheet zebra 색 토큰 | **`--smsg-blue-050` 사용**. `apps/web/src/styles/tokens.css:13`에 이미 정의됨 (`#F5F7FF` light / `#161B36` dark). table은 기존 `bg-gray-50` 유지 (= `--smsg-gray-050`). 두 토큰 모두 다크모드 자동 처리. |
| Q2 | html export 처리 | spreadsheet 핸들러가 html_export에 *아직 없음* — 본 사이클 범위 밖. 현 사이클은 **에디터 + docx export**만 다룬다. html export는 spreadsheet 자체가 없으니 zebra도 의미 없음. |
| Q3 | docx export 처리 | docx export는 옵션을 *읽지 않음*. `table.style = "Light Grid"` 그대로 유지 (Word built-in zebra 효과는 이 스타일에 포함). 옵션은 스키마 레벨에서만 보존되고 docx로 굽지 않음. |
| Q4 | hover/selected 충돌 | row hover/selected는 **없음** (편집 모드에 컬럼 hover만 존재, `group-hover/col` 등은 컬럼 단위). zebra와 충돌 없음. focus 시 셀이 `bg-white`로 덮이는 건 의도된 UX (편집 중 셀 강조)므로 유지. |
| Q5 | 테스트 mount 비용 | snapshot 안 씀. **props 단위 단위테스트**로 충분 — `getRowClassName(opts, rowIndex)` 같은 순수 함수를 분리해서 그것만 검증. UI mount는 vitest jsdom으로 1~2개 스모크만. |

---

## 1. 영향 받는 파일 (정확한 위치)

| 영역 | 파일 | 변경 |
|---|---|---|
| Schema | [[packages/shared/schemas/document.json]] L1139~1156 | `SpreadsheetBlock`에 `options.stripe` 추가 |
| Editor (Table) | [[apps/web/src/features/editor/blocks/TableBlockEditor.tsx]] L333, L514 | 하드코딩 `odd:bg-white even:bg-gray-50` → 조건부 |
| Editor (Spreadsheet) | [[apps/web/src/features/editor/blocks/SpreadsheetBlockEditor.tsx]] L198~282 | zebra 클래스 + 상단 토글 |
| docx export | [[apps/api/app/services/docx_export.py#_b_spreadsheet]] L1423~1466 | 변경 없음 (Light Grid 그대로) |
| html export (spreadsheet) | — | 핸들러 자체가 없음 → 본 사이클 범위 밖 |
| Util (신규) | `apps/web/src/features/editor/blocks/zebra.ts` | `getZebraClass(blockType, opts, rowIndex)` 순수 함수 |
| lat | [[docs/lat/documents.md#block-types]] | spreadsheet 블록 항목 신규 + table options 표 갱신 |
| LLM rules | [[docs/llm-input-rules.md]] + [[dist/llm-docx-toolkit/llm-input-rules.md]] | spreadsheet `options.stripe` 노출 |
| RAG | [[dist/llm-docx-toolkit/rag/chunks.jsonl]] + `index.lock` | 위 갱신 후 chunker 재실행 |
| Tests | `apps/web/src/features/editor/blocks/__tests__/zebra.test.ts` (신규) | `getZebraClass()` 단위테스트 |

---

## 2. Schema 변경 — `SpreadsheetBlock`

### 2.1 현재 (line 1139~1156)

```json
"SpreadsheetBlock": {
  "type": "object",
  "required": ["type", "id", "cols", "rows", "cells"],
  "additionalProperties": false,
  "properties": {
    "type":    { "const": "spreadsheet" },
    "id":      { "$ref": "#/$defs/Ulid" },
    "title":   { "type": "string" },
    "cols":    { "type": "integer", "minimum": 1, "maximum": 26, "default": 6 },
    "rows":    { "type": "integer", "minimum": 1, "maximum": 200, "default": 10 },
    "headers": { "type": "array", "items": { "type": "string" } },
    "cells":   { ... },
    "meta":    { "$ref": "#/$defs/BlockMeta" }
  }
}
```

### 2.2 변경 후

```json
"SpreadsheetBlock": {
  ...
  "properties": {
    ... (기존 그대로) ...
    "options": {
      "type": "object",
      "additionalProperties": false,
      "description": "Visual rendering options. All fields optional with sensible defaults.",
      "properties": {
        "stripe": {
          "type": "boolean",
          "description": "Zebra-striped data rows for readability. Default true; set false to disable. Header row is unaffected."
        }
      }
    },
    "meta":    { "$ref": "#/$defs/BlockMeta" }
  }
}
```

### 2.3 호환성

- `options` 자체가 옵셔널 → 기존 모든 spreadsheet 문서 *그대로 통과*.
- `additionalProperties: false`이지만 `options`는 새 *허용된* 필드이므로 추가에 충돌 없음.
- 마이그레이션 SQL/스크립트 **불필요**.

---

## 3. 신규 유틸 — `zebra.ts`

테스트 가능한 순수 함수로 분리한다 (UI mount 비용 회피).

```ts
// apps/web/src/features/editor/blocks/zebra.ts

export type ZebraOpts = { stripe?: boolean }
export type ZebraBlockType = 'table' | 'spreadsheet'

const STRIPE_CLASSES: Record<ZebraBlockType, string> = {
  table:       'bg-gray-50',                    // 기존 톤 유지 (= var(--smsg-gray-050))
  spreadsheet: 'bg-[var(--smsg-blue-050)]',     // 시각 구분용 옅은 파랑
}

/**
 * 행 인덱스 기반 zebra 클래스 반환. stripe=false (명시적 off) 면 빈 문자열.
 * 데이터 행 짝수 (0-index: r=1,3,5…) 만 색칠 — 헤더는 영향 없음.
 */
export function getZebraClass(
  blockType: ZebraBlockType,
  opts: ZebraOpts | undefined,
  rowIndex: number,
): string {
  const stripe = opts?.stripe !== false  // default true
  if (!stripe) return ''
  return rowIndex % 2 === 1 ? STRIPE_CLASSES[blockType] : ''
}
```

### 3.1 결정 — Tailwind arbitrary value 사용

`bg-[var(--smsg-blue-050)]` 형태는 Tailwind JIT에서 정상 지원. theme 확장 (`bg-smsg-blue-050` 클래스 신설)은 *별도 사이클* — 본 사이클은 토큰 *참조* 까지만.

### 3.2 단위테스트

```ts
// apps/web/src/features/editor/blocks/__tests__/zebra.test.ts
import { describe, it, expect } from 'vitest'
import { getZebraClass } from '../zebra'

describe('getZebraClass', () => {
  it('table: stripe default ON, odd rows colored', () => {
    expect(getZebraClass('table', undefined, 0)).toBe('')
    expect(getZebraClass('table', undefined, 1)).toBe('bg-gray-50')
    expect(getZebraClass('table', undefined, 2)).toBe('')
  })
  it('table: stripe=false 모든 행 빈 클래스', () => {
    expect(getZebraClass('table', { stripe: false }, 1)).toBe('')
  })
  it('spreadsheet: 옅은 파랑 토큰', () => {
    expect(getZebraClass('spreadsheet', undefined, 1))
      .toBe('bg-[var(--smsg-blue-050)]')
  })
  it('spreadsheet: stripe=true 명시', () => {
    expect(getZebraClass('spreadsheet', { stripe: true }, 3))
      .toBe('bg-[var(--smsg-blue-050)]')
  })
  it('블록 타입별 색 다름 (시각 구분)', () => {
    const t = getZebraClass('table', undefined, 1)
    const s = getZebraClass('spreadsheet', undefined, 1)
    expect(t).not.toBe(s)
  })
})
```

---

## 4. Editor 변경 — TableBlockEditor

### 4.1 변경점 정확 위치

`TableBlockEditor.tsx`의 두 군데:

**(a) Sparse 셀 모드 — L325~335** (다중-merge cells 렌더)
```diff
- ? 'bg-smsg-50 text-smsg-900'
- : 'odd:bg-white even:bg-gray-50'
+ ? 'bg-smsg-50 text-smsg-900'
+ : isStripe ? 'odd:bg-white even:bg-gray-50' : 'bg-white'
```

**(b) Flat 모드 — L514** (단순 헤더+행 렌더)
```diff
- <tr key={r} className="group/row odd:bg-white even:bg-gray-50">
+ <tr key={r} className={`group/row bg-white ${getZebraClass('table', opts, r + 1)}`}>
```

(헤더가 있으면 데이터 행은 1부터 시작하므로 `r+1`로 보정. 헤더 없으면 `r` 그대로. 정확한 보정은 구현 시 결정.)

### 4.2 `isStripe`/`opts` 끌어오기

`TableBlockEditor`가 받는 props에서 `block.options` 추출. 이미 컴포넌트 안에 `opts`가 존재할 가능성이 높음 — `tablePresets.ts`에서 `options` 적용 흐름 확인 필요 (Do 단계 첫 번째 작업).

### 4.3 회귀 방지 — 기존 행동 유지

`opts.stripe`가 `undefined`이거나 `true`면 기존 zebra가 그대로 보임. C2 만족.

---

## 5. Editor 변경 — SpreadsheetBlockEditor

### 5.1 토글 UI 추가 위치

현재 (L198~209):
```tsx
<div className="flex items-center gap-2 rounded border border-gray-200 bg-white px-2 py-1 text-xs">
  {/* 기존 컨트롤 */}
</div>
```

여기에 체크박스 1개 추가:
```tsx
<label className="flex items-center gap-1 text-xs text-gray-600">
  <input
    type="checkbox"
    checked={opts?.stripe !== false}
    onChange={(e) => updateOptions({ stripe: e.target.checked })}
  />
  줄무늬
</label>
```

### 5.2 cell 행 렌더에 zebra 적용

L260대의 데이터 셀 매핑에서 각 `<tr>`에 클래스 추가:
```tsx
<tr key={r} className={getZebraClass('spreadsheet', block.options, r)}>
  {/* 셀들 */}
</tr>
```

각 `<td>`/cell `<input>`은 `bg-transparent`이므로 부모 tr의 배경이 자연스럽게 비쳐 보임.

### 5.3 `updateOptions()` 헬퍼

block update API 패턴을 따라 `block.options`를 partial-update 하는 헬퍼 추가. 기존 `setTitle`, `setHeaders` 같은 setter 옆에.

---

## 6. lat 변경 — `documents.md`

### 6.1 Block types 섹션 갱신 (L72~)

`TableBlock` 다음에 `SpreadsheetBlock` 항목 신규 추가:

```markdown
- `SpreadsheetBlock` — `cols`, `rows`, `cells{}` (sparse A1-key map), `headers?`,
  `options?{stripe}`. 셀은 raw 입력(`'42'` / `'=SUM(A1:A10)'`). 렌더는
  옅은 파랑 zebra (`--smsg-blue-050`).
```

### 6.2 `TableBlock` 항목에 옵션 명시화

기존 한 줄을 더 자세히:
```markdown
- `TableBlock` — `headers[]`, `rows[][]`, `caption?`, `options{stripe, density,
  borderStyle, sortable, ...}`. `options.stripe` (default true) 가 zebra 토글.
  ...
```

### 6.3 Gotchas 섹션에 한 줄

```markdown
- spreadsheet의 `options.stripe`는 *기본값 true*. schema에 추가는 했지만
  스키마 호환성을 위해 옵셔널 — 기존 문서는 마이그레이션 없이 그대로 통과.
```

---

## 7. LLM rules 변경 — `llm-input-rules.md`

§2.9 (spreadsheet 위젯 섹션)에 한 단락 추가:

```markdown
**렌더 옵션**: `options.stripe` (boolean, default true) 로 행 줄무늬 토글.
끄려면 `"options": {"stripe": false}` 명시. LLM 이 docx 로는 옵션을 표현
못 하므로 (placeholder만), API 직접 호출 시에만 의미 있음.
```

source (`docs/llm-input-rules.md`) → CI가 `dist/llm-docx-toolkit/llm-input-rules.md`로 복제. RAG chunker 재실행 후 `chunks.jsonl` + `index.lock` 커밋.

---

## 8. 처리 흐름 (Do 단계 실행 순서)

1. **schema 먼저**: `document.json` 수정 → `pytest apps/api/tests/test_*schema*` 통과 확인
2. **유틸 추가**: `zebra.ts` + 단위테스트
3. **TableBlockEditor 수정**: 하드코딩 2군데 → 옵션 기반. 기존 vitest snapshot 깨지면 즉시 갱신 (의도된 변경)
4. **SpreadsheetBlockEditor 수정**: zebra 적용 + 토글 UI + `updateOptions` 헬퍼
5. **lat 갱신**: documents.md 수정
6. **LLM rules 갱신**: docs/ + dist/ 동기
7. **RAG re-chunk**: `python3 dist/llm-docx-toolkit/rag/chunker.py`
8. **테스트**: zebra 단위테스트 + 영향 받는 vitest + (가능하면) Playwright로 두 블록 시각 확인
9. **CI 시뮬레이션**: RAG lock 검증 통과 확인

---

## 9. 테스트 매트릭스

| # | 케이스 | 기대 | 도구 |
|---|---|---|---|
| T1 | `getZebraClass('table', undefined, 1)` | `'bg-gray-50'` | vitest |
| T2 | `getZebraClass('table', {stripe:false}, 1)` | `''` | vitest |
| T3 | `getZebraClass('spreadsheet', undefined, 1)` | `'bg-[var(--smsg-blue-050)]'` | vitest |
| T4 | table vs spreadsheet 색 다름 | 시각 구분 보장 | vitest |
| T5 | 기존 spreadsheet 문서 (options 없음) 스키마 통과 | 200 OK | pytest |
| T6 | 신규 옵션 스키마 통과 | 200 OK | pytest |
| T7 | TableBlockEditor flat 모드 zebra on/off | DOM 클래스 검증 | vitest jsdom |
| T8 | SpreadsheetBlockEditor 토글 동작 | 클래스 토글 검증 | vitest jsdom |

T1~T6은 결정적 단위테스트 (1초 이내), T7~T8은 jsdom mount (5초 내).

---

## 10. 에러/회귀 매트릭스

| 시나리오 | 위험 | 완화 |
|---|---|---|
| 기존 문서의 table.options.stripe=true가 우연히 옵션 안 읽히는 버그로 들어가 있고, 우리 수정 후 zebra가 *꺼져* 보임 | 시각 변화 회귀 | default가 true이므로 옵션 없거나 true면 동일하게 보임. `opts?.stripe !== false`로 비교 |
| Tailwind JIT가 `bg-[var(--smsg-blue-050)]` 클래스 안 만듦 | spreadsheet zebra 안 보임 | safelist 추가 또는 `bg-blue-50` fallback. Do 단계에서 빌드 후 클래스 존재 확인 |
| 다크모드에서 zebra 톤이 거의 안 보임 | 시각 가시성 회귀 | 토큰이 이미 다크모드 분기 (tokens.css L97~110) — 별도 작업 없음 |
| docx export가 새 옵션 필드를 모르고 통과시키지 못함 | export 실패 | docx_export.py는 `block.get("options")` 안 봄 → 영향 없음. test_docx_export 통과 확인 |
| RAG chunker가 새 §2.9 단락을 인식 못 함 | LLM 응답 품질 저하 | chunker 재실행 후 BM25로 "spreadsheet stripe" 쿼리 → 새 청크가 top-N에 등장하는지 확인 |

---

## 11. 산출물

- [ ] `packages/shared/schemas/document.json` (SpreadsheetBlock 갱신)
- [ ] `apps/web/src/features/editor/blocks/zebra.ts` (신규)
- [ ] `apps/web/src/features/editor/blocks/__tests__/zebra.test.ts` (신규)
- [ ] `apps/web/src/features/editor/blocks/TableBlockEditor.tsx` (2군데 수정)
- [ ] `apps/web/src/features/editor/blocks/SpreadsheetBlockEditor.tsx` (zebra + 토글)
- [ ] `docs/lat/documents.md` (Block types + Gotchas)
- [ ] `docs/llm-input-rules.md` (§2.9 단락 추가)
- [ ] `dist/llm-docx-toolkit/llm-input-rules.md` (위와 동기)
- [ ] `dist/llm-docx-toolkit/rag/chunks.jsonl` + `index.lock` (재생성)

---

## 12. Acceptance — Design 단계 완료 조건

- [x] Open Questions 5개 모두 결론
- [x] 정확한 파일 + 라인 위치 명시
- [x] 신규 유틸 함수 시그니처 + 단위테스트 케이스 명시
- [x] 회귀/에러 시나리오 매트릭스
- [x] lat·LLM rules·RAG 동기화 계획 포함
