# B1 Result (pass-2) — BE Export + Service

> Owner: B1 (export + service-side label normaliser).
> Date: 2026-05-18.
> Design: [[../../02-design/features/widget-integrity-pass-2.design.md#1-b1-be-export-service]].
> 1.0 design § 1.2 의 모든 MED 갭 (M3 / M5 / M6 / M7 / M11) 처리.

## 변경 요약

- **M3 pdf docx page marker**: ✅ `_b_pdf` (apps/api/app/services/docx_export.py)
  에 hidden run 추가. `page` 가 int 이고 1 이 아닐 때만
  `⟦pdf:page={page}⟧` 를 `font.hidden=True` 로 emit. page=1 (default) 인
  경우엔 hidden marker 미emit (소음 회피).
- **M5 annotation label 정규화**: ✅ `_normalise_image_annotation_labels()`
  를 `_normalise_image_annotation_ids` 패턴 그대로 `document_service.py`
  에 추가. `validate_documentjson()` 진입부에서 호출. callout-kind
  annotation 의 legacy `text` → `label` 을 in-place 로 rename.
  arrow / rect 는 이미 canonical 이므로 손대지 않음.
- **M6 org-chart docx layout marker**: ✅ `_b_org_chart` 에 hidden run
  추가. `layout` 이 default ("tree") 가 아니고 string 일 때만
  `⟦org-chart:layout={layout}⟧` 를 emit. tree 인 경우 미emit
  (기존 `Widget: org-chart` marker 만으로 충분).
- **M7 gallery docx layout marker**: ✅ 기존
  `widget_markers.emit_marker_text` 가 `layout == "carousel"` 일 때
  `Widget: gallery (carousel)` 을 이미 emit 함. `_b_gallery` 가 그
  marker 를 hidden 으로 박는 경로 검증 (회귀 테스트 추가).
- **M11 glossary-ref dead code 제거**: ✅ `_b_glossary_ref` 의
  `block.get("definition")` 시도 3 라인 제거. schema 에 없는 필드 (오로지
  `type / id / term / meta` 만 존재) 이므로 dead branch.

## 영향 파일

- `apps/api/app/services/docx_export.py` — `_b_pdf` (+6 -0),
  `_b_org_chart` (+8 -0), `_b_glossary_ref` (-5).
- `apps/api/app/services/document_service.py` — `_normalise_image_annotation_labels`
  헬퍼 추가 + `validate_documentjson` 진입부 호출 (+99 -0).
- `apps/api/tests/test_widget_export_markers.py` — 회귀 4 케이스 추가
  (+90 -0).
- `apps/api/tests/test_schema_widget_pass1.py` — M5 helper 단위 2 케이스
  추가 (+99 -0). `_normalise_image_annotation_labels` 를 import 리스트에
  포함.

다른 에이전트 소유 파일 (특히 `packages/shared/schemas/document.json`,
`packages/shared/codegen/generate-py.py`, FE 컴포넌트, `widget_markers.py`)
은 *읽기만* — 수정 없음.

## 신규 테스트 (4 + 보조 2 = 6 케이스)

`tests/test_widget_export_markers.py`:

1. `test_b_pdf_page_hidden_marker_emitted_when_non_default` —
   page=5 인 PDF block 의 docx export 에 `⟦pdf:page=5⟧` hidden run 존재.
2. `test_b_pdf_page_hidden_marker_skipped_when_default` — page=1 (default)
   인 경우 hidden page marker 가 *없어야* 함.
3. `test_b_org_chart_horizontal_layout_hidden_marker` — layout=horizontal
   org-chart 의 docx export 에 `⟦org-chart:layout=horizontal⟧` hidden run
   존재.
4. `test_b_glossary_ref_renders_without_definition_field` — schema 에
   없는 `definition` 필드 없이도 GlossaryRefBlock export 가 정상 통과
   (회귀; pass-1 dead code 잔존 검증).

`tests/test_schema_widget_pass1.py`:

5. `test_legacy_callout_text_normalises_to_label` — callout-kind
   annotation 의 legacy `text` 키가 정규화 helper 와 end-to-end
   `validate_documentjson` 양쪽 모두에서 `label` 로 rename 됨.
6. `test_arrow_rect_annotations_unchanged_by_label_normaliser` —
   arrow / rect annotation 은 이미 canonical 이므로 helper 가
   건드리지 않음.

기존에 존재하는 `test_b_gallery_carousel_variant_in_marker` (L499) 가
M7 의 export 측 동작을 이미 커버하므로 추가 케이스 불필요.

## 테스트 결과

```bash
apptainer exec instance://mxwp_api bash -lc \
  'cd /workspace/apps/api && python -m pytest \
     tests/test_docx_export.py tests/test_html_export.py \
     tests/test_pptx_export.py tests/test_markdown_export.py \
     tests/test_widget_export_markers.py \
     tests/test_schema_widget_pass1.py --tb=no'
```

→ **131 passed, 14 failed**.

- 14 failed 는 *모두* 사전 존재하는 endpoint 테스트 — postgres shared
  memory 셋업 부재 (`asyncpg.exceptions.UndefinedFileError: could not open
  shared memory segment "/PostgreSQL.…"`). 내 변경과 무관 (DB 인프라
  이슈, B1 pass-1 시점에도 동일).
- 131 passed 에 본 사이클 신규 6 케이스 + 기존 모든 회귀 포함.
- 내 신규 6 케이스 단독 실행 시: 7 passed (gallery carousel 재확인
  포함).

## 부록

### 변경 라인 수 (B1 소유 파일만)

| 파일 | 추가 | 삭제 |
|---|---:|---:|
| `apps/api/app/services/docx_export.py` | 14 | 5 |
| `apps/api/app/services/document_service.py` | 99 | 0 |
| `apps/api/tests/test_widget_export_markers.py` | 90 | 0 |
| `apps/api/tests/test_schema_widget_pass1.py` | 99 | 0 |
| **합계** | **302** | **5** |

### 설계 결정 노트

1. **hidden marker 포맷 `⟦…⟧`** — 기존 `Widget: <type> (variant)` 단일
   marker 와 충돌하지 않도록 별도 grammar 채택 (design § 1.2 M3 / M6
   의 예시 그대로). round-trip importer 가 추후 보강될 때
   `widget_markers.parse_marker` 옆에 별도 parser 가 들어갈 것
   (B1 범위 밖).
2. **M3 / M6 의 default 값 skip** — pdf.page=1 / org-chart.layout=tree
   는 schema default 이므로 hidden marker 도 emit 하지 않음. emit 하면
   docx 가 불필요한 빈 paragraph 로 부풀어 오르고, round-trip 시 무해한
   no-op 이 깜빡임 원인이 됨.
3. **M5 helper 의 walk 구조** — `_normalise_image_annotation_ids` 의
   walk 패턴 (paragraph / table 미진입, columns / tabs / accordion 만
   재귀) 그대로 따름. 동일한 책임 분할로 향후 image-annotation 관련
   normaliser 추가 시 일관성 유지.
4. **M7 (gallery)** — `widget_markers.emit_marker_text` 가 이미
   carousel variant 인코딩 처리 → `_b_gallery` 가 marker 를 hidden 으로
   박는 기존 경로 그대로. 별도 수정 없음 (소유 파일 외 수정 자제).
   기존 `test_b_gallery_carousel_variant_in_marker` 테스트가 동작
   확인용.
5. **M11 (glossary-ref)** — schema 에 `definition` 필드가 없음
   확인 (packages/shared/schemas/document.json L682-692). 코드의 dead
   branch 만 제거하면 충분, schema 변경 불필요 (design § 2.2 M11 노트
   일치).
