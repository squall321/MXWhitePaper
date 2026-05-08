---
template: plan
version: 1.2
feature: MX-WhitePaper
date: 2026-05-06
author: squall321@gmail.com
project: MX White Paper (사업부 지식 창고)
project_version: 0.1.0
---

# MX-WhitePaper Planning Document

> **Summary**: 나무위키 스타일 UI에 1/1.1/1.1.1 계층 구조와 위젯(차트·이미지·동적 데이터)을 결합한, 사업부 업무 백서 단일 지식 창고. 일목요연한 Block 기반 에디터로 누구나 5초 안에 이미지·표·차트를 첨부할 수 있다.
>
> **Project**: MX White Paper
> **Version**: 0.1.0
> **Author**: squall321@gmail.com
> **Date**: 2026-05-06
> **Status**: Draft
> **Linked Plan Doc**: [PROJECT_PLAN.md](../../../PROJECT_PLAN.md)

---

## Executive Summary

| Perspective | Content |
|-------------|---------|
| **Problem** | 업무 지식이 사람·PPT·Word·메일에 분산되어 신규 입사자 온보딩에 수개월 소요. 담당자 이동·퇴사 시 지식 휘발. 기존 위키 도구는 문단·표 위주로 표현력이 부족하고 에디터가 무거워 작성 자체가 진입 장벽 |
| **Solution** | ① 나무위키 스타일 3단 레이아웃 + 1/1.1/1.1.1 자동 번호 ② Block 기반 에디터(슬래시 커맨드, 드래그 이동, 인라인 캡션) ③ 위젯 시스템(차트·갤러리·동적 데이터) ④ 위키 링크(`[[..]]`)로 업무·용어 그래프 ⑤ 모든 데이터는 JSON-First — 추후 LLM/Word 자동 변환 확장 가능 |
| **Function/UX Effect** | 검색→읽기→관련 문서 탐색 3 클릭 이내 / 이미지 첨부+캡션 5초 이내 / 섹션 단위 빠른 편집(전체 페이지 진입 불필요) / 표→차트 1클릭 변환 |
| **Core Value** | "업무를 묻지 말고 백서를 검색하라" — 사업부 지식의 자가증식 사이클 구축. 신규 인원 온보딩 시간 30%↓, 부서 간 협업 마찰 감소 |

---

## 1. Overview

### 1.1 Purpose

사업부(MX) 내 분산된 업무 지식을 단일 위키 플랫폼에 통합하여, 누구나 빠르게 검색·열람하고 누구나 5초 안에 풍부한 콘텐츠(이미지·차트·표·동영상)를 추가할 수 있는 **지식 창고**를 구축한다. 데이터는 JSON-First로 설계하여 추후 AI/LLM 자동화로 자연스럽게 확장한다.

### 1.2 Background

- **현황**: 업무 지식이 PPT·Word·메일·사람의 머릿속에 분산. 신규 입사자/타 부서 협업 시 동일한 질문이 반복됨
- **기존 솔루션 한계**:
  - Confluence: 표현력 한계, 위젯 빈약
  - Notion: 사외 SaaS, 사내 보안 정책상 한계
  - 사내 자체 위키: 에디터 UX 열악, 이미지 첨부가 번거로움
- **트리거**: MX 사업부 지식의 단일 소스화 + 신규 인원 온보딩 가속이 시급한 과제로 대두

### 1.3 Related Documents

- 종합 계획서: [PROJECT_PLAN.md](../../../PROJECT_PLAN.md)
- 후속 산출물(예정): `docs/02-design/features/MX-WhitePaper.design.md`
- 후속 산출물(예정): `docs/02-design/document-json-schema-v1.md`

---

## 2. Scope

### 2.1 In Scope

#### Sprint 0 — Foundation (1주)
- [ ] 모노레포(pnpm workspace + uv) + ESLint/Prettier/Ruff/Pyright/commitlint
- [ ] Apptainer 인프라(`.def` + start/stop/status/logs/migrate/seed 스크립트): postgres+pgvector, meilisearch, minio, api, web
- [ ] devcontainer.json (VS Code 환경 통일)
- [ ] **`packages/shared/schemas/document.json` (DocumentJSON v1.0 SSOT) + TS·Python 타입 codegen**
- [ ] Alembic 초기 마이그레이션 (Design §3.2 DDL 전체) + 시드 데이터
- [ ] GitHub Actions CI matrix(스키마/web/api 정적): ubuntu/macos/windows + OWASP ZAP baseline (self-hosted Linux runner에서 Apptainer 통합 테스트)

#### MVP (Sprint 1~6, 6주)
- [ ] 조직 계층(사업부→팀→그룹→파트→문서) CRUD
- [ ] DocumentJSON v1.0 스키마 + JSON-First REST API (FastAPI)
- [ ] Section 1/1.1/1.1.1 자동 번호 매김 + Block 기반 본문 렌더
- [ ] 나무위키 스타일 3단 레이아웃(좌 트리 / 본문+Infobox+TOC / 우 사이드)
- [ ] Samsung Blue 톤앤매너 디자인 토큰
- [ ] 위키 링크 `[[..]]` 파서 + 미작성 링크 빨간색 표시 + 백링크 생성
- [ ] **에디터 MVP**: BlockNote 기반 / Outline 편집 / Slash Command / Section 단위 빠른 편집(`✏️`)
- [ ] **이미지·캡션 UX**: 드래그/클립보드 붙여넣기 업로드 + 인라인 캡션 + 리사이즈/정렬 + 갤러리 블록
- [ ] 위젯: `paragraph`/`list`/`table`/`callout`/`code`/`image`/`gallery`/`video`/`chart(line/bar/pie)`
- [ ] Meilisearch 기반 전문 검색(타이틀+태그+본문+캡션)
- [ ] 인증(JWT, 이메일/비밀번호) + 기본 RBAC(reader/editor/owner/admin)
- [ ] Apptainer 기반 사내/HPC 친화 인프라 (root-less, single-`.sif` 이식성)

#### Phase 2 (협업/위젯 확장, 4주)
- [ ] 버전 이력 + diff 뷰
- [ ] 백링크 + 용어집(Glossary) 툴팁
- [ ] 위젯 확장: `gantt` / `flow(Mermaid)` / `kpi-cards` / `tabs` / `columns` / `accordion` / `math(KaTeX)`
- [ ] 권한 세분화 + 감사 로그
- [ ] 이미지 인라인 크롭/회전, 갤러리 라이트박스
- [ ] CSV 붙여넣기 → 표 자동 생성 / 표 ↔ 차트 변환

#### Phase 3 (확장, 4주)
- [ ] 그래프 뷰(문서간 링크 시각화)
- [ ] 댓글/리뷰/승인 워크플로우
- [ ] PDF/Word 내보내기
- [ ] 사내 SSO 연동
- [ ] 모니터링(Prometheus/Grafana)
- [ ] 동적 위젯: `data-source` / `dashboard-embed`(Grafana/Tableau)

### 2.2 Out of Scope

- ❌ **LLM 기반 AI 작성 보조** (요약/섹션 제안/용어 추출 등) → Phase 4 별도 의사결정 후 착수
- ❌ **Word(.docx) → JSON 자동 변환** → Phase 4 별도 의사결정 후 착수 (단 JSON-First 설계로 확장 대비)
- ❌ 사외 공개 / 인터넷 SaaS 형태 운영
- ❌ 실시간 동시 편집(Yjs/CRDT) — 필요 시 Phase 3+ 검토
- ❌ 모바일 앱 네이티브 빌드 — 반응형 웹으로 충분 가정
- ❌ 외부 시스템 자동 연동(Jira/Confluence 마이그레이션 자동화)

---

## 3. Requirements

### 3.1 Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-01 | 조직 계층(사업부/팀/그룹/파트) CRUD 및 트리 네비게이션 | High | Pending |
| FR-02 | 문서 CRUD (DocumentJSON v1.0 스키마 기반 JSON-First API) | High | Pending |
| FR-03 | 1/1.1/1.1.1 3단계 자동 번호 매김 (level ∈ {1,2,3}) | High | Pending |
| FR-04 | 나무위키 스타일 3단 레이아웃(좌 트리, 중앙 본문+Infobox, 우 TOC/관련) | High | Pending |
| FR-05 | 위키 링크 `[[slug\|표시]]` 파싱·렌더링·백링크 자동 추출 | High | Pending |
| FR-06 | Block 기반 에디터(BlockNote): 슬래시 커맨드, Block 이동/복제/삭제 | High | Pending |
| FR-07 | Outline 사이드패널 — 드래그로 섹션 순서/계층 변경(Tab/Shift+Tab) | High | Pending |
| FR-08 | Section 단위 빠른 편집(In-place) + 전체 편집 모드 분리 | High | Pending |
| FR-09 | 이미지 업로드: 드래그앤드롭 / 클립보드 붙여넣기 / 다중 업로드(갤러리) | High | Pending |
| FR-10 | 이미지 인라인 캡션·Alt 텍스트·리사이즈·정렬 컨트롤 | High | Pending |
| FR-11 | 위젯: `chart`(line/bar/pie/area) + `video` + `gallery` 렌더/편집 | High | Pending |
| FR-12 | 전문 검색(Meilisearch): 타이틀/본문/태그/이미지 캡션·Alt | High | Pending |
| FR-13 | 인증(JWT, 1h Access / 7d Refresh) + RBAC 4단계(reader/editor/owner/admin) | High | Pending |
| FR-14 | Samsung Blue(#1428A0) 디자인 토큰 적용 | Medium | Pending |
| FR-15 | 자동 저장(idle 5초 또는 변경량 200자) + 버전 이력 보존 (모든 PATCH는 새 `document_versions` row 생성, 별도 드래프트 테이블 미운영) | High | Pending |
| FR-16 | Optimistic Locking(ETag/If-Match) 412 충돌 감지 + 3-way diff 머지 UI | High | Pending |
| FR-17 | OpenAPI/JSON Schema export — TS·Python 타입 자동 생성 (LLM 통합 대비) | Medium | Pending |
| FR-18 | Apptainer 기반 인프라(`.def` + 스크립트). Linux/HPC 환경에서 동일 `.sif`로 실행. host network + bind-mount 데이터 | High | Pending |

### 3.2 Non-Functional Requirements

| Category | Criteria | Measurement Method |
|----------|----------|-------------------|
| Performance | 문서 로드(Avg) < 800ms, 검색 응답 < 300ms (사내망 기준) | Lighthouse / k6 부하 테스트 |
| Editor UX | 이미지 드롭→캡션 입력 가능 상태까지 ≤ 5초 (네트워크 정상) | 사용자 시나리오 측정 |
| Editor UX | Slash Command 호출 → Block 삽입 ≤ 200ms | 클라이언트 perf measure |
| Security | OWASP Top 10 준수 / XSS 방어(본문 sanitize) / 업로드 EXIF 제거 | OWASP ZAP 스캔 |
| Accessibility | WCAG 2.1 AA (키보드 네비, alt 텍스트, 컬러 대비) | axe-core 자동 테스트 |
| Cross-platform | Linux/HPC 동일 실행 환경 (Apptainer `.sif`). 호스트 측 정적 검증은 Win/Mac/Linux 동일 | CI matrix(정적) + self-hosted runner(통합) |
| Browser | Chrome/Edge 최신 2버전, Safari 최신 2버전 | Playwright E2E |
| Reliability | 자동 저장 데이터 손실 0건 (5초 idle 트리거) | Cypress 시나리오 |
| Scalability | 문서 10,000건 / 동시 접속 200명 무 지연 | k6 스트레스 테스트 |
| Observability | API 에러율 / p95 latency / 업로드 실패율 대시보드 | Prometheus + Grafana |

---

## 4. Success Criteria

### 4.1 Definition of Done (MVP)

- [ ] FR-01 ~ FR-14, FR-18 모두 구현
- [ ] 시드 문서 100건 등록 (실 업무 백서 샘플)
- [ ] 5명 시범 사용자 onboarding 후 만족도 ≥ 4.0/5.0
- [ ] JSON-First API 100% 커버리지(OpenAPI 스펙 자동 생성)
- [ ] 단위 테스트 커버리지 ≥ 70% (백엔드 도메인 로직)
- [ ] E2E 핵심 시나리오 5개 통과(작성/이미지업로드/링크/검색/권한)
- [ ] 코드 리뷰 + Gap 분석 ≥ 90%
- [ ] README + 운영 Runbook 완비

### 4.2 Quality Criteria

- [ ] 테스트 커버리지 ≥ 70% (FE 컴포넌트), ≥ 80% (BE 도메인)
- [ ] Zero ESLint/Pyright/Ruff 에러
- [ ] Lighthouse Performance ≥ 85, Accessibility ≥ 95
- [ ] CI: Win/Mac/Linux 빌드 통과
- [ ] OWASP ZAP Critical/High 0건

### 4.3 KPI (6개월 운영 후)

| 지표 | 목표 |
|------|------|
| 등록 문서 수 | 500+ |
| 월간 활성 사용자(MAU) | 사업부 인원의 70%+ |
| 평균 문서당 백링크 수 | ≥ 3 |
| 검색→클릭률(CTR) | ≥ 60% |
| 신규 입사자 온보딩 체감 시간 | -30% (설문) |
| 이미지 첨부 평균 시간 | ≤ 5초 |

---

## 5. Risks and Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| 작성자 인센티브 부족으로 문서 양산 정체 | High | Medium | 기여도 리더보드, 팀별 KPI 연계, "오늘의 작성 추천" 위젯 |
| BlockNote/TipTap 커스텀 한계로 위젯 통합 난항 | Medium | Medium | MVP는 BlockNote, 한계 노출 시 TipTap 직접 구성으로 우회. 위젯은 Block 인터페이스로 추상화 |
| 이미지/파일 스토리지 용량/비용 폭증 | Medium | Medium | WebP 자동 변환 + 3종 크기, SHA-256 중복 제거, 단건 20MB 제한, 만료 정책 |
| 동시 편집 충돌로 데이터 손실 | High | Low | Optimistic Locking + diff 기반 머지 UX, 자동 저장 시 버전 분기 |
| 사내 보안 정책상 외부 LLM 호출 불가 (Phase 4 진입 시) | High | Medium | Phase 4 시점에 LLM 어댑터 인터페이스로 사내 모델 교체 가능 설계 |
| 위키 링크 양산으로 미작성 링크 폭증 | Medium | High | 미작성 링크 대시보드 + 빨간 링크 시각화 + "이 문서 작성하기" 유도 |
| 1/1.1/1.1.1 제약으로 깊은 계층 문서 작성 불편 | Medium | Low | level 4+는 `heading-4` Block으로 표현(번호는 제외). 가이드 문서로 안내 |
| Markdown 학습 부담 | Medium | Medium | BlockNote의 WYSIWYG 모드 기본 + 마크다운 단축키 토글 제공 |
| 사용자 시범 피드백 반영 지연 | Medium | Medium | 매 Sprint 종료 시 시범 사용자 30분 인터뷰, Backlog 우선순위 즉시 반영 |

---

## 6. Architecture Considerations

### 6.1 Project Level Selection

| Level | Characteristics | Recommended For | Selected |
|-------|-----------------|-----------------|:--------:|
| **Starter** | Simple structure | Static sites, portfolios | ☐ |
| **Dynamic** | Feature-based modules, 자체 BE | Web apps with backend, fullstack apps | ☑ |
| **Enterprise** | Strict layer separation, microservices | High-traffic, complex architectures | ☐ |

→ **Dynamic** 선택. BaaS 대신 **자체 FastAPI 백엔드**(사내 보안/JSON 스키마 컨트롤 필요).

### 6.2 Key Architectural Decisions

| Decision | Options | Selected | Rationale |
|----------|---------|----------|-----------|
| FE Framework | React+Vite / Next.js / Vue | **React + Vite + TypeScript** | SPA, 사내 사용 SEO 불요, 빌드 속도 |
| State Management | Context / Zustand / Redux / Jotai | **TanStack Query + Zustand** | 서버 상태 위주, 보일러플레이트 최소 |
| API Client | fetch / axios / react-query | **TanStack Query (axios 어댑터)** | 캐시/낙관적 업데이트/무효화 |
| Form Handling | react-hook-form / formik / native | **react-hook-form + zod** | 타입 안전 + zod 스키마 공유 |
| Styling | Tailwind / CSS Modules / styled | **Tailwind + shadcn/ui (커스텀)** | 나무위키 룩앤필 자유도, 토큰화 용이 |
| Testing | Jest / Vitest / Playwright | **Vitest + Playwright** | Vite 친화, E2E는 Playwright |
| Editor | TipTap / Lexical / BlockNote / Slate | **BlockNote → 한계 시 TipTap** | MVP 가속, 슬래시 커맨드/Block 구조 |
| Markdown | react-markdown / MDX | **react-markdown + remark/rehype** | 본문은 데이터, 코드 실행 불필요 |
| Charts | Recharts / Plotly / Chart.js | **Recharts (기본) / Plotly (복잡)** | React 친화, 번들 가벼움 |
| Backend | BaaS / FastAPI / Node | **FastAPI + Pydantic v2** | OpenAPI 자동, 비동기, JSON 친화 |
| ORM | SQLAlchemy 2.0 + Alembic / Tortoise | **SQLAlchemy 2.0 + Alembic** | 성숙도 + 마이그레이션 |
| DB | PostgreSQL / MySQL | **PostgreSQL 15+ (JSONB + pgvector)** | JSONB로 DocumentJSON, 추후 임베딩 |
| Search | Meilisearch / Elasticsearch / PG FTS | **Meilisearch** | 셋업 단순, 한국어 양호, 사내 규모 적합 |
| Image Storage | S3 / MinIO / 로컬 | **MinIO (사내) → S3 호환** | 사내 운영 / Presigned URL 표준 |
| Deploy | Apptainer / Docker Compose / K8s | **Apptainer instances (host network)** | 사내 HPC 친화, root 불필요, single-`.sif` 이식성 |
| Cross-platform Dev | Apptainer / Docker / Native | **Apptainer + 호스트 pnpm/python** | 컨테이너는 Linux/HPC 어디서든 동일 `.sif`. 정적 검증은 OS-agnostic |

### 6.3 Clean Architecture Approach

```
Selected Level: Dynamic (자체 FastAPI 백엔드)

Folder Structure Preview:
┌─────────────────────────────────────────────────────┐
│ apps/web/      (React + TS + Vite)                  │
│   src/components/   - WikiArticle, Editor, Sidebar  │
│   src/features/     - documents, search, auth       │
│   src/services/     - api client                    │
│   src/lib/          - wiki link parser, schema      │
│   src/types/        - generated from JSON Schema    │
│   src/styles/       - tokens.css (Samsung Blue)     │
├─────────────────────────────────────────────────────┤
│ apps/api/      (FastAPI)                            │
│   app/routers/      - documents, orgs, search,      │
│                       uploads, widgets              │
│   app/models/       - SQLAlchemy                    │
│   app/schemas/      - Pydantic (DocumentJSON v1.0)  │
│   app/services/     - search, storage, links        │
│   app/core/         - config, security, db          │
├─────────────────────────────────────────────────────┤
│ packages/shared/    (공유 JSON 스키마)                │
│   schemas/document.json   - SSOT                    │
│   codegen/                - TS/Python 타입 자동 생성 │
└─────────────────────────────────────────────────────┘
```

### 6.4 Document JSON Schema (v1.0 핵심)

```ts
interface Document {
  schema_version: '1.0';
  title: string;
  summary: string;
  metadata: { division, team, group, part, owners[], tags[], category, ... };
  infobox?: Record<string, string | string[]>;
  sections: Section[];          // level 1~3 트리
  related_documents: { slug, relation }[];
  glossary: { term, definition }[];
  references: { type, label }[];
  see_also: string[];
}

interface Section {
  id: string; number: string; level: 1|2|3; title: string;
  blocks: Block[];              // 본문 콘텐츠
  subsections: Section[];       // 재귀
}

type Block =
  | ParagraphBlock | HeadingBlock | ListBlock | QuoteBlock | CalloutBlock | CodeBlock
  | TableBlock | KpiCardsBlock
  | ChartBlock | GanttBlock | FlowBlock | OrgChartBlock
  | IframeBlock | VideoBlock | DashboardEmbedBlock | DataSourceBlock | CalculatorBlock
  | ImageBlock | GalleryBlock | FileBlock
  | DocLinkCardBlock | GlossaryRefBlock
  | ColumnsBlock | TabsBlock | AccordionBlock;
```

> 전체 스키마는 [PROJECT_PLAN.md §3](../../../PROJECT_PLAN.md#33-document-json-스키마-ai-작성word-변환-표준) 참조. Phase 0에서 `packages/shared/schemas/document.json`으로 확정.

---

## 7. Convention Prerequisites

### 7.1 Existing Project Conventions

- [ ] `CLAUDE.md` 코딩 컨벤션 섹션 (전역 CLAUDE.md만 존재, 프로젝트 전용 추가 필요)
- [ ] `docs/01-plan/conventions.md` (예정)
- [ ] `CONVENTIONS.md` 프로젝트 루트 (예정)
- [ ] ESLint 설정 (`.eslintrc.json` / `eslint.config.js`)
- [ ] Prettier 설정 (`.prettierrc`)
- [ ] TypeScript 설정 (`tsconfig.json`)
- [ ] Python: Ruff + Pyright 설정 (`pyproject.toml`)
- [ ] commitlint + husky (Conventional Commits)

### 7.2 Conventions to Define/Verify

| Category | Current State | To Define | Priority |
|----------|---------------|-----------|:--------:|
| **Naming (FE)** | missing | 컴포넌트 PascalCase / 훅 useXxx / 파일 kebab-case | High |
| **Naming (BE)** | missing | 모듈 snake_case / 클래스 PascalCase / 라우트 kebab-case | High |
| **Folder structure** | missing | `apps/web`, `apps/api`, `packages/shared` 모노레포 | High |
| **Import order** | missing | external → internal alias(@/) → relative | Medium |
| **Environment variables** | missing | `.env.example` 템플릿 + 검증(zod / pydantic-settings) | High |
| **Error handling (FE)** | missing | TanStack Query onError + Toast 표준 | Medium |
| **Error handling (BE)** | missing | 도메인 예외 → 표준 에러 응답 스키마 | Medium |
| **API response shape** | missing | `{ data, meta, error }` 일관 포맷 | High |
| **Commit / Branch** | missing | Conventional Commits + GitFlow lite | Medium |
| **Documentation** | missing | 모든 공개 API에 OpenAPI summary/description | Medium |

### 7.3 Environment Variables Needed

| Variable | Purpose | Scope | To Be Created |
|----------|---------|-------|:-------------:|
| `VITE_API_URL` | API 엔드포인트 | Client | ☑ |
| `DATABASE_URL` | PostgreSQL 연결 | Server | ☑ |
| `MEILI_HOST` | Meilisearch 엔드포인트 | Server | ☑ |
| `MEILI_MASTER_KEY` | Meilisearch 마스터 키 | Server | ☑ |
| `MINIO_ENDPOINT` | 이미지 스토리지 | Server | ☑ |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` | 스토리지 인증 | Server | ☑ |
| `JWT_SECRET` | JWT 서명 키 | Server | ☑ |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL` | 토큰 만료 시간 | Server | ☑ |
| `CORS_ORIGINS` | 허용 도메인 | Server | ☑ |
| `IMAGE_MAX_BYTES` | 이미지 단건 크기 제한 | Server | ☑ |

### 7.4 Pipeline Integration

| Phase | Status | Document Location | Command |
|-------|:------:|-------------------|---------|
| Phase 1 (Schema) | ☐ | `docs/01-plan/schema.md` | `/pipeline-next` |
| Phase 2 (Convention) | ☐ | `docs/01-plan/conventions.md` | `/pipeline-next` |

→ 본 Plan 승인 후 Phase 1(Schema) 진행 권장. DocumentJSON v1.0 + DB 스키마 확정.

---

## 8. Next Steps

1. [ ] **본 Plan 검토 및 승인** (사업부 IT 리드)
2. [ ] **Design 문서 작성**: `/pdca design MX-WhitePaper`
   - DocumentJSON v1.0 정식 명세 (JSON Schema 파일)
   - DB ER 다이어그램 + 마이그레이션 v1
   - REST API 명세(OpenAPI 초안)
   - 에디터 상태 머신(읽기/빠른편집/전체편집)
   - 이미지 업로드 시퀀스 다이어그램
   - 컴포넌트 트리 + 라우팅
3. [ ] **Phase 0 착수**: 모노레포 골격, **Apptainer 인프라**(`.def` + 스크립트)
4. [ ] **시드 데이터 준비**: 실 업무 백서 샘플 5건 수집
5. [ ] **Sprint 1 킥오프**: 조직 계층 CRUD + DocumentJSON 스키마 v1.0

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-05-06 | Initial draft (PROJECT_PLAN.md 기반 PDCA Plan 승격). LLM/Word 변환 Phase 4 후순위, 이미지·캡션 UX P0 강조 | squall321@gmail.com |
