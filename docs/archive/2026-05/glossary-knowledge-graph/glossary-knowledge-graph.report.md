# glossary-knowledge-graph — Completion Report

## Executive Summary

| Perspective | Content |
|---|---|
| **Feature** | glossary-knowledge-graph (어휘사전 + 지식그래프 인프라 — 큰 트랙) |
| **Plan** | 2026-05-17 작성 (772 줄), 2026-05-28 완료 |
| **Duration** | Sprint AB (BE, 2026-05-27~28) + Sprint C (FE, 2026-05-28) = ~5 시간 / 2 세션 |
| **Match Rate** | **100%** (13/13 FR + 4/4 LLM 통합 + 권한 + 호환성) |
| **Code Delta** | +6577 / -100 LOC, 35 files (신규 23 + 수정 12) |
| **Tests** | +81 신규 (BE 40 + FE 41), api **1090/1090** + web **2070/2070** |
| **Regression** | 0건 |

### 1.3 Value Delivered

| Perspective | Outcome |
|---|---|
| **Problem** | 기존 `terms` 테이블은 단순 (term/definition/related_docs) — 분야 분류·모더레이션·다국어·자가증식 불가. 누구도 용어를 제안할 수 없고 admin 만 직접 SQL 가능. |
| **Solution** | `terms` 13 컬럼 확장 + `term_domains` 계층 마스터 + `term_proposals` 이력. 13 endpoint 으로 propose → admin approve/reject 모더레이션. RAG chunker 가 승인된 용어 자동 인덱싱. wiki link alias 자동 redirect. 4 FE 영역 UI 일괄. |
| **Function/UX Effect** | 누구나 `/glossary` 에서 검색·탐색. editor+admin 가 위키 redlink 우클릭 / 길게-누르기로 즉석 제안. admin 가 `/admin/glossary-pending` 에서 일괄 승인/거부 (reason 필수). 그래프 뷰에 term 노드 통합 (`/graph?term=<id>`). LLM 이 승인된 용어를 context 로 활용. |
| **Core Value** | **어휘 → 문서 → 그래프 → 데이터 자가증식 사이클 완성**. 사용자가 글을 쓸수록 용어가 제안되고, admin 이 승인할수록 LLM 이 더 정확한 컨텍스트를 갖고, 문서 품질이 선순환. |

## 세부 작업

### Sprint AB (BE 풀스택)

**0048_glossary_extended migration**
- `term_domains` (id/slug/name/parent_id self-FK/created_at, 5 seed)
- `terms` 13 컬럼 추가: domain/subdomain/term_en/aliases TEXT[]/status (CHECK enum)/proposed_by/at/approved_by/at/rejected_by/reject_reason/page_doc_id
- `term` UNIQUE 제거 → `(term, domain)` 부분 UNIQUE INDEX (domain NOT NULL)
- aliases GIN / term_en lower / status / domain index
- `term_proposals` 이력 (action enum: propose/approve/reject/edit/deprecate)
- 기존 terms row 백필 (status='approved', domain='general')

**모듈 3개 신설**
- `apps/api/app/schemas/glossary.py` — pydantic v2 (TermBase/Propose/Patch/Out, RejectIn, DomainIn/Out, BulkImportIn)
- `apps/api/app/repos/glossary_repo.py` — raw SQL CRUD (propose/list/get/approve/reject/patch/delete/domains/history/graph/bulk)
- `apps/api/app/services/glossary_service.py` — 모더레이션 라이프사이클 + audit_logs + term_proposals 이력

**라우터 교체** (기존 2 GET + 신규 11 endpoint = 13)
- 전부 plan FR-01~13 대응. envelope `{data, meta}` 일관.

**LLM 통합**
- `chunker.py` `_chunks_from_glossary()` — status='approved' 만 인덱싱 (152 chunks, 15 from glossary)
- `_lock.py` sources 필드 — non-file backed source 명시 (drift 가드)
- `wiki_link_alias.py` `resolve_term_aliases()` — alias hit → 정규 term redirect, metadata.alias_of 보존
- `llm-input-rules.md` "9. 어휘 사전 활용" 섹션 (ko 본문 + dist 동기화)

**호환성 fix**
- 기존 `upsert_glossary_terms` 가 partial unique 와 충돌 발견 → domain='general' 명시. 모든 doc save 가 InvalidColumnReferenceError 던지던 silent drift 해소.

### Sprint C (FE UI 4 영역)

**C-1 검색/탐색 페이지 (`/glossary`)**
- `listGlossary({q, domain, status, page, size})` + `listDomains()` api
- `useGlossarySearch` hook (keepPreviousData)
- Glossary.tsx: 사이드바 (sm+) / 모바일 chip + .scroll-fade-x / 검색 + 카드 list (md:2-col) + 페이지네이션
- TopBar 의 desktop + 모바일 overflow 메뉴에 "용어집"

**C-2 propose modal + redlink hook**
- `proposeGlossaryTerm()` api (409 → ApiError.details.existing_id)
- ProposeTermModal: 6 필드 + Cmd+Enter + Esc + 409 inline 안내
- WikiLink: editor+admin 가 redlink 우클릭 / 500ms 길게-누르기 → modal (primary click 은 기존 새 문서 흐름)
- URL ?propose=1 동기화 (deep-link)

**C-3 admin pending 대시보드 (`/admin/glossary-pending`)**
- listPendingGlossary / approveGlossaryTerm / rejectGlossaryTerm api
- AdminGlossaryPending: 20/페이지, multi-select 일괄, 진행률, mobile 카드 / desktop 테이블
- RejectReasonModal: reason ≥5자 + Esc + Cmd+Enter
- AdminDashboard 에 pending count badge link

**C-4 graph term 통합 (FR-12)**
- `getTermGraph(id)` + `termGraphToKnowledge()` 어댑터 (id → `term:<uuid>` 네임스페이스로 slug 충돌 방지)
- `GraphNodeTerm` 타입 + `GraphEdge.kind` 에 `term_doc`/`term_cooc`
- KnowledgeGraph: term 노드 domain 색 + violet 폴백 + 굵은 border
- `/graph?term=<id>` URL param

## 검증

| 단계 | 결과 |
|---|---|
| typecheck | clean |
| web vitest | **2070 / 2070** (+37 신규) |
| api pytest | **1090 / 1090** (+44 신규) |
| husky pre-commit | schema validate + typecheck + RAG re-chunk + OpenAPI dump 통과 |
| OpenAPI | 230 paths (11 신규 endpoint 반영) |
| chunker | 152 chunks (15 from glossary), `--check` 통과 |

## Commits

- `488c2d0` feat(glossary): 모더레이션 워크플로우 + 13 endpoint + (term, domain) 복합 키 (Sprint AB-1/2)
- `9a9f3d4` feat(glossary): chunker glossary 통합 + wiki link alias 자동 redirect (Sprint AB-3)
- `0e7f02e` docs(glossary): plan status Sprint AB complete 표시
- `1925432` feat(glossary): sprint c fe ui — 검색/제안/admin pending/그래프 통합

## 작업 방식 회고

| 단계 | 계획 | 실제 |
|---|---|---|
| 분할 | Sprint A (Foundation) → B (BE 전체) → C (FE) | Sprint AB 통합 (한 세션) + Sprint C (한 세션) |
| 에이전트 | Sprint AB 1+1 병렬 (직렬 BE + 독립 chunker) | 동일 |
| FE | Sprint C 4 영역 | 4 병렬 에이전트, api.ts append-only rule 로 conflict 0 |
| 시간 | 1-2일 추정 | 한 세션 ~2h × 2 = ~4시간 |

### 인사이트
1. **plan 의 분할 (Sprint A/B/C)** 보다 **BE 일괄 + FE 일괄** 이 더 자연스러웠음. BE 가 한 도메인이고 commit 도 한 묶음으로 가는 게 일관성 있음.
2. **api.ts append-only 룰** 이 4 병렬 에이전트 conflict 0 의 핵심. 다른 큰 트랙에서도 재사용 패턴.
3. **호환성 fix (upsert_glossary_terms)** — 에이전트가 자발적으로 발견. 외부 audit 만으로는 못 잡았을 silent drift.
4. **deferred yagni 항목** (FR-07 admin edit UI 등) — 명세 100% 구현 강제 안 함. 실제 사용 후 필요할 때 추가.

## 다음 단계 추천

1. **댓글-리뷰-승인** (사용자 요청) — RejectReasonModal 패턴 재사용 가능
2. glossary 실제 사용 후 follow-up (도메인 관리 UI / FR-11, proposal cancel UI / FR-09 등)
3. Phase 3 다른 트랙 (SSO / Grafana)
