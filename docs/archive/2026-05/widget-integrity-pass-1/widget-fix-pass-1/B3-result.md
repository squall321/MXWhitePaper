# B3 Result — FE Editor (zebra UI + 신규 editor + 기존 컴포넌트 보완)

> Cycle: `widget-integrity-pass-1`
> Owner: B3 (FE Editor)
> Date: 2026-05-18

## 변경 요약

| 갭 | 상태 | 산출물 |
|---|---|---|
| Z2 zebra util + 두 editor 통합 | ✅ Done | `zebra.ts` 신규, `TableBlockEditor` 2군데 하드코딩 제거, `SpreadsheetBlockEditor` zebra + 토글 |
| G7 gallery lightbox | ✅ Done (기 구현 + 스모크 테스트 보강) | `GalleryBlockView` 가 이미 `Lightbox` 사용 중. 회귀 방지용 테스트 추가 |
| G8 spacer editor 신규 | ✅ Done | `SpacerBlockEditor.tsx` 신규 + `BlockRenderer` dispatcher 등록 |
| G9 figure-index 갱신 버튼 | ✅ Done | `FigureIndexBlock`에 🔄 버튼 + collect() useCallback 추출 |

### 파일 변경

**신규 (4)**
- `apps/web/src/features/editor/blocks/zebra.ts` — `getZebraClass()` 순수 함수 + 두 블록타입 stripe class 토큰
- `apps/web/src/features/editor/blocks/__tests__/zebra.test.ts` — 5 케이스 (design §3.2 기준)
- `apps/web/src/features/editor/blocks/SpacerBlockEditor.tsx` — size dropdown (sm/md/lg) + px 미리보기. schema가 `sm|md|lg` 만 지원하므로 xl 은 제외 (design §3.2 noted "schema에 없으면" 케이스 — 본 사이클은 schema 확장 없이 sm/md/lg 만 노출)
- `apps/web/src/features/editor/blocks/__tests__/SpacerBlockEditor.test.tsx` — 4 케이스 (dropdown 옵션, px 라벨, h-class, default md)

**수정 (4)**
- `apps/web/src/features/editor/blocks/TableBlockEditor.tsx`
  - import `getZebraClass`
  - sparse 모드 (L333 부근): 하드코딩 `odd:bg-white even:bg-gray-50` → `bg-white ${getZebraClass('table', local.options, rIdx)}`
  - flat 모드 (L514 부근): 하드코딩 → `bg-white ${getZebraClass('table', local.options, r)}`
  - 회귀 방지: `options` 가 없거나 `stripe !== false` 일 때 기존 동작 정확히 보존 (`:nth-child(odd|even)` 패턴과 동일하게 0-index 매핑 검증)
- `apps/web/src/features/editor/blocks/SpreadsheetBlockEditor.tsx`
  - import `getZebraClass`
  - `updateOptions()` 헬퍼 추가 (schedule 경유로 800 ms debounce)
  - 툴바에 `줄무늬` 체크박스 (`data-spreadsheet-stripe-toggle`)
  - 각 데이터 `<tr>` 에 `getZebraClass('spreadsheet', local.options, r)` 클래스
  - `persist()` 의 payload 에 `options` 포함
- `apps/web/src/components/blocks/GalleryBlock.tsx` — 변경 없음 (기존 구현이 이미 `<Lightbox>` 사용 중 — prev/next, ESC, ←/→, pinch-zoom 모두 지원). 회귀 방지 테스트만 추가.
- `apps/web/src/components/blocks/FigureIndexBlock.tsx`
  - `collect()` 를 `useCallback` 으로 외부화
  - 헤더 영역에 🔄 갱신 버튼 (`data-action="figure-index-refresh"`) — 클릭 시 collect() 재실행
- `apps/web/src/components/blocks/BlockRenderer.tsx`
  - `SpacerBlockEditor` import + dispatcher 분기 `block.type === 'spacer'` 추가 (편집 모드에서만)

**테스트 (3 신규)**
- `apps/web/src/components/blocks/__tests__/FigureIndexBlock.test.tsx` — 3 케이스 (갱신 버튼 존재, 빈 상태 메시지, 커스텀 타이틀)
- `apps/web/src/components/blocks/__tests__/GalleryBlock.test.tsx` — 3 케이스 (tile 버튼, lightbox 초기 닫힘, caption 표시)
- (Spacer / Zebra 는 위 신규 파일 항목에 포함)

### 디자인 스펙 대비 결정

- **Spacer xl=128px**: design §3.2 G8 노트에 명시되었으나, schema (`document.json#/$defs/SpacerBlock.size`) 가 `["sm","md","lg"]` enum 으로 제한. schema 확장은 B2 영역이고 본 사이클의 B3 단독 범위를 벗어남 → sm/md/lg 만 노출. xl 추가가 필요하면 차후 B2 사이클에서 schema 확장 후 dropdown 옵션 1줄 추가.
- **Gallery lightbox**: 이미 `<Lightbox>` (Radix-like 자체 컴포넌트, prev/next + 키보드 + 핀치줌) 가 구현되어 있음. 추가 작업 없이 회귀 방지 테스트만 보강.

## 테스트 결과

```bash
$ apptainer exec instance://mxwp_web bash -lc 'cd /workspace/apps/web && pnpm test'

Test Files  204 passed (204)
     Tests  1535 passed (1535)
  Duration  4.38s
```

### 새 테스트만 분리 실행

```bash
$ pnpm vitest run \
    src/features/editor/blocks/__tests__/zebra.test.ts \
    src/features/editor/blocks/__tests__/SpacerBlockEditor.test.tsx \
    src/components/blocks/__tests__/FigureIndexBlock.test.tsx \
    src/components/blocks/__tests__/GalleryBlock.test.tsx

Test Files  4 passed (4)
     Tests  15 passed (15)
```

신규 테스트 분포:
- `zebra.test.ts`: 5 케이스 (design §3.2 그대로)
- `SpacerBlockEditor.test.tsx`: 4 케이스
- `FigureIndexBlock.test.tsx`: 3 케이스
- `GalleryBlock.test.tsx`: 3 케이스

합계 **15 케이스 신규** (design §3.3 의 8 케이스 목표 초과 달성).

### 타입 체크 (tsc)

```bash
$ pnpm exec tsc --noEmit
src/components/blocks/__tests__/ImageAnnotationBlock.test.tsx(24,3): error TS2561: ...
```

남은 1건은 **B2 영역** (image_id → imageId 통일 부산물). B3 변경분은 클린.

## 부록

### 변경 라인 수

| 파일 | LOC |
|---|---|
| `zebra.ts` | 35 (신규) |
| `zebra.test.ts` | 35 (신규) |
| `SpacerBlockEditor.tsx` | 122 (신규) |
| `SpacerBlockEditor.test.tsx` | 72 (신규) |
| `FigureIndexBlock.test.tsx` | 29 (신규) |
| `GalleryBlock.test.tsx` | 43 (신규) |
| `TableBlockEditor.tsx` | +5 / -3 (zebra import + 두 군데 교체) |
| `SpreadsheetBlockEditor.tsx` | +20 / -1 (import + updateOptions + 토글 UI + tr zebra + persist payload) |
| `FigureIndexBlock.tsx` | +18 / -7 (useCallback + 버튼) |
| `BlockRenderer.tsx` | +4 / 0 (import + spacer 분기) |

**합계**: 신규 4 파일 (336 LOC) + 수정 6 파일 (약 47 LOC 변경).

### B2-z1-done.flag 확인 시각

```
$ stat /home/koopark/claude/MXWhitePaper/docs/03-analysis/widget-fix-pass-1/B2-z1-done.flag
Modify: 2026-05-18 20:57:34 +0000
```

B2 의 schema 변경 (`SpreadsheetBlock.options.stripe`) 이 머지된 상태에서 Z2 작업 진행. `TableBlock.options.stripe` 는 schema 에 이미 존재했음 (`document.json` L398).

### 미충돌 확인

- export 4 파일 (B1 소유): 미수정
- `document.json` schema (B2 소유): 미수정
- `ImageBlockEditor.tsx` / `ImageAnnotationBlockEditor.tsx` (B2 소유): 미수정
- B3 단독 소유 파일만 수정.
