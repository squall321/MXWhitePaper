# Plan — graph-triple-fe

> graph-edge-predicates 사이클 2차 (FE). 1차에서 만든 `doc_triples` DB+API 를
> 그래프 UI 에 연결 — 술어 엣지 표시 + 수동 입력 + admin 일괄 추출.

## Executive Summary

| 관점 | 내용 |
| --- | --- |
| **Problem** | 1차에서 triple BE 는 완성됐지만 FE 가 전혀 안 쓴다. 술어 엣지가 DB 에 있어도 사용자 눈에 안 보이고, 추가할 방법도 없다. |
| **Solution** | KnowledgeGraph 가 `include_triples=true` 로 fetch → triple 엣지를 predicate 라벨과 함께 렌더. 그래프 우클릭 메뉴에 "엣지 추가" → predicate 입력 dialog → POST /triples. admin 대시보드에 일괄 추출 트리거. |
| **Function · UX · Effect** | 그래프에서 두 노드 사이 화살표에 "에서_사용된다" 같은 술어가 보임. 사용자가 우클릭으로 직접 관계를 입력. admin 이 버튼 한 번으로 전체 문서 LLM 추출. |
| **Core Value** | 그래프가 "왜 연결됐는지" 를 사람에게 보여주는 진짜 *지식그래프* 가 된다. 1차의 BE 가 비로소 가시화된다. |

## 1. Overview

### 1.1 Purpose

1차 (graph-edge-predicates) 의 `doc_triples` + `/api/v1/triples` 를 FE 에 연결:
1. 그래프에서 triple 엣지를 predicate 라벨과 함께 표시
2. 사용자가 그래프 UI 에서 수동으로 triple 추가/삭제
3. admin 이 일괄 LLM 추출 트리거

### 1.2 Out of Scope

- **triple 검색/필터 페이지** — 술어로 검색하는 별도 화면.
- **triple 편집** — 생성/삭제만. 수정은 삭제 후 재생성.
- **승인 워크플로우** — manual triple 즉시 반영, 검수 단계 없음.

### 1.2b 실 LLM provider 포함 (사용자 추가 결정)

이번 사이클에 실 LLM 추출도 포함한다. 단 **graceful degradation**:

- 서버에 GPU LLM (로컬 ollama 등) 이 있다고 가정 — provider 가 그쪽으로 추론.
- LLM 엔드포인트에 도달 못 하거나 `TRIPLE_EXTRACTOR_PROVIDER` 미설정이면
  **mock 으로 자동 폴백** (CPU 만 있는 개발 환경 / LLM 없는 환경).
- 즉 어떤 환경에서도 `/extract` 가 깨지지 않는다 — LLM 있으면 실 추출, 없으면
  mock placeholder.

### 1.3 Decisions (사용자 확정 사항)

- 이번 사이클 범위: **FE 전체** (표시 + 입력 + admin). LLM 은 mock 유지.
- 에이전트 분담으로 병렬 진행.

## 2. Functional Requirements

### 2.1 triple 엣지 렌더링 (KnowledgeGraph)

- `KnowledgeGraph` 가 받는 `edges` 에 `kind="triple"` 항목이 오면:
  - sigma `renderEdgeLabels: true` 활성화 (triple 엣지만 라벨 표시)
  - 엣지 라벨 = `predicate` 텍스트
  - triple 엣지는 wiki/tag 와 색을 구분 (예: 보라/cyan 계열)
  - `triple_source` 가 `llm` 이면 점선/흐리게, `manual` 이면 실선/진하게 (출처 시각 구분)
- `edgeKinds` Set 에 `'triple'` 추가 — `include_triples` 분기와 연동.

### 2.2 그래프 fetch 분기 (include_triples)

- `/graph?domain=...` 의 엣지 모드 segmented control 에 영향: triple 표시 토글.
  - 옵션: 기존 `wiki/tag/모두` 와 별개로 "🔗 triple 표시" 체크박스 추가
    (mode 와 직교 — wiki 모드 + triple 표시 동시 가능).
- `fetchGraph` 에 `include_triples?: boolean` 파라미터 추가, 켜졌을 때만 BE 에 전달.
- `/graph/all`, `/dep-graph` 도 동일 토글.

### 2.3 우클릭 "엣지 추가" (Graph.tsx 컨텍스트 메뉴)

- doc 노드 우클릭 메뉴에 "🔗 엣지 추가" 항목 추가.
- 클릭 시 dialog: `이 노드(subject)` → `[술어 입력]` → `[대상 노드 slug]`.
  - subject 는 우클릭한 노드로 고정.
  - object_slug 는 텍스트 입력 (자동완성은 이번 범위 밖 — 단순 입력).
  - predicate 는 자유 텍스트 (max 200).
- 저장 → `POST /api/v1/triples {source:'manual'}` → 성공 시 그래프 refetch.
- 권한 없는 사용자 (reader) 에겐 메뉴 항목 자체를 숨김.

### 2.4 triple 삭제

- triple 엣지 우클릭 → "엣지 삭제" (manual 또는 admin 만).
- `DELETE /api/v1/triples/{id}` → refetch.
- (엣지 우클릭이 복잡하면, 우선 노드 메뉴에서 "이 노드의 triple 보기" 리스트 +
  각 항목 삭제 버튼으로 대체 가능 — 구현 시 판단.)

### 2.5 admin 일괄 추출 UI

- admin 대시보드 (`/admin/dashboard`) 에 "지식 그래프" 또는 "Triple 추출" 카드.
- 버튼: "전체 문서에서 triple 추출" → `POST /api/v1/triples/extract/bulk {}`.
- 진행 중 로딩 표시, 완료 시 결과 (`documents`, `stored`, `replaced`) 토스트.
- mock provider 라 결과는 적겠지만 동작은 확인 가능.

## 3. Non-Functional Requirements

| 항목 | 수준 |
| --- | --- |
| 렌더 성능 | triple 엣지 추가로 엣지 수 증가 — 기존 sigma 렌더 한계 (수천 엣지) 안에서. |
| 권한 | 엣지 추가/삭제 버튼은 editor+ 에게만 노출. bulk 추출은 admin 만. |
| 보안 | predicate 자유 텍스트 → 라벨 렌더 시 sigma 가 canvas 텍스트로 그리므로 XSS 위험 낮음. dialog 입력도 escape. |
| UX | 엣지 추가 후 그래프가 자동 refetch 되어 즉시 반영. |

## 4. 데이터 모델 영향

없음 — 1차에서 `doc_triples` 테이블 + API 완성. 이번은 순수 FE + 기존 API 소비.

## 5. 작업 분해 (에이전트 분담)

### 5.0 공유 기반 (먼저)

`apps/web/src/features/graph/triplesApi.ts` (신규):
- `fetchTriples(params)` — GET /triples
- `createTriple(body)` — POST /triples
- `deleteTriple(id)` — DELETE /triples/{id}
- `extractBulk(body)` — POST /triples/extract/bulk
- 타입: `Triple`, `TripleCreate`, `BulkExtractResult`

### 5.1 에이전트 1 — KnowledgeGraph 술어 엣지 렌더링

파일: `apps/web/src/features/graph/components/KnowledgeGraph.tsx` 단독.
- `kind="triple"` 엣지를 predicate 라벨 + 출처별 스타일로 렌더.
- `renderEdgeLabels` 활성화.
- `KnowledgeGraphProps` 인터페이스에 prop 추가하지 말 것 (다른 에이전트와 충돌
  방지) — `edges` 안의 `kind`/`predicate`/`triple_source` 필드로만 분기.

### 5.2 에이전트 2 — 그래프 페이지 fetch + 우클릭 UI

파일: `apps/web/src/pages/Graph.tsx`, `GraphAll.tsx`, `DepGraph.tsx`,
`features/graph/api.ts` 단독.
- `fetchGraph` 에 `include_triples` 파라미터 추가.
- 각 페이지에 "triple 표시" 토글 + 우클릭 "엣지 추가" dialog.
- `triplesApi.ts` 의 createTriple/deleteTriple 소비.

### 5.3 에이전트 3 — admin 일괄 추출 UI + 테스트

파일: `pages/AdminDashboard.tsx` (또는 admin 관련), 신규 테스트.
- admin 대시보드에 triple 추출 카드/버튼.
- `triplesApi.ts` 의 extractBulk 소비.
- vitest: triplesApi 클라이언트 + 새 UI 컴포넌트 SSR 스냅샷.

### 5.4 에이전트 4 — BE 실 LLM provider (graceful fallback)

파일: `apps/api/app/services/triple_extractor.py` 단독 + 관련 BE 테스트.
- `TRIPLE_EXTRACTOR_PROVIDER` 에 로컬 LLM provider 추가 (ollama 호환 HTTP).
  - `TRIPLE_EXTRACTOR_PROVIDER=ollama` + `TRIPLE_EXTRACTOR_ENDPOINT` +
    `TRIPLE_EXTRACTOR_MODEL` 환경변수.
- provider 가 ollama/openai 라도 **엔드포인트 도달 실패 시 mock 으로 폴백**.
  타임아웃 (예: 8s) 짧게 — LLM 없는 환경에서 `/extract` 가 안 멈추게.
- LLM 프롬프트: 본문 + `[[slug]]` 후보 list 를 주고 `(predicate, object_slug,
  confidence)` JSON array 회수. confidence < `TRIPLE_EXTRACTOR_MIN_CONFIDENCE`
  자동 drop.
- BE 테스트: provider 별 동작 — ollama 미도달 시 폴백 검증 (실 LLM 없이
  unreachable endpoint 로 폴백 경로 테스트), mock 은 기존대로.
- 기존 `triple_extractor` 테스트 (1차) 가 그대로 통과해야 함.

## 6. 테스트 전략

| 테스트 | 대상 |
| --- | --- |
| `triplesApi` 단위 | fetch/create/delete/extractBulk — mock apiClient |
| KnowledgeGraph 렌더 | triple 엣지 포함 fixture 로 SSR (기존 Graph.test.tsx 패턴, sigma mock) |
| admin UI | 추출 버튼 SSR 스냅샷 |
| 기존 그래프 테스트 | 변경 없이 통과 (add-only) |

## 7. 배포 순서

1. FE 빌드만 — BE 무변경 (1차 API 그대로 소비).
2. `TRIPLE_EXTRACTOR_PROVIDER=mock` 유지 — admin 추출 눌러도 mock 결과.
3. 다음 사이클에서 실 LLM provider.

## 8. Rollback

순수 FE 변경 — 이전 커밋으로 되돌리면 끝. 데이터 영향 없음.
