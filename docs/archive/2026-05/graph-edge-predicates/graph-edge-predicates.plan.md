# Plan — graph-edge-predicates

> Triple 형태 (subject, predicate, object) 의 의미 엣지를 그래프에 도입하기 위한
> DB+API 1차 단계. FE 표시/입력 UI 는 다음 사이클로 분리.

## Executive Summary

| 관점 | 내용 |
| --- | --- |
| **Problem** | 현재 그래프 엣지는 `wiki`/`doc_tag`/`tag_cooc` 종류만 있고 술어 (predicate) 가 없다. 두 노드가 왜 연결돼있는지 사용자가 본문을 읽어야만 알 수 있어 graph 의 정보가 얕다. |
| **Solution** | 별도 `doc_triples` 테이블 + `/api/v1/triples` REST + LLM 추출 트리거 (수동). wiki/doc_tag 엣지의 술어는 **공백 유지** (의미 추론은 본문 맥락에 맡김), LLM 이 본문에서 자체적으로 찾아낸 triple 만 술어를 가진 채로 저장. 사용자 수동 추가도 지원. |
| **Function · UX · Effect** | 도메인 그래프와 `/dep-graph` 의 BE 데이터에 술어가 붙은 엣지가 합류 (FE 가 표시는 안 해도 데이터는 정확). admin/문서 작성자 일괄 추출 트리거 + 단건 추가/삭제 API. |
| **Core Value** | "왜" 연결됐는지 기계가 읽을 수 있게 된다. 다음 사이클에서 FE 가 엣지 라벨로 보여주면 사용자 입장에선 그래프가 처음으로 *지식그래프* 처럼 작동. |

## 1. Overview

### 1.1 Purpose

문서 간 관계를 RDF triple `(subject_slug, predicate, object_slug)` 로 명시한다.
출처는 세 가지:

| source | 출처 | predicate |
| --- | --- | --- |
| `wiki` | 본문의 `[[...]]` 링크 | (저장 안 함 — 기존 `links` 테이블 그대로) |
| `tag` | 문서-태그 소속 | (저장 안 함 — 기존 `tags`/`doc_tags` 테이블 그대로) |
| `llm` | LLM 이 본문 맥락에서 추출 | 자연어 술어 (예: "에서_사용된다", "의_경쟁사이다") |
| `manual` | 사용자가 그래프 UI 에서 입력 | 자연어 술어 |

`doc_triples` 테이블엔 `llm`/`manual` 출처만 저장. wiki/tag 는 기존 테이블 유지 —
이번 변경은 **add-only**, 기존 엣지 종류와 직교.

### 1.2 Out of Scope

- **FE 표시** — sigma `renderEdgeLabels` 활성화, predicate 시각화. 다음 사이클.
- **FE 입력 UI** — 그래프 우클릭 메뉴에서 "엣지 추가" 폼. 다음 사이클.
- **LLM 실 호출** — 실제 OpenAI/외부 API 연동. 이번 사이클에선 추출 함수 인터페이스 + mock 응답으로 갈음하고, 실 호출은 별도 task.
- **Triple 검색/필터링** — 술어로 검색. 다음.
- **편집 이력 / approval workflow** — `glossary` 처럼 제안→승인 흐름. 추후.

### 1.3 Decisions (사용자 확정 사항)

- 저장 위치: **새 table `doc_triples`** (block JSON 안에 두지 않음 — 모든 source 일관 + 독립 조회).
- wiki/tag 엣지: **predicate 공백 유지** (별도 보강 작업 X).
- LLM triple: **자연어 술어 텍스트** 그대로 저장 (URI/온톨로지 매핑 X).
- 입력 경로: **LLM 자동 + 수동 둘 다**.
- LLM 모델: **외부 API** (.env 의 `OPENAI_API_KEY` 등). 이번 사이클은 mock + interface 만.
- 추출 트리거: **수동** (admin 일괄 + 문서 단건). 자동 background queue 안 함.

## 2. Functional Requirements

### 2.1 엔드포인트 목록

| Method | Path | 역할 | 권한 |
| --- | --- | --- | --- |
| `GET` | `/api/v1/triples` | 전체/필터 조회 (`?subject=`/`?object=`/`?predicate=`/`?source=`) | reader |
| `POST` | `/api/v1/triples` | 단건 생성 (manual / system-internal) | editor |
| `DELETE` | `/api/v1/triples/{id}` | 단건 삭제 | editor (작성자) / admin |
| `POST` | `/api/v1/triples/extract` | 문서 단건 LLM 추출 트리거 — 본문 → triples 저장 (overwrite source='llm') | editor |
| `POST` | `/api/v1/triples/extract/bulk` | 일괄 추출 (published 문서 전체 / 도메인 / 슬러그 목록) | admin |

추가로 기존 `/api/v1/links/graph` 응답의 엣지 array 에 `triple` 출처도 합류:

```json
{
  "kind": "triple",
  "source": "디스플레이",
  "target": "oled",
  "predicate": "에는_적용된다",
  "triple_source": "llm",
  "confidence": 0.82
}
```

(`include_triples=true` query param 으로 opt-in. 기본 OFF — graph 응답 크기 보호.)

### 2.2 권한 매트릭스

| 역할 | GET | POST | DELETE | extract | extract/bulk |
| --- | --- | --- | --- | --- | --- |
| reader (anon 포함, 공개 문서 한정) | ✓ | ✗ | ✗ | ✗ | ✗ |
| editor | ✓ | ✓ | ✓ (자신/팀) | ✓ | ✗ |
| admin | ✓ | ✓ | ✓ | ✓ | ✓ |

manual triple 의 소유는 `created_by` 컬럼 + 팀 단위. editor 는 자기 팀 문서에 한해
DELETE 가능.

### 2.3 Request / Response 예시

```http
POST /api/v1/triples
Authorization: Bearer ...
Content-Type: application/json

{
  "subject_slug": "디스플레이",
  "predicate": "에서_사용된다",
  "object_slug": "oled",
  "source": "manual",
  "confidence": null
}
```

응답:

```json
{
  "data": {
    "id": "01HV3...",
    "subject_slug": "디스플레이",
    "predicate": "에서_사용된다",
    "object_slug": "oled",
    "source": "manual",
    "confidence": null,
    "created_by": "3df9486b-...",
    "created_at": "2026-05-21T13:00:00Z"
  }
}
```

`POST /api/v1/triples/extract`:

```http
POST /api/v1/triples/extract
{ "subject_slug": "디스플레이" }
```

응답:

```json
{
  "data": {
    "subject_slug": "디스플레이",
    "extracted": [
      { "predicate": "는_oled_와_관련있다", "object_slug": "oled", "confidence": 0.91 },
      { "predicate": "는_플렉서블_디스플레이_의_상위_개념이다", "object_slug": "플렉서블-디스플레이", "confidence": 0.84 }
    ],
    "stored": 2,
    "replaced": 0,
    "source": "llm"
  }
}
```

추출이 끝나면 **같은 문서의 기존 `source='llm'` triples 는 전부 교체** (idempotent
재추출). manual triple 은 보존.

## 3. Non-Functional Requirements

| 항목 | 수준 |
| --- | --- |
| 응답 속도 | GET `/triples?subject=X` p95 < 100ms (단일 인덱스 lookup) |
| 추출 트리거 | 단건 < 5s, bulk N 문서 N×5s 직렬 (이번 사이클은 async 큐 X) |
| 저장 크기 | 문서당 평균 5-10 triples 가정, 1만 문서 = 5-10만 row 예상 — table 통째 in-mem 도 가능 |
| 권한 | JWT 필수. `bulk` 는 admin 만 |
| 감사 | manual triple 은 `created_by` 보관, 누가 만들었는지 항상 추적 가능 |
| 보안 | predicate 자유 텍스트 — XSS 방지 위해 FE 표시 시 escape (이번 사이클은 BE 만이라 무관) |

## 4. 데이터 모델 영향

### 4.1 마이그레이션 SQL — `0050_doc_triples.py`

```sql
CREATE TABLE doc_triples (
    id             TEXT PRIMARY KEY,                  -- ULID
    subject_slug   TEXT NOT NULL,                     -- doc.slug
    predicate      TEXT NOT NULL,                     -- 자연어, max 200
    object_slug    TEXT NOT NULL,                     -- doc.slug
    source         TEXT NOT NULL CHECK (source IN ('llm','manual')),
    confidence     REAL,                              -- LLM 만 사용 (0-1)
    created_by     UUID REFERENCES users(id),         -- manual 만 NOT NULL (LLM 은 NULL)
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- 같은 (subject, predicate, object, source) 는 중복 불허.
    UNIQUE (subject_slug, predicate, object_slug, source)
);

CREATE INDEX idx_triples_subject ON doc_triples(subject_slug);
CREATE INDEX idx_triples_object  ON doc_triples(object_slug);
CREATE INDEX idx_triples_pred    ON doc_triples(predicate);
```

`subject_slug`/`object_slug` 는 FK 로 강제하지 않음 — 문서가 삭제돼도 triple 은
orphan 으로 남길 수 있게 (편집 흐름에서 cleanup 별도 명령). 단, 그래프 응답에선
존재하지 않는 slug 의 triple 은 자동 제외.

### 4.2 ER 다이어그램 (텍스트)

```
documents.slug ── (subject)
                                  ┌─────────────────────────────┐
                                  │  doc_triples                │
                                  │  ─────────────              │
                                  │  id (PK, ULID)              │
                                  │  subject_slug ──────────┐   │
                                  │  predicate              │   │
                                  │  object_slug ──────┐    │   │
                                  │  source             │    │   │
                                  │  confidence         │    │   │
                                  │  created_by ──┐    │    │   │
                                  │  created_at    │    │    │   │
                                  └────────────────│────│────│───┘
                                                    │    │    │
documents.slug ── (object) ─────────────────────────┘    │    │
users.id ──────── (creator) ─────────────────────────────┘    │
                                                              │
links 테이블 (wiki) / doc_tags (tag) 와는 무관 ── 직교 데이터
```

### 4.3 백필 전략

기존 데이터 없음 (신규 테이블). 마이그레이션만 적용.
초기 LLM 추출은 admin 이 `/triples/extract/bulk` 를 published 문서 대상으로
1회 돌려서 채움 — 이번 사이클은 mock 으로 동작 확인만.

## 5. UX 흐름

이번 사이클은 BE only 라 UX 흐름은 다음 사이클로 미룸. 다만 다음 사이클 진입을
위한 가정:

- 그래프 우클릭 메뉴에 "엣지 추가" 항목 추가 → predicate 입력 dialog → POST /triples
- 그래프 옵션 패널에 "LLM triple 표시" 토글 추가 → fetchGraph 의 `include_triples=true` 분기
- 엣지 라벨로 predicate 텍스트 표시 (sigma renderEdgeLabels)

## 6. LLM 추출 인터페이스 (이번 사이클은 mock)

### 6.1 서비스 함수

`apps/api/app/services/triple_extractor.py`:

```python
class TripleExtractor:
    """LLM 으로 본문에서 (subject, predicate, object) triple 을 뽑는다.

    이번 사이클 구현: 외부 API 호출 인터페이스만 잡고, 실제 호출은 mock
    (`OPENAI_API_KEY` 가 없으면 빈 list, 있으면 placeholder triple 1-2 개 반환).
    실 호출은 별 사이클에서 본격 구현.
    """
    async def extract_for_doc(self, doc_slug: str) -> list[ExtractedTriple]: ...

@dataclass
class ExtractedTriple:
    predicate: str
    object_slug: str
    confidence: float
```

추출 로직 (실 구현은 다음 사이클):

1. 문서 본문 (`DocumentJSON`) 의 텍스트 노드 flatten
2. 그 본문에서 등장한 `[[...]]` 슬러그 후보 list 수집 (= object_slug 후보군)
3. LLM 에 본문 + 후보 list 줘서 `(predicate, object_slug, confidence)` array 회수
4. confidence < 0.5 자동 drop
5. `source='llm'` 으로 upsert (기존 LLM triple 은 모두 삭제 후 재삽입)

### 6.2 LLM Provider 구성 (`.env`)

```
TRIPLE_EXTRACTOR_PROVIDER=openai  # openai | mock | (future: anthropic, ollama)
OPENAI_API_KEY=sk-...              # provider=openai 시 필수
TRIPLE_EXTRACTOR_MODEL=gpt-4o-mini
TRIPLE_EXTRACTOR_MIN_CONFIDENCE=0.5
```

`provider=mock` (이번 사이클 default) 일 때 항상 빈 list 또는 placeholder 1-2 개 반환.

## 7. 테스트 전략

| 테스트 | 위치 | 목적 |
| --- | --- | --- |
| `tests/test_triples_crud.py` | api | GET/POST/DELETE 권한 + 동작 |
| `tests/test_triples_extract.py` | api | extract / extract/bulk 트리거 — mock provider 로 |
| `tests/test_links_graph_triples.py` | api | `include_triples=true` 시 graph 응답에 합류 + 존재 안 하는 slug 자동 제외 |
| `tests/test_triple_extractor_mock.py` | api | mock provider 가 항상 빈 list / placeholder 반환 |

기존 그래프/문서 테스트는 변경 없이 그대로 pass 해야 함 (add-only 변경).

## 8. 마이그레이션 / 배포 순서

1. 마이그레이션 적용: `make migrate` (`0050_doc_triples`)
2. BE 배포 (API 추가, 기존 API 무변경)
3. `TRIPLE_EXTRACTOR_PROVIDER=mock` 이 기본이라 LLM 호출 발생 안 함
4. admin 이 `POST /triples` 로 수동 1-2건 만들어 sanity check
5. 다음 사이클에서 FE 표시 + 실 LLM provider 추가

## 9. Rollback

- 마이그레이션만 revert 하면 됨. 다른 테이블에 의존하지 않으니 데이터 손실 위험 거의 없음 (manual triple 만 잃음).
- `provider=mock` 환경에선 LLM 호출 부수효과 없음.
