# Glossary lat — terms + domains + 모더레이션 라이프사이클

> 분야별 용어 사전. propose → admin approve 워크플로우. term_proposals 히스토리
> + audit_logs 보존. (term, domain) UNIQUE 로 같은 분야 중복 차단, 다른 분야는
> 같은 term 허용 (ML '커널' vs OS '커널').
>
> 연관 lat: [[core]] (auth/errors/envelope) · [[documents]] (`upsert_glossary_terms`
> 부수효과) · [[graph]] (FR-12 term graph 는 별도 endpoint)
>
> Plan: `docs/01-plan/features/glossary-knowledge-graph.plan.md`
> Migration: `apps/api/alembic/versions/0048_glossary_extended.py`

## Endpoints (전부 [[src/app/routers/glossary.py]])

| Method | Path | 인증 | 역할 |
|---|---|---|---|
| GET | `/api/v1/glossary` | public | 검색/필터 (approved 만, q+domain+page+size) |
| GET | `/api/v1/glossary/term/{term}` | public | 단건 조회 (approved 만) |
| GET | `/api/v1/glossary/pending` | admin | 승인 대기 목록 |
| POST | `/api/v1/glossary/propose` | reader+ | 새 용어 제안 (status='proposed') |
| POST | `/api/v1/glossary/{id}/approve` | admin | 승인 → status='approved' |
| POST | `/api/v1/glossary/{id}/reject` | admin | 거부 + reason 필수 |
| PATCH | `/api/v1/glossary/{id}` | admin | 직접 수정 (status 무관) |
| PATCH | `/api/v1/glossary/proposals/{id}` | 본인+pending | 자기 제안 수정 |
| DELETE | `/api/v1/glossary/proposals/{id}` | 본인+pending | 자기 제안 취소 (hard delete) |
| GET | `/api/v1/domains` | public | 분야 마스터 flat 목록 |
| POST | `/api/v1/domains` | admin | 새 분야 등록 |
| GET | `/api/v1/graph/terms/{id}` | reader+ | D3 그래프 (center+docs+cooccur) |
| POST | `/api/v1/glossary/import` | admin | CSV (multipart) 또는 JSON {rows:[...]} bulk import |

응답 envelope 은 [[core#errors-응답-envelope]] 의 `{data, meta, error}`.
list 응답은 `data: {items, total, page, size}` 패턴.

## 데이터 모델 (0048 이후)

```text
terms
  id, term, definition          ← 기존
  related_docs UUID[]           ← 기존, documents.id 누적
  domain  → term_domains.slug   (nullable FK)
  subdomain
  term_en, aliases TEXT[]
  status (proposed|approved|rejected|deprecated)
  proposed_by/at, approved_by/at, rejected_by, reject_reason
  page_doc_id → documents.id

term_domains
  id, slug UNIQUE, name, parent_id (자기참조)

term_proposals
  id, term_id → terms.id (ON DELETE CASCADE)
  action (propose|approve|reject|edit|deprecate)
  actor_id → users.id, payload JSONB, reason, created_at
```

`(term, domain) WHERE domain IS NOT NULL` partial UNIQUE index 가 중복 방지.
`domain IS NULL` 인 row 는 UNIQUE 적용 안 됨 — 자동 등록 경로
(`upsert_glossary_terms`) 는 항상 `domain='general'` 로 INSERT.

## 핵심 진입점

| 함수 | 위치 | 책임 |
|---|---|---|
| `propose_term()` | [[src/app/services/glossary_service.py#propose_term]] | 중복 체크 → terms INSERT → history+audit |
| `approve_term()` | [[src/app/services/glossary_service.py#approve_term]] | status='approved' + approved_by/at |
| `reject_term()` | [[src/app/services/glossary_service.py#reject_term]] | status='rejected' + reason 필수 |
| `patch_term_admin()` | [[src/app/services/glossary_service.py#patch_term_admin]] | admin 직접 수정 (status 무관) |
| `patch_proposal_owner()` | [[src/app/services/glossary_service.py#patch_proposal_owner]] | 본인+pending 만 |
| `delete_proposal_owner()` | [[src/app/services/glossary_service.py#delete_proposal_owner]] | 본인+pending hard delete |
| `build_graph_for_term()` | [[src/app/services/glossary_service.py#build_graph_for_term]] | D3 center/nodes/edges |
| `bulk_import()` | [[src/app/services/glossary_service.py#bulk_import]] | row 단위 INSERT (ON CONFLICT DO NOTHING) |

Repository (raw SQL): [[src/app/repos/glossary_repo.py]]
- `propose_term`, `get_term_by_id`, `get_term_by_text`, `list_terms`, `list_pending`
- `approve_term`, `reject_term`, `patch_term`, `patch_proposal`, `delete_proposal`
- `list_domains`, `create_domain`
- `insert_proposal_history`, `list_history`
- `find_related_for_term` (cooccur via `&&` array overlap)
- `bulk_import_terms`, `find_term_for_dup`

## 모더레이션 라이프사이클

```text
        propose (reader+)
            │
            ▼
        ┌──────────┐ ── admin reject ──▶ rejected
        │ proposed │                       (reject_reason 필수, public 숨김)
        └──────────┘
            │ admin approve
            ▼
        ┌──────────┐ ── admin admin patch ─▶ 그대로 approved
        │ approved │                          (definition/alias 등 갱신)
        └──────────┘
            │ (수동 SQL — endpoint 없음)
            ▼
         deprecated  (검색/위키링크 제외, related_docs 유지)
```

- 본인 PATCH/DELETE 는 status='proposed' 일 때만. approved 후 본인은
  PATCH 불가 (테스트 가드 `test_owner_cannot_patch_after_approved`).
- term_proposals 에 모든 mutation 의 action 기록 (propose/approve/reject/edit).
- audit_logs 에 `glossary.{propose,approve,reject,patch,proposal.patch,
  proposal.delete,domain.create,import}` action 기록.

## 중복 처리 (Plan §6.4)

`propose_term()` 이 INSERT 전에 `find_term_for_dup()` 으로 선조회 →
existing status 별로 친절한 409 메시지:
- proposed → "이미 제안 중" + existing_id
- approved → "alias 추가 권장" + existing_id
- rejected → "기존 제안을 수정해 재제출"
- deprecated → 통과 (새 propose 허용)

domain=NULL 호출은 partial UNIQUE 가 강제 안 함 → 중복 조회도 skip.

## Bulk import (FR-13)

`POST /glossary/import` 가 Content-Type 으로 분기:
- `multipart/form-data` → `file` 필드의 CSV (utf-8-sig 허용,
  컬럼: term/definition/domain/subdomain/term_en/aliases — aliases는 `|` 구분)
- `application/json` → `{"rows": [{term, definition, domain?, ...}]}`
  `BulkImportIn` pydantic 검증.

INSERT 는 `status='approved', approved_by=admin, approved_at=NOW()`. `ON CONFLICT
DO NOTHING` 으로 중복 skip. row 단위 에러는 `errors[]` 에 reason 누적.

## 자동 등록 경로 (documents 와의 연결점)

문서 본문의 `glossary[]` 필드는 [[src/app/services/document_service.py#upsert_glossary_terms]]
가 매 save 시 처리. 0048 이후 INSERT 가 `domain='general', status='approved'`
로 명시되고 `ON CONFLICT (term, domain) WHERE domain IS NOT NULL` partial-UNIQUE
와 매칭. 즉 문서 본문에서 자동 등록되는 용어는 모더레이션 우회 — 별도
관리 정책 미합의 사항 (Plan §12 미확정).

## Gotchas

1. **`domain=NULL` 은 UNIQUE 미적용** — 동일 (term, NULL) row 가 다수 가능.
   propose 경로는 보통 domain 을 넣지만 무 domain 제안은 중복 차단 불가.
2. **`ON CONFLICT (term, domain) WHERE domain IS NOT NULL`** 절은 partial
   index 와 정확히 매칭되어야 ProgrammingError 안 남. WHERE 절을 빼면
   "no unique or exclusion constraint matching" 에러.
3. **본인 수정/취소는 pending 한정** — service 가 `proposed_by + status` 동시
   체크. 어긋나면 403 (`Forbidden`). `404` (term 없음) 와 구분.
4. **public GET 은 approved 만** — `status='proposed'/'rejected'/'deprecated'`
   는 단건 조회도 404 로 숨김 (정보 leak 방지). admin 은 `GET /pending` 사용.
5. **`upsert_glossary_terms` 는 모더레이션 우회** — 본문 자동 등록은
   approve 없이 검색에 잡힘. 의도된 동작이지만 LLM toolkit 의 hash drift
   가드 (Plan §8.2) 와 함께 봐야 함.
6. **bulk_import 의 row-단위 rollback** — 한 row 의 FK 위반이 다음 row 영향
   주지 않도록 row 마다 try/except + rollback. 다만 rollback 직후 같은
   session 에서 후속 INSERT 시도 — service 가 호출 끝에 한 번만 commit.
   row-단위 트랜잭션 isolation 은 v2 follow-up.

## 테스트 지도

| 파일 | 무엇 |
|---|---|
| [[apps/api/tests/test_glossary.py]] | 기존: 본문 glossary[] 자동 등록 + replace 시 dedup |
| [[apps/api/tests/test_glossary_propose_approve.py]] | FR-01/05/06 happy path + audit/history 검증 |
| [[apps/api/tests/test_glossary_permissions.py]] | reader/editor/admin 권한 매트릭스, 본인 PATCH/DELETE |
| [[apps/api/tests/test_glossary_duplicate.py]] | (term, domain) 중복, 다른 도메인 허용, approved collision hint |
| [[apps/api/tests/test_glossary_list_filter.py]] | q+domain+status 필터, alias/term_en 검색, paging |
| [[apps/api/tests/test_glossary_proposal_lifecycle.py]] | admin PATCH + 본인 수정 후 admin approve + DELETE cascade |
| [[apps/api/tests/test_glossary_domains.py]] | seed 도메인 5개 + admin POST + 중복 |
| [[apps/api/tests/test_glossary_graph.py]] | FR-12 D3 응답 shape (center/nodes/edges/rel) |
| [[apps/api/tests/test_glossary_import.py]] | CSV multipart + JSON body + 중복 skip + 403 |
