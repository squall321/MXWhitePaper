# Widget Audit — A3 미디어/임베드 계열

> 점검 날짜: 2026-05-18
> 점검자: Explore agent A3
> 블록 9개: image, gallery, video, iframe, pdf, file, whiteboard, image-annotation, org-chart

## 요약 (총평 + 우선순위 Top 3)

**총평**: 9개 미디어/임베드 블록 중 **형식 무결성 갭 3건, 사용 편의성 미흡 7건** 발견.

zebra-striping 패턴처럼 "schema 정의는 있으나 렌더/UI 단계에서 미처리"가 반복. 특히:
1. **필드명 혼재** (imageId ↔ image_id, fileId ↔ file_id) — snake_case/camelCase 일관성 부재
2. **export 단계에서 옵션 무시** (image width enum, pdf page navigation, file preview)
3. **라이트박스/프리뷰 미구현** (gallery, pdf, file 등)

**우선순위 TOP 3 픽스**:

| 순위 | 블록 | 갭 | 영향 | 권장 |
|---|---|---|---|---|
| 1 | image / image-annotation | imageId ↔ image_id 혼재 → docx_export L867, html_renderer L683 | round-trip 안전성 낮음 | 필드명 통일 (camelCase로) + schema 정의 확인 |
| 2 | pdf | file_id와 page/height_px 옵션이 export에서 텍스트만 (L1186–1203) | 페이지 네비게이션 불가 docx에서 | docx export에서 page marker 또는 annotation 추가 |
| 3 | gallery | layout (grid/carousel) 선택은 있으나 UI 라이트박스 없음 | 갤러리 뷰 극히 불편 | 동적 라이트박스 컴포넌트 추가 |

---

## 블록별 상세

### 1. image

**F축 (형식 무결성)**
- schema: width enum `{sm, md, lg, full}`, caption, alt, link 정의 완전함 (L600–613)
- UI: ImageBlockEditor.tsx 에서 caption/alt/width 입력 O, width selector 개발됨 ✓
- **docx** (L866–930): imageId 수집 → resolver 호출 → picture embed, caption 처리 완전. **그러나** meta.width 필드를 읽지 않음 (L867 `meta.get("width")` 시도하나 예외 처리라 무시됨)
- **html** (L683–707): width enum을 CSS class로 매핑 완전 ✓
- **pptx/markdown**: image 지원 O
- **갭**: docx에서 width enum 무시. width가 meta에 있는지 block 최상위에 있는지 schema 재확인 필요.

**U축 (사용 편의성)**
- ✓ 드래그앤드롭 업로드 (ImageDropzone)
- ✓ alt 텍스트 경고 (savedOnce 정책)
- ✓ 캡션 입력
- ⚠️ **width selector 있으나 docx export에서 무시됨**
- ✓ 미리보기 (URL 3단계)

**갭 / 권장 픽스**
- **[HIGH] docx_export._b_image에서 width enum 처리 추가**. 현재 meta 또는 block.width에서 읽어 px 변환해 python-docx Picture의 width kwarg 전달.
- **[MED] schema 재확인**: width가 `meta.width`인지 `block.width`인지 명시. 현재 UI는 block 최상위로 저장하는 것으로 보임.

---

### 2. gallery

**F축 (형식 무결성)**
- schema: layout enum `{grid, carousel}`, items array (minItems=1), 각 item에 imageId/caption/alt (L615–638)
- UI: GalleryBlockEditor.tsx 에서 layout picker ✓, items drag-to-reorder ✓, 각 이미지마다 caption/alt 입력 ✓
- **docx** (L933–953): gallery marker emit → items 순회 → 각 item을 `_b_image` 호출. 완전함.
- **html** (L708–733): layout에 따라 `<div class="gallery-grid">` 또는 carousel JS 호출. 완전함.
- 이슈: layout이 export 단계에서 활용되는지 확인 필요 (docx에서는 단순 이미지 나열이므로 layout 무시).

**U축 (사용 편의성)**
- ✓ 다중 이미지 업로드
- ✓ drag-to-reorder
- ✓ 각 이미지별 caption/alt
- ✗ **라이트박스/뷰어 없음** (grid/carousel 선택은 있으나 클릭 시 확대 보기 미구현)

**갭 / 권장 픽스**
- **[HIGH] FE 라이트박스 컴포넌트 추가**. lightbox2, photoswipe, 또는 Radix Dialog + image zoom. grid 항목 클릭 → lightbox 팝업 → prev/next/close.
- **[MED] docx export에서 carousel 변수를 hidden marker variant로 인코딩** (현재 grid가 기본, carousel이면 marker text에 variant="carousel" 추가).

---

### 3. video

**F축 (형식 무결성)**
- schema: url (required), title, provider enum `{intra, youtube, vimeo}` (L586–597). provider 기본값 "intra".
- UI: VideoBlockEditor.tsx 에서 url 입력 → provider 자동 감지 ✓, title 입력 ✓. toYouTubeEmbed() 함수로 YouTube ID 추출 후 embed URL 생성 ✓.
- **docx** (L847–863): marker emit → url + title 텍스트 emit. provider 정보 안 씀.
- **html** (L659–681): provider에 따라 YouTube/Vimeo embed 또는 bare `<video>` src 처리. 완전함.
- 이슈: docx에서 provider 정보가 URL로 자동 감지되므로 round-trip 안전.

**U축 (사용 편의성)**
- ✓ URL paste → provider 자동 감지
- ✓ YouTube/Vimeo/intra 지원
- ✓ title 편집
- ✗ **썸네일 미구현** (YouTube API로 썸네일 가져오기 미흡)
- ✗ **autoplay/controls 옵션 없음** (UI/schema 미정의)

**갭 / 권장 픽스**
- **[MED] schema에 `autoplay`, `controls`, `loop` boolean 옵션 추가** (HTML5 video/iframe 표준 속성).
- **[LOW] YouTube 썸네일** — provider=youtube이면 FE에서 `https://img.youtube.com/vi/{id}/default.jpg` 캐시.

---

### 4. iframe

**F축 (형식 무결성)**
- schema: src (**XOR** html), title, height (100–2000), sandbox policy는 코드 하드코딩 (L563–584). "exactly one MUST be set" 주석 ⚠️ (oneOf 구조 아님, 검증 책임 BE).
- UI: IframeBlockEditor.tsx에서 mode toggle (url/html) ✓, src/html 입력 ✓, height 슬라이더 ✓, preview toggle ✓.
- **docx** (L827–844): marker → src URL + title 텍스트 emit. html 필드는 무시됨 (round-trip 불가, docx는 srcdoc 미지원).
- **html** (L642–657): src는 `<iframe>` 태그, html은 `srcdoc` 속성으로 emit.
- 이슈: docx export에서 html 필드가 제거됨 (import 시 복구 불가). schema의 XOR 검증이 BE에서 undefined일 때만 유효.

**U축 (사용 편의성)**
- ✓ URL paste
- ✓ HTML upload (file picker 또는 textarea paste)
- ✓ height 조정
- ✓ 라이브 미리보기
- ✓ sandbox 정책 (allow-scripts만 허용 — 안전)
- ⚠️ **src/html 모드 전환 시 한쪽이 지워짐** (UX상 명확하나 의도 확인 필요)

**갭 / 권장 픽스**
- **[MED] src/html XOR 검증을 schema의 oneOf 또는 schema validator에서 수행**. 현재는 BE persist 단계에서 한쪽 null 처리.
- **[LOW] docx round-trip 불가 알림** — html 필드는 docx export에서 버려짐. 사용자 안내 필요.

---

### 5. pdf

**F축 (형식 무결성)**
- schema: file_id (required), title, page (default=1), height_px (200–4000, default=600) (L655–667). clean.
- UI: PdfBlockEditor.tsx에서 file 업로드 ✓, title 입력 ✓, page spinner ✓, height_px 슬라이더 ✓, 라이브 미리보기 ✓.
- **docx** (L1186–1203): marker → file_id + title + page 텍스트만. page/height_px 옵션 **미처리** (문서에서 페이지 네비게이션 불가).
- **html** (L863–874): `<iframe src="/api/v1/files/{file_id}/download#page={page}">` → 정확히 PDF.js 호환 anchor 기반. 완전함.
- **pptx**: 텍스트 placeholder.
- 이슈: docx에서 page 정보가 버려짐.

**U축 (사용 편의성)**
- ✓ PDF 파일 업로드 (useUploadFile 파이프라인)
- ✓ 페이지/높이 조정
- ✓ 라이브 미리보기 (PDF.js via anchor)
- ✓ 다운로드 버튼 (FE 뷰에서)
- ✓ 사이즈/타입 표시

**갭 / 권장 픽스**
- **[MED] docx export에서 page 정보 보존**. 방법: (1) hidden marker에 page 인코딩 + import 측 재추출, 또는 (2) PDF annotation 객체로 embed (복잡), 또는 (3) 단순 텍스트 주석 ("— page 5부터 시작" 같은 decoration 추가).

---

### 6. file

**F축 (형식 무결성)**
- schema: fileId, name, size, mime (모두 required 또는 저장 후 자동 채움) (L640–652).
- UI: FileBlockEditor.tsx에서 file 피커 ✓, 진행 표시 ✓, 사이즈 표시 ✓, 다운로드 링크 ✓.
- **docx** (L956–965): marker → file_id + name as hyperlink. 완전함.
- **html** (L734–747): `<a href="/api/v1/files/{file_id}/download" download>` + 사이즈 표시.
- 이슈: schema/UI/export 일관성 O, 그러나 필드명 혼재 주의 (TS: fileId, PY: file_id).

**U축 (사용 편의성)**
- ✓ 파일 업로드
- ✓ 진행 표시
- ✓ 사이즈 표시
- ✓ 다운로드 버튼
- ✗ **미리보기 미구현** (텍스트/이미지 파일은 미리보기 가능한데, UI 없음)

**갭 / 권장 픽스**
- **[LOW] 파일 미리보기**. MIME type에 따라: (1) text/* → textarea, (2) image/* → `<img>`, (3) application/pdf → PDF.js, (4) 기타 → 다운로드 링크만.

---

### 7. whiteboard

**F축 (형식 무결성)**
- schema: viewbox (w, h), elements array (oneOf: stroke/shape/text) (L897–974). schema 정의 명확함.
- UI: WhiteboardBlockEditor.tsx에서 pen/eraser/shapes/text 도구 ✓, 색상 선택 ✓, 굵기 선택 ✓, undo/redo ✓, 저장 debounce 800ms.
- **docx** (L1206–1225): marker → elements 리스트를 bullet list로 emit. **SVG 미보존** (텍스트 요약만).
- **html** (L876–890): SVG canvas 동적 렌더링 ✓.
- **pptx**: 텍스트 placeholder.
- 이슈: docx round-trip에서 visual fidelity 손실.

**U축 (사용 편의성)**
- ✓ pen/shapes/text/eraser
- ✓ undo/redo (50-depth stack)
- ✓ 색상/굵기 선택
- ✗ **키보드 조작 미흡** (Delete/Ctrl+Z 단축키 미흡)
- ⚠️ **zoom 미흡** (viewport 고정 1:1)

**갭 / 권장 픽스**
- **[LOW] docx export에서 elements 테이블 emit**. 마크 방식 (마커 → 요소 테이블 → import 측 재구성).
- **[LOW] keyboard shortcuts** (Ctrl+Z / Ctrl+Y / Delete).

---

### 8. image-annotation

**F축 (형식 무결성)**
- schema: image_id, annotations array (oneOf: arrow/rect/callout) (L1056–1131). **image_id** (snake_case) 주의 ⚠️.
- UI: ImageAnnotationBlockEditor.tsx에서 이미지 선택 ✓, 도구 선택 (arrow/rect/callout) ✓, 색상 ✓, undo/redo ✓.
- **docx** (L1276–1343): marker → 이미지 embed → annotation 테이블 emit. 모든 annotation 필드를 한 테이블의 칼럼으로 매핑 → import 측이 테이블 구조로 복구.
- **html** (L892–914): SVG 캔버스 + annotations 오버레이. 완전함.
- 이슈: image_id (snake_case) ↔ imageId (camelCase) 혼재. schema는 image_id, code는 혼재 (docx_export L1286 `_str(block.get("imageId") or block.get("image_id"))`).

**U축 (사용 편의성)**
- ✓ 이미지 선택/교체
- ✓ arrow/rect/callout 도구
- ✓ 색상 선택
- ✓ undo/redo
- ⚠️ **라벨 지원**: arrow/rect는 label 필드 O, callout은 text 필드로 통합됨 (schema 일관성 미흡).
- ✗ **선택/이동 미흡** (생성 후 이동/크기 조정 UI 불명확).

**갭 / 권장 픽스**
- **[HIGH] image_id vs imageId 통일**. schema와 TS 타입을 camelCase (imageId)로 정의, PY 코드는 snake_case 변환 자동화.
- **[MED] annotation 라벨 필드 일관성**. 현재 arrow/rect는 label, callout은 text — schema에 명시.
- **[LOW] 선택/이동 UI** — annotation 생성 후 클릭 시 선택 상태 표시 + drag-to-move.

---

### 9. org-chart

**F축 (형식 무결성)**
- schema: root (OrgChartNode, required), layout enum `{tree, horizontal}` (L539–560).
- UI: OrgChartBlockEditor.tsx에서 CSV paste → parseOrgCsv (pure)로 트리 자동 생성 ✓, 수동 노드 추가/삭제 ✓.
- **docx** (L786–824): marker → root 트리를 DFS로 (name, parent_name) 튜플로 flatten → 2-column 표 emit. import 측이 표 → 트리 재생성.
- **html** (L621–640): mermaid flowchart 또는 tree diagram SVG.
- **pptx**: 텍스트 placeholder.
- 이슈: layout 옵션이 schema/UI에는 있으나 export (docx)에서 무시됨. 항상 flat 표로 emit.

**U축 (사용 편의성)**
- ✓ CSV paste → 자동 트리 구성
- ✓ 수동 노드 추가/삭제/이동 (drag-and-drop context 설정)
- ✗ **키보드 조작 미흡** (노드 선택 후 이동/복사 단축키 없음)
- ⚠️ **자동 레이아웃** — layout={tree|horizontal} 선택은 있으나 실제 화면 레이아웃 알고리즘은 뷰 측에서만
- ✗ **줌/팬** 미흡

**갭 / 권장 픽스**
- **[MED] docx export에서 layout 옵션 보존**. hidden marker에 variant="horizontal" 인코딩.
- **[LOW] keyboard shortcuts** (arrow keys to navigate / Ctrl+V to paste).
- **[LOW] 자동 레이아웃 개선** — tree/horizontal 레이아웃에 따라 노드 배치 좌표 자동 계산 (dagre-d3 같은 라이브러리 고려).

---

## 결론

**A3 미디어/임베드 계열 블록 9개 중**:
- **형식 무결성 갭**: 3건 (imageId/image_id 혼재, pdf page 네비 버림, file 미리보기 구현 없음)
- **사용 편의성 미흡**: 7건 (gallery 라이트박스 없음, whiteboard/org-chart 키보드 미흡, file preview 미흡)

**총 작업량**: 픽스 10건 × (코드 수정 + 테스트) ≈ **2–3주 예상** (병렬 수정 시 1주 가능).

**우선순위**: imageId 혼재 통일 → pdf page 보존 → gallery 라이트박스 추가 순서.

---

## 부록 — 점검에 사용한 파일 목록

### LAT (문서)
- `docs/lat/README.md`, `documents.md`, `storage.md`, `export.md`

### Schema
- `packages/shared/schemas/document.json` (L539–1131) — 9개 블록 정의

### 편집 UI (FE)
- `apps/web/src/features/editor/blocks/ImageBlockEditor.tsx`, `GalleryBlockEditor.tsx`,
  `VideoBlockEditor.tsx`, `IframeBlockEditor.tsx`, `PdfBlockEditor.tsx`,
  `FileBlockEditor.tsx`, `WhiteboardBlockEditor.tsx`, `ImageAnnotationBlockEditor.tsx`,
  `OrgChartBlockEditor.tsx`

### Export 렌더러 (BE)
- `apps/api/app/services/docx_export.py` (L786–1343)
- `apps/api/app/services/html_renderer.py` (L621–914)
- `apps/api/app/services/pptx_export.py`, `markdown_export.py`
