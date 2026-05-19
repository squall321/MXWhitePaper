# Widget Integrity Pass 2 — Design Document

> **Plan**: [[../../01-plan/features/widget-integrity-pass-2.plan.md]]
> **Feature**: widget-integrity-pass-2
> **Date**: 2026-05-18
> **Status**: Draft

pass-1과 동일한 4분할 병렬 방법론 (`B1+B2+B3+B4`). 본 문서는 각 갭의 *정확한 파일·라인 + diff 단위* 명세 + 4 에이전트 prompt 뼈대.

---

## 0. 의존성 / 진입 순서

```
B2 (schema 우선) ──┐
                  ├──> B2-schema-done.flag → B1/B3 schema 의존 작업 진입
                  ↓
              B1 + B3 (병렬)
                  ↓
              B4 (sync + 통합 테스트)
```

---

## 1. B1 — BE Export + Service

### 1.1 소유 파일

- `apps/api/app/services/docx_export.py`
- `apps/api/app/services/html_renderer.py`
- `apps/api/app/services/pptx_export.py`
- `apps/api/app/services/markdown_export.py`
- (필요 시) `apps/api/app/services/document_service.py` — annotation label 정규화

### 1.2 갭별 작업

#### M3: pdf docx page 정보 hidden marker

`docx_export.py`의 `_b_pdf` 분기 (Plan에서 L1186~1203):
```python
# 추가
marker = emit_marker_text(block)  # 이미 page를 포함하는 marker 패턴이면 그대로
# 없으면 추가:
if block.get("page") and block.get("page") != 1:
    p = document.add_paragraph()
    r = p.add_run(f"⟦pdf:page={block['page']}⟧")
    r.font.hidden = True
```

`emit_marker_text` 패턴이 이미 page를 인코딩하는지 확인 후 결정.

#### M5: annotation label 정규화 (BE)

`document_service.py`에 `_normalise_image_annotation_labels()` 추가 — `_normalise_image_annotation_ids` 와 같은 패턴. callout 종류의 annotation이 `text` 를 가지면 `label` 로 in-place rename:
```python
def _normalise_image_annotation_labels(block):
    for ann in block.get("annotations", []):
        if "text" in ann and "label" not in ann:
            ann["label"] = ann.pop("text")
```

`validate_documentjson` 진입부에서 호출.

#### M6: org-chart docx layout marker

`docx_export.py`의 `_b_org_chart` 분기 (L786~824):
```python
layout = block.get("layout", "tree")
marker = f"⟦org-chart:layout={layout}⟧"  # 기존 marker 패턴 확인 후 추가
```

#### M7: gallery docx layout marker

`docx_export.py`의 `_b_gallery` (L933~953):
```python
layout = block.get("layout", "grid")
# marker에 variant 인코딩 (기존 marker 형식 확인 후 진행)
```

#### M11: glossary-ref docx_export 죽은 코드 제거

`docx_export.py:996` 근처의 `block.get("definition")` 시도 제거 (schema에 없는 필드를 시도하는 죽은 코드).

#### M1: data-source server-side polling은 BE 안 건드림

(M1은 FE 단독 작업 — B3 소유).

### 1.3 테스트

```bash
apptainer exec instance://mxwp_api bash -lc 'cd /workspace/apps/api && python -m pytest tests/test_docx_export.py tests/test_html_export.py tests/test_pptx_export.py tests/test_markdown_export.py tests/test_widget_export_markers.py -v --maxfail=10'
```

새 케이스:
- pdf docx에 page=5 marker hidden run 포함
- org-chart docx에 layout=horizontal marker 포함
- gallery docx에 layout=carousel marker 포함
- glossary-ref에 definition 없어도 export 통과 (회귀)

### 1.4 산출물

`docs/03-analysis/widget-fix-pass-2/B1-result.md`

---

## 2. B2 — Schema + 정규화 헬퍼

### 2.1 소유 파일

- `packages/shared/schemas/document.json`
- 자동 regen: `apps/web/src/types/document.ts`, `apps/api/app/schemas/document.py`

### 2.2 갭별 작업

#### M2: iframe XOR schema 강화

`IframeBlock` (L563~584 근처)에 `oneOf`:
```json
"oneOf": [
  { "required": ["src"], "not": { "required": ["html"] } },
  { "required": ["html"], "not": { "required": ["src"] } }
]
```

pydantic v2에서 `oneOf` 직접 지원 여부 확인 — 안 되면 validator 함수로:
```python
@model_validator(mode='after')
def check_src_xor_html(self):
    if bool(self.src) == bool(self.html):
        raise ValueError("Exactly one of src or html must be set")
    return self
```

#### M4: video schema 옵션

`VideoBlock` (L586~597) properties에:
```json
"autoplay": { "type": "boolean", "default": false, "description": "Auto-play on load (browser policy may block)." },
"controls": { "type": "boolean", "default": true, "description": "Show video controls (play/pause/volume)." },
"loop":     { "type": "boolean", "default": false }
```

#### M5: annotation label schema 통일

`ImageAnnotationBlock` (L1056~1131)의 callout 타입에서 `text` → `label`:
```json
// 변경 전 (callout):
"text": { "type": "string", "maxLength": 200 }
// 변경 후:
"label": { "type": "string", "maxLength": 200 }
```

`required` 배열도 갱신. arrow/rect는 이미 `label` 사용 중 (점검 확인).

#### M11: glossary-ref schema `definition` 정리

GlossaryRefBlock에 `definition` 필드 있는지 확인. 점검상 *schema엔 없는데* docx_export 코드가 시도한다 했음. **schema 변경은 불필요**, B1의 dead code 제거로 해결.

### 2.3 진입 순서 — flag 신호

schema 변경 완료 즉시 `docs/03-analysis/widget-fix-pass-2/B2-schema-done.flag` 생성 → B1·B3 unblock.

### 2.4 테스트

```bash
apptainer exec instance://mxwp_api bash -lc 'cd /workspace/apps/api && python -m pytest tests/test_schema_widget_pass2.py tests/test_document_service.py -v'
```

새 케이스 (`test_schema_widget_pass2.py` 신규):
- iframe with both src+html → 거부
- iframe with neither → 거부
- iframe with src only → OK
- iframe with html only → OK
- video with autoplay/controls/loop → OK
- video 기존 문서 (옵션 없음) → OK
- annotation label 통일 후 검증

### 2.5 산출물

`docs/03-analysis/widget-fix-pass-2/B2-result.md`

---

## 3. B3 — FE Editor

### 3.1 소유 파일

- `apps/web/src/components/blocks/DataSourceBlock.tsx`
- `apps/web/src/features/editor/blocks/Heading4BlockEditor.tsx` (없으면 신규)
- `apps/web/src/features/editor/blocks/QuoteBlockEditor.tsx` (신규)
- `apps/web/src/components/blocks/GlossaryRefBlock.tsx`
- `apps/web/src/features/editor/blocks/ImageAnnotationBlockEditor.tsx`
- `apps/web/src/components/blocks/BlockRenderer.tsx` (dispatcher 등록)

### 3.2 갭별 작업

#### M1: data-source refreshInterval 동작화

`DataSourceBlock.tsx` (L52 근처)에서:
```tsx
// 변경 전:
useQuery({ staleTime: 60_000 })
// 변경 후:
useQuery({
  staleTime: (block.refreshInterval ?? 60) * 1000,
  refetchInterval: block.refreshInterval ? block.refreshInterval * 1000 : false,
})
```

#### M8: heading-4 level 드롭다운

Heading4BlockEditor 신규 또는 기존 컴포넌트에 추가:
```tsx
<select value={level} onChange={(e) => patchBlock({ level: Number(e.target.value) })}>
  <option value={2}>H2</option>
  <option value={3}>H3</option>
  <option value={4}>H4 (default)</option>
</select>
```

#### M9: QuoteBlockEditor 신규

pass-1의 SpacerBlockEditor 패턴 그대로:
- text textarea
- cite input
- patchBlock 호출

`BlockRenderer.tsx` dispatcher에 `block.type === 'quote'` 분기 추가.

#### M5: annotation label 통일 (FE)

`ImageAnnotationBlockEditor.tsx`에서 callout annotation의 `text` → `label` 일괄 변경. B2 schema 머지 후 진행.

#### M11: glossary-ref broken-ref 시각화

`GlossaryRefBlock.tsx`에서 useGlossary가 못 찾은 경우 ⚠️ 아이콘 + 회색 배경 표시 (기존엔 회색 텍스트만).

### 3.3 테스트

```bash
cd /home/koopark/claude/MXWhitePaper/apps/web && pnpm test
```

새 케이스:
- DataSourceBlock refreshInterval=300 시 refetchInterval 300_000ms (1)
- Heading4BlockEditor dropdown 선택 시 patchBlock (1)
- QuoteBlockEditor text + cite 변경 (2)
- ImageAnnotationBlockEditor callout label 사용 (1)
- GlossaryRefBlock broken term ⚠️ 표시 (1)

### 3.4 산출물

`docs/03-analysis/widget-fix-pass-2/B3-result.md`

---

## 4. B4 — Sync + Integration

### 4.1 진입 조건

B1·B2·B3 모두 완료.

### 4.2 작업

- `docs/lat/documents.md`: video options, iframe oneOf, annotation label, data-source polling 노트
- `docs/lat/export.md`: pdf page marker, gallery/org-chart variant marker, glossary-ref 죽은 코드 정리 노트
- `docs/llm-input-rules.md` + `dist/llm-docx-toolkit/llm-input-rules.md`: 갱신 (video 옵션 추가, iframe XOR 명시, annotation label 등)
- RAG re-chunk
- 통합 회귀 (BE renderer + schema + FE vitest)
- BM25 sanity (4쿼리)
- `docs/03-analysis/widget-fix-pass-2/summary.md`

---

## 5. Acceptance — Design 단계 완료 조건

- [x] M1~M11 각 갭의 정확한 파일·라인 명시
- [x] 4분할 의존성 (B2 flag → B1/B3 → B4) 명시
- [x] 충돌 회피 (파일 단독 소유) 유지
- [x] 각 에이전트의 테스트 명령
- [x] 산출물 보고서 경로

---

## 6. 에이전트 prompt 뼈대

pass-1과 동일 — 본 design §N을 prompt에 인라인 첨부하고:
- "수정 금지: 다른 에이전트 소유 파일"
- "CLAUDE.md lat-first 원칙"
- "apptainer 환경"
- "갭 부분만 처리 금지"
- "B2 schema 의존 작업은 flag 확인 후"
- "완료 시 보고서 작성 후 종료"

---

## 7. 위험

| # | 위험 | 대응 |
|---|---|---|
| R1 | M2 oneOf가 pydantic v2 + 자동 regen과 호환 안 됨 | validator 함수로 폴백. schema에 oneOf만 두고 코드 validator는 schemas/document.py 자동 regen 후 추가 |
| R2 | M5 annotation label 통일 시 기존 데이터 callout에 `text` 보유 | BE 정규화 (B1)로 read-side 호환 |
| R3 | M1 refetchInterval이 too frequent하면 서버 부하 | schema 최소값 30초 이미 강제됨 (Plan 결정) |
| R4 | M11 glossary-ref schema 변경 없이 코드만 정리하는데 BE pydantic 모델에 definition 필드가 있을 수 있음 | regen 결과 확인 후 결정 |
