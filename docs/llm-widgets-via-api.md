# MXWhitePaper — LLM용 위젯 API 직접 생성 가이드

> docx/pptx 가 표현하지 못하는 풍부한 위젯 (callout / chart / gantt / tabs /
> kpi-cards 등) 을 LLM 이 직접 생성하려면 **DocumentJSON block 을 API 로
> 만들어 넣어라**. 이 문서가 그 방법.
>
> 자매 문서: `docs/llm-document-formats.md` (docx/pptx 양식 가이드)

---

## 0. 언제 이 가이드를 쓰나

| 시나리오 | 가야 할 곳 |
|---|---|
| 표 / 단락 / 이미지 위주 보고서 | `llm-document-formats.md` (docx/pptx 직접 생성) |
| KPI / 차트 / callout / 탭 등 풍부한 위젯 필요 | **이 가이드** |
| 둘 다 섞임 | docx 로 골격 import 후 PATCH 로 위젯 보강 (하단 5 절) |

---

## 1. API 진입점 (전부 `/api/v1`)

| 작업 | 메서드 | 경로 | 인증 |
|---|---|---|---|
| 문서 신규 생성 | POST | `/documents` | editor+ |
| 문서 전체 교체 | PUT | `/documents/{slug}` | editor+ |
| 섹션 패치 | PATCH | `/documents/{slug}/sections/{section_id}` | editor+ |
| 블록 패치 | PATCH | `/documents/{slug}/blocks/{block_id}` | editor+ |
| 블록 추가 | POST | `/documents/{slug}/blocks` | editor+ |
| 블록 삭제 | DELETE | `/documents/{slug}/blocks/{block_id}` | editor+ |
| 블록 이동 | POST | `/documents/{slug}/blocks/{block_id}/move` | editor+ |

응답 envelope:

```json
{"data": {...}, "meta": {...}, "error": null}
```

에러 envelope:

```json
{"data": null, "error": {"code": "VALIDATION_ERROR", "http_status": 422, "message": "...", "details": {...}}}
```

ETag 잠금: 수정 엔드포인트는 `If-Match: W/"<doc_id>-<version>"` 헤더 필요.
최초 GET 응답의 ETag 헤더 그대로 echo 하면 됨.

---

## 2. 최소 문서 한 개 (POST /documents)

```json
{
  "schema_version": "1.0",
  "id": "01J3ZTEST0000000000000000",
  "slug": "my-doc",
  "title": "최소 문서",
  "metadata": {
    "division": "MX",
    "owners": ["me@example.com"],
    "tags": [],
    "confidentiality": "internal"
  },
  "sections": [
    {
      "id": "01J3ZSEC0000000000000001",
      "level": 1,
      "title": "개요",
      "blocks": [
        {
          "type": "paragraph",
          "id": "01J3ZPAR0000000000000001",
          "text": "본문입니다."
        }
      ],
      "subsections": []
    }
  ]
}
```

규칙:
- `id` 는 **ULID 26자**. 직접 생성 (예: `python -c "import ulid; print(ulid.new())"`).
- `slug` 는 lower-case + 영숫자/한글/하이픈.
- `level` 은 1~6.
- 모든 block 에 `type`, `id` 는 필수.
- `metadata.owners` 는 실제 사용자 이메일 배열 (배열에 있는 첫 사용자가 owner).

서버는 자동으로 섹션 번호 (1, 1.1, 1.1.1) 를 부여하므로 `number` 필드는 보낼
필요 없음. 보내도 무시됨.

---

## 3. 위젯별 최소 JSON (블록 단위)

각 예시는 한 블록만 보여줌. 실제로는 `section.blocks` 배열에 넣거나
`POST /blocks` 로 단독 추가.

### 3.1 paragraph (기본 단락)

```json
{
  "type": "paragraph",
  "id": "<ULID>",
  "text": "단순 **굵게** *기울임* `code` [링크](https://example.com) 지원."
}
```

inline 서식은 markdown-flavored: `**bold**`, `*italic*`, `` `code` ``,
`[label](url)`.

### 3.2 heading-4 (하위 헤딩)

```json
{
  "type": "heading-4",
  "id": "<ULID>",
  "title": "세부 항목",
  "level": 4
}
```

⚠️ 서버는 본문 안 heading-4 를 **자동으로 sub-section 으로 승격**한다.
명시적 sub-section 을 만들 때는 `section.subsections[]` 에 Section 객체를 쓰는 게 명확.

### 3.3 list (목록)

```json
{
  "type": "list",
  "id": "<ULID>",
  "style": "bullet",
  "items": ["사과", "배", "감"]
}
```

`style`: `"bullet"` | `"number"` | `"check"` (체크박스).

선택적 `options.stripe` (boolean, default `true`) — FE 한정 zebra-striping 토글
(depth=0 항목만 적용). 명시적으로 끄려면 `"options": {"stripe": false}`.

### 3.4 quote (인용)

```json
{
  "type": "quote",
  "id": "<ULID>",
  "text": "측정 가능해야 관리할 수 있다.",
  "cite": "Drucker"
}
```

### 3.5 callout (정보/경고 박스) ★

```json
{
  "type": "callout",
  "id": "<ULID>",
  "variant": "info",
  "title": "참고",
  "text": "이 문서의 데이터는 분기 마감 후 갱신됩니다."
}
```

`variant`: `"info"` | `"warn"` | `"danger"` | `"tip"`.

### 3.6 code (코드 블록)

```json
{
  "type": "code",
  "id": "<ULID>",
  "language": "python",
  "code": "x = 1\ny = 2\nprint(x + y)"
}
```

`language` 는 인기 언어 약자 (`python`/`js`/`ts`/`go`/`rust`/`sql`/`bash`/…).
미지정시 plain.

### 3.7 math (수식)

```json
{
  "type": "math",
  "id": "<ULID>",
  "expression": "E = mc^2",
  "display": "block"
}
```

LaTeX 표기. `display`: `"block"` | `"inline"`.

### 3.8 table (표) ★

```json
{
  "type": "table",
  "id": "<ULID>",
  "headers": ["분기", "매출", "성장률"],
  "rows": [
    ["Q1", "100", "5%"],
    ["Q2", "120", "20%"]
  ],
  "caption": "분기별 매출 요약",
  "options": {
    "footer": "sum",
    "density": "normal"
  }
}
```

`options.footer`: `"sum"`/`"avg"`/`"min"`/`"max"`/null.
`options.density`: `"compact"`/`"normal"`/`"comfortable"`.

### 3.9 kpi-cards (KPI 카드) ★

```json
{
  "type": "kpi-cards",
  "id": "<ULID>",
  "items": [
    {"label": "MAU", "value": 12500, "delta": "+8%", "trend": "up"},
    {"label": "재구매율", "value": "34%", "delta": "-2%", "trend": "down"},
    {"label": "이슈 해결", "value": "92%", "trend": "flat"}
  ]
}
```

`trend`: `"up"` | `"down"` | `"flat"`. `delta` 는 문자열 또는 숫자.
선택적 `options.stripe` (boolean, default `true`) — 카드 단위 zebra (한 칸 건너 blue).

### 3.10 chart (데이터 차트) ★

```json
{
  "type": "chart",
  "id": "<ULID>",
  "chartType": "bar",
  "engine": "recharts",
  "title": "월별 사용자",
  "data": {
    "categories": ["1월", "2월", "3월", "4월"],
    "series": [
      {"name": "신규", "values": [120, 150, 180, 210]},
      {"name": "이탈", "values": [10, 12, 15, 18]}
    ]
  }
}
```

`chartType`: `"line"` | `"bar"` | `"pie"` | `"area"` | `"radar"` | `"scatter"`.
`engine`: `"recharts"` (기본, 단순) | `"echarts"` (고급 인터랙션 — markPoint/
markArea/dataZoom/brush 등 추가 `options` 필드로 ECharts 옵션 직접 전달).

### 3.11 gantt (간트 차트)

```json
{
  "type": "gantt",
  "id": "<ULID>",
  "tasks": [
    {"name": "설계",   "start": "2026-01-01", "end": "2026-01-15", "progress": 100},
    {"name": "구현",   "start": "2026-01-10", "end": "2026-02-20", "progress": 60},
    {"name": "테스트", "start": "2026-02-15", "end": "2026-03-05", "progress": 0}
  ]
}
```

날짜는 ISO `YYYY-MM-DD`. `progress` 는 0~100.
선택적 `options.stripe` (boolean, default `true`) — task row 단위 zebra
(SVG `<rect>` 음영, label 영역 포함).

### 3.12 flow (플로우/다이어그램)

```json
{
  "type": "flow",
  "id": "<ULID>",
  "engine": "mermaid",
  "source": "graph LR\n  A[입력] --> B{검증}\n  B -->|통과| C[처리]\n  B -->|실패| D[에러]"
}
```

`engine`: `"mermaid"` (DSL) | `"excalidraw"` (JSON).

**Excalidraw 변형** — `source` 는 Excalidraw scene JSON 의 문자열화. 최소 형식:

```json
{
  "type": "flow",
  "id": "<ULID>",
  "engine": "excalidraw",
  "source": "{\"type\":\"excalidraw\",\"version\":2,\"source\":\"mxwp-editor\",\"elements\":[{\"id\":\"r1\",\"type\":\"rectangle\",\"x\":0,\"y\":0,\"width\":120,\"height\":80,\"strokeColor\":\"#000\",\"backgroundColor\":\"transparent\",\"strokeWidth\":2}],\"appState\":{\"viewBackgroundColor\":\"#ffffff\"},\"files\":{}}"
}
```

규칙:

- 최소 키: `{ "elements": [...] }` — 나머지는 모두 선택. parse 실패 / `elements` 미배열 → viewer 가 recovery banner 노출
- viewer 는 `@excalidraw/excalidraw` 의 헤드리스 `exportToSvg` 로 정적 SVG 렌더. editor 는 같은 lib 의 캔버스 컴포넌트 lazy mount (Sprint-7)
- LLM 이 생성하는 경우 mermaid 가 훨씬 간결 → excalidraw 는 *외부에서 받은 scene 보존* 용도로 권장. 새로 그릴 때는 mermaid 가 우선

### 3.13 org-chart (조직도)

```json
{
  "type": "org-chart",
  "id": "<ULID>",
  "layout": "tree",
  "root": {
    "id": "ceo",
    "label": "CEO",
    "role": "최고경영자",
    "children": [
      {"id": "cto", "label": "CTO", "role": "기술", "children": []},
      {"id": "cfo", "label": "CFO", "role": "재무", "children": []}
    ]
  }
}
```

`layout`: `"tree"` | `"horizontal"`.

### 3.14 image (이미지)

```json
{
  "type": "image",
  "id": "<ULID>",
  "imageId": "01J3ZIMG0000000000000001",
  "caption": "분기 추세 그래프"
}
```

`imageId` 는 **사전에 업로드해서 받은 ULID**. 업로드 흐름:
1. `POST /uploads/images/init` → `upload_id` + presigned PUT URL
2. PUT 실제 바이트
3. `POST /uploads/images/finalize` → `ulid` 받음
4. 그 `ulid` 를 `imageId` 로 박음

### 3.15 gallery (이미지 갤러리)

```json
{
  "type": "gallery",
  "id": "<ULID>",
  "layout": "grid",
  "items": [
    {"imageId": "<ULID>", "caption": "전면"},
    {"imageId": "<ULID>", "caption": "측면"},
    {"imageId": "<ULID>", "caption": "후면"}
  ]
}
```

### 3.16 iframe (외부 임베드)

```json
{
  "type": "iframe",
  "id": "<ULID>",
  "src": "https://docs.example.com/dashboard?embed=1",
  "title": "외부 대시보드",
  "height": 600
}
```

sandbox 적용 — embed 는 부모 DOM/쿠키 접근 불가.
`html` 필드로 인라인 HTML 도 가능 (`src` 와 둘 중 하나만).

### 3.17 video (비디오 임베드)

```json
{
  "type": "video",
  "id": "<ULID>",
  "src": "https://www.youtube.com/watch?v=…",
  "caption": "제품 소개"
}
```

YouTube/Vimeo 등 oembed 지원 호스트는 자동 변환됨.

### 3.18 file (첨부 파일)

```json
{
  "type": "file",
  "id": "<ULID>",
  "fileId": "01J3ZFIL0000000000000001",
  "name": "report-2026Q1.xlsx",
  "size": 245678,
  "mime": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
}
```

`fileId` 는 `/files/presign-put` + `/files/finalize` 로 사전 업로드해서 받음.

### 3.19 columns (다단 레이아웃)

```json
{
  "type": "columns",
  "id": "<ULID>",
  "columns": [
    [
      {"type": "paragraph", "id": "<ULID>", "text": "왼쪽 본문"}
    ],
    [
      {"type": "image", "id": "<ULID>", "imageId": "<ULID>"}
    ]
  ],
  "widths": [60, 40]
}
```

`columns` 길이 2~4. `widths` 합 = 100 (서버가 자동 정규화).

### 3.20 tabs (탭 그룹)

```json
{
  "type": "tabs",
  "id": "<ULID>",
  "tabs": [
    {
      "label": "개요",
      "blocks": [{"type": "paragraph", "id": "<ULID>", "text": "..."}]
    },
    {
      "label": "상세",
      "blocks": [{"type": "table", "id": "<ULID>", "headers": [...], "rows": [...]}]
    }
  ]
}
```

### 3.21 accordion (펼침 그룹)

```json
{
  "type": "accordion",
  "id": "<ULID>",
  "items": [
    {
      "label": "FAQ 1",
      "blocks": [{"type": "paragraph", "id": "<ULID>", "text": "..."}]
    }
  ]
}
```

### 3.22 pivot-table (피벗 표) ★

Excel 의 pivot table 동등. raw rows 를 `rows × cols × values` 축으로
cross-tab 집계. 외부 LLM 이 "월별 매출 + 작년 동월 대비" 같은 보고서를
한 위젯으로 표현하기에 가장 강력.

**최소 (Sprint 1)** — inline rows + 단일 측정값:

```json
{
  "type": "pivot-table",
  "id": "<ULID>",
  "source": {
    "kind": "inline",
    "rows": [
      {"dept": "Sales", "year": "2024", "v": 100},
      {"dept": "Sales", "year": "2025", "v": 150},
      {"dept": "R&D",   "year": "2024", "v": 80}
    ]
  },
  "rows": ["dept"],
  "cols": ["year"],
  "values": [{"field": "v", "agg": "sum"}]
}
```

`agg` ∈ `sum|count|avg|min|max|median|stdev|var`. measure 다중 가능.

**Sprint 2** — `totals` / `sort` / `filters`:

```json
{
  "totals": { "row": true, "col": true, "grand": true },
  "sort":   { "axis": "row", "by": "sum(v)", "order": "desc" },
  "filters": [
    { "field": "year", "op": "in", "value": ["2024", "2025"] },
    { "field": "v",    "op": "top_n", "value": 10 }
  ]
}
```

`filter.op` ∈ `in|not_in|gt|lt|top_n|bottom_n`. totals 는 raw row 재집계
(avg-of-avg 회피).

**Sprint 3** — `showAs` 비율/누적 + `numberFormat`:

```json
{
  "values": [
    { "field": "v", "agg": "sum", "showAs": "pct_row",  "numberFormat": "0.0%" },
    { "field": "v", "agg": "sum", "showAs": "running",  "numberFormat": "#,##0" }
  ]
}
```

`showAs` ∈ `value|pct_row|pct_col|pct_total|running`.

**Sprint 4** — `expr` 계산 필드 (산술식 평가 후 집계):

```json
{ "field": null, "expr": "revenue - cost", "agg": "sum", "label": "이익" }
```

`expr` 에 row 의 다른 필드 이름이 식별자. `+ - * / ( )` 와 백틱 라벨 지원.

**Sprint 5** — 시간 자동 그룹 + Calculated items (2026-06-01 신설):

```json
{
  "rows": [{ "field": "date", "group": "month" }],
  "cols": [{ "field": "region", "group": null }],
  "calculatedItems": [
    { "axis": "row", "name": "Q1", "formula": "`Jan` + `Feb` + `Mar`" },
    { "axis": "row", "name": "H1", "formula": "`Q1` + `Q2`" }
  ]
}
```

`rows` / `cols` 의 각 항목은 **단순 문자열 (raw field 사용)** 또는 **`{field, group}` object** 중 하나.

- `group` ∈ `year|quarter|month|week|day` — raw row 의 date 필드 (ISO 문자열 / epoch ms / Date) 를 자동 bucket
- `week` 는 ISO 8601 (Mon 시작, 연도 boundary 도 ISO 규정)
- 같은 field 를 다른 group 으로 중복 사용 가능 (`year(date)` + `month(date)`)

`calculatedItems` — base 결과 위에 axis 별 가상 항목 합성:

- `formula` 는 같은-축 항목 라벨을 식별자로 참조하는 산술식
- 공백/한글/`-` 라벨은 **백틱** 으로 (`` `Jan` ``, `` `Q1` ``)
- 후속 item 이 선행 item 참조 가능 (예: `` H1 = `Q1` + `Q2` ``)
- 잘못된 formula / 0 나누기 / unknown 라벨 → 그 셀만 null. 에러 throw 없음

LLM 산출 보고서 예시 — "2024년 분기별 부서 매출, Q1+Q2 합계":

```json
{
  "type": "pivot-table",
  "id": "01PIVOTREPORT2024Q4REVENUE",
  "source": {
    "kind": "inline",
    "rows": [
      {"dept": "Sales", "date": "2024-01-15", "v": 100},
      {"dept": "Sales", "date": "2024-04-10", "v": 150},
      {"dept": "Sales", "date": "2024-07-05", "v": 200},
      {"dept": "R&D",   "date": "2024-02-20", "v": 80}
    ]
  },
  "rows":  ["dept"],
  "cols":  [{ "field": "date", "group": "quarter" }],
  "values": [{ "field": "v", "agg": "sum", "numberFormat": "#,##0" }],
  "totals": { "row": true },
  "calculatedItems": [
    { "axis": "col", "name": "H1", "formula": "`2024-Q1` + `2024-Q2`" }
  ]
}
```

### 3.23 doc-link-card / glossary-ref / bibliography / spreadsheet / 기타

위 외에도 `doc-link-card`, `glossary-ref`, `bibliography`, `spreadsheet`,
`whiteboard`, `image-annotation`, `pdf`, `data-source`, `dashboard-embed`,
`calculator`, `figure-index`, `spacer`, `form`, `quiz` 등이 있다. 정확한 스키마는
서버의 `apps/api/app/schemas/document.py` 의 해당 `*Block` 클래스 참조.

★ zebra-striping 옵션은 7 종 (table / spreadsheet / list / kpi-cards / bibliography /
figure-index / gantt) 이 공유한다. 모두 `options.stripe` (boolean, default `true`)
동일 패턴 — 명시적 OFF 만 효과 있다. bibliography 는 entry 단위, figure-index 는
종류별 그룹 (`<ol>` 안 카운터) 단위, gantt 는 task row 단위 (SVG `<rect>`) 로 stripe 적용.

가장 안전한 패턴: 클래스 정의를 보고 pydantic 의 필수 필드만 채워 보낸 뒤
응답이 422 면 `error.details.errors` 가 부족한 필드를 알려줌. 이게 실질적인
스키마 디스커버리 방법.

---

## 3.X 일반 PPT 패턴 → 기존 위젯 조합 ★

사내 PPT 에서 자주 보이는 슬라이드 형태를 **현재 위젯만으로** 표현하는
레시피. LLM 이 슬라이드 모양을 보고 어떤 위젯 조합을 선택해야 할지 가이드.

### Before / After 비교 (좌우 이미지 + 캡션)

```json
{
  "type": "columns",
  "id": "<ULID>",
  "columns": [
    [
      {"type": "paragraph", "id": "<ULID>", "text": "**Before**"},
      {"type": "image", "id": "<ULID>", "imageId": "<ULID_BEFORE>", "caption": "기존 UI"}
    ],
    [
      {"type": "paragraph", "id": "<ULID>", "text": "**After**"},
      {"type": "image", "id": "<ULID>", "imageId": "<ULID_AFTER>", "caption": "개선 UI"}
    ]
  ],
  "widths": [50, 50]
}
```

### 사진 + 짧은 설명 N장 그리드

```json
{
  "type": "gallery",
  "id": "<ULID>",
  "layout": "grid",
  "items": [
    {"imageId": "<ULID>", "caption": "1단계 — 분석"},
    {"imageId": "<ULID>", "caption": "2단계 — 설계"},
    {"imageId": "<ULID>", "caption": "3단계 — 구현"},
    {"imageId": "<ULID>", "caption": "4단계 — 검증"}
  ]
}
```

### 번호 단계 / 프로세스 (1 → 2 → 3 → 4)

선택지 A — **flow** (mermaid, 가장 시각적):

```json
{
  "type": "flow",
  "id": "<ULID>",
  "engine": "mermaid",
  "source": "graph LR\n  S1[1\\. 분석] --> S2[2\\. 설계]\n  S2 --> S3[3\\. 구현]\n  S3 --> S4[4\\. 검증]"
}
```

선택지 B — **ordered list** (단순):

```json
{
  "type": "list",
  "id": "<ULID>",
  "style": "number",
  "items": ["분석 — 현황 진단", "설계 — 솔루션 설계", "구현 — 코드 작성", "검증 — QA"]
}
```

### vs. 비교 매트릭스 (체크/엑스)

```json
{
  "type": "table",
  "id": "<ULID>",
  "headers": ["기능", "당사", "경쟁사 A", "경쟁사 B"],
  "rows": [
    ["AI 추천",    "✅", "✅", "❌"],
    ["다국어",      "✅", "❌", "✅"],
    ["오프라인",    "✅", "❌", "❌"],
    ["가격(월)",    "₩9,900", "₩14,900", "₩7,900"]
  ],
  "caption": "주요 경쟁사 비교"
}
```

### 인용구 + 인물 사진 (testimonial)

```json
{
  "type": "columns",
  "id": "<ULID>",
  "columns": [
    [
      {"type": "image", "id": "<ULID>", "imageId": "<ULID>"}
    ],
    [
      {
        "type": "quote",
        "id": "<ULID>",
        "text": "이 시스템 도입 후 보고서 작성 시간이 70% 줄었습니다.",
        "cite": "김 차장 — 전략기획팀"
      }
    ]
  ],
  "widths": [30, 70]
}
```

### 로고 그리드 (파트너 / 클라이언트)

```json
{
  "type": "gallery",
  "id": "<ULID>",
  "layout": "grid",
  "items": [
    {"imageId": "<ULID_LOGO_1>"},
    {"imageId": "<ULID_LOGO_2>"},
    {"imageId": "<ULID_LOGO_3>"},
    {"imageId": "<ULID_LOGO_4>"},
    {"imageId": "<ULID_LOGO_5>"},
    {"imageId": "<ULID_LOGO_6>"}
  ]
}
```

(caption 비워두면 자동으로 그리드만 표시.)

### 타임라인 / 마일스톤

현재 전용 widget 없음. 두 가지 근사:

선택지 A — **gantt** (날짜 기반):

```json
{
  "type": "gantt",
  "id": "<ULID>",
  "tasks": [
    {"name": "MVP 출시",    "start": "2026-03-01", "end": "2026-03-01", "progress": 100},
    {"name": "β 베타 시작", "start": "2026-05-15", "end": "2026-05-15", "progress": 100},
    {"name": "GA",          "start": "2026-09-01", "end": "2026-09-01", "progress": 0}
  ]
}
```

선택지 B — **flow** (수평 그래프):

```json
{
  "type": "flow",
  "id": "<ULID>",
  "engine": "mermaid",
  "source": "graph LR\n  M1[2026-03 MVP] --> M2[2026-05 베타]\n  M2 --> M3[2026-09 GA]"
}
```

### 퍼널 / 깔때기 (영업 단계)

전용 widget 없음. ordered list 또는 단일 표:

```json
{
  "type": "table",
  "id": "<ULID>",
  "headers": ["단계", "사용자 수", "전환율"],
  "rows": [
    ["방문",        "10,000", "100%"],
    ["가입",        "2,500",  "25%"],
    ["활성화",      "1,200",  "12%"],
    ["결제",        "300",    "3%"]
  ],
  "caption": "Conversion Funnel"
}
```

### 쿼드런트 / 2×2 매트릭스 (BCG 등)

전용 widget 없음. 2×2 table 또는 columns × 2:

```json
{
  "type": "table",
  "id": "<ULID>",
  "headers": ["", "성장 낮음", "성장 높음"],
  "rows": [
    ["점유 높음", "Cash Cow",  "Star"],
    ["점유 낮음", "Dog",       "Question Mark"]
  ],
  "caption": "BCG Matrix"
}
```

### 피라미드 / 계층 (Maslow 등)

전용 widget 없음. ordered list + 들여쓰기 또는 org-chart:

```json
{
  "type": "org-chart",
  "id": "<ULID>",
  "layout": "tree",
  "root": {
    "id": "top",
    "label": "자아실현",
    "children": [
      {"id": "esteem", "label": "존중", "children": [
        {"id": "belong", "label": "소속", "children": [
          {"id": "safety", "label": "안전", "children": [
            {"id": "phys", "label": "생리적", "children": []}
          ]}
        ]}
      ]}
    ]
  }
}
```

### 통계 인포그래픽 (큰 숫자 강조)

```json
{
  "type": "kpi-cards",
  "id": "<ULID>",
  "items": [
    {"label": "도입 기업", "value": "1,200+", "trend": "up"},
    {"label": "월 활성 사용자", "value": "85,000", "delta": "+12%", "trend": "up"},
    {"label": "응답 시간", "value": "0.4s", "delta": "-30%", "trend": "down"}
  ]
}
```

### 표지 슬라이드 콘텐츠

표지는 *위젯*이 아니라 **문서 메타로** 옮기는 게 맞다:

```json
{
  "schema_version": "1.0",
  "title": "Q1 2026 사업보고서",
  "summary": "분기 실적 요약 및 다음 분기 전망",
  "metadata": {
    "division": "MX",
    "owners": ["author@example.com"],
    "tags": ["분기보고", "2026Q1"],
    "confidentiality": "internal"
  },
  "sections": [ ... ]
}
```

(첫 슬라이드의 시각 디자인은 export 시 자동 표지 페이지로 재생성됨.)

### 혼합 셀 표 (이미지 + 텍스트 + 리스트)

```text
┌──────────┬────────────────┬─────────┐
│ [사진]    │ 제품명 + 설명   │ ₩99,000 │
│ [사진]    │ 제품명 + 설명   │ ₩45,000 │
└──────────┴────────────────┴─────────┘
```

`TableBlock` 의 sparse `cells` 모드를 쓰면 셀 안에 혼합 콘텐츠를 넣을 수 있다.
각 셀은 `text` (string) **또는** `blocks` (Block 배열) 중 정확히 하나를 가진다.
`blocks` 에 허용된 타입은 다음 **3 종 (CellBlock)**:

- `paragraph` — 본문 텍스트 (마크다운 지원)
- `image` — `imageId` 로 이미지 참조
- `list` — bullet / number / check 리스트

> 표 안의 표 (table-in-table) 와 callout / chart / iframe 등 다른 블록은
> 의도적으로 금지 — 셀 레이아웃을 단순하게 유지하기 위해서.

**예제 1 — 제품 카탈로그 표 (이미지 + 본문 + 가격):**

```json
{
  "type": "table",
  "id": "<ULID>",
  "headers": ["사진", "제품", "가격"],
  "rows": [],
  "cells": [
    {"r": 0, "c": 0, "header": true, "text": "사진"},
    {"r": 0, "c": 1, "header": true, "text": "제품"},
    {"r": 0, "c": 2, "header": true, "text": "가격"},

    {"r": 1, "c": 0, "blocks": [
      {"type": "image", "id": "<ULID>", "imageId": "<ULID>", "width": "sm"}
    ]},
    {"r": 1, "c": 1, "blocks": [
      {"type": "paragraph", "id": "<ULID>", "text": "**제품 A** — 프리미엄 모델"},
      {"type": "paragraph", "id": "<ULID>", "text": "고급 마감, 3 년 보증."}
    ]},
    {"r": 1, "c": 2, "text": "₩99,000"},

    {"r": 2, "c": 0, "blocks": [
      {"type": "image", "id": "<ULID>", "imageId": "<ULID>", "width": "sm"}
    ]},
    {"r": 2, "c": 1, "blocks": [
      {"type": "paragraph", "id": "<ULID>", "text": "**제품 B** — 표준 모델"}
    ]},
    {"r": 2, "c": 2, "text": "₩45,000"}
  ]
}
```

**예제 2 — 셀 안에 리스트 (스펙 비교):**

```json
{
  "type": "table",
  "id": "<ULID>",
  "headers": ["항목", "주요 특징"],
  "rows": [],
  "cells": [
    {"r": 0, "c": 0, "header": true, "text": "항목"},
    {"r": 0, "c": 1, "header": true, "text": "주요 특징"},

    {"r": 1, "c": 0, "text": "성능"},
    {"r": 1, "c": 1, "blocks": [
      {"type": "list", "id": "<ULID>", "style": "bullet",
       "items": ["8 코어 CPU", "16GB RAM", "NVMe SSD"]}
    ]}
  ]
}
```

`text` 가 비어있을 때는 빈 문자열 (`"text": ""`) 로 표기. `text` 와 `blocks`
는 동시에 쓸 수 없다 (XOR).

---

## 4. 블록 추가 / 수정 / 이동 (PATCH)

### 4.1 기존 문서에 블록 한 개 추가

```http
POST /api/v1/documents/my-doc/blocks
If-Match: W/"<doc_id>-<version>"
Content-Type: application/json

{
  "section_id": "01J3ZSEC0000000000000001",
  "after_block_id": "01J3ZPAR0000000000000005",
  "block": {
    "type": "callout",
    "id": "<NEW_ULID>",
    "variant": "warn",
    "text": "주의 사항"
  }
}
```

`after_block_id` 생략 시 섹션 마지막에 append.

### 4.2 블록 1 개 교체

```http
PATCH /api/v1/documents/my-doc/blocks/01J3ZPAR0000000000000005
If-Match: W/"<doc_id>-<version>"

{
  "block": { "type": "paragraph", "id": "01J3ZPAR0000000000000005", "text": "수정된 본문" }
}
```

`id` 는 path 와 body 가 일치해야 함.

### 4.3 블록 이동

```http
POST /api/v1/documents/my-doc/blocks/01J3ZPAR.../move

{
  "target_section_id": "01J3ZSEC...",
  "after_block_id": "01J3ZPAR..."
}
```

### 4.4 ETag 잠금 — 실패 패턴

stale `If-Match` 보내면 412 (Precondition Failed):

```json
{"error": {"code": "PRECONDITION_FAILED", "http_status": 412, "message": "..."}}
```

복구: 문서 GET → 새 ETag → 재시도.

---

## 5. docx 골격 + 위젯 보강 워크플로우

가장 실용적인 패턴: **LLM 이 docx 로 텍스트 골격 생성 → import → 위젯 PATCH** :

1. `docs/llm-document-formats.md` 의 규칙대로 docx 만든다 (paragraph/heading/table/image).
2. `POST /imports/docx` → `{document, summary}` 반환.
3. FE 또는 LLM 이 응답 받아 `POST /documents` 로 영속화.
4. 응답으로 받은 `id`, `slug`, 섹션/블록 `id` 들을 사용해:
   - 표 다음에 callout 추가 (`POST /blocks` + `after_block_id`)
   - 단락 하나를 chart 로 교체 (`PATCH /blocks/{id}`)
   - 새 tabs 섹션 끝에 추가
5. 최종 결과는 docx 만으로 못 만든 풍부한 페이지.

이 방식은 LLM 이 "docx 로 표현 가능한 부분"과 "API 로만 가능한 부분"을 따로
처리하므로 깨끗하다.

---

## 6. 인증

API token:

```http
Authorization: Bearer mxwp_<token>
```

- 발급: 위키 UI 의 Settings → API Tokens, 또는 admin 의 `POST /api/v1/api-tokens`.
- token 은 scope 배열을 가짐 (`documents:read`, `documents:write`,
  `uploads:write` 등). 호출하려는 엔드포인트가 요구하는 scope 가 부족하면 403.
- 분당 호출 한도: 일반 사용자 120 req/min, 이미지 업로드 별도 한도.

JWT (사용자 로그인) 도 같은 헤더로 사용 가능.

---

## 7. 디버그

| 상태 코드 | 의미 | 조치 |
|---|---|---|
| 200 | 성공 | — |
| 401 | 토큰 없음/만료 | refresh 또는 재발급 |
| 403 | role/scope 부족 | scope 확인 |
| 404 | 문서/블록 없음 | slug/id 확인 |
| 409 | slug 중복 등 | 다른 slug 사용 |
| 412 | ETag stale | GET 으로 새 ETag 받고 재시도 |
| 422 | 스키마 검증 실패 | `error.details.errors` 의 field/message 확인 |
| 429 | rate limit | 1분 대기 |

스키마 검증 에러 예시:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "http_status": 422,
    "message": "DocumentJSON v1.0 본문이 규격에 맞지 않습니다 — details.errors 참조.",
    "details": {
      "errors": [
        {"field": "sections.0.blocks.2.variant", "message": "value is not a valid enumeration member; permitted: info, warn, danger, tip"}
      ]
    }
  }
}
```

field 경로가 정확히 어느 블록인지 알려주므로 LLM 이 self-correct 하기 좋다.

---

## 8. ULID 생성 (참고)

각 block / section / document 마다 26자 ULID 가 필요. LLM 환경별 생성:

- Python: `import ulid; ulid.new().str`
- JS: `import { ulid } from 'ulid'; ulid()`
- 짧게 임시: 26자 문자열을 직접 작성해도 됨 (`01J3Z` + 21 자 영숫자, 대문자 영문 + 0-9 from Crockford's base32). 단 서버는 중복 검사를 하므로 같은 ULID 두 번 X.

---

## 9. 요약 — LLM 이 위젯을 정확히 만드는 순서

1. 사용자 의도 파싱: 어떤 위젯이 적합한지 결정 (callout vs table vs chart).
2. 3 절의 해당 위젯 JSON 템플릿 채움. **필수 필드 만 채워서** 최소 JSON.
3. ULID 생성 후 `id` 박음.
4. 단독 추가면 `POST /blocks`, 전체 새 문서면 `POST /documents`.
5. ETag 충돌 시 GET 으로 갱신 후 재시도.
6. 응답이 422 면 `error.details.errors` 의 첫 항목 보고 self-correct.

이 흐름을 일관되게 따르면 거의 모든 위젯을 LLM 이 안전하게 생성 가능하다.
