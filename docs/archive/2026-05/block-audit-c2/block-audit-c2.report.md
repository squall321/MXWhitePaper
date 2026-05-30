# block-audit-c2 — Completion Report

## Executive Summary
| | |
|---|---|
| **Feature** | Block audit Cycle 2 — S 8 (Video/Math/Callout/List/IA/Gallery/SPR/Pdf alias) |
| **Completion** | 2026-05-30 |
| **Status** | 8/8 gap 해소 |
| **Match Rate** | 100% |
| **Commit** | `9bb6de7` |

### Value Delivered

| Perspective | Outcome |
|---|---|
| Problem | C1 quick win 너머의 중간 사이즈 갭 — VideoBlock 옵션이 schema 만 있고 editor 부재 / Math editor 가 keystroke 마다 PATCH / Callout 4 variant 다크 누락 / IA 라벨 a11y / Gallery 레이아웃 토글 부재 / PdfBlock snake↔camel 변환 부재 |
| Solution | 8 갭을 단일 commit 으로 — editor UI 보강 + debounce 패턴 통일 + 다크 토큰 동행 + codegen 후처리 패치 |
| UX | 비디오 옵션 토글 3종 즉시 반영 · 수식 입력 끊김 없는 KaTeX 라이브 + 500 ms 후 PATCH · 콜아웃 다크 통일 · 이미지 주석 스크린리더 라벨 · 갤러리 grid/carousel 토글 |
| Core Value | C1 의 토큰 / silent 정렬 위에 *behavior* 일관성을 얹음 — debounce 500 ms 가 Code/Quote/Math 3 블록에서 동일 패턴 (재사용 자산) |

## 세부 변경 (8 gap)

| ID | 영역 | 위치 | 내용 |
|---|---|---|---|
| VID-01 | Editor | `VideoBlockEditor.tsx` | controls/autoplay/loop 토글 + URL 미리보기 |
| VID-02-FE | Render | `VideoBlock.tsx` | 옵션 props 전달 + HTML5 attr 분기 |
| MTH-01 | Debounce | `MathBlockEditorWrapper.tsx` | 500 ms 디바운스 (Code/Quote 패턴) + cleanup |
| MTH-02 | 충돌 처리 | `MathBlockEditorWrapper.tsx` | `setConflict(null)` + precondition failed 분기 |
| CLO-01 | 다크 | `CalloutBlock.tsx` | info/warn/danger/tip 4 variant 다크 토큰 통일 |
| LST-01 | zebra 토큰 | `ListBlock.tsx` | zebra row 토큰 정렬 |
| IA-01 | a11y | `ImageAnnotationBlock.tsx` | 라벨 aria-label / role |
| GAL-01 | Layout 토글 | `GalleryBlockEditor.tsx` | grid / carousel 토글 + i18n |
| SPR-01 | 시각 정렬 | `SpreadsheetBlock.tsx` | 셀 패딩 / 헤더 토큰 |
| PDF-02 | schema alias | `apps/api/app/schemas/document.py#PdfBlock` + `packages/shared/codegen/generate-py.py` | `file_id` ↔ `fileId` 양방향 (snake/camel 모두 수용, 충돌 시 snake 우선). codegen 후처리 패치로 idempotent — 매 codegen 마다 다시 주입 |

## i18n

- `editor.video.{autoplay,controls,loop}` × ko/en
- `editor.gallery.{layout,layoutGrid,layoutCarousel}` × ko/en

## lat 갱신

- `docs/lat/documents.md` Gotcha #10 — PdfBlock alias 컨벤션 (FileBlock 의 camel-only 와 명시적 구분)

## 검증

- 신규 테스트: `VideoBlock.test.tsx`, `CalloutBlock.darkmode.test.tsx`, `MathBlockEditorWrapper.test.tsx`
- 패치된 테스트: `ImageAnnotationBlock.test.tsx`, `ListBlock.test.tsx`, `SpreadsheetBlock.test.tsx`
- schema:validate 16/16 sample 통과
- typecheck clean
- pre-commit `codegen drift` 1차 fail → `generate-py.py` 에 PdfBlock 후처리 패치 주입 후 통과 (재사용 가능한 패턴)

## 후속

- Cycle 3 (M, 2건): spacer + spreadsheet 의 html/md/pptx export 핸들러
- codegen 후처리 패치 패턴은 IframeBlock XOR 에 이어 두 번째 — 향후 schema 만으로 표현 못 하는 alias/validator 는 모두 generate-py.py 에 모음
