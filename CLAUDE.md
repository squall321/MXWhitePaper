# MXWhitePaper — Claude Code 작업 룰

> 본 파일은 **자동 로드**된다. 작업 시작 전에 반드시 읽어라.

## 컨텍스트 최적화 — `docs/lat/` 를 우선 참조

본 리포지토리는 `~34k LOC` 의 FastAPI/Vite 풀스택이라 큰 파일을 통째
Read 하면 토큰이 빠르게 소진된다. **AI agent (= 당신) 이 코드를 만지기 전에
`docs/lat/` 의 해당 lat 문서 1 장을 먼저 Read 한다.**

| 작업 영역 | 먼저 읽을 lat |
| --- | --- |
| Word / PPT / CSV 가져오기, round-trip, TOC | `docs/lat/imports.md` |
| 문서 CRUD, DocumentJSON 스키마, ETag, 버전 | `docs/lat/documents.md` |
| docx/pptx/md/html/pdf 내보내기 | `docs/lat/export.md` |
| 이미지 업로드, MinIO, sha256 dedup | `docs/lat/storage.md` |
| 백업/복원 (PostgreSQL + MinIO 시점) | `docs/lat/snapshots.md` |
| 인증 / role / API token / 에러 envelope / 설정 | `docs/lat/core.md` |
| 위 분류가 헷갈리면 | `docs/lat/README.md` (인덱스 + 컨벤션) |

lat 안의 `[[src/path#sym]]` 링크가 가리키는 코드만 추가로 Read.
큰 파일 (`docx_import.py` 1837 줄, `document_service.py` 1682 줄 등) 을
처음부터 통째 읽지 말 것 — lat 문서가 어디를 봐야 할지 알려준다.

## lat 유지 룰

코드를 변경해서 lat 문서의 사실관계가 깨지면 **같은 작업에서 lat 도 수정**.

- 새 endpoint 추가 → 해당 lat 의 Endpoints 표 갱신
- 새 block type / 새 import 형식 추가 → 영향 받는 모든 lat (`documents` + `imports` +
  `export` 모두) 의 dispatcher 표 동기화
- 시그니처/계약이 바뀌면 lat 의 "핵심 진입점" 표 갱신
- 새 함정/제약을 발견하면 해당 lat 의 "Gotchas" 섹션에 추가

drift 가 의심되면 사용자에게 알릴 것 (수정해도 되는지 확인 후 반영).

## 환경 (apptainer)

- **Docker 가 아니다.** Apptainer (rootless) 다. `docker run` / `docker-compose`
  같은 명령은 동작하지 않는다.
- 컨테이너는 *instance* 로 떠 있다 — `mxwp_api`, `mxwp_web`, `mxwp_postgres`,
  `mxwp_meili`, `mxwp_minio`.
- 컨테이너 안 명령 실행:

  ```bash
  apptainer exec instance://mxwp_api bash -lc 'cd /workspace/apps/api && <cmd>'
  ```

- 테스트:

  ```bash
  apptainer exec instance://mxwp_api bash -lc \
    'cd /workspace/apps/api && python -m pytest tests/ -q'
  ```

- 호스트 코드는 컨테이너에 `/workspace` 로 마운트되어 있어 양쪽이 같은 파일을 본다.

## 작업 스타일 (지켜야 할 것)

- 사용자 요청 범위를 넘는 리팩토링 / 주석 추가 / "개선" 금지.
- 주석은 *왜*가 비자명할 때만. 코드가 무엇을 하는지는 식별자가 설명한다.
- 큰 함수도 책임이 단순하면 그대로 둔다 — 임의로 쪼개지 말 것.
- 시작 전 가정을 명시. 모호하면 사용자에게 물어볼 것.
- 작업이 완료되었다고 보고하기 전에 실제로 동작 확인 (테스트 실행 / curl /
  type check). UI 변경은 브라우저로 직접 확인.

## 다른 문서와의 관계

| 문서군 | 답하는 질문 |
| --- | --- |
| `docs/lat/` (= 이 룰의 대상) | **지금** 코드는 어떻게 생겼나? |
| `docs/01-plan/`, `docs/02-design/` (PDCA) | **왜 / 언제** 이렇게 만들기로 했나? |
| `docs/04-report/` | **무엇을** 만들었나 (완료 리포트) |
| `docs/deployment-playbook.md` | 어떻게 배포하나? |
| `docs/HWAX-PORTAL-INTEGRATION.md` | HWAX 포탈 서브경로(`/mx-white-paper/`) 서빙 — `MXWP_BASE_PATH`, build+preview |
| `docs/copilot/` | Copilot 에 위임할 작업 명세 |
| `docs/llm-document-formats.md` | 외부 LLM 이 import 될 docx/pptx 를 어떻게 만들어야 하나 |
| `docs/llm-widgets-via-api.md` | 외부 LLM 이 풍부한 위젯 (callout/chart/tabs 등) 을 어떻게 API 로 만드나 |

충돌 시 **코드가 진실**. lat 은 코드를 빠르게 탐색하기 위한 지도일 뿐.

## bkit (외부 도구) 와의 관계

본 리포지토리에 bkit 플러그인이 활성화되어 있으나, **lat 룰이 우선**한다.
bkit 의 PDCA 워크플로우는 새 기능을 계획할 때 사용 (`/pdca plan ...`),
실제 코드 탐색/구현은 lat → 코드 순으로 한다.
