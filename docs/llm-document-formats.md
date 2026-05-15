# MXWhitePaper — LLM용 Word / PowerPoint 양식 가이드

> 이 문서는 **다른 LLM (당신) 에게 주는 명세서**다. MXWhitePaper 서버에
> 깨끗하게 import 되는 `.docx` 와 `.pptx` 를 생성하려면 아래 규칙을 따르라.
> 규칙을 어겨도 서버는 (best-effort 로) 받아들이지만 구조 정보가 손실된다.
>
> 본 가이드 한 장만으로 작업이 가능하도록 자기완결적으로 작성됨.
> 외부 참조 없음.

---

## 0. 공통 원칙 (Quick Reference)

1. **구조는 스타일로 표현하라**. 글자만 크게 / 색만 바꿔서 "제목처럼 보이게"
   하지 말 것. 스타일 (`Heading 1`, `Title Slide`, `TOC1`, `Caption`) 을 직접
   적용한 단락만 서버가 인식한다.
2. **번호는 일관되게**. 한 문서 안에서 `1`, `1.1`, `1.1.1` 식 dotted-numbering
   을 쓰거나 안 쓰거나 일관성을 유지하라.
3. **표는 첫 행이 헤더**. 헤더 행은 반드시 표의 맨 위.
4. **이미지는 inline 으로 박아라**. 텍스트와 분리된 floating 도형은 부분적으로만 인식.
5. **하이퍼링크는 마크다운으로 변환된다**. `[표시](https://…)` 형태.
6. **숨겨진 텍스트 / 주석 / 변경 추적** 은 들어가지 않거나 가짜 단락으로 나옴.
   확정된 텍스트만 본문에 두라.
7. **목차 (TOC) 는 자동 생성된다**. 수동 작성한 TOC 는 서버가 검출 후 제거 또는
   확인용으로만 사용 — 작성하지 *말거나*, 작성하더라도 TOC1/TOC2 스타일을 사용하라.

---

## 1. Word (.docx) 양식

### 1.1 문서 골격

```text
┌─────────────────────────────────────────────────┐
│ Title         ← Word 의 "Title" 스타일 (선택)    │
│ Subtitle      ← "Subtitle" 스타일 (선택, 요약)   │
│                                                  │
│ 1. Heading 1  ← "Heading 1" 스타일               │
│   본문 단락…                                      │
│                                                  │
│   1.1 Heading 2 ← "Heading 2" 스타일             │
│     본문…                                         │
│     1.1.1 Heading 3                              │
│       …                                           │
│                                                  │
│ 2. Heading 1                                     │
│   …                                               │
└─────────────────────────────────────────────────┘
```

### 1.2 헤딩 (섹션) 규칙 ★

서버는 다음 두 신호를 결합해 섹션 레벨을 결정한다:

1. **Word 스타일**: `Heading 1` ~ `Heading 9` (영어 이름) 또는 한국어 Word 의
   `제목 1` ~ `제목 9` 도 인식.
2. **Dotted prefix**: 헤딩 텍스트가 `3.1.2.3 ...` 처럼 점 분리 숫자로 시작하면
   점 개수 + 1 이 레벨이 된다.

**최종 레벨 = `max(스타일 레벨, dotted 깊이)`** — 둘 중 강한 신호 채택.

예시:

| 스타일 | 텍스트 | 인식 레벨 |
|---|---|---|
| Heading 1 | `1. 개요` | 1 |
| Heading 1 | `1.1.1 세부 항목` | 3 (dotted 가 강함) |
| Heading 2 | `1 개요` | 2 |
| **Normal** (스타일 없음) | `2.1 배경` | 2 ★ (스타일 없어도 승격) |
| Normal | `그냥 단락입니다` | 단락 (승격 안 됨) |

**권장**: Heading 스타일 + dotted prefix 를 *함께* 쓰고, 두 신호가 같은 레벨을
가리키게 하라. 가장 명확하고 안정적이다.

### 1.3 단락

기본은 Word 의 `Normal` 스타일. 인라인 서식 (굵게 / 기울임 / 코드 / 링크) 은
부분적으로 보존된다:

| Word 표현 | DocumentJSON 결과 |
|---|---|
| **굵게** (Bold run) | `**text**` |
| *기울임* (Italic run) | `*text*` |
| `Code` 폰트 적용 run | `` `text` `` |
| 하이퍼링크 | `[표시](url)` |
| 밑줄 / 색상 | 무시 (텍스트만 보존) |

### 1.4 목록 (List)

Word 의 bullet list / numbered list 가 모두 인식된다. 들여쓰기 깊이는
보존되지 않을 수 있으므로 **단일 레벨** 을 권장. 중첩이 꼭 필요하면 dotted-
numbering 으로 표현하라 (예: `1.`, `1.1.`, `1.2.`).

### 1.5 표 (Table) ★

```text
┌────────┬────────┬────────┐
│ 헤더1   │ 헤더2   │ 헤더3   │   ← 첫 행 = 헤더
├────────┼────────┼────────┤
│ a      │ b      │ c      │
│ d      │ e      │ f      │
└────────┴────────┴────────┘
```

- **첫 행은 반드시 헤더**. 데이터부터 시작하면 첫 데이터 행이 헤더로 잡힌다.
- **셀 병합** 은 부분 인식 (텍스트는 첫 셀로 모임).
- **표 안에 표 (nested)** 는 금지. 인식되지 않거나 깨진다.
- 빈 셀은 빈 문자열로 들어옴.

### 1.6 캡션 (Figure / Table caption) ★

표 또는 그림 *바로 위 또는 바로 아래* 단락에 다음 중 하나를 적용하면 자동으로
캡션으로 인식된다:

**방법 A — Word 의 `Caption` 스타일 사용 (가장 안정적)**:
```text
[표 또는 그림]
표 1: 분기별 매출 요약           ← "Caption" 스타일
```

**방법 B — 텍스트 패턴 (스타일 없어도 동작)**:

`Caption` 스타일이 없어도 텍스트가 아래 패턴 중 하나면 캡션으로 묶임:
- `표 1: …`, `Table 1: …`, `Table 1. …`
- `그림 1: …`, `Figure 1: …`, `Figure 1. …`

### 1.7 이미지

- 본문에 **inline 으로** 삽입 (텍스트 흐름 안). `Wrap text` 옵션의 floating
  이미지는 부분적으로만 인식된다.
- 포맷: PNG, JPEG, GIF, WebP, BMP, TIFF.
- **SVG 는 미지원** — 변환 후 사라진다.
- 캡션은 위 1.6 규칙으로 별도 단락에.

### 1.8 수식 (Math)

Word 의 OMML (Insert → Equation) 사용. 결과는 LaTeX 로 변환되어 본문에 박힌다.
인라인 텍스트로 `$x = y$` 식 LaTeX 직접 입력은 인식되지 않는다 — Word 의 정식
수식 입력 기능을 쓸 것.

### 1.9 코드 블록

권장 표현 (정식 인식 안 됨, 외관용):

- 단락에 **고정폭 폰트** (Consolas/Courier 등) 적용 + 들여쓰기 4-space.
- 또는 단일 셀 표에 코드를 넣고 셀 배경 회색.

정확히 인식되는 것은 아니지만 텍스트는 손실 없이 들어간다. **코드 블록** 의
정확한 표현이 필요하면 docx 가 아니라 markdown export 를 쓰는 게 낫다.

### 1.10 목차 (TOC)

서버는 출력 시 **목차를 자동 생성**한다. 입력의 수동 TOC 는:

- **검출**되어 → 본문 헤딩과 대조 (누락된 챕터 경고)
- 옵션에 따라 → **자동 제거** (round-trip 출력에서 빠짐, 자동 TOC 와 중복 방지)

수동 TOC 를 넣어야 한다면 Word 의 정식 기능을 사용 (Insert → Table of Contents).
이 경우 TOC1/TOC2 스타일이 자동 적용되고 서버가 안정적으로 인식한다.
**일반 텍스트로 챕터 목록을 만들지 말 것** — 본문 단락으로 잡혀서 본문이 망가짐.

### 1.11 페이지 / 머리말 / 꼬리말 / 각주

| 요소 | 처리 |
|---|---|
| 페이지 나누기 (Page break) | 단락 `meta.note = "page-break-before"` 로 보존 |
| 머리말 (Header) | **무시** |
| 꼬리말 (Footer) | **무시** |
| 각주 (Footnote) | 본문 끝에 footnotes 섹션으로 모임. 본문의 `[^1]` 마커는 ` (본문 평탄화)` 로 변환 |
| 미주 (Endnote) | 각주와 동일 처리 |
| 변경 추적 (Track Changes) | accept 된 상태만 인식. revisions 자체는 손실 |
| 주석 (Comments) | **무시** |

### 1.12 메타데이터

문서 자체의 메타 (제목, 분류, 태그) 는 docx 본문에 **자동 추출되지 않는다**.
업로드 시 별도로 입력하거나, API 호출 시 `title`, `slug`, `division`,
`owners`, `tags`, `confidentiality` 폼 필드로 명시한다.

본문의 첫 `Title` 스타일 단락이 있으면 문서 제목 후보로 사용된다.

### 1.13 사이즈 / 한도

- 최대 30 MB
- 분당 5 요청 / 사용자 (rate-limit)
- 분당 한도 초과 시 429

### 1.14 LLM 이 docx 를 생성할 때의 권장 워크플로우

만약 사용자가 "LLM 으로 docx 를 만들어 업로드" 하는 시나리오라면:

1. `python-docx` 또는 동등한 라이브러리로 생성
2. 매 헤딩에 `paragraph.style = doc.styles['Heading 1']` 식 명시
3. 표는 `doc.add_table(...)` + 첫 행에 헤더 텍스트
4. 이미지는 `paragraph.add_run().add_picture(...)` 로 inline
5. 캡션은 표/그림 바로 다음 단락에 `Caption` 스타일 또는 `표 N: ...` 패턴
6. 수식은 OMML 직접 생성 또는 placeholder
7. TOC 는 만들지 말 것 (자동 생성됨)

---

## 2. PowerPoint (.pptx) 양식

### 2.1 슬라이드 ↔ 섹션 매핑 ★

**한 슬라이드 = 한 섹션 (level 1)**. 슬라이드 제목 placeholder 가 섹션 제목이
된다. 슬라이드 순서가 곧 섹션 순서.

### 2.2 슬라이드 레이아웃 → DocumentJSON layout

PowerPoint 의 슬라이드 레이아웃 이름이 다음 키워드를 포함하면 매핑:

| 레이아웃 이름에 포함된 키워드 | DocumentJSON layout |
|---|---|
| `Title Slide` / `Title Only` / `Section Header` | `title-only` |
| `Two Content` / `Comparison` | `two-col` |
| `Picture with Caption` | `image-left` |
| 그 외 | `stack` (기본) |

기본 PowerPoint 테마의 영어 레이아웃 이름이 가장 안정적. 커스텀 테마라도 위
키워드를 이름에 포함시키면 인식됨.

### 2.3 슬라이드 제목 ★

- 제목 placeholder (idx=0) 의 텍스트 사용.
- 제목 placeholder 가 없으면 슬라이드의 첫 번째 텍스트 도형으로 폴백.
- **제목이 비어 있으면 슬라이드 번호로 자동 채움** (`Slide 5` 등) — 깨끗한
  결과를 위해 모든 슬라이드에 제목을 명시할 것.

### 2.4 도형 → 블록 매핑

슬라이드의 각 도형이 블록으로 변환된다. z-order 순서대로 처리:

| 슬라이드 도형 | 블록 | 비고 |
|---|---|---|
| Text frame (placeholder/textbox) | `paragraph` | 빈 단락 제외, 단락 줄별로 분리 |
| Table | `table` | 첫 행 = 헤더 |
| Picture | `image` | 업로드되어 MinIO 에 저장 |
| Chart | `kpi-cards` placeholder 또는 `paragraph "[차트]"` | 데이터 추출 best-effort |
| SmartArt | 텍스트만 평탄화 | 다이어그램 형태는 손실 |
| 도형 (선/사각형 등) | **무시** | |
| 그룹 (group) | 내부 도형 재귀 처리 | |

**제목 placeholder (idx=0) 는 섹션 제목으로 사용되므로 본문 블록에서 제외**된다.

### 2.5 스피커 노트 (Speaker Notes)

각 슬라이드의 노트 텍스트는 해당 섹션 끝에 `paragraph` 블록으로 보존되며,
`meta.note = "speaker:N"` (N = 슬라이드 번호) 메타가 붙는다.

발표용 정보를 본문에 섞고 싶지 않으면 스피커 노트를 적극 활용하라 — round-trip
출력에서도 보존된다.

### 2.6 표 (Table)

Word 와 동일 — **첫 행이 헤더**. 셀 병합은 부분 인식.

### 2.7 이미지

inline 또는 floating 모두 인식. 단, 슬라이드 안의 모든 이미지는 **stack** 으로
변환 (절대 위치 손실). 위치가 의미를 가지는 인포그래픽은 인식 결과가 어색할 수 있음.

### 2.8 차트 (Chart)

native PowerPoint 차트는 텍스트 데이터로 평탄화. 일부 단순 차트는
`kpi-cards` 로 변환되지만, 복잡한 차트 (combo, scatter, custom) 는
플레이스홀더 단락 `[차트]` 만 남는다.

차트가 중요하면 **이미지로 변환한 슬라이드** 를 권장 (가장 충실하게 보존).

### 2.9 SmartArt / 다이어그램

**텍스트만 추출**. 구조 (계층, 흐름) 는 손실. 다이어그램이 핵심이면 export 결과를
이미지로 사용하는 흐름이 낫다.

### 2.10 애니메이션 / 전환 / 마스터

- **모든 애니메이션 / 슬라이드 전환 / 사운드 → 무시**.
- 슬라이드 마스터의 배경 / 로고 / 푸터 → 무시.

### 2.11 표지 슬라이드

서버는 첫 슬라이드를 **표지로 자동 인식하지 않는다** — 1번 슬라이드도 일반
섹션 (level 1) 이 된다. 표지 콘텐츠를 문서 메타로 옮기려면:

- 표지 슬라이드는 비워두고
- API 호출의 `title` 폼 필드에 명시적으로 지정

### 2.12 사이즈 / 한도

- 최대 50 MB
- 분당 5 요청 / 사용자
- 슬라이드 1000 장 권장 상한 (그 이상은 처리 시간 지연)

### 2.13 LLM 이 pptx 를 생성할 때의 권장 워크플로우

`python-pptx` 사용 시:

1. 표준 레이아웃 사용 (`prs.slide_layouts[0]` 등). 커스텀 레이아웃 이름에
   `Title Slide` / `Two Content` 등 키워드 포함.
2. 슬라이드마다 **제목 placeholder** 반드시 채움.
3. 본문은 placeholder text frame 에 paragraph 단위로 작성.
4. 표는 `slide.shapes.add_table(rows, cols, ...)` + 첫 행 = 헤더.
5. 차트는 가능하면 native chart 대신 PNG 이미지로.
6. 발표 메모는 `slide.notes_slide.notes_text_frame.text = "..."`.

---

## 2.99 docx/pptx 로 표현 *불가능*한 위젯들 ★

DocumentJSON 에는 34 개 block 타입이 있는데, docx/pptx 가 자연스럽게
표현하는 건 일부 (paragraph / heading / list / table / image / math / caption)
뿐이다. 아래 위젯들은 **docx/pptx import 시 인식되지 않는다** — 텍스트만
평탄화되거나 사라진다.

| 위젯 | 의미 | docx/pptx import 시 결과 |
|---|---|---|
| `callout` | 정보/경고/위험 박스 | 단락 (스타일 손실) |
| `kpi-cards` | KPI 지표 카드 | 표 또는 단락 |
| `chart` | 데이터 차트 (line/bar/pie 등) | 이미지 (스크린샷이면) 또는 `[차트]` |
| `gantt` | 일정 차트 | 표 또는 사라짐 |
| `flow` | 플로우차트 | 텍스트 평탄화 |
| `org-chart` | 조직도 | 텍스트 평탄화 |
| `columns` | 좌우 분할 레이아웃 | Word columns 일부만 (단락 평탄화) |
| `tabs` | 탭 그룹 | 사라짐 |
| `accordion` | 펼침/접힘 그룹 | 사라짐 |
| `iframe` | 외부 페이지 임베드 | 사라짐 |
| `video` | 비디오 임베드 | 사라짐 |
| `gallery` | 이미지 갤러리 | 개별 이미지로 평탄화 |
| `file` | 첨부 파일 | 사라짐 |
| `pdf` | PDF 임베드 | 사라짐 |
| `doc-link-card` | 다른 위키 문서 카드 | 사라짐 또는 텍스트 링크 |
| `glossary-ref` | 용어집 참조 | 텍스트 |
| `figure-index` | 그림 색인 (자동) | 사라짐 |
| `spacer` | 빈 여백 | 빈 단락 |
| `bibliography` | 참고문헌 | 텍스트 |
| `data-source` | 외부 데이터 소스 연결 | 사라짐 |
| `dashboard-embed` | 대시보드 임베드 | 사라짐 |
| `calculator` | 인터랙티브 계산기 | 사라짐 |
| `spreadsheet` | 인라인 스프레드시트 | 표 (정적) |
| `whiteboard` | 화이트보드 | 사라짐 |
| `image-annotation` | 이미지 주석 | 이미지만 |
| `form` | 인터랙티브 폼 | 사라짐 |
| `quiz` | 퀴즈 | 사라짐 |

### 이 위젯들을 문서에 넣는 정상 경로 3 가지

1. **위키 에디터**에서 직접 삽입 (슬래시 메뉴 `/callout`, `/chart`, …)
2. **DocumentJSON API 직접 호출** — `docs/llm-widgets-via-api.md` 참고
3. **import 후 후처리** — docx 로 텍스트 골격만 import → 에디터에서 위젯 보강

→ **LLM 이 위 위젯을 자동 생성하려면 docx/pptx 가 아니라 DocumentJSON
block API 를 직접 호출하는 게 정답.** 가이드: `docs/llm-widgets-via-api.md`.

### 향후 패턴 인식 (Future Work)

장기적으로 docx/pptx 에 *약속된 패턴*을 박으면 import 가 위젯으로 복원할 수
있도록 확장 예정. 한국 사내 PPT 에서 자주 보이는 패턴을 모두 포함.

> **Phase 1 구현 완료 (2026-05-15)** — `callout` + `kpi-cards` 2 위젯의 통일 룰
> (`Widget: <type>` 마커 + 다음 블록) 이 docx/pptx import 양쪽에서 동작.
> 나머지 12 위젯 타입은 마커는 인식하되 변환은 후속 Phase. 자세히는
> [[docs/lat/imports.md#widget-marker-post-pass]] 참고.
>
> **LLM 작성법 (Phase 1 기준)**:
>
> - Callout: 한 단락 `Widget: callout (warn)` (또는 `위젯: callout (info|warn|danger|tip)`) 직후 본문 단락.
> - KPI Cards: 한 단락 `Widget: kpi-cards` 직후 헤더가 `label, value, delta?, trend?` 인 표 (1-4 행).
>
> Phase 2 에서 변환 예정인 타입 (`chart`, `gantt`, `flow`, `org-chart`, `columns`,
> `tabs`, `accordion`, `gallery`, `doc-link`, `glossary`, `image-annotation`,
> `iframe`, `video`, `file`, `pdf`, `whiteboard`) 도 마커는 인식되므로 미리
> 박아두면 후속 import 부터 자동 변환됨.

> **Phase 2 구현 완료 (2026-05-15)**: 위 청사진의 14 위젯 (chart / gantt / flow / org-chart / columns / tabs / accordion / gallery / doc-link / glossary / image-annotation / iframe / video / file / pdf / whiteboard) 모두 실제 변환기 구현. file / pdf 는 fileId placeholder, whiteboard 는 이미지 보존 fallback.

#### 1) 통일 룰

**"직전 단락이 `Widget: <type>` 또는 `위젯: <type>` 패턴이면 다음 블록을
해당 위젯으로 변환"** — 단순하고 LLM 이 생성하기 쉬움. 캡션 스타일과 공존
가능 (caption 은 자동 묶임). 이 한 룰만 구현하면 아래 표의 1차 컬럼 패턴이
일괄 해결된다.

#### 2) 위젯별 인식 매핑

| 위젯 | 1차: 통일 룰 (`Widget: <type>` + 후속 블록) | 2차: 패턴만으로 인식 |
|---|---|---|
| `callout` | `Widget: callout (info\|warn\|danger\|tip)` + 단락 | 단일 셀 표 + 배경색 (info=파랑/warn=노랑/danger=빨강/tip=초록) OR 단락 prefix `[INFO]`/`[WARN]`/`[DANGER]`/`[TIP]` |
| `kpi-cards` | `Widget: kpi-cards` + 표 (label, value, delta?, trend?) | 캡션 `KPI: …` + 2-4 컬럼 표 |
| `chart` | `Widget: chart (bar\|line\|pie\|area\|radar\|scatter)` + 표 (categories, series N개) | native Word/PPT 차트 XML 직접 추출 (가장 충실) |
| `gantt` | `Widget: gantt` + 표 (Task, Start, End, Owner?, Progress?) | 캡션 `Gantt: …` + 표 + 헤더가 Task/Start/End 포함 |
| `flow` | `Widget: flow` + code block (mermaid DSL) | 캡션 `Flow: …` + `A → B → C` 화살표 텍스트 |
| `org-chart` | `Widget: org-chart` + 들여쓰기 목록 | 캡션 `Org: …` + 들여쓰기 ≥ 2 깊이 목록 |
| `columns` | `Widget: columns` + 표 (N 컬럼 = N 단) | Word 의 native column break, 또는 캡션 `Columns: …` |
| `tabs` | `Widget: tabs` + heading-4 시리즈 (각 탭 라벨) + 본문 | 캡션 `Tabs: …` + heading-4 시리즈 |
| `accordion` | `Widget: accordion` + heading-4 시리즈 + 본문 | 캡션 `Accordion: …` + heading-4 시리즈 |
| `iframe`/`video`/`file`/`pdf` | `Widget: <type>` + 하이퍼링크 단락 | 하이퍼링크 + 캡션 `Iframe:` / `Video:` / `File:` / `PDF:` |
| `gallery` | `Widget: gallery` + 연속 이미지 (각 캡션 = item.caption) | 한 단락/문단/슬라이드에 이미지 ≥ 2 + 캡션 `Gallery: …` |
| `doc-link-card` | `Widget: doc-link` + 위키링크 단락 | `[[doc-slug]]` + 캡션 `DocLink: …` |
| `glossary-ref` | `Widget: glossary` + 단락 | 본문 `{용어: 약자}` regex 또는 정의 목록 (term: definition) |
| `image-annotation` | `Widget: image-annotation` + 이미지 + 표 (x, y, label) | PPT 그룹 (사진 + 도형/화살표 + 텍스트박스) — 같은 z-group |
| `whiteboard` | `Widget: whiteboard` + SVG/excalidraw 인라인 | 인식 어려움 — 통일 룰만 |

#### 3) 일반 PPT 슬라이드 패턴 → 위젯 매핑 ★

한국 사내 PPT 에서 가장 자주 나오는 슬라이드 모양들. 이쪽이 ROI 가 크다:

| PPT 슬라이드 모양 | 인식해서 변환할 DocumentJSON | 인식 신호 |
|---|---|---|
| **Before / After 비교** (좌우 이미지 + 캡션) | `columns` 2단 + 각 `image` + `caption` | "Two Content"/"Comparison" 레이아웃 + 이미지 2개 + 단어 `Before`/`After` 또는 `이전`/`이후` |
| **사진 + 짧은 설명** N장 그리드 | `gallery` (items 각각 caption 채움) | 같은 슬라이드 안 이미지 ≥ 3 + 각 이미지 옆/아래 텍스트박스 |
| **번호 단계 카드** (1️⃣→2️⃣→3️⃣) | `flow` (mermaid) 또는 ordered `list` | 슬라이드에 번호 텍스트박스 ≥ 3 + 화살표 도형 |
| **vs. 비교 매트릭스** (체크/엑스) | `table` + 각 cell ✅/❌ 텍스트 그대로 | 표 안에 ✓✗○×●◯ 등 비교 기호 비율 ≥ 30% |
| **인용구 + 인물 사진** (testimonial) | `columns` 2단 (좌: `image`, 우: `quote`) | 슬라이드에 이미지 1 + 큰 따옴표 텍스트 + 짧은 attribution |
| **로고 그리드** (파트너/클라이언트) | `gallery` (layout=grid, caption 없음) | 같은 슬라이드 이미지 ≥ 6 + 텍스트 거의 없음 |
| **타임라인 마일스톤** (수평선 + 점) | (장기) 새 `timeline` 위젯 / (현재) `gantt` 근사 | 슬라이드에 SmartArt timeline 또는 도형이 수평 정렬 + 날짜 텍스트 |
| **퍼널 / 깔때기** | (장기) 새 `funnel` 위젯 / (현재) ordered `list` | SmartArt funnel 또는 도형이 사다리꼴 누적 |
| **쿼드런트 / 2×2 매트릭스** | (장기) 새 `matrix-2x2` 위젯 | 슬라이드에 4 개 사분면 영역 + 각각 텍스트 |
| **피라미드 / 계층** | (장기) 새 `pyramid` 위젯 / (현재) `org-chart` 근사 | SmartArt pyramid 또는 삼각형 도형 |
| **프로세스 박스 + 화살표** | `flow` (mermaid 자동 변환) | 박스 도형 N개 + 화살표 도형으로 연결 |
| **통계 인포그래픽** ("95% — 큰 숫자") | `kpi-cards` | 슬라이드에 큰 폰트 (≥48pt) 숫자/퍼센트 ≥ 3 |
| **표지 슬라이드** | 문서 메타로 추출 (title, subtitle) | "Title Slide" 레이아웃 + 1번 슬라이드 |
| **목차 슬라이드** | 자동 TOC 트리거 (본문에서 제거) | "Section Header" 레이아웃 + 헤딩 텍스트 나열 |
| **혼합 셀 표** ★ | (스키마 확장 필요) `table` cell 이 이미지+텍스트 보유 | 표 셀 안에 이미지 또는 그룹 도형 |

#### 4) 구현 우선순위 (제안)

| 순위 | 항목 | 가치 | 비용 |
| --- | --- | --- | --- |
| 1 | **통일 룰** (`Widget: <type>` 인식) | 14 위젯 한 번에 해결 | 중 (디텍터 1개) |
| 2 | **혼합 셀 표** 스키마 확장 | 사내 PPT 50%+ 가 영향 받음 | 중 (스키마 + 4 렌더러 + 2 importer) |
| 3 | **Before/After 자동 인식** | 마케팅 자료 다수 | 소 (레이아웃 + 캡션 패턴) |
| 4 | **번호 단계 / 프로세스 박스** → `flow` 자동 변환 | 보고서 다수 | 중 (도형 그래프 분석) |
| 5 | **로고/이미지 그리드** → `gallery` 자동 | 비교적 쉬움 | 소 |
| 6 | **타임라인 / 퍼널 / 쿼드런트 / 피라미드** 새 위젯 | 인포그래픽 강화 | 대 (위젯 4개 × 풀스택) |
| 7 | **인용구 + 사진** 자동 묶기 | 빈도 중간 | 소 |
| 8 | **vs. 매트릭스** 의미 보존 (체크/엑스 → 정형 데이터) | 분석 가치 큼 | 소 (표 인식 후 변환) |

순위 1, 2 만 구현해도 PPT → 위젯 변환의 80% 효과는 나온다. 이 두 가지가
B 의 핵심.

이 패턴들이 구현되면 PowerPoint 베이스 사내 자료를 import 만으로
구조화된 DocumentJSON 으로 변환 가능 → 본 프로젝트의 장기 목표.

---

## 3. Round-trip (정규화 워크플로우)

서버는 **`POST /api/v1/imports/docx/roundtrip`** 엔드포인트로 docx 를 받아
사내 표준 형태로 정규화한 docx 를 돌려준다. DB 저장 없음.

LLM 이 docx 를 생성한 후 이 엔드포인트로 한 번 통과시키면:

- 섹션 번호 재계산 (1, 1.1, 1.1.1)
- inline heading (heading-4 이상) 자동 sub-section 승격
- 수동 TOC 제거 (자동 TOC 가 들어감)
- columns widths 정규화 (합 = 100)
- 캡션 정렬

→ **즉 LLM 이 어설프게 만든 docx 도 한 번 round-trip 거치면 일관된 결과**가
된다. 가능하면 활용할 것.

응답 헤더로 통계가 함께 옴 (`X-MXWP-Roundtrip-Sections`, `Toc-Found`,
`Toc-Missing` 등) — 변환 결과를 LLM 이 검증하는 신호로 활용.

---

## 4. DocumentJSON v1.0 (최종 내부 표현)

docx/pptx import 의 결과는 **DocumentJSON v1.0** 이라는 내부 JSON 으로
표준화된다. 핵심 필드 (참고용 — 본 가이드 사용자는 직접 만들 필요 없음):

```json
{
  "schema_version": "1.0",
  "id":   "<ULID>",
  "slug": "<lower-case-slug>",
  "title": "<제목>",
  "metadata": {
    "division":        "MX",
    "owners":          ["email@example.com"],
    "tags":            ["..."],
    "confidentiality": "public" | "internal" | "restricted"
  },
  "summary": "...",
  "sections": [
    {
      "id":     "<ULID>",
      "level":  1,
      "title":  "...",
      "blocks": [
        {"type": "paragraph", "text": "..."},
        {"type": "table", "headers": ["..."], "rows": [["..."]], "caption": "..."},
        {"type": "image", "imageId": "<ULID>", "caption": "..."},
        {"type": "list", "style": "bullet" | "ordered", "items": ["..."]},
        {"type": "code", "language": "py", "code": "..."},
        {"type": "math", "expression": "\\frac{a}{b}", "display": "block"}
      ],
      "subsections": [ … ]
    }
  ]
}
```

import 후 응답으로 받은 이 JSON 을 보고 LLM 이 잘 변환됐는지 검증 가능.

---

## 5. 자주 발생하는 실수 — 안티패턴

| 안 좋은 예 | 왜 문제인가 | 올바른 방법 |
|---|---|---|
| 큰 글씨 + 굵게로 제목 표현 | Heading 스타일 미적용 → 섹션 트리에 안 들어감 | Heading 1/2/3 스타일 적용 |
| 표 첫 행이 데이터 | 첫 행이 헤더로 잡혀서 본문 데이터가 손실 | 표 위에 명시적 헤더 행 |
| 본문 텍스트로 "목차: 1장 …, 2장 …" 나열 | 본문 단락이 되어 결과 문서가 중복 | TOC 빼거나 Word 정식 TOC |
| 그림 옆에 "그림 1" 만 작성 | 캡션으로 안 잡힘 | `그림 1: 설명문` 또는 Caption 스타일 |
| 도형으로 다이어그램 그림 | 도형이 무시되어 결과가 비어 보임 | 다이어그램을 PNG 로 export 후 image insert |
| `Calibri Light` 색상 변경으로 "제목 스타일" 모방 | 스타일 미인식 | 정식 Heading 스타일 사용 |
| SVG 이미지 삽입 | 변환 시 사라짐 | PNG / JPEG 로 변환 |
| Floating 이미지 + Wrap text | 일부만 인식 | inline (텍스트 흐름) 으로 |
| 같은 제목을 여러 슬라이드에 사용 | 섹션 제목 충돌, 자동 번호가 어색 | 슬라이드마다 다른 제목 |

---

## 6. 디버그 — 결과가 이상할 때 확인할 것

import 응답 (`/imports/docx` 또는 `/imports/pptx`) 의 `summary` 필드에
다음 카운트가 들어 있다:

- `paragraphs`, `headings`, `tables`, `images`, `equations`, `lists`,
  `code_blocks`, `footnotes`
- `warnings` — 인식 못 한 요소 메시지 배열

`warnings` 가 비어있지 않다면 거기서 단서 찾기. round-trip 엔드포인트는
응답 헤더 `X-MXWP-Roundtrip-Warnings` 에 같은 정보.

문서 자체의 구조가 의심되면 round-trip 후 LibreOffice / Word 에서 결과 docx 를
열어서 input 과 비교 — 손실된 부분이 시각적으로 보인다.

---

## 7. 요약 체크리스트 (LLM 이 docx/pptx 생성 직전에 확인)

### docx
- [ ] 제목/요약은 Title/Subtitle 스타일로
- [ ] 모든 섹션 제목에 Heading 1/2/3 스타일 적용
- [ ] dotted prefix (`3.1.2 ...`) 와 스타일 레벨이 일치
- [ ] 표 첫 행이 헤더
- [ ] 표/그림에 캡션 단락 (Caption 스타일 또는 `표 N: …` 패턴)
- [ ] 이미지는 inline + PNG/JPEG (SVG 금지)
- [ ] 수동 TOC 미작성 (자동 TOC 가 들어감)
- [ ] 머리말/꼬리말/주석 비움 (어차피 무시됨)

### pptx
- [ ] 모든 슬라이드에 제목 placeholder 채워짐
- [ ] 본문 텍스트는 placeholder 또는 textbox 안에
- [ ] 표 첫 행이 헤더
- [ ] 차트는 가능하면 이미지로 변환
- [ ] 발표 메모는 speaker notes 영역에 (본문에 섞지 말 것)
- [ ] 표준 레이아웃 (`Title Slide`, `Two Content` 등) 이름 사용
- [ ] 절대 위치에 의존하지 않는 콘텐츠 (stack 변환 후에도 의미 유지)

이 체크리스트를 통과하면 서버 import 가 거의 손실 없이 동작한다.
