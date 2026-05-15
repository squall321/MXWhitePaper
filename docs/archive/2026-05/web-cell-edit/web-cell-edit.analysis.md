# Gap Analysis — web-cell-edit

> Plan: [web-cell-edit.plan.md](../01-plan/features/web-cell-edit.plan.md)
> Design: [web-cell-edit.design.md](../02-design/features/web-cell-edit.design.md)
> Cycle date: 2026-05-15

## Match Rate: **100%** (4 영역 모두 작동 + V1 BLOCKING 0)

## 1. Success Criteria

| 기준 | 결과 |
|---|:---:|
| `TableBlockEditor.tsx` 가 cell.blocks 모드 감지 → CellBlockEditor 렌더 | ✅ |
| 셀 안 paragraph 텍스트 편집 | ✅ ParagraphRowEditor (textarea) |
| 셀 안 list items 편집 (+ / - / 편집 / style 선택) | ✅ ListRowEditor |
| 셀 안 image 의 imageId 표시 + 삭제 | ✅ ImageRowEditor (read-only display + remove) |
| text ↔ blocks 모드 토글 | ✅ `toggleCellMode` + confirm 모달 (image 손실 시) |
| pnpm typecheck exit 0 | ✅ |
| 기존 plain-text 셀 편집 회귀 0 | ✅ (cell.blocks 없으면 기존 input 그대로) |
| Vitest 통합 테스트 | ✅ 22 신규 (12 component + 10 helpers) |

## 2. 작업 분할

| Agent | 영역 | 결과 |
|---|---|:---:|
| G1 | `CellBlockEditor.tsx` (NEW, 278 LOC) + ULID helper 발견 + 재사용 | ✅ typecheck 0 |
| G2 | `TableBlockEditor.tsx` 통합 + 모드 토글 + `tableCells.ts` 의 3 helper (`promoteToBlocks`, `demoteToText`, `demoteWouldLoseData`) | ✅ typecheck 0 |
| G3 | Vitest 12 + 10 = 22 신규 테스트 (react-dom/server + 함수 직접 호출 패턴 — jsdom 없는 환경) | ✅ 22/22 pass |
| V1 | Sonnet 통합 read-only 감사 (8 영역) | ✅ BLOCKING 0, minor 3 |

V1 minor 3건 처리:
- ✅ SSR 가드 추가 (`typeof window === 'undefined'` 검사)
- ✅ 토글 버튼 `aria-label` 추가 (title 만 있었음)
- ⏸️ confirm cancel path 테스트 미추가 (TableBlockEditor 통합 영역, jsdom 없이는 무리 — `demoteWouldLoseData` 단위 테스트로 핵심 로직은 검증됨)

## 3. 핵심 의사 결정

### 3.1 컴포넌트 vs helper 분리

`promoteToBlocks` / `demoteToText` / `demoteWouldLoseData` 는 *순수 함수* — `tableCells.ts` 에 두면 단위 테스트 용이. `toggleCellMode` 는 React state + `window.confirm` 호출이라 `TableBlockEditor` 안에 둠. 분리로 테스트 가능성 ↑.

### 3.2 image picker 통합 deferred

CellBlockEditor 의 image 행은 *read-only display + remove* 만. 새 이미지 추가는 `window.prompt('imageId 입력')` 으로 임시 처리. **이유**: 풀스택 picker (업로드 + crop + 라이브러리 검색) 는 별도 사이클. 본 사이클은 *편집 가능한 셀* 의 핵심 가치 (텍스트/이미지/리스트 모두 인-셀 편집) 를 먼저 확보.

### 3.3 빈 blocks → text 자동 강등

`setCellBlocks(idx, [])` 가 blocks 배열을 비우면 자동으로 cell 이 text 모드로 강등 (blocks key 제거, text='' 설정). 사용자가 모든 블록을 삭제하면 셀이 자연스럽게 plain text input 으로 돌아감. UX 일관성.

### 3.4 jsdom 없는 환경에서의 vitest 패턴

apps/web 의 vitest 설정은 jsdom/happy-dom 미설치 → @testing-library/react 의 `fireEvent` 사용 불가. G3 가 발견 후 *react-dom/server* renderToStaticMarkup + `vi.mock('react', ...)` 로 useCallback passthrough + JSX 트리 walk 패턴 사용. 새 dependency 추가 없이 22 테스트 모두 통과. **본 프로젝트의 테스트 컨벤션 따름** (다른 test 파일들과 일관).

## 4. 변경 파일 요약

| 파일 | 변경 |
|---|---|
| `apps/web/src/features/editor/blocks/CellBlockEditor.tsx` | NEW 280 LOC (sub-components: ParagraphRowEditor / ListRowEditor / ImageRowEditor + 3 append 버튼 + SSR 가드) |
| `apps/web/src/features/editor/blocks/TableBlockEditor.tsx` | `setCellBlocks` + `toggleCellMode` + 분기 렌더 + CellActions 의 mode 토글 버튼 |
| `apps/web/src/features/editor/blocks/tableCells.ts` | 3 신규 helper (promoteToBlocks / demoteToText / demoteWouldLoseData) |
| `apps/web/src/features/editor/blocks/__tests__/CellBlockEditor.test.tsx` (NEW) | 12 vitest |
| `apps/web/src/features/editor/blocks/__tests__/tableCells.promoteDemote.test.ts` (NEW) | 10 vitest |

## 5. 발견된 부수 정보

### Pre-existing snapshot 실패 (본 사이클 무관)

`apps/web/src/components/blocks/__tests__/AllBlocksRender.test.tsx` 의 image snapshot 이 stale — `feat(figures): table/chart auto-numbering + figure-index block + pptx link` (commit fd5dfcf) 가 image 렌더에 `data-block-type` 와 `figure-caption-text` span 추가했는데 snapshot 미갱신. 본 사이클과 100% 무관. 별도 사이클로 처리 후보.

확인:
- pre-commit hook 은 schema validate + typecheck + codegen drift + openapi drift 만 — 테스트는 안 돌림.
- 따라서 본 사이클 push 무관.

## 6. 메트릭

| 지표 | 값 |
|---|---|
| Match Rate | **100%** |
| Web typecheck | exit 0 |
| 신규 vitest | 22 (12 component + 10 helper) — 모두 pass |
| 변경 파일 | 3 (CellBlockEditor 신규 + TableBlockEditor + tableCells) + 2 신규 테스트 |
| 신규 LOC | ~600 (280 컴포넌트 + 100 통합 + 50 helper + 180 테스트) |
| Generator | 3 (G1-G3, Opus) |
| Verifier | 1 (V1 Sonnet, BLOCKING 0) |
| V1 minor | 3 (2 fix-up, 1 명시적 defer) |
