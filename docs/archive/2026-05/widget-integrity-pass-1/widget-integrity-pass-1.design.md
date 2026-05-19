# Widget Integrity Pass 1 — Design Document

> **Plan**: [[../../01-plan/features/widget-integrity-pass-1.plan.md]]
> **Feature**: widget-integrity-pass-1
> **Version**: 0.1.0
> **Date**: 2026-05-18
> **Status**: Draft
> **Supersedes**: `zebra-striping.design.md`

이 문서는 4개 에이전트(B1, B2, B3, B4)가 받을 **작업 명세서**를 포함한다. B4의 첫 단계로 *B2의 schema 변경이 머지된 후* B1이 spreadsheet 옵션을 읽도록 해야 하므로, 의존성 순서는 **B2 → (B1 + B3 병렬) → B4** 가 안전. 그러나 B1·B3는 schema와 무관한 부분이 많아 *대부분 병렬 시작 가능*하며, schema가 필요한 B1의 spreadsheet stripe 처리만 마지막 commit으로 미룬다.

---

## 0. 4개 에이전트 의존성

```
B2 (schema) ──┬──> B1 (BE export) — spreadsheet stripe 부분만 B2 머지 후
              ├──> B3 (FE editor) — image_id 통일된 schema 받아서 작업
              └──>  ↓
                   B4 (lat + LLM + RAG + 통합 테스트) — B1·B2·B3 모두 완료 후
```

실제 실행: B2를 먼저 단독 출발, **B2가 schema 부분 끝나면 즉시 B1·B3 병렬 출발**. B2의 남은 작업(image_id FE 통일, list 정리)은 B1·B3와 병렬. 한 차례 더 효율적이지만 복잡도 증가 — 본 사이클은 **3개 병렬(B1+B2+B3) → B4 직렬** 단순 모델 채택. B1의 spreadsheet stripe 처리만 마지막 commit으로 미룸으로써 schema 의존 해결.

---

## 1. B1 명세서 — BE Export 통합

### 1.1 소유 파일

- `apps/api/app/services/docx_export.py`
- `apps/api/app/services/html_renderer.py`
- `apps/api/app/services/pptx_export.py`
- `apps/api/app/services/markdown_export.py`

### 1.2 작업 항목

#### G1: bibliography 3-export 추가

기준: `docx_export.py:1143~` 의 `_b_bibliography()` 구조를 복제.

- **html_renderer.py**: `_b_bibliography(block) -> str`. heading `<h{level}>` + 번호 매긴 `<ol>`. 각 entry는 `<li id="cite-{key}">{text}</li>` 형태로 anchor 유지 (read-mode와 동일).
- **pptx_export.py**: `_b_bibliography(slide, block)`. 새 슬라이드 또는 이어진 슬라이드 본문에 heading + bullet list.
- **markdown_export.py**: `_b_bibliography(block) -> str`. `## 참고문헌` 헤딩 + `1. ...` 번호 매긴 리스트.
- 각 파일의 `BLOCK_HANDLERS` dict에 `"bibliography": _b_bibliography` 등록.

#### G2: table stripe 옵션 4-export 반영

기준: `docx_export.py`의 `_b_table()` 분기를 찾아 옵션 읽기 추가.

- **docx_export.py**: `_b_table` 함수에서 `stripe = block.get("options", {}).get("stripe", True)` 추출. `stripe=True`면 Word table style을 zebra 효과 있는 것으로 (`"Light Grid Accent 1"` 또는 유사) 변경, `False`면 plain. *현재 어떤 style 쓰고 있는지 확인 후 결정* — Light Grid는 행 zebra 포함이라 디폴트 OK일 수 있음.
- **html_renderer.py**: `_b_table`에서 `<table class="...">` 클래스에 `stripe=True`면 `striped`, `False`면 `no-stripe` 추가. CSS는 기존 stylesheet에서 처리.
- **pptx_export.py**: PowerPoint table style 변경.
- **markdown_export.py**: markdown 자체는 zebra 불가 — hidden marker로 옵션만 보존 (`<!-- stripe:false -->` 같은 주석).

#### G4: image width docx에서 처리

`docx_export.py`의 `_b_image()` 분기 (L866~930)에서:

```python
# 현재: width를 무시
# 변경:
width_enum = block.get("width") or block.get("meta", {}).get("width")
WIDTH_PX = {"sm": 200, "md": 400, "lg": 600, "full": None}  # None은 페이지 너비
if width_enum in WIDTH_PX:
    pic = document.add_picture(image_path, width=Pt(WIDTH_PX[width_enum]) if WIDTH_PX[width_enum] else None)
else:
    pic = document.add_picture(image_path)
```

정확한 px 값은 design system 참조 (`docs/lat/storage.md` 또는 html_renderer의 width 매핑).

#### G5: callout hidden marker emit

`docx_export.py`의 `_b_callout()` 분기 (~L345)에서:

```python
# 추가:
marker = emit_marker_text(block)
if marker:
    mp = document.add_paragraph()
    mr = mp.add_run(marker)
    mr.font.hidden = True
```

다른 widget (chart, kpi-cards 등)에서 이미 쓰는 패턴 그대로.

#### G2-zebra: spreadsheet stripe (B2 schema 완료 후)

`docx_export.py:_b_spreadsheet()` (L1423~)에서:
- `stripe = block.get("options", {}).get("stripe", True)` 추출 (B2가 schema에 옵션 추가한 후 의미 있음)
- docx는 Light Grid 그대로 OK
- html_renderer의 spreadsheet 핸들러는 *없음* (A1에서 확인) → 본 사이클에선 추가 안 함 (out of scope)

### 1.3 테스트

```bash
apptainer exec instance://mxwp_api bash -lc 'cd /workspace/apps/api && python -m pytest tests/test_docx_export.py tests/test_html_export.py tests/test_pptx_export.py tests/test_markdown_export.py -v'
```

새 케이스 추가:
- bibliography가 html/pptx/markdown으로 export됨 (각 1 테스트)
- table stripe=False일 때 docx에서 style이 plain (1 테스트)
- callout이 docx에서 hidden marker run 포함 (1 테스트)
- image width=lg일 때 docx Picture의 width 속성 (1 테스트)

### 1.4 산출물

- 4개 export 파일 변경
- 6개 신규 테스트
- `docs/03-analysis/widget-fix-pass-1/B1-result.md` (변경 요약 + 테스트 결과)

---

## 2. B2 명세서 — Schema + image_id + list

### 2.1 소유 파일

- `packages/shared/schemas/document.json` (단독)
- `apps/web/src/features/editor/blocks/ImageBlockEditor.tsx`, `ImageAnnotationBlockEditor.tsx` (필요 시 다른 image* 파일도)
- BE의 image_id 정규화 (필요한 곳만)

### 2.2 작업 항목

#### Z1 (zebra): SpreadsheetBlock에 options.stripe 추가

`document.json` L1139~1156의 `SpreadsheetBlock`에 `options.stripe: boolean (default true)` 신설 (zebra-striping design §2.2 그대로).

**이 부분이 가장 먼저 머지되어야 B1의 spreadsheet stripe 처리가 의미 있음** → B2의 첫 commit.

#### G3: imageId 통일

(a) **schema**: `document.json`에서 image_id가 들어간 모든 곳을 imageId로 변경
- ImageBlock (L600대) — 이미 imageId일 수 있음, 확인
- ImageAnnotationBlock (L1056) — `image_id`로 되어있음, `imageId`로 변경
- GalleryBlock의 items[i].imageId — 이미 imageId일 가능성

(b) **FE**: image_id 참조하는 곳 grep & replace → imageId

(c) **BE**: image_id 또는 imageId 모두 읽되 imageId로 정규화하는 헬퍼 함수 (또는 redact/normalize 파이프라인에 추가)

#### G6: list items 타입 정리

`docx_export.py` L300~305의 dict 시도 코드 *제거*. (이건 B1 파일이지만 G6는 B2 담당 — 충돌 회피를 위해 **B1에게 위임**. B2는 docx_export를 건드리지 않음. **본 결정 변경**: G6는 B1 담당.)

→ 위 충돌 해소: **G6는 B1으로 이전**. B2는 schema + image_id FE 통일만.

### 2.3 테스트

```bash
apptainer exec instance://mxwp_api bash -lc 'cd /workspace/apps/api && python -m pytest tests/test_schema_validation.py tests/test_document_service.py -v'
pnpm --filter web test  # vitest
```

새 케이스:
- spreadsheet에 options.stripe 추가한 문서 validate 통과 (1 테스트)
- spreadsheet에 options 없는 기존 문서도 통과 (1 테스트)
- imageId 통일 후 ImageBlock/ImageAnnotationBlock validate 통과 (각 1)

### 2.4 산출물

- `document.json` schema 변경 (`SpreadsheetBlock.options.stripe`, `ImageAnnotationBlock` image_id→imageId)
- FE image_id → imageId 변경 (필요 시)
- BE imageId 정규화 헬퍼 (필요 시)
- 4개 신규 테스트
- `docs/03-analysis/widget-fix-pass-1/B2-result.md`

---

## 3. B3 명세서 — FE Editor (신규 + 수정 + zebra editor)

### 3.1 소유 파일

- `apps/web/src/features/editor/blocks/zebra.ts` (신규)
- `apps/web/src/features/editor/blocks/__tests__/zebra.test.ts` (신규)
- `apps/web/src/features/editor/blocks/SpacerBlockEditor.tsx` (신규)
- `apps/web/src/features/editor/blocks/TableBlockEditor.tsx` (수정)
- `apps/web/src/features/editor/blocks/SpreadsheetBlockEditor.tsx` (수정)
- `apps/web/src/components/blocks/GalleryBlock.tsx` (수정 — lightbox)
- `apps/web/src/components/blocks/FigureIndexBlock.tsx` (수정 — 갱신 버튼)
- 필요 시 위 blocks/의 dispatcher 등록

### 3.2 작업 항목

#### Z2 (zebra): zebra.ts 유틸 + 두 editor 통합

zebra-striping design 문서의 §3~§5 그대로 적용:
- `zebra.ts` 신규 (`getZebraClass(blockType, opts, rowIndex)` 순수 함수)
- `TableBlockEditor`의 하드코딩 zebra 2군데 → `getZebraClass()` 호출
- `SpreadsheetBlockEditor`에 zebra 클래스 + stripe 토글 UI

#### G7: gallery lightbox

`GalleryBlock.tsx` (또는 GalleryBlockView)에서 grid 항목 클릭 → Radix Dialog 모달 → 큰 이미지 + prev/next 버튼.

기존 Radix 의존 확인 후 진행 (이미 다른 모달 사용 중일 가능성 높음).

#### G8: spacer editor 신규

`SpacerBlockEditor.tsx` 신규 작성:
- size dropdown (sm=16px / md=32px / lg=64px / xl=128px)
- 현재 px 미리보기

schema에 size 옵션이 있는지 확인 (없으면 B2에 추가 요청).

#### G9: figure-index 명시적 갱신 버튼

`FigureIndexBlock.tsx` (View)에 "🔄 갱신" 버튼 추가. 클릭 시 MutationObserver 재실행 또는 BE walk 재호출.

### 3.3 테스트

```bash
pnpm --filter web test  # vitest
```

새 케이스:
- `zebra.test.ts` (zebra design §3.2 그대로) — 5 케이스
- spacer editor size 변경 시 patchBlock 호출 검증 (1)
- figure-index 갱신 버튼 클릭 시 fetch 재호출 검증 (1)
- gallery lightbox 열림/닫힘 (1)

### 3.4 산출물

- 6개 파일 변경 + 2개 신규
- 8개 신규 테스트
- `docs/03-analysis/widget-fix-pass-1/B3-result.md`

---

## 4. B4 명세서 — 동기화 + 통합 테스트

### 4.1 진입 조건

B1·B2·B3 모두 완료 + 각자 산출물 보고서 `docs/03-analysis/widget-fix-pass-1/B[1-3]-result.md` 존재.

### 4.2 소유 파일

- `docs/lat/documents.md`
- `docs/llm-input-rules.md`
- `dist/llm-docx-toolkit/llm-input-rules.md`
- `dist/llm-docx-toolkit/rag/chunks.jsonl`
- `dist/llm-docx-toolkit/rag/index.lock`

### 4.3 작업 항목

#### S1: lat 갱신 (documents.md)

- `Block types` 섹션에 `SpreadsheetBlock` 항목 신규 (zebra design §6.1)
- `TableBlock` 옵션 표 갱신 (stripe 동작 명시)
- `BibliographyBlock` — export 분기 다 들어갔다는 사실 반영
- `ImageBlock`, `ImageAnnotationBlock` — imageId 통일 노트
- `CalloutBlock` — round-trip 동작 보장 노트
- `SpacerBlock` — editor 추가 노트
- `Gotchas` 섹션에 한 줄씩 추가

#### S2: LLM rules 갱신

`docs/llm-input-rules.md` 의 각 위젯 섹션 (§2.x)에 변경사항 반영:
- spreadsheet `options.stripe` (zebra design §7 그대로)
- table stripe export 명시
- bibliography 4-export 가능
- imageId 사용 (image_id 폐기)

→ source 갱신 후 `dist/llm-docx-toolkit/llm-input-rules.md`로 복제 (CI가 자동 처리하지만 수동도 가능).

#### S3: RAG re-chunk

```bash
python3 dist/llm-docx-toolkit/rag/chunker.py
```

생성 결과 `chunks.jsonl` + `index.lock` 커밋.

#### S4: 통합 회귀 + BM25 sanity

```bash
# 전체 BE 테스트
apptainer exec instance://mxwp_api bash -lc 'cd /workspace/apps/api && python -m pytest tests/ -q'

# 전체 FE 테스트
cd apps/web && pnpm test

# RAG 검색 sanity
cd dist/llm-docx-toolkit && python3 rag/cli.py query --backend bm25 "spreadsheet stripe"
python3 rag/cli.py query --backend bm25 "bibliography export"
python3 rag/cli.py query --backend bm25 "image width"
```

각 쿼리가 새 청크를 top-3 안에 반환하는지 확인.

#### S5: 종합 보고서

`docs/03-analysis/widget-fix-pass-1/summary.md` 작성:
- B1·B2·B3 결과 종합
- C1~C14 Acceptance Criteria 별 통과 여부 체크리스트
- 회귀 테스트 결과
- 다음 단계 (Check phase로 진입)

### 4.4 산출물

- lat 1개 + LLM rules 2개 + RAG 2개 + summary 1개

---

## 5. 에이전트 출발 prompt 뼈대

각 에이전트는 *수정 권한 있는* general-purpose agent (Read/Write/Edit/Bash 사용 가능). prompt 공통 헤더:

```
MXWhitePaper 프로젝트의 widget-integrity-pass-1 사이클 — B[N] 작업 담당.

## 작업 컨텍스트
- 4개 Explore 에이전트가 35블록 점검 → CRITICAL+HIGH 9개 갭 발견.
- 본 사이클은 9개 갭 + zebra-striping을 묶어서 4분할 병렬 수정.
- 디자인 문서: docs/02-design/features/widget-integrity-pass-1.design.md
- 점검 보고서: docs/03-analysis/widget-audit/A[1-4]-*.md

## 너의 책임 (B[N])
[design 문서의 §N에 정의된 내용 인라인 첨부]

## 규칙
- 디자인 문서 §N의 *소유 파일*만 수정. 다른 파일은 *읽기*만 가능.
- 다른 에이전트의 소유 파일을 수정하면 충돌 → 절대 금지.
- CLAUDE.md의 lat-first 원칙: 큰 파일은 lat을 먼저 보고 좁혀서 Read.
- Apptainer 환경 — docker 명령 사용 금지. 테스트는 `apptainer exec instance://mxwp_api ...` 사용.
- 작업량을 줄이려고 갭을 *부분만* 처리하지 말 것 — design 문서의 모든 항목 완료해야 함.
- 매 갭 수정 후 관련 테스트를 실행해 회귀 없음 확인.
- 완료 시 docs/03-analysis/widget-fix-pass-1/B[N]-result.md 에 변경 요약 + 테스트 결과 작성.
```

---

## 6. Acceptance — Design 단계 완료 조건

- [x] B1~B4 명세서 작성 완료
- [x] 의존성 순서 명시 (B2 schema → B1/B3 → B4)
- [x] 충돌 회피 규칙 (파일 단독 소유)
- [x] 각 에이전트의 테스트 명령 명시
- [x] 산출물 보고서 경로 명시
- [x] 통합 테스트 + RAG sanity 절차 명시

---

## 7. Open Risks

| # | 위험 | 발생 시 대응 |
|---|---|---|
| R1 | B1·B2가 동시에 schema 의존 코드 변경 → spreadsheet stripe 시도가 schema 없는 상태에서 실패 | B1의 spreadsheet stripe 부분을 *별도 commit*으로 미루고, B2의 schema commit 후 진행 |
| R2 | imageId 통일에서 DB의 기존 `image_id` 데이터와 충돌 | BE에서 양쪽 모두 읽고 imageId로 정규화. 마이그레이션 없이 read-side 호환만 |
| R3 | pptx의 bibliography 슬라이드 layout 충돌 | docx 패턴이 그대로 안 맞으면 새 slide 추가 패턴으로 변경 |
| R4 | RAG chunker가 너무 짧은 단락을 청크로 안 만듦 | chunker 결과를 확인하고 필요 시 LLM rules 단락을 더 큰 단위로 합침 |
| R5 | matchRate < 90% — 어딘가 빠진 변경 | pdca-iterator로 자동 보강 (최대 5 iteration) |
