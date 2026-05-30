# block-audit-c1 — Completion Report

## Executive Summary
| | |
|---|---|
| **Feature** | Block audit Cycle 1 — XS 11 quick wins (dark/silent/lat/viewer) |
| **Completion** | 2026-05-30 |
| **Status** | 11/11 gap 해소 |
| **Match Rate** | 100% |
| **Commit** | `fedcbc9` |

### Value Delivered

| Perspective | Outcome |
|---|---|
| Problem | 30+ block 전수 audit 결과 누적된 XS 11 갭 — light-only 클래스, 빈 인라인 noisy fallback, 가독성 토큰 어긋남, lat 표 stale |
| Solution | 11 갭을 quick win 형태로 1 commit 에 묶음 — 라인 N 변경 / 토큰 정렬 / 다크 동행 / lat 사실 정정 |
| UX | 다크모드 전환 시 깜빡임 0, 빈 paragraph 시 "Empty" placeholder 사라짐, 헤딩 위계 시각화 |
| Core Value | 위젯 다크 일관성 후속 — block-darkmode-batch 가 흘린 잔여 light-only + 그 외 마이크로 흠집 일괄 청소 |

## 세부 변경 (11 gap)

| ID | 영역 | 위치 | 내용 |
|---|---|---|---|
| SPC-01 | spacing 토큰 | `BlockRenderer.tsx` | XL 간격 `space-y-8` 통일 |
| FIL-01 | 다크 | `FileBlock.tsx` | `dark:` border/bg 동행 |
| PDF-01 | 다크 | `PdfBlock.tsx` | `dark:` border/bg 동행 |
| VID-02 | 옵션 emit | `apps/api/app/services/html_renderer.py#_b_video` | controls/autoplay/loop schema flag 를 HTML5 attr 로 emit (autoplay 시 muted 동반) |
| MTH-03 | inline 오버플로 | `MathBlock.tsx` | inline 분기 다크 토큰 |
| IMG-01 | 빈 file 누락 | `ImageBlockEditor.tsx` | image_id 없으면 silent (noisy fallback X) |
| PAR-01/02 | 헤딩 토큰 + silent | `ParagraphBlock.tsx` | heading 4 dark 토큰 + 빈 인라인 빈 paragraph 직접 emit |
| QTE-02 | 다크 | `QuoteBlock.tsx` | border-l 다크 토큰 |
| COD-01 | 다크 | `CodeBlock.tsx` | code text 다크 |
| CLO-02 | lat 사실 정정 | `docs/lat/documents.md` | CalloutBlock variant 표 `success` → `tip` (코드 = `info\|warn\|danger\|tip`) |

## 검증

- 회귀 가드 `AllBlocksDarkmode.test.ts` 패치 — 새 dark 토큰 일치 검증
- `AllBlocksRender.test.tsx.snap` 스냅샷 갱신
- typecheck clean / schema:validate 16/16 sample 통과
- `make codegen` 동시에 실행 — TS/Python 모두 drift 0

## 구현 위치

- FE blocks: `apps/web/src/components/blocks/{Block,Code,File,Math,Paragraph,Pdf,Quote}*.tsx`
- BE renderer: `apps/api/app/services/html_renderer.py#_b_video`
- Editor: `apps/web/src/features/editor/blocks/ImageBlockEditor.tsx`
- lat: `docs/lat/documents.md` (CalloutBlock variant 표 두 줄)

## 후속 / 잇닿음

- Cycle 2 (S, 8건): video FE 토글 / math debounce / callout 4 variant 다크 / list/IA/gallery a11y / spreadsheet 시각 / pdf alias / i18n
- Cycle 3 (M, 2건): spacer + spreadsheet 의 html/md/pptx export 핸들러
- 본 사이클의 VID-02 (BE) 와 cycle 2 의 VID-01 (FE) 가 짝 — 옵션 schema flag end-to-end 완성
