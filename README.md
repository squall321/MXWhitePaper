# MX White Paper

> 사업부 지식 창고 — 나무위키 스타일 + 1/1.1/1.1.1 계층 + Block 기반 위젯 + JSON-First REST API

[![docs](https://img.shields.io/badge/docs-PROJECT__PLAN-1428A0)](./PROJECT_PLAN.md)
[![PDCA](https://img.shields.io/badge/PDCA-Sprint__0-2E5BFF)](./docs/03-do/features/MX-WhitePaper.do.md)

---

## 1분 시작 가이드 (Apptainer 기반)

> 본 프로젝트는 **Apptainer**로 운영됩니다(Docker 아님). HPC 친화적, root 불필요, single-`.sif` 이미지.

### 한 줄 시작 — 권장

```bash
./quickstart.sh
```

[quickstart.sh](quickstart.sh)가 8단계(preflight → .env → host deps → codegen → 이미지 빌드 → instance 기동 → 마이그/시드 → status)를 멱등하게 실행합니다. 재실행 시 완료 단계는 자동 skip.

| 옵션 | 동작 |
|------|------|
| `./quickstart.sh` | 처음부터 끝까지 실행 |
| `./quickstart.sh --only-7` | 상태 확인만 |
| `./quickstart.sh --skip-2 --skip-3` | 호스트 deps·codegen 건너뛰기 |
| `./quickstart.sh --help` | 전체 단계 설명 |

### 사전 요구사항

- **apptainer ≥ 1.2** (`apptainer --version`)
- pnpm 9 + node 20 (호스트, 스키마 codegen용)
- python 3.12 (호스트, datamodel-code-generator 실행용)

### 수동 실행 (단계별 이해 원할 때)

```bash
# 1) 환경 변수
cp .env.example .env

# 2) 호스트 의존성
pnpm install
pip install --user datamodel-code-generator

# 3) 스키마 → TS·Python 타입 + OpenAPI 스냅샷 + baseline 커밋 (최초 1회)
make codegen   # = pnpm schema:gen + python3 apps/api/app/scripts/dump_openapi.py
git add apps/web/src/types/document.ts apps/api/app/schemas/document.py apps/api/openapi.json
git commit -m "chore: codegen baseline"

# 4) Apptainer 이미지 빌드/풀 (한 번만)
make build

# 5) 전체 스택 기동 (5개 instance, host network)
make up

# 6) 마이그레이션 + 시드
make migrate && make seed

# 7) 상태/접속
make status
# Web:   http://localhost:5173
# API:   http://localhost:8000/docs   (Swagger)
# Meili: http://localhost:7700
# MinIO: http://localhost:9001        (콘솔)

# 정지
make down       # 데이터(infra/data/) 보존
make clean      # .sif + 데이터 모두 삭제 (DESTRUCTIVE)
```

> **운영 환경 차이**: Apptainer instance는 host network로 실행되므로 모든 서비스가 `127.0.0.1:PORT`로 통신합니다. Docker Compose의 internal DNS와 다른 점에 유의.

## 모노레포 구조

```
MXWhitePaper/
├── apps/
│   ├── web/                   # React + TS + Vite (SPA)
│   └── api/                   # FastAPI + SQLAlchemy + Alembic
├── packages/
│   └── shared/                # DocumentJSON v1.0 SSOT (JSON Schema → TS + Python)
├── infra/                     # Docker Compose, nginx, devcontainer
├── docs/                      # PDCA: plan / design / do / analysis / report
└── PROJECT_PLAN.md            # 종합 계획서
```

## 핵심 문서

| 문서 | 위치 |
|------|------|
| 종합 계획서 | [PROJECT_PLAN.md](./PROJECT_PLAN.md) |
| PDCA Plan | [docs/01-plan/features/MX-WhitePaper.plan.md](./docs/01-plan/features/MX-WhitePaper.plan.md) |
| PDCA Design | [docs/02-design/features/MX-WhitePaper.design.md](./docs/02-design/features/MX-WhitePaper.design.md) |
| PDCA Do (Sprint 0) | [docs/03-do/features/MX-WhitePaper.do.md](./docs/03-do/features/MX-WhitePaper.do.md) |
| Document JSON 스키마 SSOT | [packages/shared/schemas/document.json](./packages/shared/schemas/document.json) |

## 기술 스택

- **Frontend**: React 18 · TypeScript · Vite · TanStack Query · Zustand · Tailwind · BlockNote · Recharts
- **Backend**: FastAPI · Pydantic v2 · SQLAlchemy 2.0 (async) · Alembic
- **Storage**: PostgreSQL 15 (JSONB + pgvector) · Meilisearch · MinIO
- **Infra**: Docker Compose · devcontainer · GitHub Actions matrix(Win/Mac/Linux)

## 개발 명령어

```bash
make help              # 모든 명령 보기
make up | down         # 서비스 기동/중지
make logs SVC=api      # 로그 확인
make migrate | seed    # 마이그레이션·시드
make schema-gen        # 타입 재생성
make codegen           # 타입 재생성 + FastAPI OpenAPI 스냅샷 (커밋 전 실행)
make test | lint       # 테스트·린트
```

## API 한 번 호출로 페이지 만들기

DocumentJSON v1.0 한 파일만 있으면 위키 페이지가 즉시 만들어집니다.

```bash
# 1) 파일 import (멱등 — 같은 slug 재실행하면 PUT 으로 동작)
apptainer exec instance://mxwp_api /bin/sh -c \
  "cd /workspace/apps/api && python -m app.scripts.import_one /workspace/packages/shared/samples/01-month-end-closing.json"
# → {"mode":"replace", "slug":"month-end-closing",
#    "version":2, "url":"/api/v1/documents/month-end-closing",
#    "tree_path":"/mx/finance/accounting/closing",
#    "warnings":[]}

# 2) HTTP 로 직접 POST 도 가능
curl -X POST http://localhost:8000/api/v1/documents \
  -H 'Content-Type: application/json' \
  --data @packages/shared/samples/05-minimal-doc.json
```

POST 한 번이면 다음이 모두 자동으로 수행됩니다:

- DocumentJSON 본문 검증 + 섹션 1/1.1/1.1.1 번호 부여
- `metadata.part` 가 한글 이름이어도 자동으로 part_id 로 해석 (해석 실패 시 `meta.warnings` 회신)
- 본문 내 `[[slug]]` (한글 slug 포함) 위키링크 그래프 갱신
- `metadata.tags` → `tags` + `document_tags` 동기화
- `glossary[]` → `terms.related_docs[]` 누적/제거 동기화
- Meilisearch 인덱스 + `documents_flat_v` materialized view 갱신
- `audit_logs` 감사 기록

자세한 입출력은 Swagger `/docs` 페이지에서 확인할 수 있습니다 (각 엔드포인트에 한국어 요약 + 예시).

## 라이선스

사내 전용 (UNLICENSED)
