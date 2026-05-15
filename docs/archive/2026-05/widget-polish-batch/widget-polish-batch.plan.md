# Plan — widget-polish-batch

> Cycle 통합 — 5 follow-up 을 한 사이클로 묶음:
> 4-1 Cell image picker / 4-2 image-annotation roundtrip / 5-2 Cell inline format /
> 5-3 Cell drag-drop / C6 columns autodetect

## Executive Summary

| 관점 | 내용 |
| --- | --- |
| **Problem** | Cycle X-Z 마무리 후 남은 5 영역: (1) Cell image 추가가 prompt 로 ULID 입력 — UX 결함. (2) image-annotation 만 round-trip skip. (3) Cell 안 paragraph 의 inline format (bold/italic/link) 무지원. (4) Cell 안 블록 순서 변경 UI 없음. (5) docx multi-column 자동 인식 미지원. |
| **Solution** | 단일 사이클에서 5 generator 가 각각 독립 영역 처리. ImageDropzone 재사용, image_resolver 흐름 강화, contentEditable inline 툴바, 위/아래 버튼 + native DnD, sectPr 파싱. |
| **Function UX Effect** | 표 셀이 풍부한 편집기 (이미지 picker / inline 서식 / 순서 변경) 로 작동. image-annotation 까지 lossless round-trip. Word "단" 레이아웃 자동 인식. |
| **Core Value** | Phase 1-Z 까지의 위젯 인프라 완성도. 위젯 모든 차원에서 production-grade. |

## Scope

### IN (5 generator)

**G1 — Cell image picker** (web):
- CellBlockEditor 의 ImageRowEditor 가 현재 read-only display 만 + 추가는 prompt(imageId).
- 변경: ImageDropzone + uploadImage 통합. 클릭 또는 드래그&드롭으로 업로드 → 새 image 의 imageId 자동 입력.
- 기존 image 의 imageId 도 picker 통해 교체 (replace).

**G2 — image-annotation round-trip** (BE):
- Cycle X 의 skip 해소. docx round-trip 시 image_resolver pipeline 이 placeholder 이미지를 보존 → import 의 `_convert_image_annotation` 이 target image 를 인식.
- 핵심: docx_import 의 roundtrip_mode 에서 captured_images 의 sha256→ULID 매핑이 image-annotation 마커의 첫 target 이 image 로 emit 되도록.

**G3 — Cell inline format toolbar** (web):
- ParagraphRowEditor 가 현재 plain textarea.
- 변경: contentEditable 또는 textarea + selection 추적으로 "굵게/기울임/링크" 단추 (floating 또는 toolbar).
- markdown 마커 (`**...**`, `*...*`, `[text](url)`) 자동 삽입. 풀 WYSIWYG 아님 (의도된 단순화).
- IME (한글 입력) 안전성 유지.

**G4 — Cell drag-and-drop 행 순서** (web):
- CellBlockEditor 가 현재 array 순서 고정.
- 변경: 각 행에 위/아래 화살표 버튼 (간단, 모바일 친화) + native HTML5 DnD (마우스, drag handle).
- 새 dependency 추가 안 함.

**G5 — columns autodetect** (BE):
- Cycle Y 의 plan-OUT 처리. docx_import 의 sectPr `<w:cols>` 파싱.
- Phase 3 dispatcher 에 `_autodetect_columns` 추가 — section 메타에 `multi_column=N` 마커 있으면 section.blocks 를 N 단 ColumnsBlock 으로 감쌈.

### OUT

- QR encoder 풀 구현 (의도된 fallback, 사용자 결정).
- AI / SSO (정책 결정 필요).
- DnD 라이브러리 (dnd-kit) 도입 (new dependency 회피).

## Success Criteria

1. **G1**: 표 셀 안 + 버튼 클릭 → ImageDropzone modal → 업로드 또는 라이브러리 선택 → 새 ImageBlock 의 imageId 정확.
2. **G2**: `test_roundtrip_preserves_image_annotation` 의 skip 해제 → pass.
3. **G3**: 셀 paragraph 텍스트에 selection 후 "B" → `**선택텍스트**`. 동일 패턴 italic, link.
4. **G4**: 행 위/아래 버튼 클릭 → blocks 순서 변경 + onChange. drag-and-drop 도 동작.
5. **G5**: docx 의 multi-column section 이 import 후 ColumnsBlock 으로.
6. typecheck / pytest / openapi drift 회귀 0.

## Work Split

| Agent | 담당 | 영역 |
|---|---|---|
| G1 | Cell image picker | apps/web (CellBlockEditor.tsx) |
| G2 | image-annotation roundtrip | apps/api (widget_markers + docx_roundtrip + image flow) |
| G3 | Cell inline format | apps/web (CellBlockEditor.tsx + new InlineFormatToolbar) |
| G4 | Cell drag-drop | apps/web (CellBlockEditor.tsx) |
| G5 | columns autodetect | apps/api (docx_import + widget_markers) |
| V1 | 통합 검증 (Sonnet) | read-only |

**병렬화 가능성**:
- G1 / G3 / G4 가 같은 파일 (CellBlockEditor.tsx) 만짐 → **직렬 강제** (G1 → G3 → G4).
- G2 / G5 는 BE 영역, 서로 다른 import 흐름 → **G2 ‖ G5 병렬**.
- 결과 흐름: G2+G5 동시 발사 → 메인 통합 → G1 → G3 → G4 → V1.

## Risks

| Risk | Mitigation |
|---|---|
| ImageDropzone 통합이 modal 컨텍스트 복잡 | 기존 ImageBlockEditor 의 사용 패턴 그대로 따라가기. 새 wrapper 만들지 않음. |
| image-annotation 의 image_resolver 통합이 docx_roundtrip 만 영향, 실 production 흐름 무관 검증 | roundtrip 테스트만 통과시키고 production 흐름 그대로 |
| contentEditable IME (한글) 버그 | textarea 유지 + selection API 만 사용. 진짜 contentEditable 회피 |
| native DnD 의 모바일 미지원 | 위/아래 버튼이 1차 UX. DnD 는 데스크탑 보조. |
| sectPr 파싱이 다른 docx 동작에 영향 | sectPr 은 현재 무시 중 → 새 코드는 additive only, 기존 동작 변경 0 |

## Cycle Boundaries

archive: `docs/archive/2026-05/widget-polish-batch/`.
