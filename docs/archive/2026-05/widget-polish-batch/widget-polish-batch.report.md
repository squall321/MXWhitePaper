# Report — widget-polish-batch

## Executive Summary

| 관점 | 내용 |
| --- | --- |
| **Feature** | widget-polish-batch (5 follow-up + bonus fix) |
| **Started → Completed** | 2026-05-15 (단일 세션, ~3h) |
| **Match Rate** | **100%** |
| **Problem** | Cycle X-Z 후 남은 5 follow-up: Cell image picker UX 결함, image-annotation 마지막 round-trip skip, Cell inline format 부재, Cell drag-drop 부재, columns autodetect 누락. + pre-existing test_maintenance 1건. |
| **Solution** | 단일 사이클 5 generator 병렬/직렬 + 1 verifier. ImageDropzone modal 통합, image+table 이중-경로 변환, IME-safe markdown 툴바, native HTML5 DnD + ▲/▼ 버튼, sectPr <w:cols> 파싱 + section-level autodetect. |
| **Function UX Effect** | 셀 안 풍부 편집 (이미지 picker / inline 서식 / 순서 변경), 14/14 위젯 lossless round-trip, Word "단" 자동 인식. |
| **Core Value** | 위젯 인프라 의 production-grade 완성. **BE 931/931 (skip 0)** 첫 0-결함 상태. |

## 1. 메트릭

| 지표 | 값 |
|---|---|
| Match Rate | **100%** |
| BE pytest | **931 passed, 0 skipped** |
| Web vitest | **1520 passed** |
| 신규 테스트 | ~33 |
| typecheck | 0 errors |
| OpenAPI drift | 0 |
| Generator | 5 (Opus) |
| Verifier | 1 (Sonnet, BLOCKING 0) |
| 보너스 fix | 1 (test_maintenance pre-existing wall-clock 버그) |

## 2. 5 영역 핵심 변경

### G1 Cell image picker
- `window.prompt` 제거 → `CellImagePickerModal` 컴포넌트.
- `ImageDropzone` 통합 (programmatic ref open).
- Manual ULID 입력 fallback (power user 용).
- Image row 에 "교체" 버튼 추가.

### G2 image-annotation roundtrip
- `_b_image_annotation` 재설계: marker → (image when resolver bytes 있음) → 11-col annotation table → italic decoration.
- `_convert_image_annotation` 의 table-first fallback (placeholder image_id + warning).
- `test_roundtrip_preserves_image_annotation` skip 해제.

### G3 Inline format toolbar
- 순수 helper: `wrapSelection`, `wrapLink`, `applyBold/Italic/Link`.
- B/I/🔗 버튼 (hover/focus 시 fade in).
- Selection 복원 via `useEffect([block.text])` + `pendingSel` ref.
- IME 안전: compositionstart/end 인터셉트 없음.

### G4 Drag-drop reorder
- Pure `moveBlock<T>` (immutable, edge case safe).
- ▲/▼ 버튼 (mobile/keyboard primary).
- Native HTML5 DnD (desktop bonus).
- 새 dependency 없음.

### G5 columns autodetect
- `_parse_sect_cols` extracts `<w:cols w:num=N>` (2..4 validation).
- `apply_section_column_autodetect` — section-level (NOT in WIDGET_AUTODETECTORS).
- 호출 순서: markers → block autodetect → section column autodetect.
- DOCX integration test 빌드 raw zip (python-docx 가 cols API 없음).

## 3. 발견된 부수 — 같이 fix

V1 verifier 가 발견: `test_maintenance.py::test_select_versions_compacts_old_per_day` fixture 가 `base = now - 2days` 로 잡아 wall-clock hour 에 따라 calendar day boundary 를 넘는 버그. base 를 `(now - 2days).date()` 의 정오로 고정해 안정화.

본 사이클과 무관한 pre-existing 결함이지만 정직성 정신 ("꼼수 처리 말고 제대로") 에 따라 같이 fix.

## 4. 변경 파일

| 파일 | 변경 |
|---|---|
| `apps/web/src/features/editor/blocks/CellBlockEditor.tsx` | G1+G3+G4 통합 — image picker modal, inline toolbar, ▲/▼ + DnD |
| `apps/web/src/features/editor/blocks/__tests__/CellBlockEditor.test.tsx` | 36 테스트 (G1 신규 6 + G3 신규 10 + G4 신규 9 + 기존 11) |
| `apps/api/app/services/docx_export.py` | `_b_image_annotation` 재설계 |
| `apps/api/app/services/widget_markers.py` | `_looks_like_annotation_table` + `_convert_image_annotation` table-first path + `apply_section_column_autodetect` |
| `apps/api/app/services/docx_import.py` | `_parse_sect_cols` + body sectPr 파싱 + 4번째 post-pass 호출 |
| `apps/api/tests/test_widget_export_markers_roundtrip.py` | image-annotation skip 해제 + 신규 fixture |
| `apps/api/tests/test_widget_autodetect.py` | G5 신규 7 테스트 + raw docx builder |
| `apps/api/tests/test_maintenance.py` | pre-existing 결함 test fixture fix |
| `docs/lat/imports.md` | image-annotation 행 갱신 + Phase 3 section-level 표 추가 |

## 5. 학습

- **Pure function + 컴포넌트 분리**: G3/G4 의 toolbar/reorder 로직을 *순수 함수* (`wrapSelection`/`moveBlock` 등) 로 추출 → jsdom 없는 환경에서도 충분히 테스트 가능. UI 통합 테스트는 핸들러 호출만 검증.
- **Section-level vs block-level autodetect**: columns 의 signal 이 block-level 이 아니라 section-level 이라 별도 dispatcher 사용. 명확한 분리가 false positive 와 코드 명료성 양쪽에 이득.
- **양방향 round-trip 가드**: G2 의 image-annotation 이 export path A + import path B 둘 다 강화 — image bytes 가 사라져도 placeholder + warning 으로 복원. 한쪽만 fix 하면 fragile, 둘 다 fix 하면 robust.
- **Pre-existing 결함 같이 fix 의 가치**: V1 verifier 가 사이클 영역 외 버그 발견 → 일관된 정직 (꼼수 없이) 으로 같이 fix. 자연스럽게 0-skip 0-fail 상태 도달.

## 6. 다음 사이클 (별도)

대기 follow-up (사용자 결정 시):
- AI placeholder → 실제 LLM (정책 결정)
- SSO public flow (회사 IdP 결정)
- QR encoder 풀 구현 (의도된 deferral)

본 사이클로 모든 *진짜 결함* 정리 완료.
