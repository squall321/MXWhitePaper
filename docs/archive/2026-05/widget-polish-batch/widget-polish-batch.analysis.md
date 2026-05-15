# Gap Analysis — widget-polish-batch

> Plan: [widget-polish-batch.plan.md](../01-plan/features/widget-polish-batch.plan.md)
> Cycle date: 2026-05-15

## Match Rate: **100%** (5 영역 모두 작동 + 1 BE pre-existing 결함 추가 fix)

## 1. Success Criteria

| 기준 | 결과 |
|---|:---:|
| G1 Cell image picker (ImageDropzone modal) | ✅ |
| G2 image-annotation roundtrip (skip 해제) | ✅ 14/14 |
| G3 Cell inline format toolbar (B/I/링크) | ✅ |
| G4 Cell drag-drop (▲/▼ + native DnD) | ✅ |
| G5 columns autodetect (sectPr <w:cols>) | ✅ |
| 전체 BE pytest | ✅ 931 passed, 0 skipped |
| 전체 Web vitest | ✅ 1520 passed |
| typecheck / openapi drift 0 | ✅ |

## 2. 작업 분할 — 5 Generator + 1 Verifier

| Agent | 영역 | 변경 | Tests |
|---|---|:---:|:---:|
| G1 image picker | apps/web/CellBlockEditor.tsx + tests | ~150 LOC | 6 신규 |
| G2 image-ann roundtrip | apps/api (docx_export + widget_markers + roundtrip test + lat) | ~80 LOC | 1 skip 해제 |
| G3 inline format | apps/web/CellBlockEditor.tsx + tests | ~120 LOC | 10 신규 |
| G4 drag-drop | apps/web/CellBlockEditor.tsx + tests | ~100 LOC | 9 신규 |
| G5 columns autodetect | apps/api (docx_import + widget_markers + lat) + tests | ~80 LOC | 7 신규 |
| V1 verifier (Sonnet) | read-only 8-area audit | — | — |

병렬화: G2 + G5 동시 발사 (BE 영역 분리). G1 → G3 → G4 직렬 (모두 CellBlockEditor.tsx).

## 3. V1 verifier 발견

본 사이클 영역 **BLOCKING 0**. 추가로 발견된 **pre-existing 결함 1건**:
- `test_select_versions_compacts_old_per_day` 가 fixture 의 `base = now - 2days` 가 *시각에 따라* calendar day 경계를 넘는 버그. 다른 calendar day 의 두 버전은 day-compaction 대상이 아니라 결과 mismatch.
- 본 사이클과 무관하나 정직성 차원에서 같이 fix — `base` 를 `(now - 2days).date()` 의 정오로 고정해 wall-clock hour 무관 안정.

## 4. 핵심 의사 결정

### 4.1 G2 — image-annotation 의 두 갈래 strategy (Path A + B 조합)

- **Path A (export 측 fix)**: `_b_image_annotation` 가 marker → image (resolver bytes 있을 때만) → annotation table → italic decoration. 이미지 없을 때는 table 이 first target.
- **Path B (import 측 fallback)**: `_convert_image_annotation` 가 TableBlock first target 도 허용 → placeholder image_id 발급 + warning.
- 결과: image bytes 가 round-trip 통과해도 안 통과해도 *항상* image-annotation 으로 복원.

### 4.2 G5 — section-level autodetect (별도 dispatcher)

`columns` autodetect 는 *block-level* signal 이 없음 (어떤 표든 column 일 수 있음 false positive 위험). 진짜 signal = docx 의 `<w:cols w:num=N>` = *section-level*. 그래서 `apply_section_column_autodetect` 가 `WIDGET_AUTODETECTORS` (block-level) 와 **분리된** 함수. 호출 순서: markers → block autodetect → section column autodetect (broadest, last).

### 4.3 G1 — modal pattern + manual fallback

`window.prompt` 제거 → modal 컴포넌트 (`CellImagePickerModal`). `ImageDropzone` 통합 (programmatic open via ref). 동시에 manual ULID 입력 fallback 유지 (power user 가 라이브러리 ULID 직접 입력).

### 4.4 G3 — IME 안전성

`compositionstart/end` 인터셉트 *없음*. 한글 IME 가 합성 모드에 들어가도 toolbar 가 영향 안 받음. selection 은 *버튼 클릭 시점에만* 읽음. 한국어 사용자 안전.

### 4.5 G4 — DnD + ▲/▼ 두 channel

native HTML5 DnD = 데스크탑 보조. ▲/▼ 버튼 = primary (모바일/키보드 친화). 새 dependency (dnd-kit) 없이 native API 만 사용 — Cycle Z 의 "no new deps" 원칙 유지.

## 5. 메트릭

| 지표 | 값 |
|---|---|
| Match Rate | **100%** |
| BE pytest | **931 passed, 0 skipped** (image-annotation skip 해제 후 첫 완전 0 skip 상태) |
| Web vitest | **1520 passed** |
| 전체 새 테스트 | ~33 (image picker 6 + roundtrip 1 + inline 10 + drag 9 + cols 7) |
| Web typecheck | exit 0 |
| OpenAPI drift | 0 |
| 변경 파일 | 6 web + 4 BE + 2 lat + 1 test fixture fix |
| Generator | 5 (Opus) |
| Verifier | 1 (Sonnet, BLOCKING 0) |
| Verifier 가 발견한 pre-existing 결함 | 1 (test fixture wall-clock 버그) — 같이 fix 완료 |
