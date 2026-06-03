# LLM viewer guide — DocumentJSON 을 읽어 답변 / 요약하기

> **누가 읽나**: 외부 LLM (Claude / GPT / etc) 가 MXWhitePaper 의 백서를
> *읽고* — 요약, Q&A, 의사결정 지원 — 답을 만들 때.
> *작성* 가이드는 `llm-input-rules.md` / `llm-widgets-via-api.md` /
> `llm-document-formats.md` 를 보라.

문서 표현 (DocumentJSON v1.0) 은 37 종 block 의 트리다. 일부는
plain text 로 평탄화하면 정보가 사라진다 — 표는 셀, 차트는 데이터, 피벗은
계산이다. 이 문서는 **각 block 을 사람-가독 형태로 풀어내는 규칙** +
인용 / 참조 시 어떤 식별자를 쓸지 정한다.

---

## 0. 빠른 요약 (LLM 이 명심해야 할 5)

1. **block id 가 진실의 식별자다.** 사람-가독 인용 시 `[블록 N]` 같은
   순번이 아니라 ULID 8 자 prefix (`01HEX2ZX…`) 또는 section 번호
   (`§1.2`) 를 쓴다. 같은 문서 안에서 *재현 가능* 한 참조여야 한다.
2. **읽는 순서 = `sections[].blocks[]` 순서.** 트리는 section level 로
   계층이 있어도, 한 section 안 블록은 *세로 흐름* 이다.
3. **숫자/표/차트/피벗** 은 **데이터로** 읽고 사람 단어로 요약해라. "이
   분기 매출이 +12%" 가 정답, "표 5 행에 데이터" 가 오답.
4. **숨김 메타** (`block.meta.note='page-break-before'`, `slideBreak` 등)
   는 *표시용* 이라 요약에 등장하면 안 된다. 무시.
5. **권한 표시** — 블록에 `block.meta?.confidentiality` 등이 있을 수
   있다. `restricted` / `internal` 표시가 보이면 그 사실을 그대로
   답변에 반영하지 LLM 이 임의로 풀지 마라.

---

## 1. 문서 골격

```text
{
  "schema_version": "1.0",
  "id":             "<ULID>",
  "slug":           "<slug>",
  "title":          "<문서 제목>",
  "metadata":       { division, owners, tags, confidentiality, ... },
  "sections":       [ { id, number, level, title, blocks: [...], children?: [...] } ]
}
```

읽을 때:

- `metadata.confidentiality` 가 `restricted` 면 답변 *서두에 명시*. 외부
  공유 가능 여부에 영향.
- `sections[].number` (`"1"`, `"1.1"`, `"1.1.1"`) 는 사용자에게 보여주는
  공식 번호. 인용 시 `§1.2` 형태로.
- `sections[].children?` 가 있으면 하위 section — 트리 순회.

---

## 2. block 별 "사람-가독 요약" 규칙

| block | 요약 방식 |
|---|---|
| `paragraph` | `text` 그대로. 인라인 link / cite / glossary-ref 도 의미 보존 |
| `heading-4` | sub-heading — 다음 단락의 라벨로 합쳐서 인용 |
| `list` | `items[]` 각 항목 그대로. 들여쓰기 `depth` 보존하면 트리 구조 살아남음 |
| `quote` | "<인용> — <cite>" 형식. cite 없으면 인용만 |
| `code` | 코드는 *원문 그대로 인용*. 변경/요약 X (의미가 깨짐) |
| `math` | LaTeX 그대로. "이 식은 …" 같은 해석 추가는 OK |
| `image` | `alt` 또는 `caption` 텍스트를 그 자리에. 둘 다 없으면 "[이미지]" |
| `callout` | "(주의/정보/팁/위험) <title>: <text>" — variant 가 톤이라 보존 |
| `table` | **헤더 + 첫 N 행 (최대 5) 인용 후 "(총 M 행)" 부기.** 헤더가 데이터 의미를 만든다 |
| `kpi-cards` | "<label>: <value> (<delta> <trend>)" 한 줄씩 |
| `chart` | `title` + 차트 타입 + x축 라벨 + 시리즈 이름 + *각 시리즈의 최대/최소/추세*. raw 숫자 전체 나열 금지 (소음) |
| `gantt` | task list — "<name>: <start>~<end> (진행 <progress>%)" |
| `flow` | mermaid 면 *DSL 그대로 인용* (재현 가능). excalidraw 면 "[Excalidraw 다이어그램]" + 사용자가 외부 도구로 봐야 함 명시 |
| `org-chart` | 계층 들여쓰기로 평탄화. `root → children → grandchildren` |
| `gallery` | "이미지 N장. <첫 caption>, …" |
| `iframe` / `video` / `file` / `pdf` | 외부 리소스 — `title` 또는 URL 만 인용. 내용을 LLM 이 fetch 시도 X |
| `doc-link-card` | `slug` 를 *문서 참조* 로 표기. "→ [docs/<slug>]" |
| `glossary-ref` | `term` 만. 정의가 필요하면 도구 호출로 lookup |
| `bibliography` | 그대로 인용 (각 entry 의 `text` + 옵션 `url`) |
| `figure-index` | 자동 생성 — 답변에 등장시키지 마라 (메타 정보) |
| `spacer` | 무시 |
| `columns` / `tabs` / `accordion` | 컨테이너 — 안 블록을 *같은 깊이* 로 풀어서 요약 |
| `form` / `quiz` / `calculator` | 인터랙티브 — "<제목> 에 N개 질문 / 문항 / 입력" 만. 답변/입력 결과는 추측 X |
| `data-source` | 라이브 데이터 — 그 자리에 `endpoint` 표기. 실제 값은 호출 시점에 따라 변함 |
| `dashboard-embed` | 외부 대시보드 — provider + panelId 표기. 캡처는 X |
| `pdf` / `whiteboard` / `image-annotation` | 시각물 — caption / annotations 의 `label` 만 추출 |
| `paragraph.meta.note === 'page-break-before'` | 페이지 나눔 — 무시 |
| `pivot-table` ★ | **별도 챕터 §3** |
| `slicer` ★ | **별도 챕터 §4** |
| `spreadsheet` | `cells[]` 의 numeric/text 만 평탄화. formula 는 *원문 인용* 후 결과 (계산된 값) 도 함께 |

---

## 3. PivotTable 읽기 ★

피벗 표는 단순히 표 인용으로 끝낼 수 없다 — 의미는 *교차 집계* 다.
다음 순서로 요약하라:

1. **주제 한 줄** — `block.rows` × `block.cols` × `block.values` 가 무엇을
   집계하는지. 예: "부서 × 분기 별 매출 합계 (3 부서, 4 분기)".
2. **시간 그룹** — `rows`/`cols` 항목이 `{field, group}` 이면 *집계 단위*
   (year/quarter/month/…) 를 명시. raw date 가 자동 bucket 된 것.
3. **측정값** — `values[i]` 마다:
   - `field` 또는 `expr` (계산 필드면 그 식 함께 — `revenue - cost`)
   - `agg` (sum/avg/median/…)
   - `showAs` (value/pct_row/pct_col/pct_total/running) — *비율 / 누적*
     이면 답변에서 표현 단위를 명시 (`30 %` 가 분기 비중인지 누적인지)
   - `numberFormat` 패턴이 있으면 따라줘서 사람-친화적으로 (`#,##0` ⇒
     thousands 콤마)
4. **calculatedItems** — 가상 항목 (예: "Q1 = Jan+Feb+Mar"). 합산식을
   설명하고, 의미가 base 항목과 다르면 *분리해서* 보고. 라벨 충돌 시
   원본 + 가상 둘 다 보이게.
5. **필터 / Top N** — `filters` 의 `in`/`top_n`/`bottom_n` 은 "(상위 10개
   만), (선택된 부서: Sales, R&D)" 식으로 *제외된 데이터가 있음을 명시*.
   LLM 이 모든 데이터를 본 듯 답하면 오답.
6. **boundSlicers** — 다른 slicer 가 이 피벗의 필터를 결정한다. 답변
   시점의 slicer 상태는 LLM 이 알 수 없으니 "현재 활성 slicer 에 따라
   결과가 다를 수 있음" 단서를 한 줄 넣어라.
7. **숫자는 *유효 자릿수* 만**. raw `12345.6789` 를 그대로 옮기지 말고
   `numberFormat` 따르거나 thousands+2dp 정도로.
8. **drill-down 데이터는 *질문이 있을 때만***. 표 평탄화는 정보 없는
   소음.

### 3.1 인용 형식 예시

```text
§1.2 의 피벗 표 (id 01HEXPIV…):
부서 × 분기 별 매출 합계 (raw date 를 quarter 로 자동 그룹).
- Sales 가 2024-Q3 정점 (200,000), 이후 하향
- 전사 H1 (calculated item) = 470,000 / H2 = 695,000 — 후반 강세
- 필터: top_n 10 — 하위 부서 제외됨
- 현재 활성 slicer 에 따라 결과 달라질 수 있음
```

---

## 4. Slicer 읽기 ★

`SlicerBlock` 은 인터랙티브 widget — 사용자가 chip 을 클릭하면 같은
문서의 pivot/chart 가 다시 그려진다. LLM 은 chip 상태를 직접 보지
못한다 (slicer 의 active set 은 zustand 의 휘발성 UI 상태).

답할 때:

- "이 문서에는 <field> 슬라이서가 있어 현재 선택된 값에 따라 §1.2 의
  피벗이 달라진다." 라는 메타 인용 한 줄.
- `default` 키가 있으면 "기본값: A, B" 명시.
- `multiSelect=true` 면 다중 가능 — 답변에 그 가능성을 적시.
- slicer 자체가 정보 source 가 아니다 — *어떤 값이 선택 가능한지*
  목록만 전달 (distinct values).

---

## 5. 인용 / 참조 식별자 규칙

LLM 이 답변에서 *이 문서의 특정 부분* 을 가리킬 때 식별자 규칙.

| 대상 | 식별자 형식 |
|---|---|
| 문서 전체 | `docs/<slug>` |
| 섹션 | `§<number>` — section.number 그대로 (`§1`, `§1.2`, `§1.2.1`) |
| 블록 | `[<8자 prefix>]` — ULID 앞 8 글자. 예: `[01HEXPIV]` |
| 측정값 | `pivot:[<8자>]/values[i]` — i 는 0-based |
| 인용문 | `quote@§<number>:<8자>` |
| 표 행 | `table[<8자>]:row[i]` (0-based) |
| 차트 시리즈 | `chart[<8자>]:series[name]` |
| 외부 문서 링크 | `→ docs/<slug>` (doc-link-card) |

문서 전체 이름이 아닌 *추측한 한국어 라벨* 로 가리키면 ambiguity. ULID
앞 8 자는 같은 문서 안에서 고유성이 거의 보장된다 (260 billion 개 중 한
개라 collision 무시).

---

## 6. 절대 하지 말 것

1. **숫자 추측** — chart/pivot 의 raw rows 가 안 보이면 "정확한 값
   접근 불가" 라고 답해라. 가까운 표를 LLM 이 합쳐 추정하면 hallucination.
2. **slicer / data-source 상태를 안다고 답** — 둘 다 *답변 시점*에 따라
   달라진다. "현재 활성 slicer 에 따라 다름" / "endpoint 호출 시점의
   데이터" 단서를 빠뜨리지 마라.
3. **인터랙티브 widget (form/quiz/calculator) 의 사용자 입력 결과 추측**.
4. **author / owner 의 신원 추측**. metadata 에 보이는 것만 인용.
5. **숨겨진 hidden marker 인용** — `Widget: chart (bar)` 같은 import 용
   marker 가 paragraph 로 보일 수 있다. `block.meta.note==='hidden'` 또는
   `paragraph.text` 가 정확히 `^Widget: ` 패턴이면 그건 사람-가독 X.
6. **figure-index / spacer / page-break paragraph** — 메타 / 표시용,
   요약 본문 X.

---

## 7. 답변 품질 체크리스트

응답 *전* 자기-점검:

- [ ] 인용한 모든 숫자에 출처 (`§x.y` 또는 `[<8자>]`) 가 있나?
- [ ] 필터링 / Top N / slicer 영향으로 *제외된 데이터* 가 있다고 적었나?
- [ ] 시간 그룹 단위 (year/quarter/month) 를 명시했나?
- [ ] 차트 raw 값 나열 대신 *추세 / 최대 / 최소* 로 요약했나?
- [ ] confidentiality 가 `restricted` 면 그 사실을 답변 서두에 적었나?
- [ ] LLM 가 본 적 없는 data-source / slicer 상태에 대해 단서를 달았나?

---

## 8. 관련 문서

- 작성 가이드: `llm-input-rules.md`, `llm-widgets-via-api.md`,
  `llm-document-formats.md`
- 위젯 자세한 형태: 위 widgets-via-api §3.1 ~ §3.23
- 스키마 원문: `packages/shared/schemas/document.json`
- 토킷 (외부 LLM 이 docx 만들 때): `dist/llm-docx-toolkit/`
