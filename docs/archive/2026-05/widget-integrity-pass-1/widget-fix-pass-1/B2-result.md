# B2 Result — Schema + imageId

> Cycle: widget-integrity-pass-1
> Agent: B2 (Schema + imageId 통일)
> Date: 2026-05-18
> Plan: [[../../01-plan/features/widget-integrity-pass-1.plan.md]]
> Design: [[../../02-design/features/widget-integrity-pass-1.design.md]] §2

## 변경 요약

### Z1 — SpreadsheetBlock에 `options.stripe` 추가  · ✅ DONE

- `packages/shared/schemas/document.json` L1145~1162 — `SpreadsheetBlock`
  정의에 `options: { stripe: boolean }` 신설. design §2.2의 spec 그대로
  (default true, header 미영향, additionalProperties=false).
- regen된 pydantic 모델 (`apps/api/app/schemas/document.py`) +
  TS 타입 (`apps/web/src/types/document.ts`) 양쪽 모두 `options` 필드 반영.
- 머지 후 `docs/03-analysis/widget-fix-pass-1/B2-z1-done.flag` 생성하여
  **B1의 spreadsheet stripe export 처리 unblock**.

### G3 — imageId 통일 (snake → camel)  · ✅ DONE

#### Schema (`document.json`)
- `ImageAnnotationBlock` L1056~1071의 `image_id` → `imageId`로 키 변경
  + required 배열도 함께 수정. description에 BE 정규화 노트 추가.
- (ImageBlock·GalleryBlock은 이미 `imageId`였음.)

#### Regenerated artifacts
- `apps/web/src/types/document.ts` — `ImageAnnotationBlock.imageId: string` (regen).
- `apps/api/app/schemas/document.py` — `image_id: str = Field(..., alias='imageId')`
  로 pydantic alias 처리. BE 코드는 snake_case로 접근, JSON I/O는 camel.

#### FE 사용처 일괄 변경
- `apps/web/src/features/editor/blocks/ImageAnnotationBlockEditor.tsx`
  — `block.image_id` → `block.imageId` (4곳), patch payload의 `image_id` → `imageId` (1곳),
  docstring 2줄.
- `apps/web/src/components/blocks/ImageAnnotationBlock.tsx`
  — `block.image_id` → `block.imageId` (2곳), docstring 1줄.
- `apps/web/src/features/editor/components/BlockInsertPalette.tsx`
  — image-annotation 블록 생성 시 빈 `image_id: ''` → `imageId: ''`.
- `apps/web/src/features/editor/blocks/__tests__/AllBlockEditors.test.tsx` — fixture 1줄.
- `apps/web/src/features/editor/blocks/__tests__/ImageAnnotationBlockEditor.test.tsx` — fixture 1줄.
- `apps/web/src/components/blocks/__tests__/AllBlocksRender.test.tsx` — fixture 1줄.

`rec.image_id` (uploadImage API 응답 필드) 등 **block 외부의 image_id**는
B2 범위 밖이라 그대로 두었음 (api.ts, series, templates 컨텍스트).

#### BE 정규화 헬퍼
`apps/api/app/services/document_service.py`에 `_normalise_image_annotation_ids()`
신설 (L234~283). `validate_documentjson()` 진입부에서 호출하여 image-annotation
블록 안의 legacy `image_id` 키를 `imageId`로 in-place rename. 다른 type의 블록은 손대지 않음.

이유: pydantic v2의 `Field(alias='imageId')` + `extra='forbid'` 조합 때문에
legacy `image_id` 키만 있으면 validation이 reject함. read-side 호환만 위해
변환하고 DB 마이그레이션은 하지 않음 (디자인 §2.2 decision #2).

## 테스트 결과

| 영역 | 명령 | 결과 |
|---|---|---|
| Schema 검증 | `pytest tests/ -k schema -v` | 1 passed (test_mixed_cells) |
| Document service | `pytest tests/test_documents.py tests/test_block_patch.py -v` | 16 passed |
| Widget export + 신규 schema | `pytest tests/test_widget_export_markers*.py tests/test_mixed_cells.py tests/test_schema_widget_pass1.py -v` | 72 passed |
| 신규 B2 테스트 | `pytest tests/test_schema_widget_pass1.py -v` | **4 passed** |
| BE 전체 | `pytest tests/` | 961 passed (flaky DB tests 무관) |
| FE 전체 | `pnpm test -- --run` | **1535 passed / 204 files** |

신규 BE 전체 실행에서 가끔 audit/auth/totp 등 fixture-격리에 의존하는 테스트가
실행 순서에 따라 flaky하게 fail하는 현상이 관찰됨. **B2 변경과 무관 — 다른
도메인이고, 단독 실행 시 모두 통과**. 대상 도메인 (documents / block_patch /
widget_export_markers / mixed_cells / schema_widget_pass1) 88건은 모두 안정적
통과.

### 신규 테스트 4개 (design §2.3)

`apps/api/tests/test_schema_widget_pass1.py` (152줄):

1. `test_spreadsheet_with_options_stripe_validates` — Z1 추가한 옵션이 schema로 통과.
2. `test_spreadsheet_without_options_still_validates` — 기존 spreadsheet (옵션 없음) 호환.
3. `test_image_blocks_validate_with_image_id_camelcase` — ImageBlock·ImageAnnotationBlock 둘 다 `imageId`로 valid.
4. `test_legacy_image_id_normalises_to_imageid` — 정규화 헬퍼 단위 테스트 + e2e validate_documentjson 통과.

## 부록

### 변경 라인 수 (B2 단독)

- `packages/shared/schemas/document.json`: +15 / -3 (SpreadsheetBlock options + ImageAnnotation imageId)
- `apps/api/app/schemas/document.py`: +2 / -2 (regen 결과)
- `apps/api/app/services/document_service.py`: +54 (정규화 헬퍼 + 호출부 1줄)
- `apps/web/src/types/document.ts`: +1 / -1 (regen)
- `apps/web/src/features/editor/blocks/ImageAnnotationBlockEditor.tsx`: +5 / -5
- `apps/web/src/components/blocks/ImageAnnotationBlock.tsx`: +3 / -3
- `apps/web/src/features/editor/components/BlockInsertPalette.tsx`: +1 / -1
- 3개 test fixture: +3 / -3
- `apps/api/tests/test_schema_widget_pass1.py`: +152 (신규)

총 +236 / -18.

### 발견된 image_id 사용처 (FE — block 외부 context, 변경 안 함)

- `features/upload/api.ts` — uploadImage API 응답 필드 `image_id` (서버 응답 표준)
- `features/upload/uploadImage.ts`, `dispatchByMime.ts`, `__tests__/uploadImage.test.ts`
- `features/templates/serverApi.ts` — `thumb_image_id` (DB 컬럼명)
- `features/series/api.ts` — `cover_image_id` (DB 컬럼명)
- `features/editor/paste/imageRehydrate.ts`, `SmartFileDropZone.tsx`, `CellBlockEditor.tsx`,
  `GalleryBlockEditor.tsx`, `SlashCommandMenu.tsx`, `EditorToolbar.tsx`,
  `ArticleDropSurface.tsx`, `ImageBlockEditor.tsx` — 모두 `rec.image_id`로 uploadImage 응답을
  소비하는 패턴. block field와 무관.

이들은 다른 도메인 (upload API, series cover, template thumb)이고 G3의 범위는
**image-annotation block의 schema field 통일**이므로 의도적으로 손대지 않음.

### B1 unblock 신호

- `docs/03-analysis/widget-fix-pass-1/B2-z1-done.flag` (Z1 머지 직후 생성, empty).

### 의존성·후속 작업 noteable

- BE의 pydantic 모델은 `image_id` snake_case 내부 표현 + `imageId` alias.
  코드 가독성 위해 BE 내부 객체 접근은 `block.image_id`로 가능. JSON 직렬화/역직렬화는
  자동으로 camel.
- 마이그레이션은 없음. 기존 DB에 저장된 `{"image_id": "..."}` 형태의 document_versions는
  read 시 `validate_documentjson` 진입부에서 정규화되어 항상 `imageId`로 응답.
