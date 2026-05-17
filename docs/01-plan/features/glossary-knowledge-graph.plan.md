# 분야별 어휘사전 + 지식그래프 인프라 Planning Document

> **Summary**: 기존의 단순한 `terms` 테이블을 분야별 분류, 모더레이션 워크플로우,
> 다국어 지원, 지식그래프 노출로 확장하여 어휘 → 문서 → 그래프 → 데이터 자가증식
> 사이클을 완성하는 인프라 기반 계층을 도입한다.
>
> **Project**: MX White Paper
> **Feature**: glossary-knowledge-graph
> **Version**: 0.1.0
> **Date**: 2026-05-17
> **Status**: Draft

---

## Executive Summary

| Perspective | Content |
|-------------|---------|
| **Problem** | 현재 `terms` 테이블은 term/definition/related_docs 3개 컬럼만 있어 분야 분류·모더레이션·다국어 검색이 불가하다. 누구나 용어를 제안하는 워크플로우도 없고, 용어-문서 간 지식그래프 노출도 없어 사전이 정적 데이터에 머물고 있다. |
| **Solution** | `terms` 테이블에 도메인·상태·제안자·다국어 컬럼을 추가하고, 제안→승인 모더레이션 라이프사이클을 신설한다. 기존 `links_graph.py`를 확장해 `term` 노드를 그래프에 편입하고, LLM toolkit의 chunker를 연결해 승인된 어휘가 자동 인덱싱되도록 한다. |
| **Function/UX Effect** | 문서 작성 중 `[[미등록용어]]` 입력 시 제안 모달이 뜨고, admin이 pending 목록에서 일괄 승인·거부한다. 승인 즉시 위키링크가 활성화되고 LLM 컨텍스트에 반영된다. 분야·다국어로 필터링된 용어 검색이 가능해진다. |
| **Core Value** | 어휘 → 문서 → 그래프 → 데이터의 **자가증식 사이클**: 사용자가 글을 쓸수록 용어가 제안되고, admin이 승인할수록 LLM이 더 정확한 컨텍스트를 갖게 되어 문서 품질이 선순환한다. |

---

## 1. Overview

### 1.1 Purpose

MXWhitePaper는 엔지니어링 백서 작성 플랫폼으로, 사용자들이 ML·반도체·전기차 등 다양한
전문 분야의 문서를 생성한다. 현재 용어 사전은 단순 CRUD 수준에 머물고 있어 다음 문제가 있다.

1. **분류 없음**: 동일 용어가 분야마다 다른 의미를 가질 수 있으나 도메인 구분이 없음
2. **관리 부재**: 아무나 직접 수정 가능한 구조 (POST/PATCH/DELETE 라우터 미구현)
3. **정적 데이터**: 용어가 어느 문서에서 쓰이는지, 관련 용어가 무엇인지 그래프화 불가
4. **LLM 단절**: chunker가 용어 데이터를 읽지 않아 LLM 컨텍스트에 분야 어휘가 미반영

본 사이클에서는 위 4가지 문제를 동시에 해결하는 인프라 기반 계층을 구축한다.

### 1.2 Out of Scope

- 그래프 시각화 UI (D3 렌더링) — v5 로드맵 (향후 사이클)
- AI 보조 정의 초안 생성 (LLM 자동 제안) — v2 로드맵
- 자동 동의어 / 다국어 매핑 — v3 로드맵
- 외부 온톨로지 연동 (Wikidata, schema.org) — v4 로드맵
- 용어 페이지 편집 UI 풀 구현 — backend API만 (웹 UI는 별도 사이클)
- 다국어 full-text search 엔진 튜닝 — 기본 ILIKE 수준만

### 1.3 Decisions (사용자 확정 사항)

| # | 결정 | 값 |
|---|---|---|
| 1 | 어휘 단위 (a) | 1줄 정의: `terms` row 한 줄 정의만 |
| 2 | 어휘 단위 (b) | 중요 용어 페이지: 별도 `documents` 문서로 연결 (`page_doc_id`) |
| 3 | 어휘 단위 (c) | 분야별 분류: `domain` / `subdomain` 컬럼으로 카테고리화 |
| 4 | 등록 권한 | 누구나 제안 가능, admin 승인 필수 (모더레이션 워크플로우) |
| 5 | 핵심 목표 | 어휘 → 문서 → 그래프 → 데이터 자가증식 사이클 |
| 6 | 마이그레이션 번호 | 0046 (0045가 signup) — 새 발견 시 0047로 조정 |
| 7 | (term, domain) UNIQUE | 동일 분야 내 동일 용어 중복 방지 |
| 8 | status 값 | `proposed` / `approved` / `rejected` / `deprecated` |
| 9 | aliases 저장 방식 | `aliases TEXT[]` 컬럼 (정규화 별도 테이블 아님, v1 단순화) |
| 10 | LLM toolkit 연결 | `chunker.py` 에 `_chunks_from_glossary()` 추가 |
| 11 | 분야 마스터 | `term_domains` 테이블 (계층 지원, parent_id nullable) |

---

## 2. Functional Requirements

### 2.1 엔드포인트 목록

| # | Method | Path | 인증 레벨 | 책임 |
|---|--------|------|----------|------|
| FR-01 | POST | `/api/v1/glossary/propose` | 로그인 사용자 | 새 용어 제안 |
| FR-02 | GET | `/api/v1/glossary` | Public | 용어 목록 (검색/필터/분야별) |
| FR-03 | GET | `/api/v1/glossary/term/{term}` | Public | 단일 용어 조회 (term text or id) |
| FR-04 | GET | `/api/v1/glossary/pending` | admin | 승인 대기 목록 |
| FR-05 | POST | `/api/v1/glossary/{id}/approve` | admin | 용어 승인 |
| FR-06 | POST | `/api/v1/glossary/{id}/reject` | admin | 용어 거부 (reason 기록) |
| FR-07 | PATCH | `/api/v1/glossary/{id}` | admin | 직접 용어 수정/등록 |
| FR-08 | PATCH | `/api/v1/glossary/proposals/{id}` | editor+ (본인만) | 자기 제안 수정 (pending 상태일 때만) |
| FR-09 | DELETE | `/api/v1/glossary/proposals/{id}` | editor+ (본인만) | 자기 제안 취소 |
| FR-10 | GET | `/api/v1/domains` | Public | 분야 마스터 목록 (트리 구조) |
| FR-11 | POST | `/api/v1/domains` | admin | 새 분야 생성 |
| FR-12 | GET | `/api/v1/graph/terms/{id}` | 로그인 사용자 | 용어 관련 문서 + 관련 용어 그래프 |
| FR-13 | POST | `/api/v1/glossary/import` | admin | CSV 분야별 일괄 적재 |

### 2.2 권한 매트릭스

| 액션 | anonymous | reader | editor | admin |
|------|:---------:|:------:|:------:|:-----:|
| GET /glossary (approved만 노출) | O | O | O | O |
| GET /glossary/term/{term} | O | O | O | O |
| GET /domains | O | O | O | O |
| POST /glossary/propose | X | O | O | O |
| PATCH /glossary/proposals/{id} (본인) | X | O | O | O |
| DELETE /glossary/proposals/{id} (본인) | X | O | O | O |
| GET /graph/terms/{id} | X | O | O | O |
| GET /glossary/pending | X | X | X | O |
| POST /glossary/{id}/approve | X | X | X | O |
| POST /glossary/{id}/reject | X | X | X | O |
| PATCH /glossary/{id} | X | X | X | O |
| POST /domains | X | X | X | O |
| POST /glossary/import | X | X | X | O |

### 2.3 Request / Response 예시

**FR-01: 용어 제안**

```json
POST /api/v1/glossary/propose
Authorization: Bearer <token>

{
  "term": "트랜스포머",
  "definition": "어텐션 메커니즘만으로 구성된 시퀀스-to-시퀀스 모델 아키텍처.",
  "domain": "ml",
  "subdomain": "nlp",
  "term_en": "Transformer",
  "aliases": ["어텐션 모델", "Attention-based Model"]
}
```

응답 (202 Accepted):
```json
{
  "data": {
    "id": "550e8400-...",
    "term": "트랜스포머",
    "status": "proposed",
    "proposed_by": "user-uuid",
    "proposed_at": "2026-05-17T09:00:00Z"
  }
}
```

**FR-05: 승인**

```json
POST /api/v1/glossary/{id}/approve
Authorization: Bearer <admin-token>

{}
```

응답 (200):
```json
{
  "data": {
    "id": "550e8400-...",
    "status": "approved",
    "approved_by": "admin-uuid",
    "approved_at": "2026-05-17T10:00:00Z"
  }
}
```

**FR-06: 거부**

```json
POST /api/v1/glossary/{id}/reject
Authorization: Bearer <admin-token>

{
  "reason": "이미 '어텐션 모델'로 등록된 동의어와 충돌. 해당 용어에 alias 추가 권장."
}
```

**FR-02: 검색/필터**

```
GET /api/v1/glossary?domain=ml&q=트랜스&status=approved&page=1&size=20
```

응답:
```json
{
  "data": {
    "items": [
      {
        "id": "...",
        "term": "트랜스포머",
        "definition": "...",
        "domain": "ml",
        "subdomain": "nlp",
        "term_en": "Transformer",
        "aliases": ["어텐션 모델"],
        "status": "approved",
        "page_doc_id": null
      }
    ],
    "total": 1,
    "page": 1,
    "size": 20
  }
}
```

**FR-12: 지식그래프 (용어 기준)**

```
GET /api/v1/graph/terms/{id}
```

응답 (D3-friendly):
```json
{
  "data": {
    "center": { "id": "...", "label": "트랜스포머", "type": "term" },
    "nodes": [
      { "id": "doc-uuid-1", "label": "BERT 개요", "type": "document" },
      { "id": "term-uuid-2", "label": "어텐션", "type": "term" }
    ],
    "edges": [
      { "source": "term-uuid", "target": "doc-uuid-1", "rel": "referenced_in" },
      { "source": "term-uuid", "target": "term-uuid-2", "rel": "cooccurs_with" }
    ]
  }
}
```

---

## 3. Non-Functional Requirements

| 항목 | 기준 | 측정 방법 |
|------|------|----------|
| 검색 응답 시간 | < 200ms (10k terms 기준) | pytest + EXPLAIN ANALYZE |
| 그래프 응답 시간 | < 500ms (depth-1 탐색) | pytest |
| 분야 필터 정확도 | (term, domain) UNIQUE 보장 | DB constraint |
| 대량 import | 1,000 rows CSV 30초 이내 | pytest + timeit |
| 권한 오류 | 401/403 표준 envelope | 기존 auth middleware |
| aliases 검색 | ILIKE %query% on aliases 배열 | GIN index on aliases |
| audit | 제안/승인/거부 이벤트 audit_log 기록 | DB 조회 |
| 다국어 검색 | term + term_en 동시 ILIKE | 통합 쿼리 |

---

## 4. 데이터 모델 영향

### 4.1 마이그레이션 SQL — `0046_glossary_extended.py`

```sql
-- ============================================================
-- 1. 분야 마스터 테이블 (계층형)
-- ============================================================
CREATE TABLE term_domains (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT UNIQUE NOT NULL,           -- 'ml', 'network', 'semiconductor'
  name        TEXT NOT NULL,                  -- 'Machine Learning', '네트워크'
  parent_id   UUID REFERENCES term_domains(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 2. terms 테이블 컬럼 추가
-- ============================================================
ALTER TABLE terms
  ADD COLUMN domain        TEXT REFERENCES term_domains(slug) ON DELETE SET NULL,
  ADD COLUMN subdomain     TEXT,
  ADD COLUMN term_en       TEXT,
  ADD COLUMN aliases       TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN status        TEXT NOT NULL DEFAULT 'approved'
                             CHECK (status IN ('proposed','approved','rejected','deprecated')),
  ADD COLUMN proposed_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN approved_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN rejected_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN reject_reason TEXT,
  ADD COLUMN proposed_at   TIMESTAMPTZ,
  ADD COLUMN approved_at   TIMESTAMPTZ,
  ADD COLUMN page_doc_id   UUID REFERENCES documents(id) ON DELETE SET NULL;

-- (term, domain) 복합 UNIQUE: 같은 분야 내 동일 용어 중복 방지
-- NULL domain은 UNIQUE 체크 제외 (PostgreSQL NULL != NULL)
CREATE UNIQUE INDEX terms_term_domain_uidx
  ON terms (term, domain)
  WHERE domain IS NOT NULL;

-- 검색 성능: aliases GIN 인덱스
CREATE INDEX terms_aliases_gin ON terms USING GIN (aliases);

-- 다국어 검색 인덱스
CREATE INDEX terms_term_en_idx ON terms (lower(term_en));

-- status 필터 인덱스
CREATE INDEX terms_status_idx ON terms (status);

-- ============================================================
-- 3. 제안 히스토리 테이블 (이력 보존)
-- ============================================================
CREATE TABLE term_proposals (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  term_id      UUID REFERENCES terms(id) ON DELETE CASCADE,
  action       TEXT NOT NULL CHECK (action IN ('propose','approve','reject','edit','deprecate')),
  actor_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  payload      JSONB,                -- 변경 전 스냅샷
  reason       TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 4. 기존 terms rows 백필
-- ============================================================
UPDATE terms
  SET status = 'approved',
      domain = 'general'
  WHERE status IS NULL OR status = '';

-- ============================================================
-- 5. 분야 마스터 Seed (초기 5개)
-- ============================================================
INSERT INTO term_domains (slug, name) VALUES
  ('general',      '일반'),
  ('ml',           'Machine Learning'),
  ('network',      '네트워크'),
  ('semiconductor','반도체'),
  ('ev',           '전기차')
ON CONFLICT (slug) DO NOTHING;
```

**rollback (down):**
```sql
DROP INDEX IF EXISTS terms_term_domain_uidx;
DROP INDEX IF EXISTS terms_aliases_gin;
DROP INDEX IF EXISTS terms_term_en_idx;
DROP INDEX IF EXISTS terms_status_idx;
DROP TABLE IF EXISTS term_proposals;
ALTER TABLE terms
  DROP COLUMN IF EXISTS domain,
  DROP COLUMN IF EXISTS subdomain,
  DROP COLUMN IF EXISTS term_en,
  DROP COLUMN IF EXISTS aliases,
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS proposed_by,
  DROP COLUMN IF EXISTS approved_by,
  DROP COLUMN IF EXISTS rejected_by,
  DROP COLUMN IF EXISTS reject_reason,
  DROP COLUMN IF EXISTS proposed_at,
  DROP COLUMN IF EXISTS approved_at,
  DROP COLUMN IF EXISTS page_doc_id;
DROP TABLE IF EXISTS term_domains;
```

### 4.2 ER 다이어그램 (텍스트)

```
term_domains
  id (PK)
  slug UNIQUE
  name
  parent_id → term_domains.id (자기참조, nullable)

terms
  id (PK)
  term UNIQUE NOT NULL
  definition NOT NULL
  related_docs UUID[]          ← 기존 유지
  domain → term_domains.slug  ← 신규
  subdomain TEXT               ← 신규
  term_en TEXT                 ← 신규
  aliases TEXT[]               ← 신규
  status TEXT                  ← 신규
  proposed_by → users.id       ← 신규
  approved_by → users.id       ← 신규
  rejected_by → users.id       ← 신규
  reject_reason TEXT           ← 신규
  proposed_at TIMESTAMPTZ      ← 신규
  approved_at TIMESTAMPTZ      ← 신규
  page_doc_id → documents.id   ← 신규

term_proposals
  id (PK)
  term_id → terms.id
  action TEXT
  actor_id → users.id
  payload JSONB
  reason TEXT
  created_at

(기존)
documents
  id (PK)
  ...

users
  id (PK)
  ...
```

### 4.3 백필 전략

1. 기존 `terms` rows: `status='approved'`, `domain='general'`, `proposed_at=created_at (없으면 now())`
2. 기존 `related_docs` 배열: 유지 (변경 없음)
3. `term_domains` seed 5개 실행 후 backfill 실행 순서 보장 (마이그레이션 트랜잭션 내)

---

## 5. UX 흐름

### 5.1 제안 → 승인 Happy Path (시퀀스)

```
사용자 (editor)                  시스템 (API)              admin
      |                              |                       |
      | 문서 편집 중 [[새용어]] 입력  |                       |
      |----------------------------->|                       |
      |                 wiki_link_extractor: 미등록 감지      |
      |<-- "이 용어를 사전에 제안하시겠어요?" 모달 --         |
      |                              |                       |
      | 제안 폼 입력                  |                       |
      | (term/definition/domain/aliases)                     |
      |----------------------------->|                       |
      |         POST /glossary/propose                       |
      |                  INSERT terms (status=proposed)      |
      |                  INSERT term_proposals (action=propose)
      |                  audit_log 기록                      |
      |<-- 202: "제안이 접수되었습니다" --                   |
      |                              |                       |
      |                              | in-app 알림 (admin)   |
      |                              |---------------------> |
      |                              |                       |
      |                              |     GET /glossary/pending
      |                              |<--------------------- |
      |                              |     pending 목록 반환  |
      |                              |---------------------> |
      |                              |                       |
      |                              |  POST /glossary/{id}/approve
      |                              |<--------------------- |
      |                  UPDATE terms SET status=approved    |
      |                  INSERT term_proposals (action=approve)
      |                  audit_log 기록                      |
      |                              |---------------------> |
      |                              |                       |
      | (사용자 알림: 제안 승인됨)    |                       |
      |<-- in-app notification ------                        |
      |                              |                       |
      | [[새용어]] 링크 자동 활성화   |                       |
```

### 5.2 admin 대시보드 — Pending 목록 와이어프레임

```
┌─────────────────────────────────────────────────────────────────┐
│  어휘 사전 관리 > 승인 대기 (12건)                               │
├─────┬──────────────┬───────────┬──────────┬────────────┬────────┤
│  #  │  용어         │  분야     │  제안자  │  제안일    │  액션  │
├─────┼──────────────┼───────────┼──────────┼────────────┼────────┤
│  1  │ 트랜스포머    │ ML / NLP  │ 김철수   │ 2026-05-15 │ 승인 / 거부 │
│  2  │ GaN 소자      │ 반도체    │ 이영희   │ 2026-05-16 │ 승인 / 거부 │
│  3  │ 셀 밸런싱     │ 전기차    │ 박민준   │ 2026-05-17 │ 승인 / 거부 │
├─────┴──────────────┴───────────┴──────────┴────────────┴────────┤
│  [전체 승인]  [선택 승인]  [CSV 내보내기]                        │
└─────────────────────────────────────────────────────────────────┘
```

---

## 6. 모더레이션 정책

### 6.1 라이프사이클 상태 다이어그램

```
                    제안자 제출
                        │
                        ▼
                  ┌──────────┐
                  │ proposed │◄────────── 재제안 (거부 후)
                  └──────────┘
                   │        │
             admin 승인  admin 거부
                   │        │
                   ▼        ▼
            ┌──────────┐ ┌──────────┐
            │ approved │ │ rejected │
            └──────────┘ └──────────┘
                   │
            admin deprecated
                   │
                   ▼
            ┌────────────┐
            │ deprecated │  (소프트 삭제, 검색 제외)
            └────────────┘
```

### 6.2 상태별 처리 규칙

| 상태 | 검색 노출 | 위키링크 활성 | 수정 가능 주체 | 비고 |
|------|:---------:|:-------------:|---------------|------|
| proposed | X | X | 제안자(본인), admin | admin 승인 대기 |
| approved | O | O | admin | 일반 검색에 노출 |
| rejected | X | X | 제안자 (재제안만) | reason 텍스트 반환 |
| deprecated | X | X | admin | hard delete 대신 |

### 6.3 거부 / 재제안 룰

- 거부 시 `reject_reason` 필수 (없으면 422)
- 거부된 용어는 `status=rejected`로 유지, 제안자가 조회하면 reason 노출
- 재제안: 제안자는 rejected 용어를 수정 후 다시 submit 가능 → `status=proposed`로 변경
- 재제안 시 `term_proposals` 에 `action=propose` 재기록 (히스토리 보존)

### 6.4 동일 용어 중복 제안 처리

- `(term, domain)` UNIQUE index가 DB 레벨에서 차단
- proposed 상태 row가 이미 있을 때 동일 (term, domain)으로 제안 시 → 409 "이미 제안 중인 용어입니다. 기존 제안에 +1 하거나 기다려 주세요."
- 다른 domain으로 같은 term 제안은 허용 (ML의 '커널' vs 운영체제의 '커널')

### 6.5 비활성화 정책

- `status='deprecated'`: 검색·위키링크 제외. 기존 `related_docs` 배열은 유지
- hard delete는 admin 전용 (API 미구현, DB 직접 또는 별도 admin 툴)
- 문서에 `[[용어]]`가 있어도 deprecated면 링크 비활성화 (glossary-ref 위젯 처리)

---

## 7. 지식그래프 노출

### 7.1 기존 links_graph.py 확장

기존 `GET /graph/documents/{id}` 응답에 `referenced_terms` 필드 추가:

```json
{
  "data": {
    "document": { "id": "...", "title": "..." },
    "links": [...],
    "referenced_terms": [
      { "id": "term-uuid", "term": "트랜스포머", "domain": "ml" }
    ]
  }
}
```

`wiki_link_extractor.py`가 파싱한 `[[term]]` 목록 → `terms` 테이블에서 approved 항목만 조회 후 반환.

### 7.2 새 엔드포인트

**FR-12: `GET /api/v1/graph/terms/{id}`**

| 필드 | 설명 |
|------|------|
| `center` | 요청 용어 노드 |
| `nodes` | 이 용어를 사용하는 문서 노드 + 공출현 용어 노드 |
| `edges` | `referenced_in` (term→doc), `cooccurs_with` (term→term) |

공출현(cooccurrence): 동일 문서에서 함께 등장하는 두 용어 — `related_docs` 배열 교집합 기반.

### 7.3 노드 / 엣지 종류

| 노드 타입 | id 출처 | label | 색상 힌트 |
|----------|---------|-------|----------|
| `term` | terms.id | terms.term | #4A90E2 |
| `document` | documents.id | documents.title | #7ED321 |

| 엣지 rel | 방향 | 의미 |
|----------|------|------|
| `referenced_in` | term → document | 문서에서 이 용어를 위키링크로 참조 |
| `cooccurs_with` | term ↔ term | 같은 문서 내 공출현 (무방향) |
| `has_page` | term → document | `page_doc_id` 연결 (풀 페이지) |

---

## 8. LLM Toolkit 결합

### 8.1 chunker.py 변경

`dist/llm-docx-toolkit/chunker.py`에 `_chunks_from_glossary()` 함수 추가:

```python
def _chunks_from_glossary(db_session) -> list[Chunk]:
    """approved terms를 읽어 LLM 컨텍스트용 chunk 생성."""
    terms = db_session.execute(
        "SELECT term, definition, domain, subdomain, term_en, aliases "
        "FROM terms WHERE status = 'approved' ORDER BY domain, term"
    ).fetchall()
    chunks = []
    for t in terms:
        text = f"[{t.domain or 'general'}] {t.term}"
        if t.term_en:
            text += f" ({t.term_en})"
        text += f": {t.definition}"
        if t.aliases:
            text += f" (별칭: {', '.join(t.aliases)})"
        chunks.append(Chunk(source="glossary", key=str(t.term), text=text))
    return chunks
```

### 8.2 TRACKED_SOURCES drift 가드 통합

기존 4계층 drift 가드에 glossary hash 추가:

```python
TRACKED_SOURCES = {
    "documents": hash_table("documents"),
    "glossary":  hash_table("terms", filter="status='approved'"),  # 신규
    ...
}
```

승인된 용어가 추가/변경될 때마다 hash 변경 → LLM toolkit이 자동 재인덱싱 트리거.

### 8.3 llm-input-rules.md 업데이트

```markdown
## 어휘 사전 활용
- 현재 {N}개의 분야 어휘가 인덱싱되어 있습니다 (approved 기준).
- 본문 작성 시 `[[용어명]]` 형식으로 위키링크를 사용하면 독자가 용어 정의를
  즉시 확인할 수 있습니다.
- 새로운 전문 용어를 발견하면 glossary 제안 API를 통해 등록을 요청하세요.
```

### 8.4 wiki_link_extractor.py alias 확장

현재 `[[term]]` 매칭은 exact term만 인식. aliases 배열도 매칭하도록 쿼리 확장:

```sql
SELECT id, term FROM terms
WHERE status = 'approved'
  AND (term = :link_text OR :link_text = ANY(aliases))
```

---

## 9. 마이그레이션 / Seed 전략

### 9.1 단계별 적용 순서

| 단계 | 작업 | 검증 |
|------|------|------|
| 1 | `0046_glossary_extended.py` alembic upgrade | `alembic current` 확인 |
| 2 | `term_domains` seed 5개 INSERT | `SELECT count(*) FROM term_domains` = 5 |
| 3 | 기존 `terms` rows 백필 (`status=approved, domain=general`) | `SELECT count(*) FROM terms WHERE status IS NULL` = 0 |
| 4 | GIN index 생성 완료 대기 | `\d terms` 에서 index 확인 |
| 5 | 라우터 배포 | 헬스체크 + smoke test |
| 6 | chunker.py 업데이트 + LLM toolkit 재인덱싱 | drift guard hash 변경 확인 |

### 9.2 CSV import 포맷

`POST /api/v1/glossary/import` 에서 받는 CSV:

```csv
term,definition,domain,subdomain,term_en,aliases
트랜스포머,"어텐션 메커니즘만으로...",ml,nlp,Transformer,"어텐션 모델|Attention Model"
GaN 소자,"질화갈륨 반도체...",semiconductor,power,,
```

- `aliases`: `|` 구분자로 복수 개 입력
- 이미 (term, domain) 존재하면 skip + 로그 (upsert 아님, 안전 우선)
- 결과: `{ imported: N, skipped: M, errors: [...] }` 반환

### 9.3 Rollback 계획

```bash
# alembic downgrade
apptainer exec instance://mxwp_api bash -lc \
  'cd /workspace/apps/api && alembic downgrade 0045'
```

- `term_proposals` 테이블 drop (데이터 손실 — 히스토리만, 본 데이터 아님)
- `terms` 추가 컬럼 drop (기존 term/definition/related_docs는 유지)
- `term_domains` drop

---

## 10. 테스트 전략

### 10.1 케이스 매트릭스

| 케이스 | 입력 | 예상 결과 |
|--------|------|----------|
| Happy path: 제안→승인 | reader가 propose, admin이 approve | status=approved, wiki link 활성 |
| 권한: anonymous propose | 미인증 POST /propose | 401 |
| 권한: reader approve | reader가 POST /approve | 403 |
| 권한: 본인 제안 수정 | pending 상태 본인 PATCH | 200 |
| 권한: 타인 제안 수정 | pending 상태 타인 PATCH | 403 |
| 중복 제안 (같은 domain) | 동일 (term, domain) 재제안 | 409 |
| 다른 domain 같은 term | ML '커널' vs OS '커널' | 각각 201 허용 |
| 거부 후 재제안 | rejected → 수정 → propose | status=proposed 재기록 |
| alias 위키링크 | `[[어텐션 모델]]` 입력 | terms.aliases 매칭 |
| 분야 필터 검색 | GET /glossary?domain=ml | ml 분야만 반환 |
| 다국어 검색 | GET /glossary?q=Transformer | term_en 매칭 |
| deprecated 용어 | wiki link에 deprecated 용어 | 링크 비활성 (위젯 처리) |
| CSV import 정상 | 10행 CSV, 중복 2행 | imported:8, skipped:2 |
| CSV import 에러 | domain 없는 행 | error 항목 기록, 나머지 처리 |
| 그래프 조회 | GET /graph/terms/{id} | nodes/edges D3 포맷 |
| 거부 reason 누락 | reject body 없음 | 422 |

### 10.2 테스트 파일 구조

```
tests/
  test_glossary_propose.py      # FR-01, FR-08, FR-09
  test_glossary_admin.py        # FR-04, FR-05, FR-06, FR-07
  test_glossary_search.py       # FR-02, FR-03, FR-10
  test_glossary_graph.py        # FR-12
  test_glossary_import.py       # FR-13
  test_wiki_link_aliases.py     # alias 위키링크 매핑
```

---

## 11. 진화 경로

| 버전 | 범위 | 본 사이클 포함 |
|------|------|:-----------:|
| **v1** | 기본 모더레이션 + 분야 분류 + 위키링크 alias + 그래프 기초 + LLM toolkit 연결 | **O** |
| **v2** | AI 보조 정의 초안 제안 (LLM이 definition 초안 생성, human-in-the-loop) | X |
| **v3** | 자동 동의어 / 다국어 매핑 (embedding 기반 유사어 탐지) | X |
| **v4** | 외부 온톨로지 연동 (Wikidata, schema.org) | X |
| **v5** | 그래프 시각화 UI (D3 렌더링, 인터랙티브 탐색) | X |

v1 완료 기준: 13번 Acceptance Criteria 전체 통과.

---

## 12. 위험 / 미확정 사항

| 위험 | 영향 | 완화 전략 |
|------|------|----------|
| 분야 수 100+ 시 카테고리 관리 부담 | 중간 | `term_domains.parent_id` 트리 구조로 2-depth 계층 도입 (v1에서 스키마만 준비) |
| 같은 분야 내 동일 용어 중복 제안 자동 dedupe | 낮음 | DB UNIQUE constraint + 409 응답으로 충분, 자동 통합은 v2 |
| LLM 잘못된 정의 생성 (v2 추가 시) | 높음 | human-in-the-loop 필수, admin 승인 없이 auto-approve 금지 |
| 대량 import 10k+ terms 성능 | 중간 | batched INSERT (500 rows/batch) + async task, 30초 timeout |
| `wiki_link_extractor.py` alias 처리 미구현 | 낮음 | 본 사이클에서 쿼리 확장 (Section 8.4) |
| `glossary-ref` 위젯의 deprecated 처리 | 낮음 | 위젯 조회 시 status 체크 추가 (Section 6.5) |
| `in-app notification` 인프라 미비 | 중간 | 알림 인프라 없으면 audit_log만 기록, 알림은 후속 |
| `related_docs` 배열과 `term_proposals` 이력 동기화 | 낮음 | `related_docs`는 wiki_link_extractor가 관리, 별도 sync 불필요 |

**미확정 사항:**
1. `in-app notification` 인프라 존재 여부 — 설계 단계에서 확인 후 알림 구현 범위 결정
2. chunker.py DB 접근 방식 (직접 쿼리 vs API 호출) — 현재 toolkit 아키텍처 확인 필요
3. glossary-ref 위젯의 클라이언트 사이드 렌더링 방식 — design 단계에서 확정

---

## 13. Acceptance Criteria

본 사이클 완료 조건 (모두 충족해야 Complete):

| # | 조건 | 검증 방법 |
|---|------|----------|
| AC-01 | `0046_glossary_extended.py` 마이그레이션 정상 up/down | `alembic upgrade head && alembic downgrade -1` 에러 없음 |
| AC-02 | `POST /glossary/propose` 로 로그인 사용자가 용어 제안 가능 | curl 또는 pytest |
| AC-03 | `POST /glossary/{id}/approve` admin 승인 시 status=approved 변경 | pytest |
| AC-04 | `POST /glossary/{id}/reject` 거부 + reason 기록 | pytest |
| AC-05 | approved 용어만 `GET /glossary` 에 노출 (proposed/rejected 제외) | pytest |
| AC-06 | `domain` 필터 + `q` 검색 (term, term_en, aliases 포함) 정상 동작 | pytest |
| AC-07 | (term, domain) UNIQUE constraint — 동일 분야 중복 제안 409 | pytest |
| AC-08 | `[[aliases]]` 위키링크가 aliases 배열을 통해 매칭됨 | pytest |
| AC-09 | `GET /graph/terms/{id}` — D3 포맷 nodes/edges 반환 | pytest + 응답 스키마 검증 |
| AC-10 | `GET /graph/documents/{id}` 응답에 `referenced_terms` 추가 | pytest |
| AC-11 | chunker.py `_chunks_from_glossary()` 함수 존재, approved terms 반환 | pytest |
| AC-12 | `POST /glossary/import` CSV 10행 import, 중복 skip 동작 | pytest |
| AC-13 | 권한 매트릭스 전체 통과 (anonymous/reader/editor/admin) | pytest 권한 케이스 |
| AC-14 | 모든 제안/승인/거부 이벤트가 `audit_log` + `term_proposals` 기록 | pytest + DB 조회 |
| AC-15 | deprecated 용어: 검색 제외, 위키링크 비활성 | pytest |
| AC-16 | `docs/lat/` 중 영향 받는 문서 (glossary, documents, export) 업데이트 | 문서 리뷰 |

---

## 관련 문서

- Design: `docs/02-design/features/glossary-knowledge-graph.design.md` (미작성)
- lat 참조: `docs/lat/documents.md`, `docs/lat/core.md`
- 기존 Plan 참고: `docs/01-plan/features/signup.plan.md`
- LLM toolkit: `dist/llm-docx-toolkit/`

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-05-17 | Initial draft | PM Agent |
