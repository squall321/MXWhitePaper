# Plan — web-cell-edit

> Cycle Z. Mixed-cell (cell.blocks) 의 풀 인-편집 인터페이스. BE 무관.

## Executive Summary

| 관점 | 내용 |
| --- | --- |
| **Problem** | mixed-cells (TableBlock 의 `cell.blocks` 배열) 가 BE 에서 작동하고 web 의 뷰어 (`TableBlock.tsx`) 가 paragraph/image/list 렌더링하지만, **편집기 (`TableBlockEditor.tsx`) 는 여전히 `<input value={cell.text}>` 만 처리** → 사용자가 mixed-cell 표를 편집하려고 클릭하면 빈 input 만 보임. |
| **Solution** | 셀 편집 UI 를 **두 모드**로 분기: (a) plain text 셀 → 기존 input; (b) blocks 셀 → 인라인 블록 편집기 (paragraph 텍스트 직접 편집, image 자리 삭제/추가, list item 편집). 셀 클릭 시 자동 모드 감지. text → blocks 승격 + blocks → text 강등 토글 지원. |
| **Function UX Effect** | 사용자가 표 셀에 텍스트, 이미지, 리스트를 자유롭게 섞어 편집 가능. 풍부한 표 컨텐츠가 web 에서도 BE 와 동등하게 작동. |
| **Core Value** | mixed-cells 의 BE↔web parity 완성. 진정한 풀스택 풍부 표. |

## Scope

### IN — 인-셀 편집 4 영역

1. **셀 내부 paragraph 텍스트 편집**: blocks 셀의 paragraph 의 `text` 인라인 편집. textarea 또는 contenteditable.
2. **셀 내부 list item 편집**: ListBlock 의 `items[]` 의 항목 추가/삭제/편집/순서 변경.
3. **셀 내부 image 추가/삭제**: ImageBlock 의 imageId 보기 + 제거. (새 이미지 업로드는 기존 ImageBlockEditor 의 ImagePicker 컴포넌트 재사용.)
4. **셀 모드 토글**: 셀 우측 메뉴에 "텍스트로 / 풍부한 편집으로" 버튼. text → blocks 시 paragraph 1개로 변환. blocks → text 시 모든 blocks 의 텍스트만 join.

### OUT (별도 사이클)

- 셀 안에 callout / chart / table 등 *복합 위젯* 임베드 — schema 가 paragraph/image/list 만 허용.
- 셀 내부 drag-and-drop 으로 블록 순서 변경 (편집은 가능하되 마우스 드래그는 deferred).
- 셀 안 paragraph 의 inline-formatting toolbar (bold/italic/link).
- pptx 등 다른 export 렌더러 변경 (그쪽은 이미 text 또는 fallback 으로 처리).

## Success Criteria

1. `TableBlockEditor.tsx` 가 cell.blocks 모드 감지 → 블록별 인-셀 편집 UI 렌더.
2. 셀 안 paragraph 의 text 편집 동작 (입력 → state 업데이트 → 저장).
3. 셀 안 list 의 items 편집 (+ / - / 순서).
4. 셀 안 image 의 imageId 표시 + 삭제.
5. text ↔ blocks 토글 작동.
6. `pnpm typecheck` exit 0.
7. 기존 plain-text 셀 편집 회귀 0 (기존 표 사용자가 영향 안 받음).
8. mixed-cells round-trip (BE 가 emit 한 mixed-cell 표가 web 에 read → 편집 → 저장 → 재 read 시 동일) — 통합 vitest 또는 수동 확인.

## Work Split — 3 Generator + 1 Verifier

| Agent | 담당 | 파일 |
|---|---|---|
| G1 | **CellBlockEditor** — 인-셀 mixed-block 편집 컴포넌트 (paragraph / image / list 인라인 편집 + 블록 추가/삭제/순서 변경) | new `apps/web/src/features/editor/blocks/CellBlockEditor.tsx` |
| G2 | **TableBlockEditor 통합** — line 310 의 `<input value={cell.text}>` 분기를 `cell.blocks ? <CellBlockEditor /> : <input>` 으로 변경. 양쪽 모드 전환 토글 추가. tableCells.ts 의 helper 보강 | `TableBlockEditor.tsx` + `tableCells.ts` |
| G3 | **Vitest 통합 테스트** — CellBlockEditor 의 4 동작 + TableBlockEditor 의 모드 토글. 회귀 가드: plain text 셀 편집 동작 유지 | `apps/web/src/features/editor/blocks/__tests__/CellBlockEditor.test.tsx` (new) |
| V1 | **Sonnet 검증** — typecheck + 회귀 + UX 합리성 + a11y 기본 (label/aria) | read-only |

G1 부터 직렬 (G2 가 G1 의 컴포넌트 사용). G3 도 G1/G2 완료 후.

## Risks

| Risk | Mitigation |
|---|---|
| 인-셀 contenteditable 가 복잡 (포커스/IME/선택영역) | textarea + onBlur save 패턴으로 단순화. inline-formatting toolbar 는 deferred. |
| blocks → text 강등 시 정보 손실 (image 사라짐) | 토글 시 confirm 모달 "이 셀의 이미지/리스트가 사라집니다. 진행할까요?" |
| 기존 표 사용자에게 영향 | cell.blocks 없는 셀은 기존 input 100% 그대로. cell.blocks 셀만 새 컴포넌트. |
| 인-셀 image 추가는 image picker 통합 필요 | 기존 ImageBlockEditor 의 picker 컴포넌트가 있다면 재사용. 없으면 file_id placeholder 만 표시 (실제 업로드는 BE 변경 필요로 deferred). |
| typecheck 깨짐 | G1 가 자체 typecheck 실행 후 보고. G2 통합 후 메인이 한 번 더 검증. |

## Cycle Boundaries

archive: `docs/archive/2026-05/web-cell-edit/`. 후속:
- Drag-and-drop 셀 블록 순서 변경
- 셀 안 inline formatting toolbar
- 셀 안 복합 위젯 허용 (schema 확장 필요)
