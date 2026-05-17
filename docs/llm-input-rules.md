# MXWhitePaper — LLM 이 docx 만들 때 따라야 할 룰

> 본 시스템에 import 할 docx 백서 데이터를 사람이 *LLM 에게 시켜서* 만들 때
> 이 문서를 LLM 의 지시문에 첨부하라. 룰을 따르면 모든 컨텐츠가 정확히
> 인식되고, 위젯은 자동 변환된다. 룰을 어겨도 서버는 best-effort 로 import
> 하지만 정보가 손실되거나 위젯이 plain text 로 떨어진다.
>
> **현재 시스템 동작 기준 (2026-05-15)**. 18 위젯 모두 lossless round-trip
> 검증 완료.

---

## 0. 가장 빠른 요약 (LLM 이 명심해야 할 핵심 5)

1. **구조는 Word *스타일* 로 표현**. 직접 글자 크기/색만 바꾸지 말고
   `Heading 1`, `Heading 2`, ... 같은 스타일을 적용. dotted-numbering
   ("1.", "1.1", "1.1.1") 은 강한 보조 신호 — 일관되게 쓰면 자동 인식.
2. **위젯은 명확한 *형태* 를 갖춰라**. 모호하면 paragraph 로 떨어진다.
   - callout: 1×1 표 + 배경색 + ⚠️/💡/🚨/ℹ️ 이모지 또는 `[주의]`/`[정보]` 라벨
   - kpi-cards: 헤더가 `label` + `value` (+ optional `delta`, `trend`) 인 표
   - chart: 헤더 첫 칸은 라벨, 둘째+ 칸이 시리즈명. 데이터는 숫자.
   - gantt: 헤더가 `name` + `start` + `end` (+ optional `progress`) 인 표
   - gallery: 연속 3개 이상의 이미지
   - org-chart: 들여쓰기 리스트 또는 `name`/`parent` 표
   - flow: mermaid DSL 이 들어간 code block
3. **표 헤더 셀은 *plain text* — bold 처리 금지**. bold 된 헤더는 import 시
   `**label**` 처럼 markdown bold 로 wrap 돼서 header 매칭이 깨진다.
4. **이미지는 inline 으로 삽입**. 텍스트 박스/플로팅 도형은 인식 부분적.
5. **표 안에 표 / 셀 안에 위젯은 금지**. 표 셀은 paragraph/image/list 만 허용.

---

## 1. 문서 구조

### 1.1 섹션 계층

Word 스타일을 1차 신호로 사용:

| Word 스타일 | 변환 결과 |
|---|---|
| `Title` 또는 첫 번째 단락 | 문서 제목 |
| `Heading 1` | level=1 섹션 |
| `Heading 2` | level=2 섹션 (level=1 의 자식) |
| `Heading 3` ~ `Heading 6` | 더 깊은 자식 섹션 |
| `Heading 4` (inline) | heading-4 블록 (탭/아코디언의 라벨) |

**dotted-numbering 가 더 강한 신호**:
- "1.", "1.1", "1.1.1", "2.1" 처럼 *점-구분 숫자 prefix* 가 있는 단락은
  스타일이 일반 paragraph 여도 *섹션으로 승격*.
- depth = numbering 의 점 개수 + 1. ("1.1.1" → level=3)
- 한 문서 안에서 일관되게 쓰거나 아예 쓰지 마라 (섞으면 일부만 인식).

### 1.2 메타데이터

문서 첫 페이지 또는 표지에 다음 정보를 plain paragraph 로:
- 제목 (Title 스타일)
- 요약 (Title 다음 paragraph)
- 작성자 / 부서 / 태그 등은 import 시 metadata 로 자동 추출 안 됨 —
  필요하면 임포트 후 MX 에디터에서 직접 입력.

---

## 2. 일반 블록

### 2.1 paragraph

그냥 본문. inline 서식 (`bold`, `italic`, hyperlink) 모두 인식.
markdown 마커 (`**bold**`, `*italic*`, `[text](url)`) 도 인식.

### 2.2 heading-4 (탭/아코디언 라벨로 쓰임)

- Word 의 `Heading 4` 스타일.
- *섹션 깊이가 아닌* heading-4 *블록* 으로 처리됨. 본문 안에 박혀있어도 OK.

### 2.3 list

- Word 의 `List Bullet` (`•`) 또는 `List Number` (`1.`) 스타일.
- 들여쓰기 (`List Bullet 2`, `List Bullet 3` 등) 도 인식.
- 항목은 *plain text*. 항목 안에 이미지/표 금지.

### 2.4 quote

- Word 의 `Quote` 또는 `Intense Quote` 스타일.

### 2.5 code

- Word 의 `Code` 스타일, **또는** 회색 음영 배경 (`F1F5F9`) + Consolas 폰트
  단락. 둘 다 code block 으로 인식.

### 2.6 math

- 수식 편집기 (`Insert > Equation`) 로 작성된 OMML.
- 또는 `$수식$` 형태로 raw 텍스트 (LaTeX 일부 지원).

### 2.7 image

- Word 의 `Insert > Picture` 로 inline 삽입.
- *floating* (텍스트 wrap=tight 등) 는 부분 인식.
- 캡션이 필요하면 `Caption` 스타일 (`그림 N: 설명`).

### 2.8 table

- 일반 표. 첫 행이 헤더.
- 헤더 셀은 **plain text** (bold 금지 — round-trip 시 깨짐).
- 셀 병합 (rowSpan / colSpan) 지원.
- 셀 안에 paragraph / image / list 혼합 가능 (mixed-cell).
- **셀 안에 표 / 위젯 직접 금지**.

### 2.9 spreadsheet (편집 가능한 표)

- 사용자가 사이트에서 직접 셀 값을 수정할 수 있는 *살아있는* 표. `table` 과
  다른 점: docx import 가 만들지 않으며 사이트 에디터에서 직접 추가.
- LLM 이 docx 로 작성 시: 일반 `table` 로 만들고 메타에 *"사이트에서 spreadsheet
  로 전환하세요"* 한 줄 주석을 본문에 남기는 정도가 안전. spreadsheet 자체는
  docx 본문에서 표현이 모호.
- 필수: `cols` (1-26), `rows` (1-200), `cells` 배열.
- 권장: 가능하면 `table` 로 두고 사이트에서 변환.

### 2.10 spacer (여백)

- 본문 흐름에 일부러 공백을 더 줄 때. 단 *남용 금지* — 기본 8px 간격이 이미
  적정. spacer 는 *시각적 절 구분* 이 필요할 때만.
- 필수: `type`, `id`. 선택: `size` ∈ `sm` (16px), `md` (32px, 기본), `lg` (64px).
- LLM 이 *항상 spacer 를 끼워넣는* 패턴 금지. 보통 0-2개로 충분.

### 2.11 bibliography (참고문헌)

- 문서 끝의 출처 목록. 본문에서는 `[[cite:KEY]]` 인라인 문법으로 anchor link.
- docx import 가 자동으로 **"References" / "참고문헌" / "Bibliography"** 헤더
  뒤의 단락을 인식해 만들어줌 — LLM 은 그냥 "References" 섹션 작성하면 됨.
- 필수: `type`, `id`, `entries` (배열). 각 entry: `{key, text, doi?, url?}`.
- 인용 키는 *영문 + 숫자 + 하이픈* 만 (`[[cite:smith-2024]]`).

### 2.12 figure-index (그림/표/차트 목차)

- 본문에 들어간 *캡션 있는 이미지 / 표 / 차트* 의 자동 생성 목차.
- 본문 처음에 한 블록 두면 렌더러가 문서 전체를 훑어 목록 생성.
- 필수: `type`, `id`. 선택: `title`, `kinds` (필터 — `image` / `table` / `chart`).
- LLM 작성 시: 캡션을 잘 달면 (1.7 §image / §table 참고) figure-index 가 자동
  으로 풍부해짐. 별도 본문 작성 불요.

### 2.13 form (사용자 입력 폼)

- 사이트 방문자가 응답할 수 있는 폼 (조사 / 신청 / 피드백).
- docx 로는 표현 불가 — LLM 이 docx 작성 시 *form 블록을 만들지 말 것*.
  대신 본문에 "이 자리는 form 블록" 표시 + 사용자가 사이트 에디터에서 추가.
- 필수: `type`, `id`, `questions` (배열). 사이트 전용 위젯이므로 사람이 만듦.

### 2.14 quiz (퀴즈)

- form 과 유사하지만 정답 / 채점 / 합격선 추가. 학습 / 시험 / 인증.
- form 과 동일 규칙 — **LLM 이 docx 에 만들지 말고** 사이트 에디터에서 추가.
- 필수: `type`, `id`, `questions`. 선택: `passing_score`, `shuffle`, `max_attempts`.

### 2.15 calculator (수식 계산기)

- 사용자가 입력 (예: 매출, 단가) 을 넣으면 *공식 적용 결과* 를 표시.
- docx 로는 표현 불가 — LLM 은 본문에 *공식 + 예시 결과* 만 적고 사용자가
  사이트에서 calculator 블록 추가.
- 필수: `type`, `id`, `inputs` (변수 정의), `formula` (수식 문자열).

### 2.16 data-source / dashboard-embed (라이브 데이터 / 외부 대시보드)

- 외부 API 또는 Grafana / Looker 등에서 실시간 데이터 가져옴.
- 둘 다 *사이트 전용* — LLM 이 docx 로 만들지 말 것. 본문에 "이 자리는 라이브
  데이터" / "Grafana 대시보드 panelId=42" 등 placeholder 단락만 두고 사용자가
  사이트에서 실제 블록 추가.
- 필수 — data-source: `endpoint`, `render` (`chart` / `table` / `kpi`).
  dashboard-embed: `provider` (`grafana` / `looker`), `panelId`.

### 2.17 LLM 이 docx 로 만들 수 없는 블록 (요약)

| 블록 | 사유 | LLM 이 할 일 |
|---|---|---|
| `spreadsheet` | docx 본문 표현 모호 | 일반 `table` + 본문 주석 |
| `form` / `quiz` | 사용자 입력 / 채점 필요 | 본문에 placeholder 단락 |
| `calculator` | 동적 수식 계산 | 공식 + 예시값 단락 |
| `data-source` / `dashboard-embed` | 라이브 데이터 / 외부 시스템 | placeholder + 출처 표시 |

→ 이 6 블록은 사이트 에디터에서 *사람이* 직접 추가하는 게 정답. LLM 은 본문에
"여기에 form 블록 추가 예정" 같은 단락만 남기면 사용자 review 시 보강 가능.

---

## 3. 위젯 룰 — *형태* 가 자동 인식의 키

위젯 = 시각적으로 특별한 블록. *형태* 가 모호하면 plain block 으로 떨어짐.

### 3.1 callout (주의/팁/위험 박스)

3 가지 인식 패턴 *중 하나 이상*:

**패턴 A — 1×1 색 표** (가장 권장):
- 표 만들기 → 1 행 1 열 → 셀 배경색 (warn=주황/빨강, danger=빨강, tip=초록, info=파랑/회색).
- 텍스트만 한 줄: `중요한 경고 메시지`.

**패턴 B — 이모지/라벨 prefix + 색 배경 paragraph**:
- 평범한 paragraph 인데 *음영 (배경색)* 설정 + 첫 단어가 이모지 또는 라벨:
  - `⚠️ 작업 중지 금지` (warn)
  - `🚨 즉시 대피` (danger)
  - `💡 단축키 Ctrl+S` (tip)
  - `ℹ️ 참고 사항` (info)
  - `[주의] 내용` (warn)
  - `[정보] 내용` (info)

**패턴 C — 1×1 표 + 이모지/라벨** (배경색 없이 신호):
- 1×1 표 + 셀 텍스트가 이모지/라벨로 시작.

**중요**: *paragraph 만 색 배경* (이모지/라벨 없음) → 인식 안 됨 (일반 paragraph).
이모지/라벨 + *색 없는 paragraph* → 인식 안 됨. 두 신호 다 필요.

### 3.2 kpi-cards (큰 숫자 카드)

표 헤더가:
- 필수: `label` + `value`
- 옵션: `delta`, `trend`

행 1~4개:
```
| label | value | delta | trend |
| 매출  | 100억 | +10%  | up    |
| MAU   | 5만   | +1k   | up    |
```

### 3.3 chart (차트)

표:
- 첫 칸 (헤더의 0번째) = label-axis 이름 (예: `Month`)
- 둘째+ 칸 = 시리즈 이름

```
| Month | Revenue | Profit |
| Q1    | 100     | 20     |
| Q2    | 150     | 30     |
```

chart 종류 명시하려면 위에 hidden marker `Widget: chart (bar)` 를 추가
(line/bar/pie/area/radar/scatter). marker 없으면 *autodetect 안 함* —
chart 는 표와 모양이 같아서 자동 인식 위험. **marker 권장.**

### 3.4 gantt (간트 차트)

표 헤더:
- 필수: `name` (또는 `task`/`작업`/`이름`) + `start` (또는 `시작`) + `end` (또는 `종료`)
- 옵션: `progress` (또는 `진행률`)

```
| Task | Start      | End        | Progress |
| 설계 | 2026-01-01 | 2026-01-15 | 50%      |
```

### 3.5 flow (플로우/다이어그램)

code block (회색 음영 paragraph + Consolas 폰트) 에 mermaid DSL:
```
graph TD
  A --> B
  B --> C
```

### 3.6 org-chart (조직도)

두 가지:

**A — 들여쓰기 리스트** (List Bullet):
```
• CEO
  • CTO
    • Dev
  • CFO
```
들여쓰기 깊이 = 트리 깊이.

**B — name/parent 표**:
```
| name  | parent |
| Alice |        |   ← 루트
| Bob   | Alice  |
| Carol | Alice  |
```

### 3.7 gallery (이미지 모음)

연속 3개 이상의 inline 이미지. 2개 이하는 개별 이미지로 처리.
캡션 (Caption 스타일) 있으면 각 이미지에 자동 attach.

### 3.8 columns (다단 레이아웃)

Word 의 *"단" 기능*: `Layout > Columns > Two/Three` 로 섹션 분할.
import 가 sectPr 의 `<w:cols num=N>` (2~4 단) 인식 → 자동 ColumnsBlock 변환.

### 3.9 tabs / accordion (탭/아코디언)

연속된 Heading 4 + 각 heading 의 본문이 한 그룹. **marker 없으면 그냥
heading-4 시리즈** 로만 인식 (탭 위젯 변환 X). 명시적으로 탭/아코디언으로
만들려면 hidden marker `Widget: tabs` 또는 `Widget: accordion` 추가.

### 3.10 iframe / video / file / pdf / doc-link-card / glossary-ref

각각 hidden marker 와 한 줄 paragraph (URL/슬러그/단어). marker 없으면
인식 안 됨 (그냥 link 또는 paragraph 로 떨어짐).

```
Widget: iframe          ← hidden marker (워드 hidden text)
https://example.com     ← URL paragraph
```

또는 marker 없이 시스템 안에서 직접 위젯 블록 생성 (MX 에디터로).

### 3.11 image-annotation (이미지 위 주석)

이미지 + 주석 좌표 표 (헤더: `kind`/`x`/`y`/`from_x`/`from_y`/`to_x`/`to_y`/`w`/`h`/`text`/`color`).
복잡하면 *MX 안에서 직접 만드는 것* 을 권장.

### 3.12 whiteboard

docx 가 strokes 를 표현 못 함 — *MX 안에서만 작성 가능*. docx 에 만들지 마라.

---

## 4. Hidden marker — 진보한 사용

LLM 이 hidden marker 를 *직접* 넣을 수도 있음:

- python-docx 가 아닌 직접 XML 편집이나 외부 도구로 가능.
- 형식: `<w:r><w:rPr><w:vanish/></w:rPr><w:t>Widget: callout (warn)</w:t></w:r>`.
- import 가 hidden 여부와 무관하게 `Widget: <type> (variant)` 패턴 인식.

대부분 LLM 은 직접 hidden text 작성이 어렵다. 권장:
- 시각 패턴 (3장의 룰) 따라 자연스럽게 작성 → autodetect.
- 또는 *visible marker* `Widget: callout (warn)` 한 줄 + 본문 — autodetect 가 잡고 marker 는 round-trip 후 hidden 으로 보존됨.

---

## 5. 자주 하는 실수 (해결법)

| 실수 | 결과 | 해결 |
|---|---|---|
| Heading 1 대신 글자 크기만 키움 | 섹션 아닌 paragraph | 반드시 `Heading 1` 스타일 적용 |
| 표 헤더를 bold | 헤더 매칭 깨짐 | bold 제거, plain text |
| callout 을 색 paragraph 만 | 일반 paragraph 로 떨어짐 | 이모지/라벨 prefix 추가 |
| 2개 이미지 → gallery 기대 | 개별 이미지 | 3개 이상 또는 marker 명시 |
| chart 표 위에 marker 없음 | 일반 table | `Widget: chart (bar)` marker 추가 |
| 점-숫자 prefix 일관성 없음 | 일부만 섹션 승격 | 전부 dotted 또는 전부 안 씀 |
| 셀 안에 표 중첩 | 무시됨 | 셀에는 paragraph/image/list 만 |

---

## 6. import 후 확인

import 시 응답에 `summary.warnings` 가 포함됨:
- `"auto-detected callout from single-cell table"` ← 정상 인식
- `"file marker '<name>': placeholder fileId emitted"` ← marker 인식, file 은 placeholder
- `"image-annotation marker: neither image nor annotation table found"` ← 위젯 인식 실패, placeholder

import 후 MX 에디터에서 확인하고 필요시 수정.

---

## 7. 빠른 체크리스트 — LLM 에게 줄 마지막 명령

작성 후 *반드시* 다음을 검증한 뒤 결과물 출력:

- [ ] 모든 섹션에 `Heading 1`~`Heading 6` 스타일 적용
- [ ] dotted-numbering 일관성 (있으면 전부, 없으면 전부 없음)
- [ ] 표의 헤더 행이 plain text (bold 없음)
- [ ] callout 은 *색 + 이모지/라벨* 둘 다 신호
- [ ] kpi-cards 의 헤더는 정확히 `label` / `value` (옵션 `delta`/`trend`)
- [ ] chart 표 위에 `Widget: chart (bar)` marker 추가 (autodetect 안 함)
- [ ] gantt 표 헤더는 `name`/`start`/`end`
- [ ] 이미지는 inline 으로 삽입 (floating 금지)
- [ ] gallery 는 3+ 이미지 연속
- [ ] flow 는 code block 안에 mermaid DSL
- [ ] tabs/accordion 은 marker 필요
- [ ] iframe/video/file/pdf/doc-link/glossary 는 marker 필수
- [ ] image-annotation/whiteboard 는 docx 에서 만들지 말고 MX 에서 직접

---

## 8. 부록 — DocumentJSON API 직접 사용

위 룰을 따르기 어려운 경우 (예: 풍부한 image-annotation, 정확한 chart 옵션),
사람이 docx 만들고 import 하는 대신 **DocumentJSON 을 API 로 직접 생성**
하는 게 더 안전:

```
POST /api/v1/documents
Authorization: <token>
Content-Type: application/json

{
  "schema_version": "1.0",
  "slug": "my-whitepaper",
  "title": "백서",
  "metadata": {...},
  "sections": [...]  ← 위젯 블록 직접 명시
}
```

자세한 스키마는 `packages/shared/schemas/document.json`, LLM 친화 가이드는
`docs/llm-widgets-via-api.md` 참고.
