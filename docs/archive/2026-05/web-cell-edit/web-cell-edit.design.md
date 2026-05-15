# Design — web-cell-edit

> Plan: [web-cell-edit.plan.md](../../01-plan/features/web-cell-edit.plan.md)

## 1. Architecture

### 1.1 새 컴포넌트 — `CellBlockEditor`

위치: `apps/web/src/features/editor/blocks/CellBlockEditor.tsx` (NEW)

```tsx
import { useCallback } from 'react'
import type { CellBlock, ParagraphBlock, ImageBlock, ListBlock } from '@/types/document'
import ulid from 'ulid'

interface Props {
  blocks: readonly CellBlock[]
  onChange: (next: CellBlock[]) => void
  // imagePicker?: (current?: string) => Promise<string | null>
  //   — Phase: 인-셀 image picker integration deferred. Show imageId-only.
}

export function CellBlockEditor({ blocks, onChange }: Props) {
  const updateAt = useCallback((idx: number, patch: CellBlock) => {
    const next = blocks.slice() as CellBlock[]
    next[idx] = patch
    onChange(next)
  }, [blocks, onChange])
  
  const remove = useCallback((idx: number) => {
    const next = blocks.filter((_, i) => i !== idx)
    onChange(next as CellBlock[])
  }, [blocks, onChange])
  
  const append = useCallback((kind: 'paragraph' | 'list' | 'image') => {
    const newBlock = (
      kind === 'paragraph'
        ? { type: 'paragraph', id: ulid(), text: '' } as ParagraphBlock
        : kind === 'list'
        ? { type: 'list', id: ulid(), style: 'bullet', items: [''] } as ListBlock
        : { type: 'image', id: ulid(), imageId: '' } as ImageBlock
    )
    onChange([...blocks, newBlock] as CellBlock[])
  }, [blocks, onChange])
  
  return (
    <div className="cell-block-editor space-y-1">
      {blocks.map((b, idx) => (
        <BlockEditorRow
          key={b.id}
          block={b}
          onChange={(next) => updateAt(idx, next)}
          onRemove={() => remove(idx)}
        />
      ))}
      <div className="flex gap-1 text-xs">
        <button onClick={() => append('paragraph')}>+ ¶</button>
        <button onClick={() => append('list')}>+ ⋮ list</button>
        <button onClick={() => append('image')}>+ 🖼</button>
      </div>
    </div>
  )
}

function BlockEditorRow({ block, onChange, onRemove }: ...) {
  // paragraph: <textarea value={block.text} onChange={...} />
  // image: read-only display of imageId + delete button (no picker for now)
  // list: <ul> with editable <li>s and add/remove item buttons
}
```

### 1.2 `TableBlockEditor` 통합 — 분기

`TableBlockEditor.tsx` line 310 (현재):
```tsx
<input
  value={cell.text}
  onChange={(e) => setCellText(idx, e.target.value)}
  ...
/>
```

신규:
```tsx
{cell.blocks ? (
  <CellBlockEditor
    blocks={cell.blocks}
    onChange={(next) => setCellBlocks(idx, next)}
  />
) : (
  <input value={cell.text ?? ''} onChange={(e) => setCellText(idx, e.target.value)} ... />
)}
```

`setCellBlocks(idx, next)` 새 helper:
```ts
const setCellBlocks = (idx: number, blocks: CellBlock[]) => {
  setLocal((prev) => {
    const cells = (prev.cells ?? []).map((c, i) =>
      i === idx ? { ...c, blocks: blocks.length > 0 ? blocks : undefined, text: blocks.length > 0 ? undefined : '' } : c,
    )
    return { ...prev, cells } as TableBlock
  })
}
```

### 1.3 모드 토글 — 셀 도구 메뉴 확장

`CellStyleToolbar.tsx` (또는 `TableBlockEditor` 의 셀 컨텍스트 메뉴) 에 새 버튼 추가:
- "텍스트만" — cell.blocks 가 있으면 강등: 모든 paragraph/list 의 텍스트만 join → cell.text. image 는 사라짐 → confirm 모달.
- "풍부한 편집" — cell.text 가 있으면 승격: paragraph 1개로 감싸 → cell.blocks=[{type:'paragraph', text: cell.text}].

```tsx
function toggleCellMode(cellIdx: number) {
  setLocal((prev) => {
    const cells = (prev.cells ?? []).slice()
    const c = { ...cells[cellIdx] }
    if (c.blocks && c.blocks.length > 0) {
      // Demote to text — combine paragraph + list text. Image content is lost.
      const hasImage = c.blocks.some((b) => b.type === 'image')
      if (hasImage && !window.confirm('이 셀의 이미지가 사라집니다. 진행할까요?')) {
        return prev
      }
      const text = c.blocks.flatMap((b) =>
        b.type === 'paragraph' ? [b.text]
        : b.type === 'list' ? b.items
        : []
      ).join('\n')
      cells[cellIdx] = { ...c, text, blocks: undefined }
    } else {
      // Promote to blocks
      cells[cellIdx] = {
        ...c,
        blocks: [{ type: 'paragraph', id: ulid(), text: c.text ?? '' }],
        text: undefined,
      }
    }
    return { ...prev, cells }
  })
}
```

## 2. Generator agent 시방서

### 2.1 G1 — `CellBlockEditor` 컴포넌트

**파일**: `apps/web/src/features/editor/blocks/CellBlockEditor.tsx` (NEW).

**Components**:
- `CellBlockEditor` (entry)
- `BlockEditorRow` (per-block dispatcher)
- `ParagraphRowEditor` (textarea)
- `ListRowEditor` (item list with add/remove/edit)
- `ImageRowEditor` (read-only imageId display + remove button + "이미지 교체" disabled with tooltip "별도 사이클")

**Constraints**:
- ULID 생성: `import ulid from 'ulid'` 또는 기존 헬퍼 (`packages/shared` 또는 web 에 있다면) 사용.
- Tailwind 클래스 사용 (다른 editor 컴포넌트 따라하기).
- 한국어 라벨.
- typecheck 통과 (`pnpm -w typecheck` 또는 `pnpm typecheck` from web).

**Out**:
- 이미지 picker UI 통합 (기존 ImageBlockEditor 의 picker 가 있어도 별도 사이클).
- inline formatting toolbar.

### 2.2 G2 — `TableBlockEditor` 통합 + 모드 토글

**파일**: `apps/web/src/features/editor/blocks/TableBlockEditor.tsx` + `apps/web/src/features/editor/blocks/tableCells.ts`.

**TableBlockEditor.tsx 변경**:
- Line ~310 의 sparse-cell input 을 `cell.blocks` 분기로 감쌈.
- `setCellBlocks(idx, next)` helper 추가.
- 셀 컨텍스트 메뉴 (CellMenu 또는 직접 컨테이너) 에 모드 토글 버튼 추가.
- flat 모드 (line ~506) 는 cell.blocks 없으므로 변경 불필요.

**tableCells.ts 변경** (있다면):
- `cellsToFlat` 의 lossy-collapse 가 이미 작동하므로 그대로.
- 토글 helper (`promoteToBlocks(cell): SparseCell`, `demoteToText(cell): SparseCell`) 를 pure function 으로 분리하면 테스트 용이.

**Out**:
- 다른 표 기능 (merge / split / column header 메뉴) 변경 없음.

### 2.3 G3 — Vitest 통합 테스트

**파일**: `apps/web/src/features/editor/blocks/__tests__/CellBlockEditor.test.tsx` (NEW).

**Tests** (Vitest + @testing-library/react):

1. `renders paragraph blocks with editable textareas` — `<CellBlockEditor blocks={[{type:'paragraph',id:'a',text:'hello'}]}>`. Assert textarea with value "hello" 존재.
2. `paragraph edit fires onChange` — type 'world' into textarea → onChange called with updated block.
3. `removes a paragraph` — click delete → onChange with empty array.
4. `appends a paragraph via + button` — click + ¶ → onChange with new paragraph (empty text).
5. `list item add/remove` — list block, click +item → onChange has extended items array.
6. `image row shows imageId read-only` — image block with imageId 'img-1' → assert "img-1" 표시 + 삭제 버튼 존재.

For `tableCells.ts` (if pure helpers added):
7. `promoteToBlocks converts text cell to single paragraph` — input `{r:0,c:0,text:'hi'}` → output has `blocks: [{type:'paragraph',text:'hi'}]`, `text: undefined`.
8. `demoteToText joins paragraph + list text` — input with `blocks: [{type:'paragraph',text:'a'},{type:'list',items:['b','c']}]` → output `text: 'a\nb\nc'`.

**TableBlockEditor integration** (optional, more complex setup):
9. `mixed cell renders CellBlockEditor not plain input` — render TableBlockEditor with a table whose cells[0] has blocks → assert the mixed-cell UI appears (find a textarea or the `cell-block-editor` class).

**Verify**: `apptainer exec instance://mxwp_web bash -lc 'cd /workspace/apps/web && pnpm test -- CellBlockEditor 2>&1 | tail -10'`.

### 2.4 V1 — Sonnet 검증

**범위**:
- typecheck 전체 통과.
- 기존 plain text 셀 편집 회귀 0 (시각/동작 변경 없음).
- CellBlockEditor 의 UX 합리성 (버튼 라벨, 키보드 접근성, 한국어 confirm 메시지).
- 정보 손실 가드: blocks → text 토글 시 image 가 있으면 confirm.
- Hook order / state management 정확성 (React rules of hooks).

**Out**:
- 시각 디자인 폴리시 (Tailwind 색/간격) — 최소한이면 OK.
- Accessibility audit 풀스펙 (WCAG AA) — 별도 사이클.

## 3. Definition of Done

- 4 영역 모두 작동 (paragraph 편집 / list 편집 / image 삭제 / 모드 토글).
- typecheck exit 0.
- 기존 표 회귀 0.
- 통합 vitest 8-9개 통과.
- V1 verifier 통과 (BLOCKING 0).
- archive + commit + push.

## 4. 메인 thread 책임

1. G1 → G2 → G3 직렬 (한 컴포넌트가 다른 거 import 함).
2. 각 generator 후 typecheck 빠른 점검.
3. V1 발사.
4. analysis / report / archive / commit / push.
