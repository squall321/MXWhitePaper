# Widget Audit — A4 컨테이너/특수 계열

> 점검 날짜: 2026-05-18
> 점검자: Explore agent A4
> 블록 8개: columns, tabs, accordion, doc-link-card, spacer, figure-index, form, quiz

## 요약 (총평 + 우선순위 Top 3)

**총평**: 8개 블록 모두 **형식 무결성은 양호** (schema → UI → export 3단계 일관성 유지, additionalProperties false 준수). 다만 **사용 편의성** 분야에서 중도 이상의 갭 3개, 경미 갭 2개 식별.

**우선순위 Top 3 (수정 권장)**:
1. **[HIGH] spacer** — schema에만 존재, UI 편집 불가 (editor 컴포넌트 없음)
2. **[HIGH] figure-index** — 정적 DOM 스캔으로 인한 수동 갱신 필요 (자동화 미흡)
3. **[MED] form/quiz** — 기본값 미설정 (필드/질문 추가 시 항상 기본 템플릿 사용, 사용자 선호도 학습 없음)

---

## 블록별 상세

### 1. columns

**F축 (형식 무결성)** ✅
- Schema: `columns` (2..4) + optional `widths[]` (5..95, sum~100). `additionalProperties: false` 준수.
- UI: ColumnsBlockEditor 완전 구현. 컬럼 추가/삭제, 너비 드래그 조정, left/right 레일 버튼, 비율 라이브 표시.
- Export: docx (표 1행 N열로 round-trip marker 포함), html (css class="col" grid), markdown (순차 배치).
- 검증: `_columns_cell_blocks()` 가 지원 불가 블록(table/chart 등) → paragraph 폴백. 일관성 유지.

**U축 (사용 편의성)** ✅ 문제 없음
- 컬럼 추가/삭제: ✅ 명확한 UI (+/- 버튼, 최대 4개 schema 제약)
- 비율 조정: ✅ drag splitter 직관적, 라이브 % 표시
- 내부 블록 drag: ✅ NestedBlockControls 통합
- 모바일 자동 stack: frontend 테일윈드 `grid` 기본 동작 (CSS 스택)

---

### 2. tabs

**F축 (형식 무결성)** ✅
- Schema: `tabs[]` (minItems: 1), 각 항목 {label, blocks[]}.
- UI: TabsBlockEditor. 탭 추가/삭제, 라벨 인라인 편집, 활성 탭 색상 구분 (bg-smsg-700).
- Export: docx (marker → heading-4 per tab label → blocks), html (`<details>` 정적), markdown (`<details>` flatten).
- 자식 블록 제한 무시: schema에는 `Block` (모든 타입), 실제 제약 없음 (의도적 설계로 보임).

**U축 (사용 편의성)** ✅ 문제 없음
- 탭 추가/삭제: ✅ 최소 1개 제약 (disabled 버튼)
- 라벨 편집: ✅ 인라인 input
- 활성 탭 시각화: ✅ 색상 + aria-selected
- 탭 순서 변경: UI 미제공 (drag 없음, 하지만 삭제/재추가로 우회 가능)

---

### 3. accordion

**F축 (형식 무결성)** ✅
- Schema: `items[]` (minItems: 1), 각 항목 {label, blocks[]}.
- UI: AccordionBlockEditor. 항목 추가/삭제, 라벨 편집, `<details>` 첫 항목만 기본 open.
- Export: docx (marker → heading-4 per label → blocks), html (`<details>` non-open), markdown (`<details>`).

**U축 (사용 편의성)**
- 펼침/접힘: ✅ native `<details>` (사용자 click)
- 기본 펼친 상태 설정: ⚠️ 오직 첫 항목만 hard-coded. schema에 옵션 없음 (제어 불가)
  - 컨텍스트: line 234 in AccordionBlockEditor: `open={i === 0 ? true : undefined}`
- 다중 펼침 vs 단일: ✅ native `<details>` 들은 독립 상태 (다중 가능)
- 순서 변경: UI 미제공 (탭과 동일)

**갭 / 권장 픽스** [MED]
- Schema에 `defaultOpen: boolean` (또는 index) 추가하면 더 나음. 현재 "첫 항목 항상 열기" 강제.

---

### 4. doc-link-card

**F축 (형식 무결성)** ✅
- Schema: `slug` (required), optional `showSummary` (default: true).
- UI: DocLinkCardBlockEditor. 문서 검색 input, fuzzy filter (title/slug substring), 결과 8개 제한, 현재 타겟 표시, showSummary toggle.
- Export: docx (slug bare paragraph + 데코 italic 텍스트), html (anchor + doc-link-summary class), markdown ([title](/docs/slug)).

**U축 (사용 편의성)** ✅ 문제 없음
- 문서 검색: ✅ useDocumentList + 로컬 fuzzy filter
- 자동완성: ✅ 실시간 결과 (loading state 있음)
- 미리보기: ⚠️ 정적 (선택 후 fetch, pending skeleton 표시)
- broken-link 표시: ✅ DocLinkCardBlockView 가 404 catch → red "존재하지 않는 문서" 박스

---

### 5. spacer

**F축 (형식 무결성)** ✅
- Schema: `size` (enum: "sm"|"md"|"lg", default: "md").
- UI: **편집 컴포넌트 없음** ⚠️⚠️ (중대 갭)
- Export: docx (`_b_spacer()` 구현, 공 paragraph 1/2/4개), html (미구현), markdown (미구현).
- Render: BlockRenderer에서 inline `<div className="h-4/h-8/h-16">` 렌더링.

**U축 (사용 편의성)** ❌
- 높이 조정 UI: 없음. size는 schema에만 존재. 편집 불가능.
- 기본값: md (32px) hard-coded 렌더.

**갭 / 권장 픽스** [HIGH]
- SpacerBlockEditor 컴포넌트 생성 필요:
  - radio/select "sm|md|lg"
  - 높이 라이브 프리뷰 (16px/32px/64px)
  - export: html/markdown 분기 미구현 (docx만 있음)

---

### 6. figure-index

**F축 (형식 무결성)** ✅ (거의)
- Schema: optional `title`, `kinds` (enum subset: "image"|"table"|"chart").
- UI: FigureIndexBlockView 구현. 정적 DOM 스캔 (MutationObserver).
- Export: docx (`_b_figure_index()` 구현, context.figure_index 참조), html (미확인), markdown (미구현).
- 자동화 메커니즘: backen end docx_export에서 `ctx.figure_index` 구성 (caption 검사), 하지만 **frontend는 수동 DOM walk**.

**U축 (사용 편의성)**
- 자동 갱신: ⚠️ **UI단계에서만 MutationObserver로 DOM 스캔**. 블록 추가/삭제 시 문서 re-render → `querySelectorAll` 재실행. 신뢰성은 있지만 "보이는 것만".
- 수동 갱신 버튼: 없음 (MutationObserver가 암묵적 갱신).
- 수정 불가: 목록은 read-only (caption만 있는 figure를 찾아 자동 나열).

**갭 / 권장 픽스** [HIGH]
- 현재 메커니즘: FE가 "화면에 보인 figure 나열" vs BE가 "저장된 caption 검사". 괴리 위험 (scrolled-out figure 미포함).
- 개선: BE figure_index walk를 FE에도 expose하거나, 명시적 "갱신" 버튼 추가.

---

### 7. form

**F축 (형식 무결성)** ✅
- Schema: `questions[]` (minItems: 1), FormQuestion {id, kind, label, required, placeholder, options}.
  - kind: text|long-text|email|number|select|multi-select|checkbox|rating-5|date (9가지).
  - `additionalProperties: false` 준수.
- UI: FormBlockEditor 완전. 질문 추가/순서변경(DnD)/삭제, 필드별 옵션 UI (select/multi-select의 경우).
- Export: docx (제목 + 각 질문 list + 선택지 italic), html (미확인), markdown (미구현).

**U축 (사용 편의성)**
- 필드 추가: ✅ add 버튼, kind selector (9가지)
- 순서 변경: ✅ DnD (dnd-kit, PointerSensor 거리 4px threshold)
- 검증 규칙 UI: ⚠️ kind별로 자동 (email regex, number/rating/date 포맷) 있지만 **custom 검증은 불가**. kind 선택으로만 제약.
- 제출 결과 처리: ✅ success → green box "감사합니다" + 선택적 "다시 응답하기" (allow_multiple_responses).
- 미리보기: UI상 전체 form 보이되, 제출 없음 (read mode).

**갭 / 권장 픽스** [MED]
- 필드 기본값 템플릿 미흡: `makeQuestion()` 가 kind별 기본값 제공하지만 (text → label:"새 질문", options: undefined 등), 사용자가 자신의 선호 템플릿을 저장/재사용 불가.
- 예: "항상 required=true로 시작하고 싶은데" → 매번 toggle 필요.

---

### 8. quiz

**F축 (형식 무결성)** ✅
- Schema: `questions[]` (minItems: 1), QuizQuestion {id, kind, label, correct, explanation, points}.
  - kind: single-choice|multi-choice|true-false|short-text.
  - correct: oneOf [string, string[], boolean] (kind별로 알맞은 타입).
  - `additionalProperties: false` 준수.
- UI: QuizBlockEditor 완전. 질문 추가/DnD/삭제, kind 선택, correct 필드 (kind별 shape 다름).
- Export: docx (제목 + passing_score + 질문 list + 정답 [role=editor/admin만]), html (미확인), markdown (미구현).

**U축 (사용 편의성)**
- 정답 설정: ✅ kind별로 자동 (single-choice → string, multi → string[], true-false → boolean).
- 다중 선택 vs 단일: ✅ kind selector에서 명확 분리 (single|multi|true-false|short-text).
- 채점 즉시 표시: ✅ FE 제출 후 BE 응답 (score/breakdown/explanation).
- 해설: ✅ optional explanation (editor/admin만 export 시 표시).
- 시도 제한: ✅ max_attempts (0=무한), 현재 시도 카운트 표시.
- 섞기: ✅ shuffle 옵션 (Fisher-Yates deterministic seed per attempt).

**갭 / 권장 픽스** [MED]
- 기본값 템플릿 미흡: `makeQuizQuestion()` 가 kind별 기본 제공하지만, 사용자 선호 저장 불가 (form과 동일 맥락).
- 예: "모든 quiz의 점수는 2점으로 시작하고 싶은데" → 매번 points 수정 필요.

---

## 상세 검증 결과

### Export 분기 완성도

| 블록 | docx | pptx | html | markdown |
|------|------|------|------|----------|
| columns | ✅ (표 1행N열) | ✅ (표) | ✅ (div.b-columns) | ✅ (순차) |
| tabs | ✅ (h4→blocks) | ✅ (h4→blocks) | ✅ (`<details>`) | ✅ (`<details>`) |
| accordion | ✅ (h4→blocks) | ✅ (h4→blocks) | ✅ (`<details>`) | ✅ (`<details>`) |
| doc-link-card | ✅ (p+deco) | ⚠️ (링크?) | ✅ (anchor) | ✅ (markdown link) |
| spacer | ✅ (공 p들) | ⚠️ (공 p들?) | ❌ (미구현) | ❌ (미구현) |
| figure-index | ✅ (목록) | ⚠️ (목록?) | ⚠️ (미확인) | ❌ (미구현) |
| form | ✅ (q list) | ⚠️ (q list?) | ⚠️ (미확인) | ❌ (미구현) |
| quiz | ✅ (q list) | ⚠️ (q list?) | ⚠️ (미확인) | ❌ (미구현) |

**유의사항**: pptx는 python-pptx 이미지 셀 미지원으로 기본 fallback 텍스트. HTML/markdown은 spacer/figure-index/form/quiz가 "부분 구현" (docx만 우선).

### 컨테이너 자식 블록 제한

| 블록 | Schema 자식 제약 | UI 실제 제약 | Export 처리 |
|------|-----------------|----------|-----------|
| columns | `Block` (모두) | 모두 가능 | CellBlock subset (p/img/list) 폴백 |
| tabs | `Block` (모두) | 모두 가능 | 모두 flat |
| accordion | `Block` (모두) | 모두 가능 | 모두 flat |

→ 모두 **제약 없음** (의도적 open design).

---

## 부록 — 점검에 사용한 파일 목록

### Schema
- `/home/koopark/claude/MXWhitePaper/packages/shared/schemas/document.json` (lines 670~1054)

### Editor UI
- `/home/koopark/claude/MXWhitePaper/apps/web/src/features/editor/blocks/ContainerBlockEditors.tsx`
- `/home/koopark/claude/MXWhitePaper/apps/web/src/features/editor/blocks/DocLinkCardBlockEditor.tsx`
- `/home/koopark/claude/MXWhitePaper/apps/web/src/features/editor/blocks/FormBlockEditor.tsx`
- `/home/koopark/claude/MXWhitePaper/apps/web/src/features/editor/blocks/QuizBlockEditor.tsx`

### Reader/Render Components
- `/home/koopark/claude/MXWhitePaper/apps/web/src/components/blocks/ColumnsBlock.tsx`
- `/home/koopark/claude/MXWhitePaper/apps/web/src/components/blocks/TabsBlock.tsx`
- `/home/koopark/claude/MXWhitePaper/apps/web/src/components/blocks/AccordionBlock.tsx`
- `/home/koopark/claude/MXWhitePaper/apps/web/src/components/blocks/DocLinkCardBlock.tsx`
- `/home/koopark/claude/MXWhitePaper/apps/web/src/components/blocks/FigureIndexBlock.tsx`
- `/home/koopark/claude/MXWhitePaper/apps/web/src/components/blocks/FormBlock.tsx`
- `/home/koopark/claude/MXWhitePaper/apps/web/src/components/blocks/QuizBlock.tsx`
- `/home/koopark/claude/MXWhitePaper/apps/web/src/components/blocks/BlockRenderer.tsx` (spacer inline 렌더)

### Export (Backend)
- `/home/koopark/claude/MXWhitePaper/apps/api/app/services/docx_export.py` (lines 968~1420)
- `/home/koopark/claude/MXWhitePaper/apps/api/app/services/html_renderer.py` (lines 751~822)
- `/home/koopark/claude/MXWhitePaper/apps/api/app/services/markdown_export.py` (lines 493~642)

### Documentation
- `/home/koopark/claude/MXWhitePaper/docs/lat/README.md`
- `/home/koopark/claude/MXWhitePaper/docs/lat/documents.md`
- `/home/koopark/claude/MXWhitePaper/docs/lat/export.md`
