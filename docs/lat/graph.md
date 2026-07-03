# Graph lat — 위키 링크 그래프 / 의존성 그래프 / 의미 triple

> 문서 간 관계를 그래프로 노출하는 세 라우터. 모두 read-heavy 이고 `core` 의
> `require_*` / `envelope()` 위에 얹혀 있다.
>
> 연관 lat: [[documents]] (DocumentJSON 본문이 링크/triple 의 원천), [[core]]

## 모듈

| 라우터 | prefix | 책임 |
| --- | --- | --- |
| [[src/app/routers/links_graph.py]] | `/api/v1/links` | wiki 링크 + 태그 기반 그래프 (도메인/BFS/전역) |
| [[src/app/routers/dep_graph.py]] | `/api/v1/dep-graph` | `content_json` 본문을 직접 walk 한 의존성 그래프 + 고아 문서 |
| [[src/app/routers/triples.py]] | `/api/v1/triples` | (subject, predicate, object) 의미 엣지 CRUD + LLM 추출 |

세 그래프의 데이터 원천이 다르다:

- **links_graph** — `links` 테이블 (문서 저장 부수효과로 누적되는 `[[slug]]` 링크).
- **dep_graph** — `documents.content_json` 을 매 요청마다 직접 walk. `links` 테이블
  sync 와 무관하게 최신 본문이 반영됨 (느리지만 정확).
- **triples** — 별도 `doc_triples` 테이블. LLM 추출 (`source='llm'`) + 사용자 수동
  입력 (`source='manual'`) 만 담음. wiki/tag 엣지와 **직교**.

## 1. links_graph — wiki 링크 그래프

### Endpoints

| Method | Path | 역할 |
| --- | --- | --- |
| `GET` | `/api/v1/links/graph` | 그래프 노드 + 엣지. 3 경로 (아래) |

`GET /links/graph` 의 3 경로 — query 파라미터로 분기:

| query | 동작 |
| --- | --- |
| (없음) | 전역 — wiki degree 상위 `limit` (기본 200, 최대 20000) 노드 + 그 사이 엣지 |
| `root=<slug>&depth=N` | root 에서 양방향 BFS depth (1~4) |
| `domain=<id>` | super-domain 의 tag 를 가진 published doc 집합 + 옵트인 엣지 |

opt-in 플래그 (도메인 경로에서 주로):

| 플래그 | 추가되는 것 |
| --- | --- |
| `include_tags=1` | tag 노드 (`kind="tag"`) |
| `include_doc_tag_edges=1` | doc–tag 소속 엣지 (`kind="doc_tag"`) |
| `include_tag_cooc=1` | tag–tag 공동출현 엣지 (`kind="tag_cooc"`) |
| `include_context=1` | contextual 약한 관계 (`ctx_author`/`ctx_part`/`ctx_tag`) |
| `include_triples=1` | `doc_triples` 의 의미 엣지 (`kind="triple"`) — 아래 §3 참조 |

응답 shape:

```text
nodes: [{kind, slug, title, status, group}]   # kind: "doc"|"tag"
edges: [{kind, source, target, count?, weight?, ...}]
```

### 핵심 진입점

- [[src/app/routers/links_graph.py#get_graph]] — 3 경로 분기 본체
- [[src/app/routers/links_graph.py#_domain_subgraph]] — domain 경로
- [[src/app/routers/links_graph.py#_aggregate_edges]] — `links` 테이블 → (src, tgt, count) 집계
- [[src/app/routers/links_graph.py#_fetch_nodes]] — slug set → 노드 메타 (없는 slug 은 status='missing')
- [[src/app/routers/links_graph.py#_triple_edges]] — `include_triples` 시 triple 합류 (§3)

## 2. dep_graph — 의존성 그래프

### Endpoints

| Method | Path | 역할 |
| --- | --- | --- |
| `GET` | `/api/v1/dep-graph?root_slug=&depth=` | root 중심 본문 의존성 그래프 |
| `GET` | `/api/v1/dep-graph/orphans` | 아무도 참조하지 않는 고아 문서 목록 |

links_graph 와 달리 `content_json` 을 매 요청 walk 하므로 새로 추가된 `[[slug]]`
가 `links` 테이블 resync 전에도 보인다. 비용이 있어 in-process 캐시
(`_cache_get`/`_cache_set`/`_cache_clear`) 를 둔다.

## 3. triples — 의미 엣지 (graph-edge-predicates)

`doc_triples` 테이블 (`0047_doc_triples`). 엣지에 **술어 (predicate)** 를 붙여
"왜 연결됐는지" 를 기계가 읽게 한다.

### 데이터 모델 — `doc_triples`

| 컬럼 | 비고 |
| --- | --- |
| `id` | ULID (TEXT PK) |
| `subject_slug` / `object_slug` | doc.slug. **FK 강제 안 함** — 문서 삭제 시 orphan 으로 남김 |
| `predicate` | 자연어 술어 (subject→object), max 200자 |
| `inverse_predicate` | 역방향 자연어 술어 (object→subject), nullable. manual 은 선택 입력, llm 은 추출 시 함께 생성, 없으면 표시 측 fallback (0049_triple_inverse_predicate) |
| `source` | `'llm'` 또는 `'manual'` (CHECK) |
| `confidence` | LLM 만 사용 (0~1), manual 은 NULL |
| `created_by` | manual 만 보관, llm 은 NULL |
| UNIQUE | `(subject_slug, predicate, object_slug, source)` |

### Endpoints

| Method | Path | 권한 | 역할 |
| --- | --- | --- | --- |
| `GET` | `/api/v1/triples` | reader | 필터 조회 (`subject`/`object`/`predicate`/`source`) |
| `GET` | `/api/v1/triples/predicates` | reader | 정제된 관계 유형 캐논 ([[src/app/lib/relationship_types.py]]) — 온톨로지 |
| `GET` | `/api/v1/triples/subgraph?root=&depth=` | reader | root 에서 depth(1~4)홉 BFS 서브그래프 (양방향, 노드 200 cap) |
| `POST` | `/api/v1/triples` | editor | 단건 생성. UNIQUE 위반 시 409. **캐논 predicate 면 inverse 자동채움** (명시 inverse 우선) |
| `DELETE` | `/api/v1/triples/{id}` | editor/admin | 작성자 본인 또는 admin. `created_by=NULL`(=llm) 은 admin 전용 |
| `POST` | `/api/v1/triples/extract` | editor | 문서 단건 LLM 추출 (body `{subject_slug}`) |
| `POST` | `/api/v1/triples/extract/bulk` | admin | 일괄 추출 (`{slugs?}` / `{domain?}` / 미지정시 published 전체) |

`extract` 는 해당 문서의 기존 `source='llm'` triple 을 전부 삭제 후 재삽입한다
(idempotent 재추출). `manual` triple 은 보존.

### 핵심 진입점

- [[src/app/routers/triples.py#list_triples]] / `#create_triple` / `#delete_triple`
- [[src/app/routers/triples.py#extract_triple]] / `#extract_bulk`
- [[src/app/routers/triples.py#_replace_llm_triples]] — extract 의 idempotent 교체 로직
- [[src/app/services/triple_extractor.py#TripleExtractor]] — LLM 추출기.
  `extract_for_doc(slug)` → `list[ExtractedTriple{predicate, object_slug, confidence,
  inverse_predicate}]`. mock 은 `inverse='와_관련있다'`, LLM 프롬프트는 predicate +
  inverse_predicate 양방향을 함께 요청 (예: '인용한다' ↔ '에 인용된다').

### LLM provider

`TRIPLE_EXTRACTOR_PROVIDER` 환경변수 (`.env`):

- `mock` (기본) — 본문의 `[[slug]]` 앞 1~2 개를 `는_<obj>_와_관련있다` 술어로
  반환. 외부 호출 부수효과 없음.
- `ollama` / `openai` — `TRIPLE_EXTRACTOR_ENDPOINT` 의 ollama 호환 HTTP API
  (`POST /api/chat`) 로 실 추출. 본문 + `[[slug]]` 후보를 주고 `(predicate,
  object_slug, confidence)` JSON 회수. 후보 밖 slug / `MIN_CONFIDENCE` 미만 drop.

**Graceful fallback** — provider 가 ollama/openai 라도 엔드포인트 도달 실패
(연결 실패 / 8s 타임아웃 / 비-200 / JSON 파싱 실패) 시 `_mock_extract` 로 자동
폴백 + `logging.warning`. 즉 LLM 없는 환경에서도 `/extract` 가 깨지지 않는다.

**자동 셋업** — `infra/scripts/setup-llm.sh` 가 GPU (`nvidia-smi`) 를 감지해서
있으면 ollama 설치 + 모델 pull + `.env` 를 `provider=ollama` 로, 없으면 `mock`
으로 둔다. `install-host-deps.sh` 의 Step 6 에서 자동 호출 — 새 서버에 GPU 만
있으면 LLM provider 가 자동으로 켜진다.

`include_triples=1` 시 `_triple_edges` 가 `doc_triples` 에서 **subject/object 가
둘 다 현재 그래프 노드인** triple 만 골라 `{kind:"triple", source, target,
predicate, triple_source, confidence}` 형태로 합류시킨다. 존재하지 않는 slug 의
triple 은 런타임 제외.

## Gotchas

- **3 그래프 데이터 원천 다름** — links_graph 는 `links` 테이블, dep_graph 는
  `content_json` 직접 walk. `[[slug]]` 추가 직후 links_graph 에 안 보이면
  resync 가 안 된 것 (dep_graph 는 즉시 반영).
- **triple FK 없음** — `doc_triples.subject/object_slug` 는 FK 가 아니다. 문서가
  삭제돼도 triple 은 남는다. graph 응답에선 `_triple_edges` 가 노드 멤버십으로
  걸러서 orphan triple 이 안 보일 뿐, 테이블엔 그대로 있다 (별도 cleanup 필요).
- **extract 는 llm triple 만 교체** — 같은 문서 재추출 시 `source='manual'` 은
  절대 안 건드린다. `_replace_llm_triples` 가 `WHERE source='llm'` 로만 삭제.
- **`include_triples` 기본 OFF** — graph 응답 크기 보호. FE 가 명시적으로 켜야 함.
- triple 의 predicate 는 자유 텍스트 → FE 표시 시 escape 필수 (XSS).

## FE — triple 표시 + 입력

| 파일 | 책임 |
| --- | --- |
| [[src/features/graph/triplesApi.ts]] | triples API 클라이언트 — `fetchTriples` / `createTriple` / `deleteTriple` / `extractBulk`. `Triple`/`TripleCreate` 에 `inverse_predicate` |
| [[src/features/graph/useRelationships.ts]] | 문서의 양방향 관계 훅 — `subject=`(나가는)/`object=`(들어오는) 병렬 fetch, best-effort degrade |
| [[src/components/Relationships.tsx]] | 우측 레일 "관계" 패널 — 나가는=predicate / 들어오는=inverse_predicate(없으면 '의 관련 문서' fallback), llm 관계 ✨ 배지. **editor/admin 은 인라인 편집**: `+ 관계 추가`(온톨로지 predicate picker + object slug + optional inverse → createTriple, 캐논이면 inverse 자동) + 행별 ✕ 삭제(deleteTriple). viewer/빈 관계면 패널 숨김, editor 는 추가 위해 항상 노출. [[src/components/layout/RightRail.tsx]] 의 Backlinks 아래 |
| [[src/features/graph/triplesApi.ts#fetchRelationshipTypes]] | `GET /triples/predicates` — 온톨로지 캐논 (편집 폼 picker) |
| [[src/features/graph/components/KnowledgeGraph.tsx]] | `kind="triple"` 엣지를 predicate 라벨 + 출처별 스타일로 렌더 (`renderEdgeLabels`) |
| [[src/pages/Graph.tsx]] | "🔗 triple" 표시 토글, 우클릭 "엣지 추가" dialog → `createTriple` |
| [[src/pages/AdminDashboard.tsx]] | triple 탭 — `extractBulk` 일괄 추출 버튼 |

- triple 엣지 색: 보라 (`#c084fc`). `triple_source='llm'` 흐림 / `'manual'` 진함.
- `renderEdgeLabels: true` — wiki/tag 엣지엔 label 미부여라 triple 만 라벨 보임.
- `include_triples` 토글은 `edgeMode` (wiki/tag/모두) 와 **직교** — 어느 모드에서든
  triple on/off 가능.
- `/dep-graph` 는 BE endpoint 가 triple 미지원 → 토글이 disabled 로 노출만.

## MCP — LLM 이 관계를 읽고 쓴다 (graph-triple-mcp)

외부 LLM(Claude Desktop 등)이 mxwp-mcp 로 의미 관계를 다룬다. FE 패널의 LLM 판.

| 도구 | 책임 |
| --- | --- |
| [[dist/llm-docx-toolkit/mcp/server.py#get_relationships]] | 문서의 양방향 관계 읽기 — outgoing(predicate)/incoming(inverse) + **LLM-legible sentence**(`me --[전제로 한다]--> b`, 역방향 포함) + id + summary. read (토큰 있으면 사용) |
| [[dist/llm-docx-toolkit/mcp/server.py#create_relationship]] | 관계 저술 — subject/predicate/object + inverse_predicate. write(토큰), 409 는 관계-특화 메시지로 변환 |
| [[dist/llm-docx-toolkit/mcp/server.py#delete_relationship]] | id 로 삭제. write |
| [[dist/llm-docx-toolkit/mcp/server.py#extract_relationships]] | 서버 LLM/mock 추출 트리거 (`/triples/extract`). write |
| [[dist/llm-docx-toolkit/mcp/server.py#list_relationship_types]] | 관계 유형 캐논 목록 (온톨로지) — predicate 고르면 inverse 자동. read |
| [[dist/llm-docx-toolkit/mcp/server.py#get_related_subgraph]] | depth 홉 서브그래프 + hop별 LLM-legible sentence + summary. read |

- API 래퍼: [[dist/llm-docx-toolkit/mcp/api_client.py]] 의 `list_triples` /
  `create_triple` / `delete_triple` / `extract_triples` (ETag 무관 — 본문 아님).
- LLM 지침: `llm-system-prompt.md` §7 (mxwp_system_prompt 프롬프트로 노출).
- 테스트: [[dist/llm-docx-toolkit/mcp/tests/test_relationship_tools.py]] (6). ★ 도구
  추가 시 **바이너리 재빌드**(`python build.py --target mcp`) 필요 — stdio 는 frozen,
  HTTP transport 는 소스 즉시 반영.

계획: [`docs/01-plan/features/graph-edge-predicates.plan.md`](../01-plan/features/graph-edge-predicates.plan.md) (1차 DB+API),
[`docs/01-plan/features/graph-triple-fe.plan.md`](../01-plan/features/graph-triple-fe.plan.md) (2차 FE)
