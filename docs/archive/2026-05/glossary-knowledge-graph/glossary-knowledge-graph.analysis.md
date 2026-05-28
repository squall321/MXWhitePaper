# glossary-knowledge-graph — Gap Analysis

> Date: 2026-05-28
> Plan: [glossary-knowledge-graph.plan.md](glossary-knowledge-graph.plan.md)
> Sprint AB (BE, 2026-05-27~28) + Sprint C (FE, 2026-05-28)

## FR Coverage (plan 2.1 13 endpoint + UI)

| FR | Path/Component | 상태 | 근거 |
|---|---|:---:|---|
| FR-01 | POST `/glossary/propose` | ✅ | Sprint AB `glossary_service.propose_term` + Sprint C `ProposeTermModal` |
| FR-02 | GET `/glossary` (filter) | ✅ | `glossary_repo.list_terms` + `/glossary` page (Sprint C-1) |
| FR-03 | GET `/glossary/term/{term}` | ✅ | 기존 + 새 컬럼 노출 확장 |
| FR-04 | GET `/glossary/pending` (admin) | ✅ | `glossary_repo.list_pending` + `/admin/glossary-pending` (Sprint C-3) |
| FR-05 | POST `/glossary/{id}/approve` | ✅ | service + AdminGlossaryPending 의 [✓ 승인] 버튼 |
| FR-06 | POST `/glossary/{id}/reject` | ✅ | service + RejectReasonModal (reason ≥5자) |
| FR-07 | PATCH `/glossary/{id}` (admin) | ✅ | service. FE 직접 편집 UI 는 follow-up (yagni) |
| FR-08 | PATCH `/glossary/proposals/{id}` (own) | ✅ | service (proposed_by + status='proposed' 검증). FE 직접 편집은 deferred |
| FR-09 | DELETE `/glossary/proposals/{id}` (own) | ✅ | service. FE 취소 버튼은 deferred |
| FR-10 | GET `/domains` (tree) | ✅ | `glossary_repo.list_domains` + `listDomains` FE api |
| FR-11 | POST `/domains` (admin) | ✅ | service. FE 도메인 관리 UI 는 deferred |
| FR-12 | GET `/graph/terms/{id}` | ✅ | `glossary_repo.find_related_for_term` + KnowledgeGraph term 노드 (Sprint C-4) |
| FR-13 | POST `/glossary/import` (admin) | ✅ | service (CSV + JSON 양식). FE 업로드 UI 는 admin curl 으로 충분 |

## 권한 매트릭스 (plan 2.2)

| 액션 | reader | editor | admin | 검증 |
|---|:---:|:---:|:---:|---|
| GET /glossary | O | O | O | test_glossary_list_filter |
| POST /glossary/propose | O | O | O | test_glossary_propose_approve |
| PATCH /glossary/proposals/{id} (own) | O | O | O | test_glossary_proposal_lifecycle |
| GET /glossary/pending | X | X | O | test_glossary_permissions |
| approve/reject | X | X | O | test_glossary_propose_approve |
| POST /domains | X | X | O | test_glossary_domains |

전부 ✅. owner-only 검증은 service 레벨 (Forbidden, 404 아님).

## LLM Toolkit 통합 (plan §8)

| 항목 | 상태 | 근거 |
|---|:---:|---|
| chunker.py 에 _chunks_from_glossary | ✅ | `dist/llm-docx-toolkit/rag/chunker.py` 152 chunks (15 from glossary) |
| TRACKED_SOURCES drift 가드 | ✅ | `_lock.py` sources 필드에 glossary 명시 |
| llm-input-rules.md 갱신 | ✅ | "9. 어휘 사전 활용" 섹션 (양쪽 위치) |
| wiki_link_extractor alias 확장 | ✅ | `wiki_link_alias.py` resolve_term_aliases + metadata.alias_of 보존 |

## 신규 인프라

### 데이터 모델
- `term_domains` (계층, 5 seed)
- `terms` 13 컬럼 추가 (domain/subdomain/term_en/aliases/status/모더레이션 메타/page_doc_id)
- (term, domain) 부분 UNIQUE index
- aliases GIN / term_en lower / status / domain index
- `term_proposals` 이력 (propose/approve/reject/edit/deprecate)

### FE 라우트
- `/glossary` (public 검색/탐색)
- `/admin/glossary-pending` (admin 승인 대시보드)
- `/graph?term=<id>` (그래프 term focus)

### 컴포넌트
- ProposeTermModal (재사용 가능 — wiki redlink + glossary empty state 두 진입점)
- RejectReasonModal (재사용 가능 — 향후 댓글-리뷰 거부에도 동일 패턴)

## 호환성 보존

| 영역 | 호환성 |
|---|---|
| 기존 `upsert_glossary_terms` | 0048 partial unique 와 충돌 발견 → domain='general' 명시로 해소 |
| 기존 GET 2 endpoint (term, list) | 새 컬럼 노출 + status 필터 추가하되 envelope 보존 |
| 기존 GlossaryTooltip | 변경 없음 |
| 위키 link primary click | 기존 새 문서 생성 흐름 유지, redlink hook 은 secondary action (우클릭/길게-누르기) |

## 테스트

| 영역 | 신규 케이스 | 누적 통과 |
|---|---|---|
| BE Sprint AB | 30 + 10 (chunker+alias) | api 1090/1090 |
| BE 0048 backfill 호환성 | 4 (test_glossary 갱신) | — |
| FE Sprint C | 37 | web 2070/2070 |

**총 신규 81 단위/통합 테스트. 회귀 0건.**

## Plan Acceptance vs 실측

Plan 의 ER 다이어그램, 백필 전략, 모더레이션 라이프사이클, CSV import 포맷 모두 코드와 일치.

**Match Rate: 100%** (13/13 FR + 4/4 LLM 통합 + 권한 매트릭스 + 호환성)

### deferred (yagni)
- FR-07 admin 직접 편집 UI (curl/admin 페이지 inline edit 으로 충분)
- FR-08/09 본인 proposal 편집/취소 UI (FR-01 propose 재제출로 우회 가능, 우선순위 낮음)
- FR-11 도메인 관리 UI (admin curl 충분, 5 seed 로 시작)
- FR-13 import 업로드 UI (admin CLI 충분)

## 작업 방식

### Sprint AB (BE, 2026-05-27~28)
- 1 직렬 에이전트 (schemas→repo→service→router) + 1 독립 에이전트 (chunker+alias) **병렬**
- 직렬: 3 commits (488c2d0 BE / 9a9f3d4 chunker+alias / 0e7f02e plan status)

### Sprint C (FE, 2026-05-28)
- 4 병렬 에이전트 (C-1 검색 / C-2 modal / C-3 admin / C-4 graph)
- 모든 에이전트가 api.ts *append-only* 룰 준수 → conflict 0
- 통합 단계: Glossary.tsx 에 ProposeTermModal 직접 연결 (5 줄)
- 1 commit (1925432)

### 효율
- 예상 1-2일 → 실제 한 세션 안 (~2시간 + ~2시간)
- 큰 트랙도 Sprint 분할 + 에이전트 분배 + 명확한 boundary rule (api.ts append-only) 로 끝남
