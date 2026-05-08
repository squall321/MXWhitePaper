---
template: design
version: 1.2
feature: MX-WhitePaper
date: 2026-05-06
author: squall321@gmail.com
project: MX White Paper (사업부 지식 창고)
project_version: 0.1.0
---

# MX-WhitePaper Design Document

> **Summary**: 1/1.1/1.1.1 계층 + Block 기반 위젯 본문을 갖는 나무위키 스타일 지식 창고. JSON-First REST API와 BlockNote 에디터, 자연스러운 이미지·캡션 업로드 UX를 핵심 설계 요소로 한다.
>
> **Project**: MX White Paper
> **Version**: 0.1.0
> **Author**: squall321@gmail.com
> **Date**: 2026-05-06
> **Status**: Draft
> **Planning Doc**: [MX-WhitePaper.plan.md](../../01-plan/features/MX-WhitePaper.plan.md)
> **Master Plan**: [PROJECT_PLAN.md](../../../PROJECT_PLAN.md)

### Pipeline References (if applicable)

| Phase | Document | Status |
|-------|----------|--------|
| Phase 1 | [Schema Definition](../../01-plan/schema.md) | ❌ (본 문서 §3에 통합) |
| Phase 2 | [Coding Conventions](../../01-plan/conventions.md) | ❌ (본 문서 §10에 통합) |
| Phase 3 | [Mockup](../mockup/MX-WhitePaper.md) | ❌ (Sprint 3 산출 예정) |
| Phase 4 | [API Spec](../api/MX-WhitePaper.md) | ❌ (본 문서 §4 + OpenAPI 자동 생성) |

---

## 1. Overview

### 1.1 Design Goals

1. **JSON-First**: DocumentJSON v1.0이 단일 진실 공급원(SSOT). 모든 API I/O는 이 스키마 그대로. 추후 LLM/Word 변환 통합 비용 최소화
2. **계층 안정성**: 1/1.1/1.1.1 3단계 강제 + 자동 번호 매김으로 TOC 가독성 보장
3. **Block 자유도**: 본문은 Block 배열. 텍스트/표/차트/이미지/영상이 1급 객체로 동등하게 조작
4. **에디터 우선**: 작성 비용 최소화가 시스템 성패. Section 단위 빠른 편집 + 슬래시 커맨드 + 인라인 캡션
5. **타입 단일화**: `packages/shared/schemas/document.json`(JSON Schema)에서 TS 타입 + Pydantic 모델 자동 생성. 프론트-백 타입 드리프트 0
6. **크로스 플랫폼 (Apptainer)**: `.def` 파일 + `apptainer instance start` 스크립트로 Linux/HPC 어디서나 동일 `.sif` 실행. root 불필요, host network 모드

### 1.2 Design Principles

- **Single Source of Truth**: 스키마, 환경 변수, 디자인 토큰 모두 단일 소스
- **Read-Heavy Optimized**: 캐시·CDN·인덱스 우선. 쓰기 < 1% 가정
- **Progressive Disclosure**: 빠른 편집(섹션) → 전체 편집(구조 변경) 단계적 노출
- **Fail-Fast Validation**: Pydantic v2 + Zod 동일 스키마로 양단 검증
- **Optimistic UI**: 자동 저장은 낙관적, 충돌은 명시적 머지 UX

---

## 2. Architecture

### 2.1 Component Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                         Browser (사내 사용자)                          │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  React SPA (Vite build)                                        │  │
│  │  - Article Reader  - Block Editor (BlockNote)                  │  │
│  │  - Outline Panel   - Search UI                                 │  │
│  └────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ HTTPS (사내망)
                ┌───────────────▼─────────────────┐
                │  Nginx (TLS, static, proxy)     │
                └───┬────────────────────┬────────┘
                    │                    │
            ┌───────▼─────────┐  ┌───────▼─────────────────┐
            │  Static Assets  │  │  FastAPI App            │
            │  (Vite output)  │  │  - REST /api/v1/*       │
            └─────────────────┘  │  - Auth (JWT middleware)│
                                 │  - WikiLink parser      │
                                 │  - Image processor      │
                                 └─┬───────┬───────┬───────┘
                                   │       │       │
                    ┌──────────────▼┐  ┌───▼───┐  ┌▼──────────────┐
                    │ PostgreSQL 15+│  │Meili- │  │  MinIO        │
                    │ (JSONB+pgvec) │  │search │  │  (S3 호환)     │
                    │ - documents   │  │       │  │  - images/    │
                    │ - sections*   │  │ index │  │  - files/     │
                    │ - links graph │  │       │  │  WebP+3 sizes │
                    └───────────────┘  └───────┘  └───────────────┘
```

> *sections는 별도 테이블이 아닌 `documents.content_json` JSONB 내부 트리. 단, **검색용 평탄화 뷰**(`documents_flat_v`)를 유지해 Meilisearch 인덱싱과 SQL 검색 효율화.

### 2.2 Data Flow

#### 읽기 Flow (대다수 트래픽)
```
URL /docs/:slug
   ↓
Frontend Router → TanStack Query 캐시 조회
   ↓ (miss)
GET /api/v1/documents/:slug
   ↓
PostgreSQL: documents WHERE slug = :slug
   ↓
ETag 비교 → 변경 없으면 304
   ↓
DocumentJSON 응답 → 클라이언트 렌더(Section 트리 + Block)
   ↓
WikiLink 파서 → 미작성 링크 빨강 / 백링크는 lazy fetch
```

#### 쓰기 Flow (Section 단위)
```
사용자 ✏️ 클릭 (단일 섹션)
   ↓
PATCH /api/v1/documents/:slug/sections/:sectionId
  Body: { blocks: [...], title?, level? }
  Header: If-Match: <etag>
   ↓
서버: Optimistic Locking 검증 (etag/version 미스매치 시 409)
   ↓
JSONB 부분 업데이트 + version++ + audit_log + 새 document_versions row
   ↓
WikiLink 추출 → links 테이블 갱신
   ↓
Meilisearch 인덱싱 (비동기 큐)
   ↓
응답: 새 etag + 갱신된 section
```

#### 이미지 업로드 Flow (Sprint 5 핵심)
```
[클라이언트]
드래그/붙여넣기/슬래시 커맨드
   ↓
1. POST /api/v1/uploads/image/init
   Body: { filename, mimeType, sha256, size }
   ↓
2. 서버: 중복 체크(sha256) → 있으면 기존 imageId 반환(Skip 4-6)
   없으면 presigned PUT URL 발급
   ↓
3. 클라이언트: PUT presigned URL (직접 MinIO로 업로드)
   ↓
4. POST /api/v1/uploads/image/finalize
   Body: { uploadId }
   ↓
5. 서버 (백그라운드 워커):
   - EXIF 제거 (privacy)
   - WebP 변환 (3 sizes: thumb 320 / view 1024 / orig)
   - dominant color 추출 (placeholder)
   - alt 텍스트 input flag (WCAG)
   ↓
6. 응답: { imageId, urls: { thumb, view, orig }, dominantColor }
   ↓
[클라이언트] ImageBlock 삽입 + 캡션 placeholder 포커스
   - Enter: 캡션 확정
   - Tab: alt 텍스트 입력 이동
   - Esc: 캡션 빈 상태로 확정
```

### 2.3 Dependencies

| Component | Depends On | Purpose |
|-----------|-----------|---------|
| Frontend SPA | FastAPI REST, Static CDN | UI |
| FastAPI App | PostgreSQL, MinIO, Meilisearch | API/비즈니스 로직 |
| Image Worker | MinIO, PostgreSQL | 비동기 이미지 변환 |
| Search Indexer | PostgreSQL, Meilisearch | 변경 이벤트 → 인덱스 갱신 |
| `packages/shared` | (없음) | 스키마 SSOT — TS/Python 자동 생성 |

---

## 3. Data Model

### 3.1 DocumentJSON v1.0 (논리 모델) — **SSOT**

> **본 §3.1은 DocumentJSON v1.0의 단일 진실 공급원(SSOT)이다.** PROJECT_PLAN.md §3.3의 예시는 참고용이며, 본 정의와 충돌 시 본 §3.1이 우선한다. 정식 JSON Schema 파일은 Sprint 0에서 `packages/shared/schemas/document.json`으로 작성한다.

```typescript
// packages/shared/schemas/document.json (JSON Schema 2020-12)
// 아래는 자동 생성된 TS 타입의 발췌

interface Document {
  schema_version: '1.0';
  id: string;                  // ULID
  slug: string;                // url-safe, unique
  title: string;
  summary?: string;
  metadata: DocumentMeta;
  infobox?: Record<string, string | string[]>;
  sections: Section[];          // 최상위 = level 1만
  related_documents: { slug: string; relation: string }[];
  glossary: { term: string; definition: string }[];
  references: { type: 'internal'|'external'; label: string; url?: string }[];
  see_also: string[];           // slug list
}

interface DocumentMeta {
  division: string;
  team?: string;
  group?: string;
  part?: string;
  owners: string[];             // user ids
  reviewers?: string[];
  tags: string[];
  category?: string;
  confidentiality: 'public'|'internal'|'restricted';
}

interface Section {
  id: string;                   // ULID, 안정 ID (편집 추적용)
  number: string;               // 자동 계산 ('1', '1.1', '1.1.1')
  level: 1 | 2 | 3;
  title: string;
  blocks: Block[];
  subsections: Section[];
}

type Block =
  | ParagraphBlock | HeadingBlock | ListBlock | QuoteBlock | CalloutBlock | CodeBlock
  | MathBlock                                                              // KaTeX (Phase 2)
  | TableBlock | KpiCardsBlock
  | ChartBlock | GanttBlock | FlowBlock | OrgChartBlock                    // OrgChart (Phase 2)
  | IframeBlock | VideoBlock
  | ImageBlock | GalleryBlock | FileBlock
  | DocLinkCardBlock | GlossaryRefBlock
  | ColumnsBlock | TabsBlock | AccordionBlock
  | DataSourceBlock | DashboardEmbedBlock | CalculatorBlock;               // Phase 3 동적

interface BlockBase {
  id: string;                   // ULID
  type: string;
  meta?: { align?: 'left'|'center'|'right'|'full'; collapsed?: boolean; locked?: boolean };
}
interface ParagraphBlock extends BlockBase { type: 'paragraph'; text: string; }  // markdown + [[..]]
interface ImageBlock extends BlockBase {
  type: 'image';
  imageId: string;              // FK to images table
  caption?: string;
  alt?: string;
  width?: 'sm'|'md'|'lg'|'full'; // 25/50/75/100
  link?: string;                // optional click-through
}
interface GalleryBlock extends BlockBase {
  type: 'gallery';
  layout: 'grid'|'carousel';
  items: { imageId: string; caption?: string; alt?: string }[];
}
interface ChartBlock extends BlockBase {
  type: 'chart';
  chartType: 'line'|'bar'|'pie'|'area'|'radar'|'scatter';
  title?: string;
  data: { labels: string[]; series: { name: string; values: number[] }[] };
  options?: Record<string, unknown>;
}
interface TableBlock extends BlockBase {
  type: 'table';
  headers: string[];
  rows: string[][];             // markdown 셀(굵게/링크)
  options?: { sortable?: boolean; searchable?: boolean };
}
interface MathBlock extends BlockBase {       // Phase 2 (KaTeX)
  type: 'math';
  expression: string;           // LaTeX
  display: 'block'|'inline';
}
interface OrgChartBlock extends BlockBase {   // Phase 2
  type: 'org-chart';
  root: { id: string; label: string; role?: string; children?: OrgChartBlock['root'][] };
  layout?: 'tree'|'horizontal';
}
// ... (전체 Block 타입은 packages/shared/schemas/document.json 참조)
```

#### Section 자동 번호 매김 규칙
- 서버 측에서 저장 시 `sections` 트리를 재귀 순회하며 `number` 재계산
- level 검증: 자식 level은 부모 level + 1만 허용. 위반 시 400
- Section은 level=1 한정으로 최상위. level=2/3은 무조건 부모의 `subsections[]`에 포함

### 3.2 DB Schema (PostgreSQL 15+)

```sql
-- 조직 계층
CREATE TABLE divisions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE teams (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id  UUID NOT NULL REFERENCES divisions(id) ON DELETE CASCADE,
  slug         TEXT NOT NULL,
  name         TEXT NOT NULL,
  lead_user_id UUID,
  UNIQUE (division_id, slug)
);

CREATE TABLE groups (
  id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  slug    TEXT NOT NULL,
  name    TEXT NOT NULL,
  UNIQUE (team_id, slug)
);

CREATE TABLE parts (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  slug     TEXT NOT NULL,
  name     TEXT NOT NULL,
  UNIQUE (group_id, slug)
);

-- 문서 본체 (DocumentJSON 그대로 JSONB)
CREATE TABLE documents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         TEXT UNIQUE NOT NULL,
  part_id      UUID REFERENCES parts(id) ON DELETE SET NULL,
  title        TEXT NOT NULL,
  summary      TEXT,
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  content_json JSONB NOT NULL,            -- DocumentJSON v1.0 그대로
  schema_ver   TEXT NOT NULL DEFAULT '1.0',
  version      INT  NOT NULL DEFAULT 1,   -- Optimistic Locking
  owner_id     UUID NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  embedding    VECTOR(1536)               -- pgvector, Phase 4
);
CREATE INDEX idx_documents_part ON documents(part_id);
CREATE INDEX idx_documents_updated ON documents(updated_at DESC);
CREATE INDEX idx_documents_content_gin ON documents USING GIN (content_json jsonb_path_ops);

-- 버전 이력
CREATE TABLE document_versions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id  UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version      INT NOT NULL,
  content_json JSONB NOT NULL,
  edited_by    UUID NOT NULL,
  edited_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  change_log   TEXT,
  UNIQUE (document_id, version)
);

-- 위키 링크 그래프 (양방향 탐색용)
CREATE TABLE links (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_doc_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  target_slug   TEXT NOT NULL,            -- 미작성 가능 → 문자열
  target_doc_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  anchor        TEXT,                     -- section number/id
  link_type     TEXT NOT NULL DEFAULT 'wiki',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_links_source ON links(source_doc_id);
CREATE INDEX idx_links_target_slug ON links(target_slug);
CREATE INDEX idx_links_target_doc ON links(target_doc_id);

-- 태그 (다대다)
CREATE TABLE tags (
  id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL
);
CREATE TABLE document_tags (
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  tag_id      UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (document_id, tag_id)
);

-- 용어집
CREATE TABLE terms (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  term        TEXT NOT NULL,
  definition  TEXT NOT NULL,
  related_docs UUID[] NOT NULL DEFAULT '{}',
  UNIQUE (term)
);

-- 사용자
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,            -- argon2id
  role          TEXT NOT NULL DEFAULT 'reader' CHECK (role IN ('reader','editor','owner','admin')),
  team_id       UUID REFERENCES teams(id) ON DELETE SET NULL,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 이미지 (중복 제거 + 변환 결과 메타)
CREATE TABLE images (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sha256        CHAR(64) UNIQUE NOT NULL,
  original_name TEXT NOT NULL,
  mime_type     TEXT NOT NULL,
  size_bytes    BIGINT NOT NULL,
  width         INT,
  height        INT,
  dominant_color TEXT,
  storage_keys  JSONB NOT NULL,           -- { thumb, view, orig }
  uploaded_by   UUID NOT NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 감사 로그
CREATE TABLE audit_logs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES users(id),
  action     TEXT NOT NULL,                -- 'doc.create','doc.update.section', ...
  target     TEXT NOT NULL,                -- 'document:slug:section_id'
  payload    JSONB,
  ip         INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_audit_created ON audit_logs(created_at DESC);

-- 검색용 평탄화 뷰 (Meilisearch 인덱싱 소스)
CREATE MATERIALIZED VIEW documents_flat_v AS
SELECT
  d.id, d.slug, d.title, d.summary,
  COALESCE(d.content_json->>'title','') AS json_title,
  jsonb_path_query_array(d.content_json, '$.sections[*].title')::TEXT AS section_titles,
  -- 본문 텍스트 추출 (paragraph/heading/quote/callout/list)
  (SELECT string_agg(value, ' ')
     FROM jsonb_path_query(d.content_json,
       'strict $.**.text ? (@ != null)') AS value
  ) AS body_text,
  -- 이미지 캡션/alt
  (SELECT string_agg(coalesce(c, '') || ' ' || coalesce(a, ''), ' ')
     FROM jsonb_path_query(d.content_json,
       'strict $.sections[*]..blocks[*] ? (@.type == "image")') AS img,
       LATERAL (SELECT img->>'caption' AS c, img->>'alt' AS a) v
  ) AS image_text,
  array_agg(DISTINCT t.name) FILTER (WHERE t.name IS NOT NULL) AS tags,
  d.updated_at
FROM documents d
LEFT JOIN document_tags dt ON dt.document_id = d.id
LEFT JOIN tags t ON t.id = dt.tag_id
WHERE d.status = 'published'
GROUP BY d.id;
CREATE UNIQUE INDEX ON documents_flat_v(id);
```

### 3.3 Entity Relationships

```
[Division] 1 ─ N [Team] 1 ─ N [Group] 1 ─ N [Part] 1 ─ N [Document]
                                                          │
                                                          ├─ 1 ─ N [DocumentVersion]
                                                          ├─ 1 ─ N [Link] ─ N ─ 1 [Document]  (target)
                                                          ├─ N ─ N [Tag]
                                                          └─ JSONB content (Sections / Blocks)
                                                                     │
                                                                     └─ ImageBlock ─→ [Image] (sha256 dedup)

[User] 1 ─ N [Document] (owner)
       1 ─ N [AuditLog]
       N ─ 1 [Team]
```

---

## 4. API Specification (REST, JSON-First)

> 베이스 URL: `/api/v1` · 응답은 일관 `{ data, meta?, error? }` 포맷 · OpenAPI는 FastAPI가 자동 export

### 4.1 Endpoint List

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/divisions` / `/teams` / `/groups` / `/parts` | 조직 계층 목록(트리 네비) | Reader+ |
| POST/PUT/DELETE | (조직 계층) | 조직 관리 | Admin |
| GET | `/documents` | 목록(필터: part, tag, q) | Reader+ |
| GET | `/documents/:slug` | 단일 조회 (DocumentJSON) | Reader+ |
| POST | `/documents` | 신규 (DocumentJSON 그대로) | Editor+ |
| PUT | `/documents/:slug` | 전체 교체 (If-Match etag) | Editor+ |
| PATCH | `/documents/:slug/sections/:sectionId` | **Section 단위 부분 수정** | Editor+ |
| PATCH | `/documents/:slug/blocks/:blockId` | **Block 단위 부분 수정** | Editor+ |
| DELETE | `/documents/:slug` | 삭제(soft) | Owner/Admin |
| GET | `/documents/:slug/versions` | 버전 목록 | Reader+ |
| GET | `/documents/:slug/versions/:n` | 특정 버전 | Reader+ |
| GET | `/documents/:slug/backlinks` | 백링크 | Reader+ |
| POST | `/uploads/image/init` | 업로드 시작(presigned 발급) | Editor+ |
| POST | `/uploads/image/finalize` | 업로드 확정(변환 트리거) | Editor+ |
| GET | `/search?q=` | 통합 검색(Meilisearch 프록시) | Reader+ |
| GET | `/glossary?q=` | 용어집 검색 | Reader+ |
| POST | `/auth/login` / `/refresh` / `/logout` | 인증 | Public/Auth |
| GET | `/me` | 내 정보 | Auth |

### 4.2 Detailed Specifications

#### `GET /api/v1/documents/:slug`

**Response (200 OK)**:
```json
{
  "data": {
    "schema_version": "1.0",
    "id": "01J...",
    "slug": "month-end-closing",
    "title": "월결산 프로세스",
    "summary": "...",
    "metadata": { "division": "MX", "team": "재무팀", "tags": ["결산"], ... },
    "sections": [ /* 1/1.1/1.1.1 트리, blocks 포함 */ ]
  },
  "meta": {
    "version": 7,
    "etag": "W/\"01J...-7\"",
    "updated_at": "2026-05-06T03:00:00Z",
    "owners": [{ "id": "u1", "name": "홍길동" }]
  }
}
```

**Headers**:
- `ETag: W/"<id>-<version>"` — Optimistic Locking
- `Cache-Control: private, max-age=60`

#### `POST /api/v1/documents`

**Request** (DocumentJSON 그대로):
```json
{
  "schema_version": "1.0",
  "slug": "month-end-closing",
  "title": "월결산 프로세스",
  "metadata": { "division": "MX", "owners": ["u1"], "tags": ["결산"], "confidentiality": "internal" },
  "sections": [
    { "id": "01J...", "level": 1, "title": "개요",
      "blocks": [{ "id": "01J...", "type": "paragraph", "text": "..." }],
      "subsections": [] }
  ]
}
```

**Response (201)**: 위와 동일 + `Location: /api/v1/documents/month-end-closing`

**Errors**:
- `400`: 스키마 검증 실패(Pydantic detail 포함)
- `409`: slug 중복

#### `PATCH /api/v1/documents/:slug/sections/:sectionId`

**Request**:
```json
{ "title": "월결산 일정", "level": 2, "blocks": [ /* 새 Block 배열 */ ] }
```

**Headers**: `If-Match: W/"<id>-<version>"` (필수)

**Response (200)**:
```json
{ "data": { "section": { /* 업데이트된 섹션 */ } },
  "meta": { "version": 8, "etag": "W/\"...-8\"" } }
```

**Errors**:
- `412 Precondition Failed`: etag 미스매치 → 클라이언트는 충돌 머지 UI 표시
- `400`: level 위반 (자식 level은 부모+1만 허용)

#### `POST /api/v1/uploads/image/init`

**Request**:
```json
{ "filename": "screenshot.png", "mimeType": "image/png",
  "sha256": "abc123...", "size": 234567 }
```

**Response (200, 신규)**:
```json
{
  "data": {
    "uploadId": "01J...",
    "method": "PUT",
    "url": "https://minio/.../upload?X-Amz-...",
    "headers": { "Content-Type": "image/png" },
    "expiresIn": 600
  }
}
```

**Response (200, 중복 — sha256 일치)**:
```json
{ "data": { "imageId": "01J...", "deduped": true,
  "urls": { "thumb": "...", "view": "...", "orig": "..." } } }
```

#### `POST /api/v1/uploads/image/finalize`

**Request**: `{ "uploadId": "01J..." }`

**Response (202 Accepted)** (비동기 변환 진행 중):
```json
{ "data": { "imageId": "01J...", "status": "processing" } }
```

**Webhook/Polling**: 클라이언트는 `GET /api/v1/images/:id`로 폴링하거나 SSE `/api/v1/uploads/:id/events` 구독

### 4.3 Pagination & Filter

- 모든 목록 API: `?limit=20&cursor=<opaque>` 커서 페이지네이션
- 필터: `?part=<slug>&tag=<name>&q=<text>&updated_after=<iso>`

### 4.4 Common Response Wrapper

```json
{
  "data": { /* primary payload */ },
  "meta": { "etag": "...", "version": 0, "pagination": { "next": "...", "limit": 20 } },
  "error": null
}
```

---

## 5. UI/UX Design

### 5.1 Screen Layout (Reader Mode — 나무위키 3-column)

```
┌────────────────────────────────────────────────────────────────────────┐
│ [Logo] [검색 ⌘K]            [최근][작성+][프로필]                       │
├──────────────┬─────────────────────────────────┬──────────────────────┤
│              │                                 │                      │
│  Tree Nav    │  ┌────── Infobox (우상단) ───┐  │  Table of Contents   │
│  ▼ MX        │  │ 주기: 월/분기/연           │  │  1. 개요              │
│   ▼ 재무팀    │  │ 산출물: 재무제표           │  │   1.1 결산 일정       │
│    ▼ 회계    │  └────────────────────────────┘  │     1.1.1 월결산 ...  │
│     ▾ 결산   │                                 │  2. R&R               │
│       • 월결산│  # 월결산 프로세스               │  ...                 │
│       • 분기 │                                 │                      │
│              │  ## 1. 개요                     │  관련 문서             │
│   ▶ 마케팅팀 │  ...본문... [[월결산 체크리스트]] │  · [[분기결산]]       │
│              │                                 │  · [[SAP 매핑]]      │
│  [+섹션]     │  ## 1.1 결산 일정                │                      │
│              │  ### 1.1.1 월결산 상세 일정      │  용어집(Glossary)     │
│              │  [표] [차트] [영상]              │  · DPS               │
│              │                                 │                      │
└──────────────┴─────────────────────────────────┴──────────────────────┘
            Footer: 마지막 편집 2026-05-06 by 홍길동 [버전이력]
```

- 좌측 트리 폭: 280px, 접기 가능
- 본문 폭: 760~880px (가독성 우선)
- 우측 패널 폭: 280px (sticky TOC, 스크롤 추적)
- 모바일/태블릿: 좌우 패널 햄버거 메뉴화

### 5.2 Editor Mode (3-pane)

```
┌────────────────────────────────────────────────────────────────────────┐
│ [저장][되돌리기][이력][미리보기▾][공개도▾]   자동저장 ✓ 5초전          │
├──────────────┬─────────────────────────────────┬──────────────────────┤
│  Outline     │   Section / Block Editor        │  Live Preview ▾      │
│              │                                 │  (또는 AI 보조 — P4)  │
│  ▼ 1. 개요   │  ┌── 섹션 헤더 ───────────────┐  │                      │
│  ▾ 1.1 일정  │  │ # 1.1.1 월결산 상세 일정    │  │  [읽기 모드 미리보기] │
│   • 1.1.1 ✏️ │  │ [↑↓][복제][삭제][잠금]      │  │                      │
│  ▶ 2. R&R    │  └────────────────────────────┘  │                      │
│              │                                 │                      │
│  드래그로     │  ┌─[Block: paragraph]────────┐  │                      │
│  계층/순서    │  │ 본문 입력... /로 위젯       │  │                      │
│  변경 (Tab)   │  └────────────────────────────┘  │                      │
│              │                                 │                      │
│  [+섹션]     │  ┌─[Block: image]────────────┐  │                      │
│              │  │ [📷 이미지 미리보기]         │  │                      │
│              │  │ 캡션: 결산 흐름도            │  │                      │
│              │  │ alt: 결산 단계 다이어그램    │  │                      │
│              │  │ [↕ 크기][↔ 정렬][🔁 교체]   │  │                      │
│              │  └────────────────────────────┘  │                      │
│              │                                 │                      │
│              │  [+ Block 추가] (또는 / )       │                      │
└──────────────┴─────────────────────────────────┴──────────────────────┘
```

### 5.3 User Flow

```
[홈]
  ├─ [트리에서 선택] → [문서 읽기]
  ├─ [⌘K 검색] → [검색 결과] → [문서 읽기]
  └─ [+ 새 문서] → [에디터 (Full Edit)]

[문서 읽기]
  ├─ [✏️ 섹션 편집] → [Section Quick Edit] → [저장] → [읽기]
  ├─ [편집] (전체) → [Editor Full Edit]
  ├─ [TOC 클릭] → 섹션 스크롤
  ├─ [위키 링크 클릭] → 다른 문서 / 미작성 시 작성 유도
  ├─ [버전 이력] → [diff 뷰] → [롤백]
  └─ [관련 문서] → 다른 문서

[Editor (Full Edit)]
  ├─ Outline 드래그 → 섹션 순서/계층 변경
  ├─ "/" → Block 삽입
  ├─ 이미지 드래그/붙여넣기 → 인라인 캡션 입력
  └─ 자동 저장 / [저장] → [읽기]
```

### 5.4 Component List (주요)

| Component | Layer | Location | Responsibility |
|-----------|-------|----------|----------------|
| `WikiArticle` | Presentation | `src/features/document/components/` | 문서 렌더 — Section 트리 + Block 디스패치 |
| `SectionRenderer` | Presentation | `src/features/document/components/` | 섹션 1단위 렌더 + permalink |
| `BlockRenderer` | Presentation | `src/features/document/components/blocks/` | type별 블록 렌더 디스패처 |
| `WikiLink` | Presentation | `src/features/document/components/` | `[[..]]` → 링크/빨간링크 |
| `Infobox` | Presentation | `src/features/document/components/` | 우상단 정보 박스 |
| `TableOfContents` | Presentation | `src/features/document/components/` | sticky TOC |
| `OrgTree` | Presentation | `src/features/org/components/` | 좌측 트리 네비 |
| `BlockEditor` | Presentation | `src/features/editor/` | BlockNote 래퍼 |
| `OutlinePanel` | Presentation | `src/features/editor/` | Outline 드래그 편집 |
| `SectionQuickEdit` | Presentation | `src/features/editor/` | 단일 섹션 인라인 편집 |
| `SlashCommandMenu` | Presentation | `src/features/editor/` | "/" 메뉴 |
| `ImageDropzone` | Presentation | `src/features/editor/blocks/` | 드래그/붙여넣기 처리 |
| `ImageBlockEditor` | Presentation | `src/features/editor/blocks/` | 이미지 + 캡션 + 컨트롤 |
| `ChartBlockEditor` | Presentation | `src/features/editor/blocks/` | 데이터 그리드 + 미리보기 |
| `documentService` | Application | `src/services/document.ts` | CRUD/PATCH 호출, 캐시 무효화 |
| `uploadService` | Application | `src/services/upload.ts` | init→PUT→finalize 시퀀스 |
| `wikiLinkParser` | Domain | `src/lib/wiki-link.ts` | `[[..]]` AST 변환 |
| `apiClient` | Infrastructure | `src/lib/api/client.ts` | axios 인스턴스 + 인터셉터 |

### 5.5 Editor State Machine

```
              [Reader]
                │
                │ ✏️ (섹션)              [편집] (전체)
                ▼                              ▼
        [QuickEdit:section]              [FullEdit:doc]
            │      │                       │      │
   [저장]   │   [취소]               [저장] │   [취소]
            ▼      ▼                       ▼      ▼
              [Reader]                       [Reader]

  자동 저장 트리거: idle 5초 OR 누적 변경량 200자 → 백그라운드 PATCH
  저장 정책 (MVP): 모든 PATCH는 새 document_versions row 생성
                   별도 drafts 테이블은 운영하지 않음 (단순화 우선)
                   `change_log`에 'auto-save'/'manual'/'restore' 기록
  버전 정리: Phase 3에서 보존 정책 도입 (예: 24h 내 N개 + 일자별 1개)
  충돌 (412): [QuickEdit] → [Conflict Merge: 3-way diff] → [Reader]
```

### 5.6 Image Caption UX (Detailed)

```
1. 이미지 업로드 완료
   ┌─────────────────────────┐
   │  [이미지 표시]            │
   │  ┃                       │  ← placeholder 자동 포커스 (input)
   │  ┃ "캡션 입력..."         │
   │  alt: [+]                 │
   └─────────────────────────┘

2. Enter → 캡션 확정 → alt placeholder 노출 (WCAG 알림)
   Tab  → alt 입력으로 이동
   Esc  → 캡션 빈 상태로 확정

3. 호버 시 컨트롤 노출 (이미지 위)
   ┌─[↕ Size][↔ Align][🔁 Replace][🔗 Link][⬇ Download][✂ Crop*][🗑 Delete]
   *Phase 2

4. 다중 드롭(N장) → 자동 제안 토스트
   "이미지 N장을 갤러리로 묶을까요? [예/아니오]"
```

### 5.7 Color Tokens (Samsung Blue)

```css
:root {
  --smsg-blue-900: #0A1F8F;
  --smsg-blue-700: #1428A0;
  --smsg-blue-500: #2E5BFF;
  --smsg-blue-100: #E8EEFF;
  --smsg-gray-900: #1A1A1A;
  --smsg-gray-500: #6B7280;
  --smsg-gray-100: #F3F4F6;
  --smsg-link: #2E5BFF;
  --smsg-link-red: #C00;       /* 미작성 위키 링크 */
  --smsg-bg: #FFFFFF;
  --smsg-success: #10B981;
  --smsg-warn: #F59E0B;
  --smsg-error: #DC2626;
}
[data-theme="dark"] { /* Phase 2 */ }
```

---

## 6. Error Handling

### 6.1 Error Code Definition

| Code | Domain | Cause | Client Handling |
|------|--------|-------|-----------------|
| `400` | Validation | Pydantic 스키마 위반 | 폼 인라인 에러 표시 |
| `401` | Auth | 토큰 만료/누락 | refresh 시도 → 실패 시 로그인 |
| `403` | Auth | 권한 없음 | "권한이 없습니다" 토스트 |
| `404` | Resource | 문서/이미지 없음 | 404 페이지 (위키 링크는 작성 유도) |
| `409` | Conflict | slug 중복 | "이미 존재하는 slug" 폼 에러 |
| `412` | Concurrency | etag 미스매치 | **충돌 머지 UI** (3-way diff) |
| `413` | Upload | 이미지 크기 초과 | 사용자 안내 + 압축 가이드 |
| `422` | Schema | DocumentJSON 위반 | 위반 위치 강조 |
| `429` | RateLimit | 과도한 요청 | 백오프 + 재시도 |
| `500` | Server | 내부 오류 | 토스트 + 에러 ID 표기 |

### 6.2 Error Response Format

```json
{
  "data": null,
  "error": {
    "code": "VALIDATION_ERROR",
    "http_status": 422,
    "message": "Section level must be parent level + 1",
    "errors": [
      { "path": "sections[0].subsections[0].level", "msg": "expected 2, got 3" }
    ],
    "trace_id": "01J..."
  }
}
```

### 6.3 Conflict Resolution UX (412)

```
편집 충돌 감지
   ↓
좌(내 변경) | 중(공통 조상) | 우(상대방 변경) 3-way diff
   ↓
3-way diff Conflict Merge UI: 자동 머지(🤖) → 충돌만 surface → 항목별 chooser
   ↓
사용자 선택: [내 것 유지] / [상대 것 채택] / [수동 머지]
   ↓
PATCH 재시도 (새 etag)
```

---

## 7. Security Considerations

- [x] **인증**: JWT (HS256, Access 1h / Refresh 7d, httpOnly cookie 또는 Authorization)
- [x] **인가**: RBAC 4단계 + 문서 owner 체크 미들웨어
- [x] **XSS 방어**: 본문 마크다운은 `rehype-sanitize` 화이트리스트 통과 후 렌더. `iframe`은 사내 도메인 화이트리스트만
- [x] **SQL Injection**: SQLAlchemy 파라미터 바인딩만 사용. Raw SQL 금지
- [x] **CSRF**: SameSite=Lax 쿠키 + Origin 헤더 검증
- [x] **입력 검증**: Pydantic v2 strict + JSON Schema (`packages/shared`)
- [x] **업로드 보안**:
  - mimetype + magic bytes 검증
  - EXIF 메타데이터 자동 제거
  - 파일명 정규화 (path traversal 방어)
  - 단건 20MB / 일괄 100MB / 분당 N건 rate-limit
- [x] **Secrets**: `.env`는 git ignore, Apptainer는 `--env-file .env` 또는 `--env KEY=VAL`로 주입. 운영은 사내 secret manager 연계
- [x] **HTTPS 강제**: Nginx에서 80→443 리디렉트, HSTS 헤더
- [x] **Rate Limiting**: nginx + slowapi (FastAPI 미들웨어)
- [x] **Audit Log**: 모든 쓰기 작업 기록 (`audit_logs`)
- [x] **OWASP ZAP**: CI에 baseline 스캔 통합
- [x] **의존성 스캔**: `pip-audit`, `npm audit` CI 통합

---

## 8. Test Plan

### 8.1 Test Scope

| Type | Target | Tool |
|------|--------|------|
| Unit (FE) | 위키 링크 파서, 스키마 변환, 컴포넌트 | Vitest + React Testing Library |
| Unit (BE) | Section 번호 매김, 권한, 검색 인덱서 | pytest + pytest-asyncio |
| Schema | DocumentJSON 골든 샘플 검증 | Ajv (TS) + jsonschema (Py) |
| Integration | API 엔드포인트(전 라우트) | httpx + pytest-postgresql |
| E2E | 사용자 시나리오 5종 | Playwright |
| Performance | 문서 1만 건 인덱스/검색 | k6 + locust |
| A11y | WCAG 2.1 AA | axe-core (Playwright 통합) |
| Security | OWASP Top 10 | OWASP ZAP CI |

### 8.2 Test Cases (Key, MVP)

#### Happy Path
- [ ] 문서 작성 → 저장 → 목록 노출 → 검색 → 클릭 → 읽기
- [ ] 이미지 드래그 업로드 → 캡션 입력 → 저장 → 읽기 모드 표시
- [ ] 위키 링크 `[[unknown]]` → 빨간색 → 클릭 → 새 문서 작성 → 자동 백링크
- [ ] Outline에서 1.1을 1.2.1로 드래그 → 자동 번호 재계산 검증
- [ ] 표 → 차트 1클릭 변환 → line/bar 적절 추천

#### Error / Edge
- [ ] level=3 섹션에 level=4 자식 추가 시도 → 400
- [ ] 같은 문서 동시 편집 → 412 → 충돌 머지 UI 표시
- [ ] 21MB 이미지 업로드 → 413 + 가이드 메시지
- [ ] 토큰 만료 → refresh 자동 시도 → 성공 후 PATCH 재시도
- [ ] EXIF 위치 정보 포함 이미지 → 업로드 후 메타 제거 확인
- [ ] 동일 sha256 이미지 → 중복 제거(deduped: true)

---

## 9. Clean Architecture (FastAPI 적응)

> Dynamic 레벨이지만 BaaS 대신 자체 FastAPI. **계층은 유지**, **DI는 FastAPI Depends**로 단순화.

### 9.1 Layer Structure

| Layer | Responsibility | FE Location | BE Location |
|-------|---------------|-------------|-------------|
| **Presentation** | UI/페이지/라우트 | `apps/web/src/features/*/components/`, `apps/web/src/pages/` | `apps/api/app/routers/` |
| **Application** | 유스케이스/서비스 | `apps/web/src/services/`, `apps/web/src/features/*/hooks/` | `apps/api/app/services/` |
| **Domain** | 엔티티/규칙/스키마 | `apps/web/src/types/` (자동 생성), `apps/web/src/lib/wiki-link.ts` | `apps/api/app/schemas/`, `apps/api/app/domain/` |
| **Infrastructure** | DB/외부 시스템 | `apps/web/src/lib/api/client.ts` | `apps/api/app/repos/`, `apps/api/app/storage/`, `apps/api/app/search/` |
| **Shared** | SSOT 스키마 | — | `packages/shared/schemas/` |

### 9.2 Dependency Rules

```
Presentation ──→ Application ──→ Domain ←── Infrastructure
                       │
                       └──→ Infrastructure (포트 인터페이스 통해)

규칙:
- Domain은 외부 의존 금지 (순수 타입/규칙)
- Routers는 Service만 호출 (DB 직접 호출 금지)
- Service는 Repo 인터페이스 의존, 구현체는 DI 주입
```

### 9.3 File Import Rules

| From | Can Import | Cannot Import |
|------|-----------|---------------|
| Presentation | Application, Domain | Infrastructure 직접 |
| Application | Domain, Infrastructure | Presentation |
| Domain | (없음) | 모두 |
| Infrastructure | Domain | Application, Presentation |

### 9.4 This Feature's Layer Assignment (예시)

| Component | Layer | Location |
|-----------|-------|----------|
| `documents_router.py` | Presentation (BE) | `apps/api/app/routers/documents.py` |
| `DocumentService` | Application (BE) | `apps/api/app/services/document_service.py` |
| `Document`, `Section`, `Block` (Pydantic) | Domain (BE) | `apps/api/app/schemas/document.py` (auto-gen) |
| `DocumentRepo` | Infrastructure (BE) | `apps/api/app/repos/document_repo.py` |
| `MeiliSearchAdapter` | Infrastructure (BE) | `apps/api/app/search/meili_adapter.py` |
| `MinIOStorageAdapter` | Infrastructure (BE) | `apps/api/app/storage/minio_adapter.py` |
| `WikiArticle.tsx` | Presentation (FE) | `apps/web/src/features/document/components/` |
| `useDocument()` hook | Application (FE) | `apps/web/src/features/document/hooks/` |
| `documentService` | Application (FE) | `apps/web/src/services/document.ts` |
| `Document` type | Domain (FE) | `apps/web/src/types/document.ts` (auto-gen) |
| `apiClient` | Infrastructure (FE) | `apps/web/src/lib/api/client.ts` |

---

## 10. Coding Convention Reference

### 10.1 Naming Conventions

| Target | Rule | Example |
|--------|------|---------|
| Components (FE) | PascalCase | `WikiArticle`, `BlockEditor` |
| Hooks | `useXxx` | `useDocument`, `useUpload` |
| Functions | camelCase | `parseWikiLink()` |
| Constants | UPPER_SNAKE_CASE | `MAX_IMAGE_BYTES` |
| Types/Interfaces | PascalCase | `Document`, `Block` |
| Files (component) | PascalCase.tsx | `WikiArticle.tsx` |
| Files (utility) | kebab-case.ts | `wiki-link.ts` |
| Folders | kebab-case | `block-editor/`, `image-upload/` |
| Python module | snake_case | `document_service.py` |
| Python class | PascalCase | `DocumentService` |
| Python func/var | snake_case | `parse_wiki_link()` |
| API route | kebab-case | `/api/v1/document-versions` |
| DB table | snake_case (plural) | `documents`, `document_versions` |

### 10.2 Import Order

#### TypeScript
```typescript
// 1. External
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
// 2. Internal absolute (alias @/)
import { Button } from '@/components/ui'
import { documentService } from '@/services/document'
// 3. Relative
import { useEditorState } from './hooks'
// 4. Type imports
import type { Document } from '@/types'
// 5. Styles
import './styles.css'
```

#### Python (Ruff isort)
```python
# 1. stdlib
import json
from datetime import datetime
# 2. third-party
from fastapi import APIRouter, Depends
from sqlalchemy import select
# 3. first-party (apps.api)
from app.schemas import Document
from app.services.document_service import DocumentService
# 4. relative
from .deps import get_db
```

### 10.3 Environment Variables

| Prefix | Purpose | Scope |
|--------|---------|-------|
| `VITE_` | 클라이언트 노출 | Browser (FE) |
| `DATABASE_`, `DB_` | DB 연결 | Server only |
| `MEILI_`, `MINIO_` | 외부 서비스 | Server only |
| `JWT_` | 인증 secret | Server only |
| `CORS_`, `LOG_` | 운영 설정 | Server only |

### 10.4 This Feature's Conventions

| Item | Convention Applied |
|------|-------------------|
| FE 컴포넌트 | PascalCase, 1 file 1 default export, 동일 폴더에 `*.test.tsx` 인접 |
| Hook | `useXxx` + 동명 hook은 동일 도메인 폴더에 |
| 상태 관리 | 서버 상태=TanStack Query, 클라이언트 상태=Zustand store(피처별) |
| 에러 처리 | TanStack Query `onError` + `<Toast>` 표준 / 에러 바운더리 라우트별 |
| 폼 | react-hook-form + zod (스키마는 `packages/shared`에서 가져옴) |
| BE 라우터 | 1 라우터 = 1 리소스, response_model로 Pydantic 강제 |
| BE 서비스 | 도메인 예외 → 미들웨어에서 표준 에러 응답으로 변환 |
| 마이그레이션 | Alembic, 1 PR = 1 마이그레이션, autogenerate 후 수동 검토 |
| 커밋 | Conventional Commits (`feat`, `fix`, `chore`, `docs`, `refactor`, `test`) |

---

## 11. Implementation Guide

### 11.1 File Structure (모노레포)

```
MXWhitePaper/
├── apps/
│   ├── web/                       # React + TS + Vite
│   │   ├── src/
│   │   │   ├── features/
│   │   │   │   ├── document/      # 읽기 + 렌더
│   │   │   │   │   ├── components/   # WikiArticle, SectionRenderer, BlockRenderer
│   │   │   │   │   └── hooks/
│   │   │   │   ├── editor/        # 에디터
│   │   │   │   │   ├── components/   # BlockEditor, OutlinePanel, SectionQuickEdit
│   │   │   │   │   ├── blocks/       # ImageBlockEditor, ChartBlockEditor, ...
│   │   │   │   │   └── hooks/
│   │   │   │   ├── org/           # 트리 네비
│   │   │   │   ├── search/
│   │   │   │   └── auth/
│   │   │   ├── components/        # 공통 ui (shadcn/ui 커스텀)
│   │   │   ├── services/          # documentService, uploadService, ...
│   │   │   ├── lib/
│   │   │   │   ├── api/client.ts
│   │   │   │   └── wiki-link.ts
│   │   │   ├── types/             # 자동 생성 (DocumentJSON)
│   │   │   ├── styles/tokens.css
│   │   │   ├── pages/
│   │   │   └── main.tsx
│   │   ├── vite.config.ts
│   │   └── package.json
│   │
│   └── api/                       # FastAPI
│       ├── app/
│       │   ├── routers/
│       │   │   ├── documents.py
│       │   │   ├── orgs.py
│       │   │   ├── uploads.py
│       │   │   ├── search.py
│       │   │   ├── glossary.py
│       │   │   └── auth.py
│       │   ├── services/
│       │   │   ├── document_service.py
│       │   │   ├── section_numbering.py
│       │   │   ├── wiki_link_extractor.py
│       │   │   ├── upload_service.py
│       │   │   └── search_service.py
│       │   ├── schemas/           # 자동 생성 (DocumentJSON)
│       │   ├── domain/            # 도메인 규칙
│       │   ├── repos/
│       │   ├── storage/minio_adapter.py
│       │   ├── search/meili_adapter.py
│       │   ├── core/
│       │   │   ├── config.py      # pydantic-settings
│       │   │   ├── security.py    # JWT, password
│       │   │   ├── db.py          # SQLAlchemy
│       │   │   └── errors.py
│       │   └── main.py
│       ├── alembic/
│       ├── tests/
│       └── pyproject.toml
│
├── packages/
│   └── shared/
│       ├── schemas/document.json  # JSON Schema 2020-12 (SSOT)
│       └── codegen/
│           ├── generate-ts.mjs    # → apps/web/src/types/document.ts
│           └── generate-py.py     # → apps/api/app/schemas/document.py
│
├── infra/
│   ├── apptainer/
│   │   ├── api.def
│   │   └── web.def
│   ├── scripts/
│   │   ├── _common.sh
│   │   ├── build.sh / start.sh / stop.sh / restart.sh
│   │   ├── status.sh / logs.sh
│   │   └── migrate.sh / seed.sh
│   └── data/                       # bind-mount target (gitignore)
│       ├── postgres/  meili/  minio/
│
├── evals/                         # Phase 4 LLM 통합용 자리만
├── docs/
│   ├── 01-plan/features/
│   ├── 02-design/features/        # 본 문서
│   └── ...
└── README.md
```

### 11.2 Implementation Order (MVP 6 Sprint)

#### Sprint 0 — Foundation (1주)
1. [ ] 모노레포(pnpm workspace + uv/poetry) 골격
2. [ ] `packages/shared/schemas/document.json` v1.0 작성 + codegen 스크립트
3. [ ] Apptainer 인프라: `infra/apptainer/{api,web}.def` + `infra/scripts/{build,start,stop,status,logs,migrate,seed}.sh` (host network)
4. [ ] GitHub Actions CI matrix(스키마/web/api 정적 — Win/Mac/Linux)
5. [ ] Alembic 초기 마이그레이션(divisions~documents~images~links~tags~users~audit_logs)

#### Sprint 1 — 조직 + 문서 CRUD (1주)
6. [ ] `routers/orgs.py` 4개 (divisions/teams/groups/parts CRUD)
7. [ ] `routers/documents.py` GET/POST/PUT/DELETE + Pydantic 검증
8. [ ] FE: API client + TanStack Query 셋업
9. [ ] FE: `OrgTree` (좌측 트리 네비)
10. [ ] FE: `documents/[slug]` 라우트 + 읽기 페이지 골격

#### Sprint 2 — Reader (1주)
11. [ ] BE: Section 자동 번호 매김 서비스 + JSONB 검증
12. [ ] FE: `WikiArticle` + `SectionRenderer` + `BlockRenderer`
13. [ ] FE: Block 렌더 (paragraph/list/table/callout/code/image)
14. [ ] FE: `Infobox` + `TableOfContents` (sticky + 스크롤 추적)
15. [ ] FE: 컬러 토큰 + Tailwind config + shadcn/ui 셋업

#### Sprint 3 — WikiLink + 레이아웃 (1주)
16. [ ] FE/Domain: 위키 링크 파서 (`[[slug|text]]`, `[[slug#1.1.1]]`)
17. [ ] BE: 위키 링크 추출기 + `links` 테이블 갱신 트리거
18. [ ] FE: `WikiLink` 컴포넌트 (미작성=빨강, 클릭=라우팅)
19. [ ] BE: `GET /documents/:slug/backlinks`
20. [ ] FE: 우측 패널 (관련/백링크/용어집)

#### Sprint 4 — Editor MVP ⭐ (1주)
21. [ ] FE: BlockNote 통합 + 커스텀 Block 어댑터(공통 인터페이스)
22. [ ] FE: `OutlinePanel` (드래그로 순서/계층 변경, Tab/Shift+Tab)
23. [ ] FE: `SectionQuickEdit` (단일 섹션 인라인 편집)
24. [ ] FE: `SlashCommandMenu` ("/" → Block 삽입)
25. [ ] BE: `PATCH /documents/:slug/sections/:sectionId` + Optimistic Locking
26. [ ] FE: 자동 저장(idle 5초) + 충돌 머지 UI

#### Sprint 5 — 이미지·캡션 UX ⭐ (1주)
27. [ ] BE: `POST /uploads/image/init` (presigned PUT, sha256 dedup)
28. [ ] BE: 백그라운드 워커 — EXIF 제거 + WebP 3 sizes
29. [ ] BE: `POST /uploads/image/finalize` + `GET /images/:id`
30. [ ] FE: `ImageDropzone` (드래그/붙여넣기/파일 다이얼로그)
31. [ ] FE: `ImageBlockEditor` (인라인 캡션/alt/리사이즈/정렬/교체)
32. [ ] FE: `GalleryBlock` 자동 제안(다중 드롭)

#### Sprint 6 — 위젯 + 검색 + 인증 (1주)
33. [ ] FE: `ChartBlockEditor` (Recharts, 데이터 그리드)
34. [ ] FE: `VideoBlock` (사내 + 유튜브)
35. [ ] BE: Meilisearch 인덱서(변경 이벤트 → 인덱스 업데이트)
36. [ ] BE/FE: `/search` API + ⌘K 검색 UI
37. [ ] BE: 인증(JWT, refresh) + RBAC 미들웨어
38. [ ] FE: 로그인 페이지 + AuthGuard
39. [ ] E2E: 핵심 시나리오 5종 (Playwright)

### 11.3 Key Dependencies

#### Frontend (`apps/web/package.json`)
```json
{
  "dependencies": {
    "react": "^18", "react-dom": "^18", "react-router-dom": "^6",
    "@tanstack/react-query": "^5", "zustand": "^4",
    "@blocknote/react": "^0.x", "@blocknote/core": "^0.x",
    "react-markdown": "^9", "remark-gfm": "^4", "rehype-sanitize": "^6",
    "recharts": "^2",
    "react-hook-form": "^7", "zod": "^3",
    "axios": "^1",
    "tailwindcss": "^3", "shadcn-ui": "(generator)"
  },
  "devDependencies": {
    "vite": "^5", "vitest": "^1", "@playwright/test": "^1",
    "typescript": "^5", "eslint": "^8", "prettier": "^3",
    "json-schema-to-typescript": "^14"
  }
}
```

#### Backend (`apps/api/pyproject.toml`)
```toml
[project]
dependencies = [
  "fastapi>=0.110", "uvicorn[standard]>=0.27",
  "sqlalchemy>=2.0", "alembic>=1.13", "asyncpg>=0.29",
  "pydantic>=2.6", "pydantic-settings>=2.2",
  "python-jose[cryptography]>=3.3", "argon2-cffi>=23",
  "python-multipart>=0.0.9",
  "boto3>=1.34",                    # MinIO/S3
  "Pillow>=10",                     # 이미지 처리
  "meilisearch>=0.30",
  "slowapi>=0.1.9",
  "structlog>=24",
  "httpx>=0.27"
]
[tool.ruff] target-version = "py312"
[tool.pytest.ini_options] addopts = "-ra -q"
```

### 11.4 Local Dev Quickstart (Apptainer)

```bash
# 0) 사전: apptainer >= 1.2, pnpm 9, node 20, python 3.12
cp .env.example .env

# 1) 호스트 의존성 + 스키마 codegen baseline (최초 1회)
pnpm install
pip install --user datamodel-code-generator
pnpm schema:gen
git add apps/web/src/types/document.ts apps/api/app/schemas/document.py
git commit -m "chore: codegen baseline"

# 2) Apptainer 이미지 빌드/풀 (한 번만)
make build         # → infra/apptainer/{postgres,meili,minio,mc,api,web}.sif

# 3) 5개 instance 기동 (host network)
make up            # → ./infra/scripts/start.sh

# 4) 마이그레이션 + 시드
make migrate
make seed

# 5) 상태/로그
make status
make logs SVC=api  # 또는 web/postgres/meili/minio

# 접속 (모두 호스트 포트)
# Web:   http://localhost:5173
# API:   http://localhost:8000/docs
# Meili: http://localhost:7700
# MinIO: http://localhost:9001 (콘솔)

# 정지 / 정리
make down          # 데이터 보존
make clean         # .sif + 데이터 모두 삭제 (DESTRUCTIVE)
```

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-05-06 | Initial design — DocumentJSON v1.0 schema, DB ERD, REST API spec, 3-pane Editor, Image upload sequence, Conventions, 6-Sprint impl order | squall321@gmail.com |
