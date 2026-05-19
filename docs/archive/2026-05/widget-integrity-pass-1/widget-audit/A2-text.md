# Widget Audit — A2 텍스트/구조 계열

> 점검 날짜: 2026-05-18
> 점검자: Explore agent A2 (read-only)
> 블록 9개: paragraph, heading-4, list, quote, callout, code, math, bibliography, glossary-ref

## 요약

A2 텍스트/구조 계열 9개 블록 중 **심각한 결함 2개** 발견.

**Top 3 우선순위:**

1. **[CRITICAL] bibliography 블록: 3개 export 형식 누락** — pptx/html/markdown에서 완전히 처리되지 않음. docx만 구현됨. 참고문헌 데이터 손실 위험.
2. **[HIGH] glossary-ref 블록: definition 필드 export 미반영** — schema에는 "definition"이 있지만 docx export에서 사용하지 않음 (line 996 읽음만 하고 버림).
3. **[MED] list 블록: items 저장 형식 이중화** — items가 string[]이지만 docx export에서 `dict(text, depth)` 파싱 시도 (line 300-305). round-trip 안정성 의심.

---

## 블록별 상세

### 1. paragraph

**F축 (형식 무결성)**
- ✅ Schema 정의: type, id, text, meta. additionalProperties: false 엄격함.
- ✅ UI 저장: ParagraphBlock.tsx는 렌더만 하고, 편집은 다른 컴포넌트에서.
- ✅ Export: docx/html/md 모두 `_b_paragraph()` 구현 (text 그대로, inline markdown 파싱).
- ✅ 특수 처리: footnote 정의 `[^TAG]: body` 자동 탐지, speaker-note 숨김 처리.

**U축 (사용 편의성)**
- ✅ Markdown inline 지원 확인 (Inline 컴포넌트 사용, `**굵게**` 등).
- ✅ Page-break-before meta.note 시각화 (editor에서 점선 표시).
- ✅ 자동 단락 분리 (text.split(/\n{2,}/) → 여러 `<p>` 생성).

**갭 / 권장 픽스**: 없음 ✅

---

### 2. heading-4

**F축 (형식 무결성)**
- ✅ Schema: title (max 200), level enum [2, 3, 4] (optional, default 4).
- ⚠️ Export 레거시 호환성: docx export가 meta.level을 읽음 (line 273-279). 신규는 block.level 사용, 구형은 meta에서 읽음. 혼재 지원.
- ✅ HTML/MD: level을 h2/h3/h4로 매핑.

**U축 (사용 편의성)**
- ✅ 승격 규칙 자동화: heading-4/5/6이 섹션 안 paragraph로 들어오면 자동으로 sub-section 승격 (documents.md 라인 135-138 참고).
- ⚠️ 편집 UI에서 level 빠른 전환 도구 없음 (variant chip 같은 affordance 부재). 스키마에는 있는데 UI에서 선택 못함.

**갭 / 권장 픽스**
- **[MED] UI에 level 선택 드롭다운 추가** (heading-4 블록에서). 현재 schema는 [2,3,4]를 지원하는데 UI가 고정. 작업량: 30분

---

### 3. list

**F축 (형식 무결성)**
- ✅ Schema: type, id, style ["bullet"|"number"|"check"], items (string[]).
- ⚠️ **항목 깊이 인코딩 문제**: schema의 items는 `string[]` 인데, export/editor 모두 들여쓰기를 `"  "` 접두사로 인코딩함 (2-space pairs).
- ⚠️ **Export 타입 안정성**: docx export가 item.get("text")와 item.get("depth")를 시도 (line 300-305) — items가 string이어야 하는데 dict로 파싱. Round-trip에서 실패 가능.

**U축 (사용 편의성)**
- ✅ Nested depth visual (padding-left: depth * 1.5rem).
- ✅ Bullet/numbered/check style 라이브 전환.
- ✅ ListBlockEditor에서 Tab/Shift+Tab 들여쓰기 지원 (테스트 파일 있음).
- ✅ Check style: 비활성화된 checkbox 표시 (read-only).

**갭 / 권장 픽스**
- **[HIGH] schema 정규화**: items를 `{text: string, depth?: number}` 객체로 마이그레이션하거나, export 코드 수정. 현재 docx export line 300-305가 방어 코드이지만 의도가 불명확. 작업량: 반나절
- **[MED] check style round-trip 보장**: 현재 ☐ 문자 삽입은 수동 (line 314). import/export 왕복 시 손상 위험. 테스트 추가. 작업량: 1시간

---

### 4. quote

**F축 (형식 무결성)**
- ✅ Schema: type, id, text (required), cite (optional).
- ✅ Export: docx는 "Intense Quote" + "Quote" 스타일 + cite footer italic 처리.
- ✅ HTML/MD 모두 구현.

**U축 (사용 편의성)**
- ✅ 다중 줄 인용 지원 (text.splitlines()).
- ✅ cite 자동 footer 렌더 (— 기호).
- ⚠️ 편집 UI 없음 — BlockView만 있고 BlockEditor 파일 없음. 원문 수정 시 generic inline editor 사용 추정.

**갭 / 권장 픽스**
- **[MED] QuoteBlockEditor 추가** (cite 필드 UI + 유효성 검사). 작업량: 30분

---

### 5. callout

**F축 (형식 무결성)**
- ✅ Schema: type, id, variant ["info"|"warn"|"danger"|"tip"], text (required), title (optional).
- ✅ Export: 4가지 variant 모두 색상/아이콘 매핑 (VARIANT_STYLES 딕셔너리).
- ⚠️ **export 마커 누락**: docx export에서 hidden marker emit 안 함 (line 345-373 코드 확인, emit_marker_text() 호출 없음). 다른 widget은 하는데 callout만 누락.

**U축 (사용 편의성)**
- ✅ Read-mode에서 variant 칩 클릭 시 순환 변경 (onCycle, nextCalloutVariant).
- ✅ 아이콘 자동 (info/warn/danger/tip별 SVG).
- ✅ variant별 색상 일관성 (border, bg, iconBg).

**갭 / 권장 픽스**
- **[HIGH] docx export hidden marker 추가** (line 353 이전). 작업량: 5분 + test 추가

---

### 6. code

**F축 (형식 무결성)**
- ✅ Schema: type, id, language, code (required), filename (optional).
- ✅ Export: docx는 Consolas font + code shading, html는 `<pre><code>`, md는 fenced block.

**U축 (사용 편의성)**
- ✅ 언어 드롭다운 (LANGUAGES 목록, 15개 선택지).
- ✅ 복사 버튼 (navigator.clipboard).
- ✅ 파일명 optional (figcaption에 표시).
- ✅ Tab-to-space 변환 (editor에서 구현).

**갭 / 권장 픽스**: 없음 ✅

---

### 7. math

**F축 (형식 무결성)**
- ✅ Schema: type, id, expression (LaTeX), display ["block"|"inline"] (optional, default "block").
- ✅ Export: docx는 `$$expr$$` italic, html은 KaTeX render, md는 `$$ … $$`.

**U축 (사용 편의성)**
- ✅ KaTeX 실시간 렌더 (MathBlockView에서 useEffect + katex.render).
- ✅ 렌더 실패 시 fallback (raw expression 표시).
- ✅ display 선택 (block vs inline).

**갭 / 권장 픽스**: 없음 ✅

---

### 8. bibliography

**F축 (형식 무결성)**
- ✅ Schema: type, id, entries[] (required, minItems 1), title, style ["numeric"|"alphabetic"|"author-year"].
- ❌ **Export 누락 (CRITICAL)**:
  - docx: `_b_bibliography()` 구현됨 (line 1143, heading + numbered list).
  - **pptx: BLOCK_HANDLERS에 등록 안 됨**
  - **html: BLOCK_HANDLERS에 등록 안 됨**
  - **markdown: BLOCK_HANDLERS에 등록 안 됨**
- ⚠️ Schema의 `style` 필드는 정보성만 — FE가 numbered list로 고정 렌더함. style별 실제 포맷팅 없음.

**U축 (사용 편의성)**
- ✅ BibliographyBlockEditor: key/text/url 3개 필드, add/remove 버튼.
- ✅ Read-mode: 각 entry에 `id="cite-{key}"` anchor → inline `[[cite:KEY]]` 링크 가능.
- ✅ Debounced save (800ms).

**갭 / 권장 픽스**
- **[CRITICAL] 3개 export 형식 추가** (pptx/html/markdown). 각 renderer의 BLOCK_HANDLERS에 등록 + 함수 구현 + test. 작업량: 반나절

---

### 9. glossary-ref

**F축 (형식 무결성)**
- ✅ Schema: type, id, term (required).
- ⚠️ **definition 필드 누락된 export**: schema에는 `block.get("definition")`이 없음 (line 689 스키마 확인, term만 있음).
  - 그런데 docx export line 996에서 `block.get("definition")`을 읽음 (사실상 죽은 코드, 항상 None).
  - glossary 테이블 자체는 `{term, definition}` 구조인데, glossary-ref block은 term만 가짐. lookup할 때 term → 글로벌 glossary 테이블에서 정의 찾음.

**U축 (사용 편의성)**
- ✅ Read-mode: useGlossary hook으로 정의 조회, 없으면 "(정의 없음)".
- ✅ Hover 미리보기 없음 (현재는 block 렌더만 함).
- ❌ **broken-ref 시각화 없음** — term이 glossary에 없으면 회색 텍스트만 표시. 에러 표시 부족.

**갭 / 권장 픽스**
- **[MED] schema 정정**: definition 필드 제거 (사용 안 함). 또는 glossary-ref를 확장해 inline definition 지원. 작업량: 5분 + 1시간
- **[LOW] broken-ref 시각화** (term 미스 시 배경색 highlight 또는 느낌표 아이콘). 작업량: 1시간

---

## 결론

**심각도별 정리:**

| 심각도 | 블록 | 문제 | 작업량 |
|--------|------|------|--------|
| CRITICAL | bibliography | 3개 format (pptx/html/md) export 함수 누락 | 반나절 |
| HIGH | callout | docx hidden marker 누락 | 5분 + test |
| HIGH | list | items 타입 이중화 (string vs dict) | 반나절 |
| MED | heading-4 | UI에 level selector 없음 | 30분 |
| MED | quote | BlockEditor 파일 없음 | 30분 |
| MED | glossary-ref | definition 필드 schema/export 불일치 | 5분 + 1시간 |
| LOW | glossary-ref | broken-ref 시각화 부재 | 1시간 |

**총평:** paragraph/code/math는 형식 무결성 & 편의성 모두 양호. **table 블록의 zebra-striping 패턴과 유사하게 bibliography/callout/glossary-ref에서 schema 정의와 export 구현 간 gap이 존재**. bibliography가 가장 심각 (3개 포맷 누락).

---

## 부록 — 점검에 사용한 파일 목록

### Schema & Documents
- `packages/shared/schemas/document.json` (완전 읽음)
- `docs/lat/documents.md`, `docs/lat/export.md`, `docs/lat/README.md` (완전 읽음)

### Frontend UI Components
- `apps/web/src/components/blocks/ParagraphBlock.tsx`, `Heading4Block.tsx`, `ListBlock.tsx`,
  `QuoteBlock.tsx`, `CalloutBlock.tsx`, `CodeBlock.tsx`, `MathBlock.tsx`,
  `BibliographyBlock.tsx`, `GlossaryRefBlock.tsx`

### Frontend Editors
- `apps/web/src/features/editor/blocks/BibliographyBlockEditor.tsx`
- `apps/web/src/features/editor/blocks/CodeBlockEditor.tsx`
- `apps/web/src/features/editor/components/ListBlockEditor.tsx`

### Backend Export Services
- `apps/api/app/services/docx_export.py` (line 260-1200 핵심)
- `apps/api/app/services/html_renderer.py` (BLOCK_HANDLERS L927-957)
- `apps/api/app/services/pptx_export.py` (BLOCK_HANDLERS L1231-1261)
- `apps/api/app/services/markdown_export.py` (BLOCK_HANDLERS L644-674)

### Tests
- `apps/api/tests/test_docx_export.py`, `test_html_export.py`,
  `test_markdown_export.py`, `test_pptx_export.py`
