# Report — web-cell-edit

## Executive Summary

| 관점 | 내용 |
| --- | --- |
| **Feature** | web-cell-edit (mixed-cell 풀 인-셀 편집) |
| **Started → Completed** | 2026-05-15 (단일 세션, ~1.5h) |
| **Match Rate** | **100%** |
| **Problem** | TableBlock 의 mixed-cell (cell.blocks 모드) 가 BE 와 web 뷰어에는 작동했지만 web 편집기는 여전히 text-only input → 사용자가 mixed-cell 표를 편집하려고 클릭하면 빈 input 만 보임. |
| **Solution** | `CellBlockEditor` 새 컴포넌트 — paragraph (textarea) / list (style + items) / image (read-only display + remove) 모두 인-셀 편집. `TableBlockEditor` 가 cell.blocks 있으면 CellBlockEditor, 없으면 기존 input. text↔blocks 모드 토글 + image 손실 시 confirm 모달. `tableCells.ts` 의 promote/demote 순수 헬퍼. |
| **Function UX Effect** | 사용자가 셀 안에 텍스트, 이미지, 리스트를 자유롭게 섞어 편집 가능. mixed-cells 의 BE↔web parity 완성. |
| **Core Value** | 진정한 풀스택 풍부 표. mixed-cells 가 wireframe 만이 아니라 실제 사용자 편집 가능 자원. |

## 1. 결과 메트릭

| 지표 | 값 |
|---|---|
| Match Rate | **100%** |
| Web typecheck | exit 0 |
| 신규 vitest | **22** (12 component + 10 helper) — 모두 pass |
| 변경 파일 | 3 + 2 신규 테스트 |
| 신규 LOC | ~600 |

## 2. 작업 분할 — 3 Generator + 1 Verifier

| Agent | 담당 | LOC | Tests |
|---|---|:---:|:---:|
| G1 | CellBlockEditor.tsx (NEW) + ULID helper 재사용 | 280 | — (G3 가 작성) |
| G2 | TableBlockEditor 통합 + 모드 토글 + tableCells helper 3개 | ~100 | — |
| G3 | Vitest 22개 (jsdom 없는 환경에서 react-dom/server + 함수 직접 호출 패턴) | — | 22 |
| V1 | Sonnet 통합 read-only 감사 — BLOCKING 0 | — | — |

직렬 발사 (G1 → G2 → G3) — 같은 파일 영역 만지는 작업이라 충돌 회피.

## 3. 핵심 의사 결정

### 3.1 helper 와 컴포넌트의 분리

`promoteToBlocks` / `demoteToText` / `demoteWouldLoseData` 는 *pure function* 으로 tableCells.ts 에 추출 → 단위 테스트 용이 (10 테스트). 토글 자체는 React state 와 window.confirm 통합이라 TableBlockEditor 안에 잔존. 분리로 핵심 로직의 검증성 ↑.

### 3.2 image picker deferred

CellBlockEditor 의 image 행은 read-only display + remove 만. 추가는 `window.prompt('imageId 입력')` — 임시 처리. 풀 picker (업로드 / crop / 라이브러리 검색) 는 별도 사이클. 본 사이클은 *편집 가능한 셀* 의 핵심 가치 먼저.

### 3.3 빈 blocks 자동 강등

사용자가 모든 블록을 삭제하면 셀이 자동으로 text 모드로 강등 (blocks key 제거, text='' 설정). `setCellBlocks` 이 `length === 0` 검사. UX 일관성: 빈 blocks 배열 상태가 stuck 되지 않음.

### 3.4 jsdom 없는 vitest 패턴

apps/web 의 vitest 설정은 jsdom/happy-dom 미설치 → `@testing-library/react` 의 fireEvent 사용 불가. G3 가 발견 후 프로젝트 컨벤션 따라 react-dom/server `renderToStaticMarkup` + `vi.mock('react', ...)` useCallback passthrough + JSX 트리 walk 패턴 사용. 새 dependency 추가 없이 22 테스트 모두 통과.

## 4. 변경 파일

| 파일 | 변경 |
|---|---|
| `apps/web/src/features/editor/blocks/CellBlockEditor.tsx` (NEW) | 280 LOC — paragraph/list/image 행 편집기 + 3 append 버튼 + SSR 가드 |
| `apps/web/src/features/editor/blocks/TableBlockEditor.tsx` | `setCellBlocks` + `toggleCellMode` + 셀 렌더 분기 + CellActions 의 모드 토글 버튼 (aria-label 포함) |
| `apps/web/src/features/editor/blocks/tableCells.ts` | 3 신규 pure helper |
| `apps/web/src/features/editor/blocks/__tests__/CellBlockEditor.test.tsx` (NEW) | 12 vitest |
| `apps/web/src/features/editor/blocks/__tests__/tableCells.promoteDemote.test.ts` (NEW) | 10 vitest |

## 5. V1 verifier 발견된 minor 처리

- ✅ SSR 가드 추가 (`typeof window === 'undefined'` before prompt)
- ✅ 토글 버튼 aria-label 추가 (title 외에)
- ⏸️ confirm cancel path 통합 테스트 미추가 — TableBlockEditor 통합 영역 (jsdom 없이 react-dom event 시뮬레이션 한계). `demoteWouldLoseData` 단위 테스트로 핵심 로직 검증.

## 6. 발견된 부수 정보 (본 사이클 무관)

`apps/web/src/components/blocks/__tests__/AllBlocksRender.test.tsx` 의 image snapshot 2개가 stale — commit `fd5dfcf feat(figures)` 가 image 렌더에 `data-block-type` 와 `figure-caption-text` span 추가했는데 snapshot 미갱신. 본 사이클이 발견한 *기존 결함*. 별도 사이클로 처리 후보. pre-commit hook 은 테스트 미실행 → 본 사이클 push 영향 없음.

## 7. 학습

- **pure helper 분리의 가치**: pure function 으로 분리하면 jsdom 없는 환경에서도 단위 테스트가 자명. 컴포넌트 깊은 통합 테스트의 어려움을 우회.
- **빈 컬렉션 자동 처리**: UI 의 상태 표현이 "blocks=[]" 와 "text=''" 두 가지 모드 → 빈 상태에서 자연스럽게 한 모드로 수렴시키면 stuck state 회피. 작은 결정이 큰 UX 영향.
- **dependencyless vitest**: jsdom/RTL 없이도 react-dom/server + 함수 호출 + 트리 walk 로 검증 가능. 프로젝트 컨벤션을 따르며 새 dependency 추가 안 하는 절제.

## 8. 다음 사이클 (별도, 사용자 결정 필요)

- **Cell image picker 통합**: 풀 업로드/picker UI.
- **AllBlocksRender snapshot 갱신**: pre-existing stale snapshot 정리.
- **Inline formatting toolbar**: 셀 안 paragraph 의 bold/italic/link 도구.
- **Drag-and-drop 셀 블록 순서**: 셀 안 블록 순서 변경 UI.
