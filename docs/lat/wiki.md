# Wiki lat — LLM 위키(원천 · 변경 묶음 · 범위 · 작업) + 포털 위임 신원

> 모듈 목적: Karpathy 'LLM Wiki' 를 사내용으로 넓혀 MXWP 문서 위에 짓는다 — 불변 **원천**이 들어오면 AI 가 **변경 묶음**으로 위키 문서를
> 쓰고 고치며, 모든 사실 블록은 원천에 **근거**를 단다. DocumentJSON v1.0 은 바꾸지 않고 **옆 표**(`wiki_*`)에 둔다(WK-D2).
> 무엇을 · 왜는 [`docs/llm-wiki/request.md`](../llm-wiki/request.md), 정확한 꼴은 [`CONTRACTS.md`](../llm-wiki/CONTRACTS.md) — 지은 부분은
> **이 문서가 정본**이 되고 CONTRACTS 는 여기를 가리킨다.
>
> 연관 lat: [[core]](설정 · 인증 · 위임 신원) · [[documents]](반영 경로 · ETag · 저장 훅) · [[graph]](triple · 링크 그래프) ·
> [[glossary]](제안 → 승인 길) · [[chat]](LLM 클라이언트 · SSE) · [[storage]](첨부 · 버킷) · [[snapshots]](백업에 `wiki_*` 포함)

## 단계 — 지금 어디까지

| 단계 | 상태 | 이 문서의 절 |
| --- | --- | --- |
| W0 준비 | 봉투 모델 · 합성 원천 20 · 가짜 LLM · 설정 자리 | [[#Envelope]] · [[#Test bundle]] · [[#Fake LLM]] · [[#Settings]] |
| W1 연결 · 신원 | 위임 창구 · 위임 토큰(세대) · 소속 · 플랫폼 증명 · 진입 토큰 스냅숏 · jti 원장 · 소속→팀 표(API · 화면 `/admin/aff-team-map`) | [[core#게이트웨이 · 포털 위임]] |
| W2 보이기 범위 | 읽기 길 전수(아래 표) · 길마다 시험 · admin 범위 밖 읽기 감사. 남은 것 — cae00 배포 · 재색인 | [[#Audience]] |
| W3 원천 · 작업 | 표(원천 불변 · 작업 · 기록 덧붙이기만 · 워커 심장박동) · DB 큐 · 워커(0052). 남은 것 — 받기 REST · 원천 문서 · /health · 인스턴스 | [[#Sources · Jobs]] |
| W4 들이기 ~ W8 cae00 | (아직) | — |

## 데이터 흐름(목표 — 지은 칸은 위 표)

```text
생산자 ──봉투 mxwp-source/1──▶ POST /api/v1/wiki/sources ──▶ wiki_sources(불변) + 버킷 wiki-sources
(포털 · 연결기 · 사람)          envelope.py 검증 · 멱등        │
                                                             ▼ wiki_jobs(DB 큐 · SKIP LOCKED)
                                          python -m app.wiki.worker(인스턴스 mxwp_wiki — API 와 다른 프로세스)
                                             준비 → 엔티티 해석 → 계획(LLM) → 쓰기(LLM) → 검증 V1~V11(코드)
                                                             │
                                  자동 반영 ◀────────────────┴────────────▶ 검토 큐(wiki_changesets pending_review)
                                  document_service 경로(ETag · 판 · 저장 훅 · 재색인) · wiki_citations · wiki_log
```

## 코드 자리

| 무엇 | 어디 | 상태 |
| --- | --- | --- |
| 원천 봉투(종류별 body) · 범위 토큰 정규화 · payload 해시 | [[src/app/wiki/envelope.py#SourceEnvelope]] · `normalize_audience` | W0 |
| 범위 계산 · 저장소 층 필터 · 읽는 사람 문맥 | [[src/app/wiki/audience.py]] · 표 `wiki_pages`(0051) | W2 |
| DB 큐 · 워커(처리기 등록부) | [[src/app/wiki/jobs.py]] · [[src/app/wiki/worker.py#run_once]] · 표 `wiki_sources` · `wiki_jobs` · `wiki_log` · `wiki_workers`(0052) | W3 |
| 받기 · 멱등 · 철회 · 원천 문서 | `app/wiki/sources.py` | W3 |
| LLM(구조화 출력) · 해석 · 계획 · 쓰기 · 검증 · 반영 | `app/wiki/{llm,resolve,plan,write,validate,apply}.py` | W4 |
| REST | `app/routers/wiki.py`(`/api/v1/wiki/*`) | W3~ |
| 위임 창구 · 회수 · 소속→팀 표 | [[src/app/routers/auth_sso.py]] · 검증 `core/auth._resolve_delegated` · 증명 `core/portal_identity.py` | W1 |

## Envelope

- 모르는 칸은 거부(`extra='forbid'`) — 조용히 버리지 않는다. 종류별 body 오류의 위치는 `body.…` 로 시작한다(`from_exception_data` 로 앞에 붙인다).
- 숫자는 늘 `{value, unit}`. 해석 조건(`setup.conditions`)도 `StrictStr | StrictBool | Quantity` 만 받는다 — 맨 숫자 1 이 `True` 나 `"1"` 로
  슬며시 바뀌지 않게.
- `audience` 정규화 — 중복 제거 · 정렬 · 다른 토큰과 함께인 `org` 는 뺀다(org ∧ X = X). 빈 목록 · 틀린 꼴 · 서로 다른 `aff:` 둘 ·
  `user:` 둘은 거부(만족하는 사람이 없다).
- `origin.url` 은 `/` 로 시작하는 상대 경로만(박스마다 호스트가 다르다). `captured_at` 은 시간대가 있어야 한다.
- 멱등 열쇠의 한 칸 `payload_sha256` = 정규화한 body(빈 선택 칸 뺌)의 정규 JSON(키 정렬 · 공백 없음) sha256.
- CONTRACTS §3 표에 꼴이 없던 셋은 이렇게 정했다 — `document{doc_slug, version}` · `note{text}` · `report.figures[{name, caption?,
  upload_id?}]`(그리고 `card.claims[].evidence` 는 글 · `inquiry_answer.confidence` 는 0~1).

## Audience

보이기 범위(CONTRACTS §2-11 · WK-D15 · D26~D28). 문서는 둘 다 맞아야 보인다 — ① `wiki_pages` 줄이 있으면 그 `audience` 토큰을 모두
가진 사람 ② `confidentiality=restricted` 면 작성자 · `document_reviewers` · metadata owners/reviewers 의 이메일 · admin.

| 무엇 | 어떻게 |
| --- | --- |
| 읽는 사람 | `Viewer`(user · system · anonymous). `get_current_user` 가 `viewer_from_user` 로 요청 문맥(ContextVar)에 두고, `ViewerContextMiddleware` 가 요청마다 비운다 |
| 토큰 | `org` · `user:<id>` 늘, `aff:` · `plat:` 은 `portal_access_at` 이 `ACCESS_MAX_AGE_H`(24) 안일 때만(위임 호출은 그 호출의 증명값) |
| 술어 | `visible_sql(alias)` + `sql_params()` — `documents` 별칭 하나에 붙인다. admin · system 은 `_aud_all` 로 통과 |
| 빠뜨림 | 문맥이 비면 `ViewerMissing`(조용히 새지 않고 깨진다). 배경 작업 `acting_as(SYSTEM)`, 공개 길 `acting_as(ANONYMOUS)`(`["org"]` · restricted 아님) |

거르는 자리(지금) — `document_repo.find_by_slug` · `find_by_id` · `list_documents` · `list_backlinks`(→ GET · 목록 · 판 · 내보내기 · 패치가 모두
`get_document_or_404` 로 지난다) · 공유 링크(만들기 403 · 열기 410) · oEmbed(좁은 위키 404) · 홈 히어로(전역 캐시라 익명 기준) · 오늘의
문서(사람 기준) · 링크 그래프(간선 · 노드 · 도메인 — 범위 밖은 `missing` 으로도 그리지 않고 뺀다) · 의존 그래프(캐시 열쇠에 범위) ·
triple(주어 · 목적어) · 검색 · suggest · 챗 `search_corpus`(Meili `aud1~3` · `readers` — [[documents#보이기 범위 거르기 (docs/llm-wiki W2)]]).
알림 · 메일 — 앱 안 알림은 **읽을 때 한 곳**(`GET /notifications` — payload `slug` 의 문서가 지금 보이나)에서 거르고(생산자 아홉 곳을 하나씩
막지 않는다), 메일은 보낼 때 받는 사람별로 `viewer_for_user` + `can_see`(구독 이벤트 · 결재 요청 · 자동화 · 알림 예약). 공유 링크 메일은
익명이 보는 문서만 링크가 생기므로 따로 막지 않는다. 바깥 밀어내기(AIDataHub)는 `GET /documents?audience=org`(익명 기준 목록).
재색인(`app.scripts.reindex`)은 뷰에 없는 색인 줄도 지운다 — 남으면 범위 칸 없이 이행기 규칙으로 제목이 뜬다.
그 밖의 목록 — 활동 피드(판 · 댓글 · 공유 · 북마크 · 검토) · 북마크 · 최근 열람 · 태그(구름은 공유 캐시라 익명 기준, 태그별 목록은 사람
기준) · 반응 · 시리즈 · 저장된 보기 · 알림 예약 · 구독 목록 · 검토 대기 · 분석(조회 감사 줄 `document:<slug>` 의 문서로) · 위젯
'최근 문서'(공유 캐시라 익명) · 용어의 관련 문서 · 댓글(문서를 못 보면 404). admin 이 자기 토큰으로 못 볼 문서를 꺼내면
`get_document_or_404` 가 감사 `document.read.admin_override` 를 남긴다(GET 은 커밋하지 않으니 따로 세션).
일부러 거르지 않는 곳 — `/admin/*`(admin 은 다 본다) · 백업 그리기(결과는 admin 만) · 관리자 태그 바꾸기 · triple 일괄 추출(admin).

시험 [[apps/api/tests/test_wiki_audience.py]] — 문서 여섯(org · aff · plat · aff+plat 위키, restricted, 보통) × 읽는 사람 여섯(소속 ·
플랫폼 · 없음 · 오래된 소속 · 작성자 · admin) × 길.

## Sources · Jobs

| 무엇 | 어떻게 |
| --- | --- |
| 원천 불변 | 트리거 `wiki_sources_guard` — 바꿀 수 있는 칸은 `status` · `ingest_state` · `doc_id` · `owner_user_id` · `submitted_by` 뿐. DELETE 는 트랜잭션 안 `SET LOCAL mxwp.wiki_purge = 'on'` 일 때만(시험 정리 · 손 정리) |
| 기록 | `wiki_log` 는 UPDATE 늘 거부 · DELETE 는 같은 스위치로만 |
| 집기 | `jobs.claim` — `queued`(not_before 지남) 또는 lease 지난 `running` 을 `FOR UPDATE SKIP LOCKED` 로 하나. 순서 `priority`(작을수록 먼저 — 묻기 `PRIORITY_INTERACTIVE` 10 · 배경 100) → `not_before` → `created_at`. 집은 순간 커밋 |
| lease | 워커가 lease 의 1/3 마다 `extend`. 못 늘리면(남이 다시 집음) 손을 뗀다. 상태를 바꾸는 쿼리는 모두 `worker = 나 AND state = 'running'` 을 본다 — lease 를 잃은 워커가 덮어쓰지 못한다 |
| 재시도 | `fail` → 시도가 남았으면 `queued` + `not_before` = 30s × 2^(시도−1), 아니면 `failed`. lease 만료로 다시 집힌 것도 시도에 든다 — 넘으면 집는 자리에서 `failed`(그 작업에서 워커가 거듭 죽어도 끝없이 돌지 않게) |
| 처리기 | `@worker.handler(op)` 로 등록. **처리기가 없는 op 는 집지 않는다** — 들이기(W4) 전에 받은 원천의 `ingest` 작업은 줄에서 기다린다. `noop`(args `sleep_s` · `fail`)은 점검용 |
| 꺼짐 | `WIKI_ENABLED` 가 꺼져 있으면 집지 않고 30초씩 쉰다(`wiki_workers.state='disabled'`) |
| 커밋 | `claim` 만 스스로 커밋한다. `enqueue` 등은 부르는 쪽이 — 원천 받기와 작업 줄 세우기를 한 트랜잭션에 넣는다 |

시험 [[apps/api/tests/test_wiki_jobs.py]] — 순서 · not_before · 워커가 죽은 뒤 다른 워커가 다시 집기 · 재시도 · 거듭된 lease 만료 · 불변 · 덧붙이기만.

## Test bundle

`apps/api/tests/fixtures/wiki/` — 합성 원천 20 장(해석 6 · 사례 4 · 집계 2 · 문답 5 · 심의 2 · 정정 1)과 일부러 심은 결함(모순 · 낡음 ·
빈틈 · 사람의 정정 · 연락처 꼴). 무엇이 어디 심겼는지는 그 폴더 `README.md`, 심겨 있는지는 [[apps/api/tests/test_wiki_w0.py]] 가 못 박는다.

## Fake LLM

[[apps/api/tests/fakes/fake_llm.py#FakeLLM]] — 진짜 소켓 위 HTTP 서버(stdlib `ThreadingHTTPServer`), 시험 픽스처 `fake_llm`(conftest).
위키 쓰기 시험은 이것만 쓴다 — **mock LLM 금지**(WK-D7).

- 꼴은 vLLM OpenAI 호환 — `tool_calls` 는 없을 때 `[]`(null 아님) · 도구 모드 `content` 는 null · `arguments` 는 JSON **글** ·
  모르는 모델 404 `The model \`x\` does not exist.` · `--api-key` 꼴 401 `{"error": "Unauthorized"}`.
- 오류 본문은 둘 다 낼 수 있다(`error_style`) — 새 vLLM · OpenAI `{"error": {...}}` / 옛 vLLM `{"object": "error", ...}`.
  **클라이언트(W4 `llm.py`)는 둘 다 읽어야 한다** — 박스의 vLLM 판을 dev 에서 확인하지 못했다(dev 에 닿는 LLM 이 없다, 10-24).
- 시나리오 결함은 500 — 맞는 규칙 없음 · `json` 답이 요청 스키마에 안 맞음(`conform`, 진짜의 유도 디코딩 흉내) · `capture` 실패.
- `stream: true` 는 아직 400 — 묻기(W6)가 스트리밍을 쓸 때 더한다.

## Settings

[[src/app/core/config.py#Settings]] — `WIKI_ENABLED`(기본 끔 → `/api/v1/wiki/*` 404) · 배경 `WIKI_LLM_{BASE_URL,MODEL,API_KEY}` ·
묻기 `WIKI_QUERY_LLM_*`(비면 배경과 같게) · 위임 `MXWP_SSO_SECRET`(비면 위임 창구 404) · `MXWP_SSO_JIT_CREATE`(기본 켬).
API 인스턴스는 `.env` 를 `_common.sh` 의 `set -a` 로 물려받는다 — 새 키에 start.sh `--env` 를 더할 필요가 없다.

## Gotchas

- **시험의 pytest · jsonschema 는 api.sif 안이 아니라 호스트 `~/.local` 에서 온다**(홈 마운트). `--no-mount home` 으로 sif 만 띄우면
  둘 다 없다. jsonschema 는 pyproject `dev` 에 적어 두었다.
- 이 리포의 시험은 **dev DB 를 그대로 쓴다** — 위키 시험이 만든 줄은 시험이 지운다(conftest 의 `sup-*` 정리와 같은 자세).
- `pytest -q` 는 addopts 의 `-q` 와 겹쳐 요약 줄이 숨는다 — 결과 줄을 남기려면 `-q` 없이 돌린다.
- **요청 밖에서 서비스 · 저장소를 직접 부르는 코드(시험 · CLI · 배경 작업)는 읽는 사람을 골라야 한다** — 안 고르면 `ViewerMissing`.
  시험은 `audience.set_viewer(audience.SYSTEM)` 또는 `with audience.acting_as(...)`. CLI(`scripts/import_one.py`)는 시작할 때 시스템으로.
- 시험 문서는 SQL 로 직접 넣는다 — `document_service.create_document` 는 dev Meili 색인 · 웹훅까지 부른다.
