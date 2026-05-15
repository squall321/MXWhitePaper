# MXWhitePaper Agent Lattice — index

> AI 코딩 에이전트 (Claude Code / Copilot / Codex 등) 가 본 리포지토리를
> 빠르게 이해하기 위한 **knowledge graph**. 마크다운 한 장이 코드 1000+ 줄을
> 대신 설명하므로 토큰을 절약한다. `lat.md` (<https://lat.md>) 컨벤션을
> 따르되 **CLI 도구 없이 마크다운만 사용** (mode A).

## 어떻게 읽나

1. **이 파일** (`README.md`) 로 시작 — 어느 모듈이 어디 있는지 본다.
2. 작업 대상 모듈의 lat 문서 1 장만 읽는다. 보통 100~300 줄.
3. 진짜 구현이 필요한 코드 진입점만 lat 의 `[[src/path#sym]]` 링크를
   따라 Read.

**원칙**: lat 파일 → 필요한 코드만 점프. lat 을 건너뛰고 큰 파일을 통째
Read 하는 패턴을 피한다.

## 컨벤션

```text
[[Concept]]                   # 다른 lat 개념 (같은 폴더의 다른 md 안의 섹션)
[[src/foo.py#bar]]            # 소스 코드 직접 참조 (함수/클래스명)
[[src/foo.py]]                # 소스 파일 전체
[[#section-id]]               # 같은 문서의 다른 섹션
```

- 섹션 헤더는 의미 있는 영어 id (`## Round-trip`, `## TOC detection`)
- 각 lat 문서 상단에 **모듈 목적 한 줄** + **연관 lat** 링크
- 본문은 "데이터 흐름 + 책임 + 함정 (gotchas)" 위주. API 시그니처 복사
  금지 (drift 발생).
- 새 함정/제약을 코드에서 발견하면 lat 도 같이 수정 — `git commit`
  관행으로 정착.

## Lattice 노드 (= 모듈 그룹)

| 노드 | 핵심 책임 | 주요 코드 |
| --- | --- | --- |
| [imports](imports.md) | Word/PPT/CSV → DocumentJSON, round-trip 정규화, TOC 처리 | `app/services/docx_import.py`, `app/services/docx_roundtrip.py`, `app/services/toc_extract.py`, `app/services/pptx_import.py`, `app/routers/imports.py` |
| [documents](documents.md) | DocumentJSON v1.0 schema, CRUD, ETag, versioning | `app/services/document_service.py`, `app/repos/document_repo.py`, `app/routers/documents.py` |
| [export](export.md) | DocumentJSON → docx/pptx/md/html 렌더 | `app/services/docx_export.py`, `app/services/pptx_export.py`, `app/services/html_renderer.py`, `app/services/markdown_export.py`, `app/routers/exports.py` |
| [storage](storage.md) | 이미지 업로드 파이프라인, MinIO, sha256 dedup | `app/services/upload_service.py`, `app/routers/uploads.py`, `app/routers/files.py` |
| [snapshots](snapshots.md) | PostgreSQL + MinIO 시점 백업/복원 | `app/services/snapshots.py`, `app/routers/snapshots.py`, `infra/scripts/snapshot.sh`, `infra/scripts/restore-snapshot.sh` |
| [core](core.md) | 인증 (`require_role`), 에러 envelope, 설정 (pydantic-settings) | `app/core/auth.py`, `app/core/errors.py`, `app/core/config.py`, `app/core/db.py` |

## 노드 간 의존 흐름

```text
                  ┌──────────────────────┐
                  │       core           │  ← 모두가 의존
                  │  (auth/errors/conf)  │
                  └──────────────────────┘
                            ▲
        ┌───────────────────┼───────────────────┐
        │                   │                   │
   ┌─────────┐         ┌─────────┐         ┌─────────┐
   │ imports │ ──────► │documents│ ◄────── │ export  │
   └─────────┘         └─────────┘         └─────────┘
        │                   │
        ▼                   ▼
   ┌──────────────────────────────┐
   │          storage             │  (이미지)
   └──────────────────────────────┘
                ▲
                │
   ┌──────────────────────────────┐
   │         snapshots            │  (PG + MinIO 일관성)
   └──────────────────────────────┘
```

## 환경 (apptainer)

본 프로젝트는 Docker 가 아니라 **Apptainer (rootless)** 로 동작.

| instance | 컨테이너 이미지 | 역할 |
| --- | --- | --- |
| `mxwp_api` | api.sif | FastAPI (포트 8000) |
| `mxwp_web` | web.sif | Vite/React 정적 서빙 (포트 5173/3000) |
| `mxwp_postgres` | postgres.sif | PostgreSQL 16 |
| `mxwp_meili` | meili.sif | Meilisearch (검색) |
| `mxwp_minio` | minio.sif | S3 호환 객체 스토리지 (이미지) |

테스트 실행은 항상 컨테이너 안:

```bash
apptainer exec instance://mxwp_api bash -lc \
  'cd /workspace/apps/api && python -m pytest tests/ -q'
```

## lat 외부 자료 (필요할 때)

- **LLM 용 docx/pptx 양식 가이드**: [`docs/llm-document-formats.md`](../llm-document-formats.md)
  — 외부 LLM 이 본 서버에 import 될 docx/pptx 를 생성할 때 따를 규칙
- **LLM 용 위젯 API 가이드**: [`docs/llm-widgets-via-api.md`](../llm-widgets-via-api.md)
  — docx/pptx 가 못 다루는 풍부한 위젯 (callout/chart/gantt/tabs/kpi-cards
  등) 을 DocumentJSON block API 로 직접 만드는 방법
- PDCA 계획/설계 문서: `docs/01-plan/`, `docs/02-design/`
- 배포: `docs/deployment-playbook.md`
- 이상적 그래프 (목표 상태): `docs/05-ideal-graph/`
- 본 lat 와 PDCA 의 관계: lat = "지금 코드가 어떻게 생겼나",
  PDCA = "왜/언제 이렇게 만들기로 했나". 충돌 시 코드가 진실.

## 갱신 정책

- 코드 변경 PR 이 lat 문서의 정확성을 깨뜨리면 **같은 PR 에서 lat 수정**.
- lat 만 수정하는 PR 도 가능 (오타/사실관계 정정).
- `lat check` 같은 자동 drift 검출은 현재 사용 안 함 — 리뷰 시 사람 눈으로.
