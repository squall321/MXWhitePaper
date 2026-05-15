# Plan — Mixed-content table cells

## Executive Summary

| 관점 | 한 줄 요약 |
| --- | --- |
| **Problem** | 사내 PPT 의 50%+ 가 "사진 + 설명 + 숫자" 혼합 셀 표를 쓰는데, 현재 `Cell.text: str` 만 지원해서 import 시 이미지 손실 + 의미 평탄화. |
| **Solution** | `Cell` 에 `blocks: list[CellBlock]` 옵션 필드 추가. 셀이 image/list/paragraph 혼합을 보유 가능. `text` 와 상호 배타 (one-of validator). |
| **Function / UX 효과** | docx/pptx 의 혼합 셀이 import 후에도 시각 + 데이터 그대로 보존. export 시에도 셀 안 이미지/단락 렌더. |
| **Core Value** | PPT 베이스 사내 자료 → 구조화 DocumentJSON 변환의 핵심 누락 조각 해결. |

## 목표 / 비목표

### 목표 (이 PR 의 scope)

- `Cell` 스키마 확장 — 셀 1 개에 paragraph/image/list 블록 다수 허용.
- 4 렌더러 (docx/pptx/html/markdown) 가 `Cell.blocks` 모드를 처리.
- 2 importer (docx/pptx) 가 셀 안 이미지를 인식하고 `blocks` 로 emit.
- 회귀 방지: 기존 `text` 모드 cell 동작 100% 유지.
- 테스트: 정방향 (입력 mixed cell → blocks 유지) + round-trip.

### 비목표 (별도 작업)

- 셀 안 `table`/`callout`/`chart` 등 복잡한 위젯 재귀 — paragraph/image/list
  3 가지로 제한.
- FE 위키 에디터 UI — 본 PR 은 BE 만. FE 는 후속.
- `Widget: <type>` 통일 룰 (별도 PR — B 청사진 #1 우선순위).

## 변경 영향 범위

| 파일 | 변경 | 위험도 |
| --- | --- | --- |
| `apps/api/app/schemas/document.py` | `Cell` 필드 추가 + 새 `CellBlock` union | 중 — schema 변경 |
| `apps/api/app/services/docx_export.py` | `_emit_table_cells()` 셀 렌더 분기 | 중 |
| `apps/api/app/services/pptx_export.py` | `_b_table()` 의 셀 텍스트 채우기 분기 | 중 |
| `apps/api/app/services/html_renderer.py` | `_b_table()` 셀 HTML | 하 |
| `apps/api/app/services/markdown_export.py` | `_b_table()` 셀 markdown | 하 |
| `apps/api/app/services/docx_import.py` | 표 안 이미지 추출 → `Cell.blocks` | 상 — 셀 단위 OOXML 파싱 추가 |
| `apps/api/app/services/pptx_import.py` | 표 안 이미지 추출 | 중 |
| `apps/api/tests/test_documents.py` 등 | 스키마 변경에 따른 회귀 확인 | 하 |
| `apps/api/tests/test_mixed_cells.py` (신규) | 정방향 + round-trip | — |

## 스키마 변경 — 정확한 형태

```python
# Block subset that may live inside a table cell. Intentionally narrow to
# keep cell rendering tractable; tables-in-tables and callouts-in-cells
# remain out of scope.
CellBlock = RootModel[Annotated[
    ParagraphBlock | ImageBlock | ListBlock,
    Field(discriminator='type')
]]


class Cell(BaseModel):
    model_config = ConfigDict(extra='forbid')

    r: int = Field(..., ge=0)
    c: int = Field(..., ge=0)
    row_span: int | None = Field(None, alias='rowSpan', ge=1)
    col_span: int | None = Field(None, alias='colSpan', ge=1)

    # CHANGED: text now optional. Either `text` or `blocks` must be set.
    text: str | None = None
    blocks: list[CellBlock] | None = None

    header: bool | None = None
    align: Align1 | None = None
    bg: str | None = Field(None, pattern=r'^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$')
    bold: bool | None = None
    color: str | None = Field(None, pattern=r'^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$')

    @model_validator(mode='after')
    def _one_of_text_or_blocks(self) -> 'Cell':
        if (self.text is None or self.text == '') and not self.blocks:
            # tolerate empty cells — both None becomes text=''
            self.text = ''
        if self.text is not None and self.blocks is not None and self.text != '':
            raise ValueError("Cell must have either `text` or `blocks`, not both")
        return self
```

## 단계별 진행

1. **schema 확장 + 단위 테스트** — 새 Cell 검증 케이스 (text only / blocks only / both → 에러).
2. **markdown 렌더러** — 가장 단순. 셀 안 paragraph/image/list 평탄화.
3. **html 렌더러** — `<td>` 안에 paragraph 의 `<p>`, image `<img>`, list `<ul>`.
4. **docx 렌더러** — `_emit_table_cells()` 안에서 셀 별 add_paragraph + add_picture.
   가장 어려운 부분. 셀에 paragraph 여러 개 / 이미지 / 리스트 추가.
5. **pptx 렌더러** — pptx 표의 셀은 text frame 만 가짐. 이미지는 본문 평탄화로
   대체 (제약 명시). 텍스트 + 리스트는 paragraph 단위 보존.
6. **docx_import** — 표 단계 walk 시 각 cell 안 `<w:drawing>` 검출 → 이미지
   업로드 + `Cell.blocks` 에 `image` 추가. 셀 안 text run 은 paragraph 로 함께 emit.
7. **pptx_import** — slide.table 의 cell 에 has_text_frame + has_chart 등 활용.
8. **round-trip 테스트** — 혼합 셀 PPT 한 장 만들어서 import → export 후 이미지
   sha256 보존 검증.
9. **lat 문서 동기화** — `documents.md`, `imports.md`, `export.md` 셀 모드 설명 추가.

## 위험

- **기존 데이터**: 모든 기존 cell 에는 `text` 가 있고 `blocks` 가 없음 → 새 validator
  통과. DB migration 불필요.
- **export pptx 한계**: python-pptx 의 table cell 은 텍스트만 — 이미지 inject 가
  까다로움. 1차는 이미지 셀을 alt 텍스트로 대체하고 별도 issue 로 보강.
- **docx_import 무거움**: 표 셀의 `<w:p>` 안 `<w:drawing>` 파싱은 기존 본문 흐름과
  분리되어 있어 image_uploader 호출 경로 새로 만들어야 함. preprocess_zip_images
  로 이미 sha 맵이 있으니 그걸 활용.
- **테스트 안정성**: 기존 테스트 `test_documents.py`, `test_docx_export.py`,
  `test_docx_roundtrip.py` 가 cell 시그니처에 의존 — text 만 보내는 케이스는
  계속 통과해야 함.

## Success Criteria (Done = 모두 ✅)

- [ ] schema 변경 + validator + 단위 테스트 통과
- [ ] markdown / html 렌더러: 셀 안 paragraph + image 렌더 확인
- [ ] docx 렌더러: 셀 안 paragraph + image 렌더 확인 (Word 열어서 검수)
- [ ] pptx 렌더러: 텍스트는 보존, 이미지는 alt 텍스트 fallback (제약 명시)
- [ ] docx_import: 표 셀 안 이미지 → `Cell.blocks` 에 image 블록
- [ ] pptx_import: 동일
- [ ] round-trip: 혼합 셀 docx → import → export → 이미지 sha256 일치
- [ ] 기존 테스트 전체 통과 (회귀 없음)
- [ ] lat 문서 (`documents.md`, `imports.md`, `export.md`) 갱신
