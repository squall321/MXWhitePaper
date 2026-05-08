---
template: do
version: 1.0
feature: MX-WhitePaper
date: 2026-05-06
author: squall321@gmail.com
project: MX White Paper (사업부 지식 창고)
project_version: 0.1.0
---

# MX-WhitePaper Implementation Guide

> **Summary**: 모노레포 + **Apptainer 인프라** 골격 → DocumentJSON 스키마 SSOT → 6 Sprint MVP 구현. 본 문서는 마스터 진행 체크리스트이며, Sprint별 상세는 §3 참조.
>
> **Project**: MX White Paper
> **Version**: 0.1.0
> **Author**: squall321@gmail.com
> **Date**: 2026-05-06
> **Status**: In Progress
> **Plan Doc**: [MX-WhitePaper.plan.md](../../01-plan/features/MX-WhitePaper.plan.md)
> **Design Doc**: [MX-WhitePaper.design.md](../../02-design/features/MX-WhitePaper.design.md)

---

## 1. Pre-Implementation Checklist

### 1.1 Documents Verified
- [x] Plan reviewed: `docs/01-plan/features/MX-WhitePaper.plan.md`
- [x] Design reviewed: `docs/02-design/features/MX-WhitePaper.design.md`
- [ ] Master Plan (`PROJECT_PLAN.md`) 최종 확인
- [ ] 컨벤션은 Design §10에 통합 — 별도 `CONVENTIONS.md` 추출 여부 결정

### 1.2 Environment Ready
- [ ] **Apptainer ≥ 1.2** 설치 (`apptainer --version`, root-less 설치 가능)
- [ ] Node 20 LTS + pnpm 9 (호스트 — 스키마 codegen + lint)
- [ ] Python 3.12 + `pip install --user datamodel-code-generator` (호스트 — Pydantic 모델 생성)
- [ ] `.env`는 `.env.example`에서 복사 후 시크릿 채우기
- [ ] Git 초기화 + Conventional Commits 훅(commitlint + husky)
- [ ] (선택) `apptainer instance list`가 정상 동작하는 사용자 권한 확인

---

## 2. Master Implementation Roadmap (6 Sprints + Sprint 0 Foundation)

> Design §11.2의 39개 작업을 Sprint별로 묶었다. 각 Sprint = 약 1주.

| Sprint | 목표 | 산출물 | 상태 |
|:------:|------|--------|:----:|
| **0** | Foundation | 모노레포 + **Apptainer 인프라** + 스키마 SSOT + CI | ☐ |
| **1** | 조직 + 문서 CRUD | divisions/teams/groups/parts API + 문서 GET/POST/PUT/DELETE + 트리 네비 | ☐ |
| **2** | Reader | Section 자동 번호 + Block 렌더 + Infobox + TOC | ☐ |
| **3** | WikiLink + 레이아웃 | `[[..]]` 파서 + 빨간 링크 + 백링크 + 3-column | ☐ |
| **4** | ⭐ Editor MVP | BlockNote + Outline + SlashCommand + Section PATCH + Optimistic Lock | ☐ |
| **5** | ⭐ 이미지·캡션 UX | presigned 업로드 + EXIF/WebP/3sizes + 인라인 캡션 + 갤러리 | ☐ |
| **6** | 위젯 + 검색 + 인증 | Chart/Video Block + Meilisearch + JWT/RBAC + E2E 5종 | ☐ |

---

## 3. Implementation Order — Sprint 0 (Foundation, 즉시 착수 권장)

### 3.1 Phase 1: Repo & Tooling

| Priority | Task | File/Location | Status |
|:--------:|------|---------------|:------:|
| 1 | pnpm workspace + uv 모노레포 골격 | `package.json`, `pnpm-workspace.yaml`, `apps/*/`, `packages/*/` | ☐ |
| 2 | TypeScript / ESLint / Prettier 설정 | `tsconfig.base.json`, `.eslintrc.json`, `.prettierrc` | ☐ |
| 3 | Ruff / Pyright 설정 | `apps/api/pyproject.toml` | ☐ |
| 4 | commitlint + husky | `.husky/`, `.commitlintrc.js` | ☐ |
| 5 | `.env.example` + `dotenv-vault` 또는 `pydantic-settings` | `.env.example`, `apps/api/app/core/config.py` | ☐ |

### 3.2 Phase 2: Schema SSOT (Critical)

| Priority | Task | File/Location | Status |
|:--------:|------|---------------|:------:|
| 6 | DocumentJSON v1.0 JSON Schema 작성 | `packages/shared/schemas/document.json` | ☐ |
| 7 | TS 타입 codegen (json-schema-to-typescript) | `packages/shared/codegen/generate-ts.mjs` → `apps/web/src/types/document.ts` | ☐ |
| 8 | Pydantic 모델 codegen (datamodel-code-generator) | `packages/shared/codegen/generate-py.py` → `apps/api/app/schemas/document.py` | ☐ |
| 9 | 골든 샘플 5건 작성 + 스키마 검증 테스트 | `packages/shared/samples/*.json`, `packages/shared/tests/` | ☐ |

### 3.3 Phase 3: Infra (Apptainer)

| Priority | Task | File/Location | Status |
|:--------:|------|---------------|:------:|
| 10 | postgres 15 + pgvector (`.sif` pull) | `infra/scripts/build.sh` (docker://pgvector/pgvector:pg15) | ☐ |
| 11 | meilisearch 1.x (`.sif` pull) | `infra/scripts/build.sh` (docker://getmeili/meilisearch:v1.10) | ☐ |
| 12 | minio + mc 클라이언트 (`.sif` pull) | `infra/scripts/build.sh` | ☐ |
| 13 | api `.def` 빌드 (FastAPI bind-mount + hot-reload) | `infra/apptainer/api.def` | ☐ |
| 14 | web `.def` 빌드 (Vite dev bind-mount) | `infra/apptainer/web.def` | ☐ |
| 15 | orchestration 스크립트 | `infra/scripts/{_common,build,start,stop,status,logs,migrate,seed}.sh` | ☐ |
| 16 | host network 포트 매핑 + bind-mount 데이터 디렉토리 | `infra/data/{postgres,meili,minio}/`, `.env` 포트 | ☐ |

### 3.4 Phase 4: DB & Migrations

| Priority | Task | File/Location | Status |
|:--------:|------|---------------|:------:|
| 17 | Alembic 초기화 | `apps/api/alembic.ini`, `apps/api/alembic/env.py` | ☐ |
| 18 | 초기 마이그레이션 (Design §3.2 DDL 전체) | `apps/api/alembic/versions/0001_init.py` | ☐ |
| 19 | `documents_flat_v` materialized view | `apps/api/alembic/versions/0002_search_view.py` | ☐ |
| 20 | 시드 스크립트 (조직 + 문서 5건) | `apps/api/app/scripts/seed.py` | ☐ |

### 3.5 Phase 5: CI/CD

| Priority | Task | File/Location | Status |
|:--------:|------|---------------|:------:|
| 21 | GitHub Actions: lint + type-check + test | `.github/workflows/ci.yml` | ☐ |
| 22 | matrix: ubuntu / macos / windows | `.github/workflows/ci.yml` | ☐ |
| 23 | OWASP ZAP baseline 스캔 (PR마다) | `.github/workflows/zap.yml` | ☐ |
| 24 | Apptainer .sif 빌드 (self-hosted runner / 또는 nightly) | `.github/workflows/apptainer-build.yml` | ☐ |

### 3.6 Sprint 0 Definition of Done
- [ ] **`make up` (= `./infra/scripts/start.sh`) 한 번에 5개 Apptainer instance(postgres/meilisearch/minio/api/web) 기동.** host network 모드. `make build`로 사전 `.sif` 빌드/풀 후 instance start
- [ ] `make migrate` (alembic upgrade head) 성공
- [ ] `make seed` (시드 적재) 성공
- [ ] FastAPI Swagger(`/docs`) 응답 / Vite dev(`/`) 응답
- [x] **FR-17 codegen drift 자동화 (CI + pre-commit)** ✓
  - `make codegen` (= `pnpm schema:gen` + `python3 apps/api/app/scripts/dump_openapi.py`) 한 번이 TS / Pydantic / OpenAPI 스냅샷 모두 갱신.
  - CI: `schema` 잡(3 OS matrix)이 codegen 결과를 `git diff --exit-code`로 검사하고, 새 `openapi-drift` 잡(ubuntu)이 FastAPI 런타임 스펙 드리프트를 잡는다. 두 잡 모두 path-filter(`packages/shared/schemas/**` · `apps/api/app/**`)로 트리거.
  - pre-commit hook: schema codegen + (apptainer api 인스턴스가 떠 있거나 호스트 fastapi 가능 시) `dump_openapi.py`를 5초 이내에 실행 후 drift 차단. 둘 다 불가능하면 경고만 띄우고 통과(CI에서 보강).
  - baseline 확립: `make codegen` → `git add apps/web/src/types/document.ts apps/api/app/schemas/document.py apps/api/openapi.json` → 커밋.
- [ ] **골든 샘플 5건**: `packages/shared/samples/*.json`이 Ajv(JS) + jsonschema(Py) 양쪽 검증 통과
- [ ] **타입 사용 검증**: 생성된 TS/Python 타입을 import한 stub 코드(`apps/web/src/types/__check__.ts`, `apps/api/app/schemas/__check__.py`)가 컴파일/타입체크 통과
- [ ] **CI 3 OS matrix**: `web`/`schema`/`api` 모든 잡이 ubuntu/macos/windows에서 통과 (Ajv path/EOL 이슈 회귀 방지)
- [ ] OWASP ZAP baseline 스캔 Critical/High 0건

---

## 4. Key Files to Create (Sprint 0)

### 4.1 New Files

| File Path | Purpose |
|-----------|---------|
| `package.json` (root) | workspace 설정, 스크립트 모음 |
| `pnpm-workspace.yaml` | apps/* + packages/* 워크스페이스 |
| `apps/web/package.json` | Vite + React + TS |
| `apps/web/vite.config.ts` | Vite 설정 (alias `@/`, proxy `/api`) |
| `apps/api/pyproject.toml` | FastAPI 의존성 |
| `apps/api/app/main.py` | FastAPI 엔트리(헬스 체크만 우선) |
| `apps/api/app/core/config.py` | pydantic-settings 환경 변수 |
| `apps/api/app/core/db.py` | SQLAlchemy async 엔진 + 세션 |
| `apps/api/alembic/versions/0001_init.py` | 초기 스키마 |
| `packages/shared/schemas/document.json` | DocumentJSON v1.0 SSOT |
| `packages/shared/codegen/generate-ts.mjs` | TS 타입 생성 |
| `packages/shared/codegen/generate-py.py` | Pydantic 모델 생성 |
| `infra/apptainer/api.def` | FastAPI Apptainer 빌드 정의 (Bootstrap: docker, From: python:3.12-slim) |
| `infra/apptainer/web.def` | Vite Apptainer 빌드 정의 (Bootstrap: docker, From: node:20) |
| `infra/scripts/_common.sh` | 공통 env/paths/instance 헬퍼 |
| `infra/scripts/build.sh` | `.sif` 풀/빌드 (postgres/meili/minio/mc/api/web) |
| `infra/scripts/start.sh` | 5개 instance 순차 기동 + healthcheck + bucket init |
| `infra/scripts/stop.sh` `status.sh` `logs.sh` `migrate.sh` `seed.sh` | 운영 스크립트 |
| `Makefile` | `make build`, `make up`, `make migrate`, `make seed`, `make status`, `make logs SVC=api` |
| `.env.example` | 모든 필요 환경 변수 |
| `.github/workflows/ci.yml` | lint/type/test matrix |
| `README.md` | 1분 시작 가이드 |

### 4.2 No Files to Modify
> 신규 프로젝트 — 전부 새 파일 생성

---

## 5. Dependencies

### 5.1 Frontend (apps/web)
```bash
pnpm --filter web add react react-dom react-router-dom \
  @tanstack/react-query zustand axios \
  react-markdown remark-gfm rehype-sanitize \
  recharts react-hook-form zod \
  @blocknote/react @blocknote/core \
  tailwindcss postcss autoprefixer

pnpm --filter web add -D vite @vitejs/plugin-react typescript \
  vitest @testing-library/react @playwright/test \
  eslint prettier @types/react @types/react-dom
```

### 5.2 Backend (apps/api) — `uv` 또는 `poetry`
```bash
# uv 기준
uv add fastapi 'uvicorn[standard]' \
  sqlalchemy alembic asyncpg \
  pydantic pydantic-settings \
  'python-jose[cryptography]' argon2-cffi python-multipart \
  boto3 Pillow meilisearch slowapi structlog httpx
uv add --dev pytest pytest-asyncio ruff pyright httpx pytest-postgresql
```

### 5.3 Shared (packages/shared)
```bash
pnpm --filter shared add -D json-schema-to-typescript ajv ajv-formats
# Python 측 codegen
uv add --dev datamodel-code-generator
```

---

## 6. Implementation Notes

### 6.1 Design Decisions Reference (요약)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| FE Framework | React + Vite + TS | SPA, SEO 불요, 빌드 속도 |
| State Management | TanStack Query + Zustand | 서버 상태 위주 |
| Editor | BlockNote → 한계 시 TipTap | MVP 가속 + Block 추상화 |
| Styling | Tailwind + shadcn/ui (커스텀) | 나무위키 룩앤필 자유도 |
| BE | FastAPI + Pydantic v2 + SQLAlchemy 2.0 | OpenAPI 자동, JSON 친화 |
| DB | PostgreSQL 15 + JSONB + pgvector | 문서 저장 + 추후 임베딩 |
| Search | Meilisearch | 한국어 양호, 셋업 단순 |
| Storage | MinIO (S3 호환) | 사내 운영, presigned URL |
| Concurrency | Optimistic Locking (etag) | 동시 편집 충돌 명시적 처리 |

### 6.2 Code Patterns

#### Section 자동 번호 매김 (Pydantic validator)
```python
# apps/api/app/services/section_numbering.py
def renumber(sections: list[Section], prefix: str = "") -> None:
    for i, sec in enumerate(sections, start=1):
        sec.number = f"{prefix}{i}" if not prefix else f"{prefix}.{i}"
        if sec.subsections:
            assert all(c.level == sec.level + 1 for c in sec.subsections), \
                "child level must be parent + 1"
            renumber(sec.subsections, sec.number)
```

#### TanStack Query 표준 훅 (FE)
```typescript
// apps/web/src/features/document/hooks/useDocument.ts
export function useDocument(slug: string) {
  return useQuery({
    queryKey: ['document', slug],
    queryFn: () => documentService.get(slug),
    staleTime: 60_000,
  })
}
```

#### Optimistic Locking (BE)
```python
# apps/api/app/services/document_service.py
async def update_section(slug: str, section_id: str, patch: SectionPatch, if_match: str):
    doc = await repo.get_by_slug(slug)
    if etag(doc) != if_match:
        raise ConflictError(412, "etag mismatch")
    # ... apply patch, bump version, save, return new etag
```

### 6.3 Things to Avoid
- [ ] Raw SQL 직접 작성 (SQLAlchemy 파라미터 바인딩만)
- [ ] `dangerouslySetInnerHTML` (rehype-sanitize 통과 후 사용)
- [ ] FE에서 Infrastructure 직접 import (`apiClient`는 `services/`만)
- [ ] 인라인 스타일 (Tailwind 토큰 사용)
- [ ] `console.log` 잔재 (eslint rule로 차단)
- [ ] 비동기 폭주 (이미지 변환은 BackgroundTasks/Celery로 분리)

### 6.4 Architecture Checklist
- [ ] Presentation → Application → Domain 의존 방향 준수
- [ ] Domain은 외부 의존 없음 (자동 생성된 `schemas/document.py` 단독)
- [ ] Repos는 Service 통해서만 호출

### 6.5 Convention Checklist (Design §10)
- [ ] FE: PascalCase 컴포넌트 / kebab-case 폴더
- [ ] BE: snake_case 모듈 / PascalCase 클래스
- [ ] API route: kebab-case (`document-versions`)
- [ ] DB table: snake_case plural

### 6.6 Security Checklist (Design §7)
- [ ] 입력 검증: Pydantic strict + Zod (양단)
- [ ] JWT httpOnly cookie 또는 Authorization 헤더 통일
- [ ] CSRF: SameSite=Lax + Origin 검증
- [ ] 업로드: mime + magic bytes + EXIF 제거
- [ ] Rate limiting: nginx + slowapi
- [ ] OWASP ZAP CI baseline

### 6.7 API Checklist (Design §4)
- [ ] 응답 포맷 `{ data, meta?, error? }` 일관
- [ ] ETag/If-Match 동시성 제어
- [ ] OpenAPI summary/description 모든 엔드포인트
- [ ] 표준 에러 코드 사용

---

## 7. Testing Checklist (각 Sprint 완료 시)

### 7.1 Unit
- [ ] Section 번호 매김(prefix/level 검증)
- [ ] WikiLink 파서(엣지 케이스: 중첩 `[[..]]`, 앵커, 표시 텍스트)
- [ ] Pydantic 스키마 검증(골든 샘플)

### 7.2 Integration
- [ ] 모든 라우터 happy path + 4xx 케이스
- [ ] Optimistic Locking 412
- [ ] 이미지 업로드 init→PUT→finalize 흐름 (mock S3)

### 7.3 E2E (Sprint 6 종료 시)
- [ ] 작성→저장→검색→읽기
- [ ] 이미지 드래그→캡션→저장
- [ ] 위키 링크 빨강→작성→백링크
- [ ] Outline 드래그로 1.1↔1.2.1 변경
- [ ] 동시 편집 → 충돌 머지 UX

---

## 8. Progress Tracking

### 8.1 Daily Progress

| Date | Sprint | Tasks Completed | Notes |
|------|--------|-----------------|-------|
| 2026-05-06 | — | Plan/Design/Do 문서 작성 | PDCA Plan→Design→Do 진입 |
|  |  |  |  |

### 8.2 Blockers

| Issue | Impact | Resolution |
|-------|--------|------------|
| _(없음)_ | — | — |

---

## 9. Post-Implementation

### 9.1 MVP Self-Review Checklist (Sprint 6 종료 후)
- [ ] Design FR-01 ~ FR-14, FR-18 모두 구현
- [ ] 시드 100건 적재 + 5명 시범
- [ ] JSON-First API 100% (OpenAPI 자동 export)
- [ ] BE 도메인 테스트 ≥ 80% / FE 컴포넌트 ≥ 70%
- [ ] E2E 5종 통과
- [ ] Lighthouse Performance ≥ 85, Accessibility ≥ 95
- [ ] CI 3 OS 통과

### 9.2 Ready for Check Phase
```bash
/pdca analyze MX-WhitePaper
```

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-05-06 | Initial Do guide. Sprint 0 Foundation 상세화 + 마스터 6 Sprint 로드맵 | squall321@gmail.com |
