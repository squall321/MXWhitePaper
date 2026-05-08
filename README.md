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

## Word(.docx) 가져오기

`POST /api/v1/imports/docx` (FE: `/docs/import`) — .docx 파일을 업로드하면
DocumentJSON v1.0 으로 변환합니다.

지원 (블록 변환표):

| docx feature | DocumentJSON 결과 |
| --- | --- |
| Heading 1/2/3 | `SectionLevel1/2/3` (스택 추적 + 자동 부모 보강) |
| Heading 4+ | `heading-4` 블록 |
| 일반 단락 | `paragraph` (markdown-lite: `**bold**`, `*italic*`, `~~strike~~`, `__underline__`) |
| 하이퍼링크 | `[label](url)` 인라인 |
| 표 | `table` 블록 (1행=headers, Caption 스타일 단락 → `meta.note`) |
| 그림(drawing) | `image` 블록 (sha256 dedup, `meta.width/height` 는 EMU→px) |
| OOXML 수식(`m:oMath`) | `math` 블록 (디스플레이) 또는 `$…$` (인라인) |
| 번호/불릿 리스트 | `list` 블록 (depth 는 2-space 들여쓰기) |
| 페이지 브레이크 | 빈 단락 + `meta.note='page-break-before'` |
| 각주 | 본문 끝 "각주" level-1 섹션 |

알려진 한계 / 폴백:

- **SmartArt** → 텍스트만 보존, 도형/관계는 손실됨.
- **임베디드 차트** → drawing 안의 raster image 만 추출 (chart 블록으로
  자동 변환 안 함).
- **복잡 수식** (matrix, accent, function with limits over) → 변환 실패 시
  `code` 블록 (`language='omml-xml'`) 으로 폴백.
- **Track changes / 코멘트** → 무시 (현재 텍스트만 사용).
- **헤더/푸터** → 본문에 포함하지 않음.
- **이미지 영속화**: 현 구현은 import 응답 시점에 placeholder ULID 만
  발급. 실제 MinIO 영속화는 추후 백그라운드 잡으로 분리 예정 (대량 이미지가
  포함된 .docx 의 import 지연을 피하기 위해).

제약:

- 크기 한도: **30 MB**
- 권한: editor 이상
- 레이트 리밋: **5/min/user**
- 응답은 DB 미기록. FE 가 받은 DocumentJSON 을 사용자 확인 후 별도로
  `POST /documents` 로 영구화한다 (이중 확인 UX).

## 전체 검증 (한 번에 schema + tsc + build + vitest)

`apps/web/scripts/check-all.sh` 는 회로(circuit) 4개를 차례로 돌려 “지금
스택이 통째로 컴파일 가능한가”를 한 번에 확인합니다. 새 widget·sample을
추가하거나 schema/렌더러를 손본 직후 마지막 게이트로 쓰세요.

```bash
chmod +x apps/web/scripts/check-all.sh   # 최초 1회
./apps/web/scripts/check-all.sh
# ▶ 1/4  Validate DocumentJSON samples       (pnpm --filter @mx/shared run validate)
# ▶ 2/4  TypeScript typecheck (@mx/web)
# ▶ 3/4  Vite build (@mx/web)
# ▶ 4/4  Vitest                              (apps/web — unit+integration, no e2e)
```

운영 노트:

- **샘플 9개 모두 valid** (`packages/shared/samples/01..09-*.json`) — schema 변경 시 가장 먼저 깨지는 게이트.
- **AllBlocksRender** (26 tests) + **AllBlockEditors** (21 tests) 가 SSOT 26 block
  타입의 read-mode/edit-mode 컴파일을 한 번에 보장합니다.
- BE에 샘플을 즉시 반영하려면 `python -m apps.api.scripts.seed_samples` (orgs/admin은 `app.scripts.seed`가 먼저 깔려있어야 함).

## 라이선스

사내 전용 (UNLICENSED)
