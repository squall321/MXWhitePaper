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
| W3 원천 · 작업 | 표(원천 불변 · 작업 · 기록 덧붙이기만 · 워커 심장박동) · DB 큐 · 워커(0052 · 0053) · 받기 · 원천 문서 · 철회 · 기록 · /health. 워커 인스턴스 `mxwp_wiki` · 덤프 · 합치기 제외. 남은 것 — cae00 배포(0052 · 0053 · 버킷 · wiki.sif) | [[#Sources · Jobs]] · [[#Intake]] · [[#REST]] |
| W4 들이기 · 검토 · 근거 | 표(0054 · 0055) · 규칙서(YAML 검증 · 판) · LLM 클라이언트 · 결정적 해석 · 계획 · 쓰기 · 검증 V1~V11 · 반영 · 되돌리기 · 검토 큐 · 근거 읽기. 목록 `index` · `index.md` · 규칙서 창구(`/schema` — admin 만) · 화면(홈 · 문서 머리띠 · 각주 · 원천 카드 · 검토 큐 · 기록 · 원천). 남은 것 — 규칙서 사람 재검토 | [[#Rule book]] · [[#LLM]] · [[#Ingest]] · [[#Validation]] · [[#Apply · Revert]] · [[#Review]] |
| W5 온톨로지 | 술어 표 첫 판 18(0056) · 유형 · 술어 제안 → admin 승인 · 거절 · 유형의 바깥 어휘 대응(`ext_axes`) · `doc_triples` 위키 칸 · 지운 문서의 triple 정리. 들이기의 관계(코드 · 계획) · '관계(자동)' 절 · 검토 화면의 관계 · 의미 관계 패널의 '위키' 표지 · 엔티티 등록부(보이기 · 별칭 · 외부 id · 중복 후보 · 합치기 — 늘 검토 · 되돌리기). 엔티티 후보 해석(열쇠 · 후보 · `wiki_resolve`) · 정답표 초안 · 평가 스크립트. 화면(온톨로지 · 엔티티 목록 · 한 건 · 합치기 카드). 남은 것 — 사람의 정답표 확인 · LLM 을 낀 정확도(진짜 LLM 이 있는 박스) | [[#Ontology]] · [[#Relations]] · [[#Entities]] · [[#Resolution]] |
| W6 묻기 · 되쌓기 · MCP | 묻기(`/query` SSE · 근거 각주 · MISS) · 질문 대기열(0057 · `/questions`) · 되쌓기(`/fileback` → qa 원천 → 문답 문서 · 비슷한 물음은 같은 문서에) · 후보(주인만 보는 held 원천 · `/candidates` · 화면 '내 후보' · 0058) · 제안(`/propose` — 늘 검토) · 기계 호출의 위키 문서 직접 쓰기 막음 · MCP `wiki_*` 열넷(`/search` · `/ask`) · 메인 챗 위키 모드([[chat#위키 모드]]) · 게이트웨이 `tools/list` 열넷 확인(10-24 포털 세션). 남은 것 — 포털 P6~P8 뒤 끝에서 끝 | [[#Query]] · [[#Fileback]] · [[#Candidates]] · [[#Propose]] · [[#MCP]] |
| W7 점검 · 지속 질의 | 예산 · 조용한 시간 · 묻기 우선(0059 — LLM 쓴 양 장부 · 묻기 표지) · 점검 아홉(결함 한 줄 · 빠진 링크 자동 고침 · 숫자 모순 메모 · 질문 · 밀린 검토 알림 0060 · 보고서 `lint-YYYYMMDD` · 반영 직후 작은 점검) · 지속 질의(위키 → 허용된 읽기 전용 도구 → 사람 · 실험 제안, 답은 `inquiry_answer` 원천) · 일정(밤 점검 · 상시 질문 · 지속 질의) · 사람의 답 · 들이기가 남긴 물음 · 화면(`/wiki/lint` · `/wiki/questions`) · 찾기 재현율 도구(Q11). 남은 것 — 게이트웨이 도구 PAT · 허용 목록(사람) · LLM 이 있는 박스의 실제 값(W8) | [[#Budget]] · [[#Lint]] · [[#Inquiry]] · [[#Query]] |
| W8 cae00 | (아직) | — |

## 데이터 흐름(목표 — 지은 칸은 위 표)

```text
생산자 ──봉투 mxwp-source/1──▶ POST /api/v1/wiki/sources ──▶ wiki_sources(불변) + 버킷 mxwp-wiki-sources
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
| 받기 · 멱등 · 철회 · 원천 문서 · 기록 | [[src/app/wiki/sources.py#receive]] · 문서 만들기 `document_service.create_document(wiki=…)` | W3 |
| 규칙서(YAML 검증 · 판) | [[src/app/wiki/schema.py#RuleBook]] · 저장 검사 `document_service.validate_documentjson` | W4 |
| LLM(구조화 출력) | [[src/app/wiki/llm.py#structured]] | W4 |
| 점검 아홉 · 결함 · 고침 묶음 · 보고서 | [[src/app/wiki/lint.py#run]](워커 처리기 `lint`) · 표 `wiki_lint_runs` · `wiki_lint_findings`(0059) | W7 |
| 예산 · 조용한 시간 · 묻기 우선 · 쓴 양 장부 | [[src/app/wiki/budget.py#gate]] · `background_turn` · `interactive_turn` · 표 `wiki_llm_usage` · `wiki_llm_turns`(0059) | W7 |
| 해석 · 후보 문서 | [[src/app/wiki/resolve.py#targets]] · 표 `wiki_entity_types` · `wiki_entities`(0054) | W4 |
| 온톨로지(유형 · 술어 · 제안 → 승인 · 정의역 · 치역) | [[src/app/wiki/ontology.py]] · 표 `wiki_predicates` · `doc_triples` 위키 칸(0056) | W5 |
| 엔티티 등록부(목록 · 별칭 · 외부 id · 중복 후보 · 합치기) | [[src/app/wiki/entities.py]] | W5 |
| 들이기(계획 · 쓰기 · 묶음 짓기) | [[src/app/wiki/ingest.py#run]](워커 처리기 `ingest`) | W4 |
| 검증 V1~V11 · 판정 | [[src/app/wiki/validate.py#run]] · `decide` | W4 |
| 문서 내용(빈 꼴 · 연산 적용 · 자동 절) | [[src/app/wiki/pages.py#apply_ops]] | W4 |
| 반영 · 되돌리기 · 근거 | [[src/app/wiki/apply.py#apply]] · `revert` · 표 `wiki_changesets` · `wiki_citations`(0054) | W4 |
| 검토 큐 | [[src/app/wiki/review.py]] · 표지 `users.wiki_reviewer`(0055) | W4 |
| 목록(index · index.md) | [[src/app/wiki/catalog.py#build]] | W4 |
| 묻기(근거 모으기 · 스트리밍 답 · 각주 · MISS) | [[src/app/wiki/query.py#run]] | W6 |
| 질문 대기열(남기기 · 한 건 · 바꾸기 · 사람의 답) | [[src/app/wiki/questions.py#add]] · `get` · `update` · `answer` · 표 `wiki_questions`(0057 · 0059 시도 · detail) | W6 · W7 |
| 지속 질의 | [[src/app/wiki/inquire.py#run]](워커 처리기 `inquire`) · 읽기 전용 도구 [[src/app/wiki/tools.py#Session]] | W7 |
| 일정(밤 점검 · 상시 질문 · 지속 질의) | [[src/app/wiki/schedule.py#tick]] · 표 `wiki_schedule`(0059) | W7 |
| 되쌓기(묻기의 답 → qa 원천) | [[src/app/wiki/fileback.py#fileback]] | W6 |
| 후보('내 후보' — 승인 · 버림 · 기한) | [[src/app/wiki/candidates.py]] · 받기의 후보 길 `sources.receive(held=…)` | W6 |
| 제안(바깥 에이전트 · 사람의 위키 쓰기 — 늘 검토) · 기계 호출의 직접 쓰기 막음 | [[src/app/wiki/propose.py#propose]] · [[src/app/core/auth.py#_guard_wiki_writes]] | W6 |
| 규칙서 문서 올리기 | [[src/app/wiki/schema_doc.py#put]] | W4 |
| 화면(apps/web) | [[src/features/wiki/api.ts]] · [[src/features/wiki/WikiCitations.tsx]] · `pages/Wiki{Home,Source,Changes,Log}.tsx` | W4 |
| REST | [[src/app/routers/wiki.py]](`/api/v1/wiki/*`) | W3~ |
| 위임 창구 · 회수 · 소속→팀 표 | [[src/app/routers/auth_sso.py]] · 검증 `core/auth._resolve_delegated` · 증명 `core/portal_identity.py` | W1 |

## Envelope

- 모르는 칸은 거부(`extra='forbid'`) — 조용히 버리지 않는다. 종류별 body 오류의 위치는 `body.…` 로 시작한다(`from_exception_data` 로 앞에 붙인다).
- 숫자는 늘 `{value, unit}`. 해석 조건(`setup.conditions`)도 `StrictStr | StrictBool | Quantity` 만 받는다 — 맨 숫자 1 이 `True` 나 `"1"` 로
  슬며시 바뀌지 않게.
- `audience` 정규화 — 중복 제거 · 정렬 · 다른 토큰과 함께인 `org` 는 뺀다(org ∧ X = X). 빈 목록 · 틀린 꼴 · 서로 다른 `aff:` 둘 ·
  `user:` 둘은 거부(만족하는 사람이 없다).
- `origin.url` 은 `/` 로 시작하는 상대 경로만(박스마다 호스트가 다르다). `captured_at` 은 시간대가 있어야 한다.
- 멱등 열쇠 = (시스템 · ref · 판 · `payload_sha256` · 범위) — 범위는 0058 부터(후보를 고른 범위로 승인하면 새 줄). `payload_sha256` = 정규화한 body(빈 선택 칸 뺌)의 정규 JSON(키 정렬 · 공백 없음) sha256.
- CONTRACTS §3 표에 꼴이 없던 셋은 이렇게 정했다 — `document{doc_slug, version}` · `note{text}` · `report.figures[{name, caption?,
  upload_id?}]`(그리고 `card.claims[].evidence` 는 글 · `inquiry_answer.confidence` 는 0~1). `inquiry_answer` 에는 W7 이 `evidence`
  (문답과 같은 꼴 — 답의 `[k]` 는 k 째)를 더했다(비어도 된다).

## Audience

보이기 범위(CONTRACTS §2-11 · WK-D15 · D26~D28). 문서는 둘 다 맞아야 보인다 — ① `wiki_pages` 줄이 있으면 그 `audience` 토큰을 모두
가진 사람 ② `confidentiality=restricted` 면 작성자 · `document_reviewers` · metadata owners/reviewers 의 이메일 · admin.

| 무엇 | 어떻게 |
| --- | --- |
| 읽는 사람 | `Viewer`(user · system · anonymous). `get_current_user` 가 `viewer_from_user` 로 요청 문맥(ContextVar)에 두고, `ViewerContextMiddleware` 가 요청마다 비운다 |
| 토큰 | `org` · `user:<id>` 늘, `aff:` · `plat:` 은 `portal_access_at` 이 `ACCESS_MAX_AGE_H`(24) 안일 때만(위임 호출은 그 호출의 증명값) |
| 술어 | `visible_sql(alias)` + `sql_params()` — `documents` 별칭 하나에 붙인다. admin · system 은 `_aud_all` 로 통과 |
| 빠뜨림 | 문맥이 비면 `ViewerMissing`(조용히 새지 않고 깨진다). 배경 작업 `acting_as(SYSTEM)`, 공개 길 `acting_as(ANONYMOUS)`(`["org"]` · restricted 아님) |
| 서비스 계정 | `MXWP_SERVICE_ACCOUNTS`(기본 `admin@mx.local`)의 **API 토큰** 호출 — 게이트웨이의 신원 없는 내부 호출 — 은 `SERVICE`(익명과 같은 시야 — `["org"]` · restricted 아님, 지은이여도). 사용자 결정 10-24 · WK-D43. `get_current_user` 가 `is_service_call` 로 고른다. 같은 계정의 웹 세션 · 위임 호출은 사람 admin 그대로. 역할은 admin 그대로라 관리 창구 · 원천 받기 규칙(연결기가 남의 범위 · 주인으로 보낸다 — `receive` 는 호출자의 `viewer_from_user` 를 따로 쓴다)은 바뀌지 않는다 |

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
| 인스턴스 | `mxwp_wiki` — `infra/apptainer/wiki.def`(api.sif 위에 시작 스크립트만 다름 · `--build-arg API_SIF=…`). build.sh 는 api.sif 가 더 새것이면 따라 다시 짓는다. 시작 스크립트가 물려받은 `.env` 로 접속 주소를 짓고(명령줄에 비밀 없음) 워커가 죽으면 5초 뒤 다시 띄운다. start · stop · status · update(여섯) · diag · logs `wiki` · sync-from-drive(API 코드가 바뀌면 다시 띄움) |

시험 [[apps/api/tests/test_wiki_jobs.py]] — 순서 · not_before · 워커가 죽은 뒤 다른 워커가 다시 집기 · 재시도 · 거듭된 lease 만료 · 불변 · 덧붙이기만.

## Intake

[[src/app/wiki/sources.py#receive]] — `POST /sources` 와 연결기(W8)가 같이 부른다.

| 무엇 | 어떻게 |
| --- | --- |
| 범위 | 보낸 사람이 토큰을 모두 가져야 한다(admin · 시스템은 다). `["org"]` 는 admin 만(되쌓기의 근거가 있고 모두 전사 문서면 예외 — `org_ok`). 위임 호출은 admin 이 owner 로 깎여 늘 일반 규칙. 빠진 토큰이 `aff:` · `plat:` 이면 403 메시지가 까닭 둘을 덧붙인다 — 웹 세션은 포털을 거쳐 들어온 지 24시간 안이어야 하고(저장된 `portal_*`), 위임 호출은 관리자가 막 바꾼 소속을 게이트웨이 권한 조회 캐시가 늦게 따라온다(포털 세션 확인, 10-24) |
| 주인 | 비면 보낸 사람. 남의 이메일은 admin(연결기)만. `owner_email`(불변 · 0053) + `owner_user_id`(그 이메일의 사람 — 나중에 이을 수 있게 바꿀 수 있는 칸) |
| via | 위임 `gateway` → `gateway` · `hwax-portal` → `portal-chat` · API 토큰 → `connector:<origin.system>`(인증이 `auth_via='api_token'` 을 단다) · 웹 세션 → `upload` |
| 멱등 | 먼저 찾고(같으면 200 `dedup`), INSERT 는 `ON CONFLICT DO NOTHING` — 동시에 같은 것 둘이 와도 한 줄 |
| 새 판 | 같은 (시스템, ref)의 active 를 `FOR UPDATE` 로 잡아 새 줄의 `supersedes_id` 로, 옛 줄은 `superseded` |
| 첨부 | `upload_id` = 이미지(id · ulid → `storage_keys.orig`, role `figure`) 또는 파일(id → `storage_key`, role `raw`). 바이트의 sha256 → 버킷 `mxwp-wiki-sources` 의 `<sha 앞 2>/<sha>`(있으면 그대로). 이미지 원본은 webp 라 blob mime 이 `image/webp`. 못 찾으면 422 |
| 원천 문서 | slug `src-<id 앞 8>`(겹치면 12 · 전체). 절 — 요약 · 핵심 값(본문을 표로 — 숫자 그대로, 객체 목록은 목록마다 표) · 그림(이미지 첨부) · 출처 · 이 원천을 인용한 문서(W4 가 채운다). 기밀 = 원천 sensitivity, 지은이 = 보낸 사람, `metadata.owners` = 원천 주인. 시스템으로 짓는다(서비스 계정이 보낼 때마다 admin 범위 밖 읽기 감사가 쌓이지 않게) |
| 트랜잭션 | 원천 줄 · 들이기 작업 · 문서 · 범위 줄이 `create_document` 의 커밋 하나에 든다(`wiki=` 는 범위 줄을 첫 커밋에 — 나중에 달면 그 사이 모두에게 보인다). `doc_id` 만 그 뒤 따로 |
| 후보 | 동의 `candidate` 로 받으면 범위를 주인만(`user:<주인 id>`) · `held` 로 두고 들이지 않는다. 보낸 범위는 동의 칸 `suggested_audience` 로. 주인이 MXWP 사용자가 아니면 422 — [[#Candidates]] |
| 철회 | 주인 · admin. `status=withdrawn` · 줄에 선 들이기 `cancelled` · `ingest_state` new/queued/held → `skipped` · 기록 `withdraw`(detail `source_id` · `by` · `cancelled_jobs`, actor `user:<id>`) · 원천 문서 보관. 못 보는 원천은 404. **돌고 있는 들이기(W4)는 반영 전에 원천 상태를 다시 봐야 한다** |
| 원천 보기 | `sources.visible_sql` — 범위 토큰 ⊆ 내 토큰, restricted 면 주인 · 들인 사람만(admin 은 다). 승인 전 후보는 주인만 — admin 도 못 본다 |

## REST

[[src/app/routers/wiki.py]] — 꺼지면(`WIKI_ENABLED`) 모두 404 `wiki_disabled`(라우터 의존성). 문구는 'MX 백서 AI 위키는 아직 열리지
않았다' — 설정 이름을 싣지 않는다(사람 · 에이전트가 읽는다, 10-27 MW-01). 503 으로 바꾸지 않는다 — 꺼짐은 잠깐의 고장이 아니고(되풀이를
부른다) 화면 · 포털이 404 로 꺼짐을 안다. 인증 없는 `GET /wiki/health` 의 200 · 404 를 켜짐 신호로 쓰는 곳 — 웹 `useWikiEnabled` ·
mxwp-mcp `_wiki_switch` · 포털 버튼(HP-16) · 에이전트 심의(HA-08). 닿지 않으면 '모름' 으로 보고 숨기지 않는다. 200 은 스위치만 본다 —
LLM 이 비어도(`llm: unset`) · 워커가 없어도 200 이다.

| 메서드 · 경로 | 권한 | 무엇 |
| --- | --- | --- |
| `POST /sources` | editor | 201 `{id, short, dedup:false, doc_slug, ingest_state}` / 200 `dedup:true`. `?ingest=0` 이면 작업 없음. 봉투 오류 422 — `details.errors[].field` 가 `body.…` 로 시작한다 |
| `GET /sources` | reader | `kind` · `system` · `status` · `since` · `until` · `limit`(≤200) · `offset` → `meta.total`. 줄마다 `mine`(내가 주인) |
| `GET /pages/{slug}` | reader | 위키 문서 한 장 — 종류 · 관리 · 범위 · 잠금 · 낡음 · 엔티티 + 블록별 근거 + 기대는 원천(생긴 때 순). 위키 문서가 아니거나 못 보면 404 |
| `GET /sources/{id}` | reader | 위 + `payload` · `blobs` · `subject_hints` · `consent_mode`. 범위 밖은 404 |
| `POST /sources/{id}/withdraw` | 주인 · admin | `{status, changed, cancelled_jobs}` — 두 번째는 `changed:false` |
| `GET /log` · `GET /log.md` | reader | 범위 토큰을 모두 가진 줄. md 는 옛것부터 `## [YYYY-MM-DD HH:MM] op \| 제목`(KST) + detail 한 줄 |
| `POST /ingest` | editor | `{source_ids[≤50]}` — 보이고 활성인 원천을 다시 줄 세운다(아니면 `queued:false` + 까닭) |
| `GET /changes` · `GET /changes/{id}` | 검토자 | 목록(`status` · `limit` · `offset` → `meta.total`) · 한 건([[#Review]]) |
| `POST /changes/{id}/approve` · `/reject` · `/revert` | 검토자 | 승인(→ applied) · 거절(`note` 꼭) · 되돌리기 |
| `GET /index` · `GET /index.md` | reader | 목록 — 볼 수 있는 위키 문서를 규칙서 순서의 갈래(엔티티 유형 · 사례 · 종류)로, 갈래마다 제목 순 `index.max_per_section` 까지 + '그 밖 N'. 원천 · 규칙서는 싣지 않는다(원천은 머리 줄 수). md 는 CONTRACTS §10 꼴 |
| `GET /schema` · `PUT /schema` | reader · admin | 지금 판 · YAML · 읽은 꼴(문서가 없으면 판 0 · 첫 판 YAML) · 올리기(`{yaml}` → `{version, created}`, 틀리면 422) |
| `GET /ontology` | reader | 유형 · 술어(`status` 로 거르기 — 비면 제안 · 거절까지 모두. 이름에는 범위가 없다). 유형은 `ext_axes` · 살아 있는 엔티티 수 |
| `POST /ontology/types` · `POST /ontology/predicates` | editor | 제안 → 201 `proposed`. 같은 key · slug 약어 409, 승인되지 않은 상위 · 정의역 · 치역 유형 422 |
| `POST /ontology/{types\|predicates}/{key}/approve` · `/reject` | admin | 제안 중인 것만(아니면 409). 거절은 `note` 꼭(422). 기록 `ontology` · 감사 `wiki.ontology.*` |
| `GET /entities` · `GET /entities/{id}` | reader | 등록부 — `type` · `q`(이름, admin 은 별칭도) · `status` · `limit` · `offset` → `meta.total`. 줄마다 `full` · 볼 수 있는 문서(낡음 표시) · `full` 일 때만 별칭 · 외부 id · 속성, 한 건은 `merged_from` |
| `PATCH /entities/{id}` | editor(`full`) | `{aliases?, ext_ids?}` 바꿔 넣기 — 같은 유형의 다른 엔티티와 겹치면 409, 칸 이름 꼴이 틀리면 422 |
| `GET /entities/duplicates` | 검토자 | 같은 개체로 보이는 짝(이름 · 별칭 열쇠 · 같은 외부 id) — 둘 다 `full` 인 것만 |
| `POST /entities/merge` | editor(둘 다 `full`) | `{from_id, into_id, note?}` → 201 변경 묶음(`human_request`, 늘 검토 — 검증에 걸리면 `failed`) |
| `POST /query` | reader(분에 20) | SSE — `{messages[{role, content}] ≤20}`(마지막이 물음). 프레임 `tool_call` · `tool_result`(wiki_index · wiki_search · wiki_read) · `token` · `citation`(쓴 근거마다 `{n, slug, title, section, block_id, sources}`) · `miss` · `error` · `done{miss, cited, uncited, pages, usage}` — [[#Query]] |
| `POST /fileback` | reader | `{question, answer, citations[{slug, block_id?, n?}], outcome, audience?, model?}` → 201(새것) · 200(멱등) `{id, short, dedup, doc_slug, ingest_state, audience}` — [[#Fileback]]. 볼 수 없는 근거 422 · 근거보다 넓은 범위 422(`details.required`) · 가진 토큰 밖 403 |
| `GET /candidates` · `POST /candidates/{id}/approve` · `/discard` | 주인(reader) | 내 후보(기한이 지난 것은 이때 철회) · 승인 `{audience?}`(비면 보낸 범위 → 그 범위의 새 원천을 들이고 후보는 superseded, 나만이면 그 줄을 들인다 → `{id, short, candidate, audience, dedup}`) · 버림(철회). 남의 후보 404 |
| `POST /propose` | editor | `{summary, ops[block.insert · block.update · block.delete], relations[]}` → 201 `{id, short, status, validation}` — 늘 `pending_review`(실패가 있으면 `failed`). 고칠 문서는 이미 있고 볼 수 있는 위키 문서(아니면 422) — [[#Propose]] |
| `GET /search?q=` | reader | 묻기의 찾기만 — `{pages[{slug, title, kind, via: entity · search}], entities[{id, name, type_key}]}`(볼 수 있는 위키 문서) |
| `POST /ask` | reader(묻기와 같은 분에 20) | `{question}` → 묻기 한 번을 JSON 으로 `{answer, citations, miss, question_id, pages, error}` — 답이 없으면 물은 사람만 보는 질문을 바로 남긴다(MCP `wiki_ask`) |
| `GET /questions` · `POST /questions` | reader | 볼 수 있는 물음(범위 토큰 ⊆ 내 토큰) · `mine` · `attempts` · `detail`(답 발췌 · 실험 제안 · 사람이 필요한 까닭) · `answer_source` / 남기기 `{text, audience?, priority, origin: user · query_miss}` → 201 `{id, asked_count, created, audience}`. 범위는 비면 나만(`user:<id>`), 가진 토큰 밖은 403. 같은 물음(문장 부호 · 공백 무시) · 범위면 한 줄에 `asked_count` 만 |
| `GET /questions/{id}` · `PATCH /questions/{id}` | reader | 한 건(못 보면 404) / `{status: open · closed · dropped, priority}` — 남긴 사람 · 검토자(아니면 403). 다시 열면 시도 수를 비운다 |
| `POST /questions/{id}/answer` | editor | `{answer, confidence}` → 201 — 그 사람 명의의 `inquiry_answer` 원천(물음의 범위 · system `human`) → 들이기, 물음은 answered. 전사 물음은 검토자 · admin 만(원천 받기의 전사 규칙) |
| `POST /lint` | 검토자 | `{scope: full · docs, slugs?, llm?}` → 201 `{job_id}` — 워커가 돈다. `llm` 을 켜면 조용한 시간 · 하루 예산을 따른다 — [[#Lint]] |
| `GET /lint/findings` | reader | 결함 — 범위 토큰을 다 가진 것만, `rule` · `status`(비면 open · question_raised, `all`) · `limit` · `offset` → `meta.total` · `by_rule` · `last_run`. 줄마다 볼 수 있는 문서만 |
| `POST /lint/findings/{id}/dismiss` | 검토자 | `{note}`(꼭) — 버린 결함은 다음 점검에도 다시 열리지 않는다. 못 보는 결함 404 |
| `GET /health` | 없음 | `jobs`(queued · running · held · oldest_queued_s · failed_24h · last_failure{op, at}) · `workers`(10분 안에 본 것) · `llm`(ok · unreachable · unset, 30초 캐시) · `last_lint`(`{scope, at, ok, open}` — 열린 결함 수만, 제목 · 범위 없음). **실패 글은 내지 않는다** — 인증 없는 창구이고 예외 꼬리에 원천 글이 섞일 수 있다 |

## Rule book

[[src/app/wiki/schema.py]] — 규칙서 = 문서 `wiki-schema` 안의 YAML 코드 블록 **하나**(둘이면 거부). 판 = 그 문서의 판, 문서가 없으면
첫 판 `DEFAULT`(판 0 — SCHEMA-DRAFT 의 규칙 열 문장 그대로 · 절 꼴 · 정책). 코드가 읽는 칸 — `rules` · `sections` ·
`policy.auto_apply` · `policy.always_review_kinds` · `budget.*`([[#Budget]]) · `ingest.*` · `lint.*`([[#Lint]] — 첫 판 YAML 에 없는
`contradiction_rel_tol` 은 기본 0.1) · `inquiry.*`([[#Inquiry]] — `tools_allowlist` 는 이름 또는 `{name, audience}`) · `qa.candidate_ttl_days` ·
`standing_questions`. `access.max_age_h` 는 아직 코드 상수(`audience.ACCESS_MAX_AGE_H`).
절 이름 끝 `(자동)` = 코드가 짓는 절, `(사람)` = 사람만 쓰는 절 — AI 쓰기는 나머지 절에만(V5). 저장 때 `validate_documentjson` 이
slug `wiki-schema` 면 YAML 을 검사하고 틀리면 422(첫 까닭을 글에 싣는다). **admin(또는 시스템)만 고친다** — 저장 길이 여럿(만들기 ·
바꾸기 · 절 · 블록 패치 · 판 복원)이라 모두 지나는 `validate_documentjson` 에서 막고, 보관은 `archive_document` 에서 막는다(읽는
사람 문맥으로 본다 — 위임 호출은 admin 이 owner 로 깎여 있어 못 고친다). 올리기는 `PUT /schema`([[src/app/wiki/schema_doc.py#put]] —
없으면 설명 한 절 + YAML 한 덩이로 만들고 · 있으면 그 YAML 블록만 바꿔 판을 올린다). 문서는 종류 `schema` · `managed='human'` · `["org"]`.

## LLM

[[src/app/wiki/llm.py#structured]] — `structured(ep, messages, Model, name=…)` 가 pydantic 모델 하나를 돌려준다.

| 무엇 | 어떻게 |
| --- | --- |
| 자리 | `background()`(WIKI_LLM_*) · `interactive()`(WIKI_QUERY_LLM_*, 비면 배경). 비면 None — mock 으로 대신하지 않는다 |
| 꼴 | `WIKI_LLM_STRUCTURED` = `json_schema`(기본, `response_format`) · `tools`(도구 호출). 스키마는 `Model.model_json_schema()` |
| 다시 묻기 | 받은 글을 pydantic 으로 검사 — 틀리면 무엇이 틀렸는지 붙여 한 번 다시, 또 틀리면 `LLMFormatError` |
| 오류 | 429 · 5xx · 연결 · 끊김 · 시간 초과(연결 10초) → `LLMUnavailable`, 그 밖 4xx → `LLMError`. 오류 본문 셋(OpenAI · 옛 vLLM · `--api-key`)을 다 읽는다 |
| 쓴 양 | `Usage`(prompt · completion 토큰 · 부른 수 · 초) — 부를 때마다 더한다 |
| 흘리기 | `stream_text(ep, messages)` — `stream: true` · `include_usage`, 조각마다 낸다. 조각 사이 읽기 시간 120초(연결 10초). 4xx `LLMError` · 429 · 5xx · 끊김 `LLMUnavailable`(이미 낸 조각은 부르는 쪽 몫) |
| 역할(W7) | `Endpoint.role` — `background()` 는 `background`, `interactive()` 는 `interactive`(묻기 자리가 비어 배경 서버를 써도 역할은 묻기). 배경 호출은 [[#Budget]] 의 문지기를 지나고, 묻기 흘리기는 표지를 둔다. 둘 다 쓴 토큰을 장부에. 역할이 빈 Endpoint(시험이 바로 짓는 것)는 거르지도 적지도 않는다 |

## Budget

[[src/app/wiki/budget.py]] — 규칙서 `budget` 칸(SCHEMA-DRAFT §6)으로 배경 작업을 거른다(request §5-9 · §5-13 · CONTRACTS §8).

| 무엇 | 어떻게 |
| --- | --- |
| 문지기 | 워커가 작업을 집은 뒤 처리기 전에 `gate(op, args)` — 막히면 `jobs.defer`(시도 수를 쓰지 않음 · `error` 에 까닭) |
| 조용한 시간 | `quiet_hours`(KST, 자정을 넘어도 된다) — **지속 질의 · LLM 을 쓰는 점검만**(`needs_quiet`). 들이기는 언제나(W8 '원천 → 반영 1시간'), LLM 없는 점검도 언제나 |
| 하루 예산 | `daily_tokens` — 장부 `wiki_llm_usage` 의 배경 줄을 KST 하루로 더한다(작업이 실패 · 보류로 끝나도 쓴 양은 남는다). 넘으면 다음 날 0시(조용한 시간 작업은 그 뒤 첫 조용한 시간)로 미루고 기록 한 줄(하루에 한 번). 보류가 아니다 — 상한은 결함이 아니라 속도다 |
| 작업 하나의 상한 | `ingest_tokens` · `inquiry_tokens` · `lint_tokens` — 넘으면 `BudgetExceeded` → 워커가 `held`(점검은 LLM 짝 판정을 멈추고 센다) |
| 묻기 우선 | 묻기 흘리기가 도는 동안 `wiki_llm_turns` 에 한 줄(API 프로세스 · 330초 뒤 무시 — API 가 죽어도 배경이 영영 서지 않게). 배경 호출(워커 프로세스)은 그 줄이 있는 동안 0.5초씩 기다린다 |
| 동시 수 | `llm_concurrency` — 배경 호출은 권고 잠금 자리(`pg_try_advisory_lock('WIKI', 자리)`) 하나를 쥐고 부른다(제 연결을 호출 내내 쥔다 — 워커가 여럿이어도). 묻기는 자리를 잡지 않는다(예산 밖 · 맨 앞) |
| 장부 | 호출마다 `wiki_llm_usage(role, tokens, job_id, name)` — `job_id` 는 워커가 `current_job` 에 둔다. 장부 쓰기가 깨져도 호출은 막지 않는다 |

시험 [[apps/api/tests/test_wiki_budget.py]] — 시간 셈 · 문지기(조용한 시간 · 하루 예산) · 미룸(시도 수 그대로) · 묻기 우선(느린 계획 호출 사이의 묻기 —
배경의 다음 호출이 묻기 뒤에) · 동시 수 1 · 장부.

## Lint

[[src/app/wiki/lint.py#run]] — 점검 한 번 = 작업 하나(op `lint`). 규칙은 코드가 판정하고 LLM 은 글 모순 짝만 본다(request §5-8).

| 규칙 | 무엇을 | 손쓰기(새로 보인 결함만) |
| --- | --- | --- |
| `orphan` | 들어오는 `[[링크]]` 가 없는 내용 문서 — 원천 · 목록 · 보고서 · 규칙서 문서의 링크는 치지 않는다(원천 문서의 '인용한 문서' 는 자동 목록). 목록(index)은 모든 문서를 싣으므로 따지지 않는다 | 보고서 |
| `uncited` | AI 절의 사실 블록에 근거가 없음(사람이 편집기로 넣은 것) — 문서마다 한 줄 | 질문(우선순위 4) |
| `stale` | 인용 원천이 새 판에 밀림 · 철회 · 같은 대상의 **조건이 모두 같은**(수치 설정까지) 더 새 결과가 있음 | `detail.reingest`(다시 들일 원천) |
| `contradiction` | 숫자 — 같은 대상(모델 · 부품)의 해석 결과가 같은 시나리오에서 같은 지표를 `lint.contradiction_rel_tol`(기본 0.1) 넘게 다르게 말함. 시나리오 비교에서 수치 설정(메시 · 솔버 …)은 빼고 그 차이를 `detail.differs` 에, 설계 변형(design_variation …)이 다르면 다른 대상. 글 — 밤 점검에서 바뀐 엔티티 문서의 같은 AI 절 · 다른 근거 블록 짝(`contradiction_pairs_per_entity`)을 LLM 이 | 숫자 — 그 범위의 엔티티 문서 '서로 다른 말' 절에 두 값 · 두 근거를 쓰는 묶음(이미 적혔으면 안 씀) + 질문(2). 글 — 질문(3) |
| `missing_page` | 원천의 힌트 · 문서 본문 `missing_page_min_mentions`(3)곳에 나오는 이름인데 그 범위에서 볼 수 있는 엔티티 문서가 없음 — 가장 넓은 범위에서 한 번 | 보고서(`detail.reingest`) |
| `missing_link` | AI 절에 엔티티 이름 · 별칭이 있는데 그 문서로 가는 링크가 문서 어디에도 없음 — 처음 나온 곳 하나, 더 좁은 문서로는 걸지 않는다(V8) | **결정적 자동 고침** — 근거 있는 블록만, 링크만 단 `block.update`(근거는 그대로) |
| `gap` | 불량 유형 — 시장 증거(현장 원천 · `observed-in`)가 있는데 재현(해석 원천 · `reproduced-by`)이 없음 · 그 거꾸로. 대책 — 효과 확인(해석 원천 · `verified-by`) 없음. 부품 — 시험(`tested-by` · 같은 원천의 신뢰성 시험 힌트) 없음. 범위를 건너 '있다' 면 빈틈이 아니다 | 재현 없음 · 확인 없음은 질문(3) |
| `schema` | 종류 꼴(규칙서 sections)의 절이 문서에 없음 — `detail` 에 쓴 판 · 지금 판 | 보고서 |
| `stuck_review` | 검토가 `stuck_review_days`(7) 넘게 밀림 | 그 묶음을 볼 수 있는 검토자(wiki_reviewer · admin)에게 앱 안 알림 `wiki_stuck_review`(0060) |

| 무엇 | 어떻게 |
| --- | --- |
| 범위(scope) | `full`(밤 — 아홉 · 보고서) · `incremental`(반영 직후 — `apply` 가 줄 세운다. 그 묶음의 문서에 문서 하나로 닫히는 넷: uncited · stale · missing_link · schema. 점검 자신의 `lint_fix` 묶음은 다시 부르지 않는다) · `docs`(손으로 고른 문서 — 같은 넷) |
| 한 줄 | `fingerprint` = sha256(규칙 + 대상)[:40]. 다시 보이면 `last_seen_at` 만, 이번 점검이 덮은 범위에서 안 보이면 `fixed`(글 모순은 이번에 LLM 이 본 문서의 것만). 고쳐졌던 것이 다시 보이면 다시 열리고 새 결함으로 친다. **사람이 버린 것은 그대로**(손도 안 쓴다) |
| 범위(audience) | 대상 문서 · 원천의 좁은 토큰을 다 가진 사람 — 둘을 다 볼 사람이 없으면(소속 둘) 결함을 만들지 않는다. 제목 · 질문 글에는 그 범위 안의 이름만(원천의 힌트 이름 · 그 범위 문서의 제목). restricted · 아직 후보인 원천은 보지 않는다 |
| 고침 묶음 | 문서 하나에 하나(`lint_fix`) — 들이기와 같은 검증(V1~V11) · 판정 · `apply`. 링크 고침은 반영되면 그 결함을 닫고, 숫자 모순 메모는 모순이 남으므로 닫지 않는다. 한 점검에 문서 30장까지 |
| 질문 | 결함과 같은 범위 · origin `lint` · 행위자 `wiki`. 열린 질문이 `inquiry.max_open` 이면 더 남기지 않는다(한 점검에 30까지). 결함은 `question_raised` · `question_id` |
| 보고서 | `lint-YYYYMMDD`(KST) — 종류 `lint-report` · `["org"]` · 전사 결함만(버린 것 빼고). 같은 날 다시 돌면 새 판. 좁은 결함은 제목도 수도 넓은 문서에 쓰지 않는다 — `GET /lint/findings` 가 읽는 사람의 범위로 거른다 |
| 기록 | `lint` — 결함 범위마다 한 줄(그 범위의 열린 결함 수 · 질문 · 자동 고침 — 열쇠가 한국어라 log.md 가 '모순 2 · 낡음 5 …' 로 읽힌다). 밤 점검은 결함이 없어도 전사 줄 하나 |
| 예산 | LLM 은 글 모순만 — 밤 점검(`llm: true`)에서 지난 LLM 점검 뒤 바뀐 엔티티 문서(밤에 40장까지), `lint_tokens` 가 차면 멈추고 남긴 수를 센다. LLM 이 없으면 코드 규칙만 돈다 |

시험 [[apps/api/tests/test_wiki_lint.py]] — 손으로 지은 위키에 아홉을 하나씩 심어 다 잡힘 · 범위대로 보임(읽는 사람 · 검토자) · 버림 ·
닫힘 · 한 줄(질문 · 메모가 늘지 않음) · 반영 직후 작은 점검 · 워커 · 끝에서 끝(합성 20 → 들이기 → 밤 점검에 묶음의 모순 · 낡음 · 빈틈).

## Inquiry

[[src/app/wiki/inquire.py#run]] — 질문 하나 = 작업 하나(op `inquire`, request §5-9 · WK-D11). 단계는 코드, LLM 은 갈래만 고른다(`wiki_inquire`).

| 무엇 | 어떻게 |
| --- | --- |
| 질문이 생기는 곳 | 점검(빈틈 · 모순 · 근거 없음 — [[#Lint]]) · 들이기(계획의 `questions` · `contradictions` — 원천의 범위, 원천 하나에 5) · 묻기 MISS(`query_miss`) · 사람(`user`) · 규칙서 상시 질문(`standing` — 아래 일정). 자동으로 생기는 것은 열린 질문이 `inquiry.max_open` 이면 남기지 않는다 |
| 읽기 | **질문의 범위로만** — 읽는 사람 = 그 범위의 토큰 + org(사람 없음 — restricted 는 못 본다). 묻기와 같은 길(엔티티 이름 · 검색 → 문서 블록 근거 · 원천 발췌). 그래서 답 원천의 범위는 질문의 범위다 |
| 갈래 | `answer`(근거 번호 · 숫자는 근거 값 그대로) · `call_tool` · `needs_human` · `needs_experiment`(제안만 — 돌리지 않는다) · `unknown`. 근거 번호도 도구 결과도 없는 answer 는 unknown 으로 본다 |
| 도구 | [[src/app/wiki/tools.py]] — `WIKI_TOOLS_URL` · `WIKI_TOOLS_TOKEN`(포털 읽기 전용 PAT)이 있고 규칙서 `inquiry.tools_allowlist`(이름 또는 `{name, audience}` — 범위를 안 적으면 전사)에 있고, 그 범위를 질문 범위가 다 담고, 게이트웨이 `tools/list` 가 `readOnlyHint` 를 단 도구만 내놓는다. 질문 하나에 3번. MCP streamable HTTP(JSON · 이벤트 흐름 둘 다 읽음 · `Mcp-Session-Id`). 결과는 `<<<도구 결과 … >>>` 구획(데이터) |
| 답 = 원천 | `inquiry_answer` — 질문 · 답(`[n]` → 남긴 근거 차례 `[k]`) · `evidence`(위키 블록 발췌 · 그 원천) · 도구 호출 요약(결과 2000자) · 확신도. origin `mxwp / wiki-inquiry/<질문 id>` · rev = 시도 수(다시 답하면 새 판 · 옛 답은 superseded) · 주인 위키(지은이 admin) · via `inquiry` → 들이기 작업. 질문 answered · `answer_source_id` |
| 실패 · 되풀이 | unknown 은 시도를 쓰고 open — `max_asks_per_question`(3)이면 needs_human. LLM 이 안 닿거나 깨지면 그 시도는 없던 것으로(open · 시도 되돌림). 질문 예산 `inquiry_tokens` 를 넘으면 작업 held · 질문 needs_human |
| 알림 | needs_human — `wiki_question`(0060). 물은 사람(user · query_miss) · 사람 한 명의 물음(`user:` 범위)이 아니면 그 범위를 다 가진 검토자 |
| 사람의 답 | `POST /questions/{id}/answer` — 그 사람 명의의 원천(system `human`) → 같은 들이기 |
| 기록 | `inquire`(질문의 범위) — 결과 · 근거 수 · 도구 수 · 토큰(· 원천) |

[[src/app/wiki/schedule.py#tick]] — 워커가 1분마다(op 를 좁히지 않은 워커만). `wiki_schedule` 표지 + 트랜잭션 권고 잠금으로 워커가 여럿이어도 한 번.
밤 점검 — KST 그날 `lint.nightly_at` 이 지났는데 그 뒤로 줄 세운 적이 없으면(LLM 이 있으면 `llm: true`). 상시 질문 — 하루 한 번, 유형마다 살아
있는 엔티티의 문서(범위마다 한 장)에 '<문서 제목>: <물음>' 을 그 문서의 범위로, `every_days` 가 지나면 답했어도 다시 연다. 지속 질의 —
조용한 시간에 한 시간마다, 남은 하루 예산(질문 하나 = `inquiry_tokens`)만큼 열린 질문을 우선순위 순으로(한 번에 10). LLM 이 없으면 줄
세우지 않는다. 실제로 언제 도는지는 문지기([[#Budget]])가 정한다.

시험 [[apps/api/tests/test_wiki_inquire.py]] — 위키로 답 → 원천(범위 · via · 근거 · 들이기 작업) · 질문 범위로만 읽음 · 근거 없는 답은 모름 ·
되풀이 뒤 사람(알림) · 실험 제안 · 혼자만 보는 물음의 알림 · 도구(허용 목록 · 범위 · readOnlyHint · JSON / 이벤트 흐름) · 질문 예산 보류 · 낮에는
기다림 · 일정 · 들이기의 물음 · 사람의 답 · 바꾸기. 가짜 게이트웨이 [[apps/api/tests/fakes/fake_mcp.py]].

## Ingest

[[src/app/wiki/ingest.py#run]] — 원천 하나 = 작업 하나(op `ingest`). 단계는 코드가 이끌고 LLM 은 정해진 칸만 채운다.

| 단계 | 무엇 |
| --- | --- |
| 거르기 | 활성이 아닌 원천(새 판에 밀림 · 철회)과 `restricted`(WK-D37)는 들이지 않는다 — 원천 `skipped`, 기록에 까닭. LLM 을 부르지 않는다 |
| 해석 | [[src/app/wiki/resolve.py#targets]] — 힌트마다 외부 id → 별칭 → 정규화 이름(공백 없앰 · casefold) → 열쇠로 등록부를 찾고, 못 찾으면 후보를 LLM 에게 물은 뒤([[#Resolution]]), 그래도 없으면 새 엔티티(승인된 유형만). 찾은 엔티티는 그 범위의 문서가 있으면 그 slug(합치기로 옮겨 온 문서는 slug 가 다르다 — 낡음 없는 것 · 오래된 것 먼저). 문답 원천은 문답 문서가 먼저 — 같은 범위에 물음 열쇠(`question_key`)가 같은 문서 하나, 아니면 비슷한 문답 문서(제목 Dice ≥ 0.5 · 둘) + 새 `qa-<열쇠 해시 8>`(계획이 고른다). 문서는 범위마다 한 장 — `["org"]` 는 기본 slug, 그 밖은 `<기본>--<범위 꼬리>`. 기본 slug(`ent-<약어>-<외부 id>` 또는 `-<이름 해시 6>`)는 엔티티 `attrs.slug` 에 적어 두고 다시 짓지 않는다. 사례 문서 `case-sim-<짧은 id>` · `case-field-<짧은 id>`(W4 는 엔티티를 잇지 않는다) |
| 계획 | `wiki_plan` — 후보 안에서 고칠 문서와 까닭, 원천 문서 요약 · 물음 · 모순. 후보 밖 slug 는 버리고 `plan.unknown` 에 남긴다. 문서 수는 규칙서 `ingest.max_pages_per_source` |
| 쓰기 | 문서마다 `wiki_write` — 그 문서의 절(누가 쓰나 표시)과 블록 id 를 보여 주고 `block.insert`(절 이름) · `block.update` · `block.delete` 와 근거(sid · loc · quote)를 받는다. 블록 종류는 문단 · 목록 · 표 · 알림 상자. 새 블록 id · 근거의 원천 id(sid 앞자리로 찾음)는 코드가 정한다 |
| 검증 → 판정 | [[#Validation]] → `auto_applied`(바로 반영) · `pending_review` · `failed`. 반영 중 판 충돌이면 `pending_review` |
| 남기기 | 묶음(plan — 문서 · 판 · 새 문서의 빈 꼴 / ops / validation / usage / prompt_hash / 규칙서 판 / 모델) · 기록 `ingest`(묶음 · 판정 · 문서 수 · 걸린 규칙 · 토큰) · 원천 `done` |

- 프롬프트 — 원천은 `<<<원천 src_… >>>` 구획 안에만(원천 속 `>>>` 는 흩뜨린다), 시스템 글에 규칙서 판과 규칙 열 줄. 가짜 LLM 시나리오의
  `capture` 가 읽는 줄 — `후보: <slug>` · `문서: <slug>` · `요약: …` · `## <절> (AI)` · `- 블록 <id> <종류>: …`.
- LLM 이 닿지 않거나 설정이 비면 작업을 시도 수를 쓰지 않고 120초 뒤로(`jobs.defer` — 원천 `queued`). 예산(`budget.ingest_tokens`)을 넘으면
  작업 `held` · 원천 `held` · 기록. 그 밖의 예외는 재시도(남으면 원천 `queued`, 다 쓰면 `failed`).
- 묶음의 `created_by` = 원천을 보낸 사람(작업의 `created_by`), 문서의 지은이 = 시스템(첫 admin — `apply.wiki_author`).
- 관계 — [[#Relations]]. 계획 프롬프트의 후보 줄은 `후보: <slug> · <이름>(<유형 key>) · …` 이고 그 아래 술어 표(코드가 다는 넷은 뺀다)가 붙는다.
- 물음(W7) — 실패하지 않은 묶음이면 계획의 `contradictions`(우선순위 2) · `questions`(3)를 질문 대기열에(원천의 범위 · origin `ingest:<묶음>` · 5까지) — [[#Inquiry]].

## Validation

[[src/app/wiki/validate.py#run]] — 규칙마다 판정 하나(`pass` · `warn` · `review` · `fail`)와 까닭. `decide` 가 묶음의 판정을 낸다.

| 규칙 | 무엇을 | 걸리면 |
| --- | --- | --- |
| V1 schema | 블록이 `Block` 에 맞나 · 연산이 문서에 맞나(없는 절 · 블록) · 문서 2MB | fail |
| V2 cited | 사실 블록(문단 · 목록 · 표 · 알림 …)에 근거 · 근거의 원천을 찾았나 | fail |
| V3 numbers | 블록의 숫자(+단위)가 인용한 원천의 payload(숫자 칸 · 글 속 숫자) · 제목에 있나. 단위는 접두어만 맞추고(mm ↔ m · MPa ↔ Pa), 반올림은 블록에 적힌 자릿수까지. `계산: 식 = 값` 은 셈해 맞추고 식의 수가 원천에 있어야. 날짜(YYYY-MM-DD)는 원천 글 · 생긴 날에 있어야. 시각은 보지 않는다. 식별자 속 숫자(A1 · SUS304 · JOB-0001)는 숫자가 아니다 | fail |
| V4 audience | 인용한 원천의 범위 토큰(org 뺌)이 문서 범위에 다 있나 | fail — 그대로 승인하면 좁은 사실이 넓은 문서로 샌다 |
| V5 locked | 잠긴 블록 · AI 가 쓰지 않는 절(`(자동)` · `(사람)`) · 사람 문서 · 검토 잠금 · `always_review_kinds` | review |
| V6 scope | 계획에 없던 문서 · 지우기(늘 검토) · 묶음 크기(문서 · 블록 — 규칙서 `policy.auto_apply`) | review |
| V7 ontology | 새 엔티티의 유형이 approved 인가 · 관계의 술어가 approved 인가 · 정의역 · 치역 · 두 끝이 후보인가 · 자기 자신과의 관계 | fail(엔티티 해석 의심은 review — 실패가 검토보다 앞선다) |
| V8 links | `[[slug]]` 가 있거나 같은 묶음에서 생기나 · **더 좁은 문서로 링크하지 않나**(넓은 문서가 좁은 문서를 드러내지 않게) | fail |
| V9 privacy | 이메일 · 전화 · 사번 꼴 — 가린다(`[가림]`, 연산의 블록을 고친다). 문답 · 심의만이 아니라 모든 원천에 | warn |
| V10 quote | 근거 인용 300자(규칙서 `ingest.quote_max_chars`) · 원천 본문(300자 넘는 글)을 통째 옮김 | fail |
| V11 style | 문단 끝 마침표 · SI 아닌 단위 · `MM/DD/YYYY` 날짜 | warn |

자동 반영 = fail · review 가 없고 지우는 연산이 없고 `policy.auto_apply.enabled`. 하나라도 어긋나면 `pending_review`, fail 이 있으면 `failed`.
관계 연산은 V2(근거) · V4(인용한 원천 범위가 두 끝 문서에 다 있나) · V7 · V10(인용 길이) · V5(사람 · 잠금 문서의 '관계(자동)' 가 바뀜)를
본다. 묶음 크기(V6)는 블록 연산만 센다.

## Apply · Revert

[[src/app/wiki/apply.py#apply]] — 계획의 문서마다 연산을 얹어 저장한다.

| 무엇 | 어떻게 |
| --- | --- |
| 새 문서 | 계획에 둔 빈 꼴(규칙서 sections) + 연산 → `create_document(wiki={kind, audience, managed:'ai'})`(범위 줄이 첫 커밋에). 새 엔티티는 `ON CONFLICT … DO UPDATE` 로 만들고 `wiki_pages.entity_id` 를 잇는다 |
| 있는 문서 | 지금 판이 계획이 읽은 판과 같아야 — 아니면 `ApplyConflict`(409 · 묶음은 `pending_review`). `replace_document(If-Match)` · 판 메모 `wiki cs_xxxxxxxx` |
| 자동 절 | 문서의 '원천' 을 같은 판에 다시 짓는다(이 문서가 인용한 원천 문서 링크). 문답 문서의 '비슷한 질문' 은 인용한 문답 원천의 물음(질문자 없음). 원천 문서의 '이 원천을 인용한 문서' 는 **원천과 범위가 같은 문서만** 싣는다 — 더 좁은 문서 제목이 넓은 원천 문서에 새지 않게 |
| 근거 | 블록마다 `wiki_citations`(update 는 그 블록 근거를 갈고, delete 는 지운다). 읽기는 `GET /documents/{slug}?with=citations` — 볼 수 있는 원천만 |
| 함께 반영 | 저장은 문서마다 커밋된다 — 중간에 깨지면 저장한 문서를 판 복원 · 보관으로 되감고 이 묶음 근거를 지우고, 이 묶음이 만든 엔티티 중 살아 있는 문서가 없는 것을 retired |
| 되돌리기 | `applied` 의 판 위에 더 고친 것이 없을 때만(있으면 409). 새 문서 보관 · 있던 문서 from 판 복원 · 근거 지움 · 관계 되돌림 · 기록 `revert` |
| 관계 | 문서 저장 **전에** `doc_triples` 에 쓴다 — [[#Relations]]. `applied.triples` 에 줄마다 `created` 또는 바꾸기 전 값(`prev`) |
| 합치기 | `entity.merge` 를 맨 먼저 — [[#Entities]]. `applied.merges` 에 다시 이은 문서 · 바꾸기 전 별칭 · 외부 id(되돌리기가 그대로 돌린다) |

## Review

[[src/app/wiki/review.py]] — 검토자 = `users.wiki_reviewer` 또는 admin(Q7). 묶음은 그 범위 토큰을 다 가진 사람에게만 보인다(아니면 404).
한 건 상세는 문서마다 연산의 앞(계획이 읽은 판 — `document_versions`) · 뒤 글 · 까닭 · 근거(볼 수 있는 원천만 제목). 승인은
`pending_review` 만, fail 이 있으면 409 · 반영은 `applied`. 거절은 까닭 한 줄이 꼭 있어야(422). 기록 `review`(승인 · 거절).
**계획 밖 문서의 연산은 승인해도 반영되지 않는다**(그 문서의 판도 꼴도 계획에 없다 — V6 로 사람에게 보일 뿐).
한 건 상세의 `relations` — 주어 · 술어 이름 · 목적어(제목) · 까닭 · `origin`(code · llm) · 근거, `relations_dropped` — 끝이 후보 밖이라 버린 것.
`merges` — 두 엔티티의 제안 때 모습 · 까닭 · (반영했으면) 다시 이은 문서 · 낡음 · 다시 들일 원천. 목록에서는 합치기 묶음의 문서 칸에 요약 한 줄.

## MCP

`dist/llm-docx-toolkit/mcp/server.py` 의 `wiki_*` 열넷(CONTRACTS §7) — `MxwpClient.wiki(method, path, …)` 한 길로 `/api/v1/wiki/*` 를 부른다.
순수 읽기 아홉은 `annotations=_WIKI_READ`(`readOnlyHint`) — 게이트웨이가 읽기 전용 PAT 에 연다. `wiki_ask` 는 MISS 때 질문을 남겨 빠진다.
위키가 꺼진 박스는 MCP 가 뜰 때(`_wiki_switch` — `/wiki/health`) `wiki_*` 열넷을 싣지 않는다 — 꺼진 도구를 먼저 불러 404 를 맞던 것을
막는다(10-27 MW-01). 닿지 않으면 싣고, 부를 때 꺼짐이면 'search_documents 를 쓰세요' 안내를 돌려준다.

| 도구 | 창구 |
| --- | --- |
| `wiki_index(kind?)` | `GET /index` → 목록 마크다운(갈래 하나로 거르기) |
| `wiki_search(query)` · `wiki_ask(question)` | `GET /search` · `POST /ask` |
| `wiki_read(slug)` | `GET /pages/{slug}` + `GET /documents/{slug}?with=citations` → 절 · 블록(id · 글 1500자) · 블록별 근거 |
| `wiki_source(id)` · `wiki_entity(name \| id, type?)` · `wiki_graph(slug, depth≤2, predicates?)` | 원천 한 건 · 엔티티 + 위키 관계(깊이 1) · 서브그래프에서 위키 관계만 |
| `wiki_log(n)` · `wiki_lint_report(rule?, limit?)` · `wiki_questions(status?)` | 기록 꼬리 · `GET /lint/findings`(규칙별 수 · 마지막 점검 · 결함) · 질문 대기열 |
| `wiki_submit_source` · `wiki_fileback` · `wiki_propose` · `wiki_add_question` | 쓰기(토큰 필요) — `/sources` · `/fileback` · `/propose` · `/questions` |

기존 쓰기 도구의 위키 문서 거부는 서버가 한다([[#Propose]]). 시스템 프롬프트(`llm-system-prompt.md` §8)에 위키 규칙 요약. 붙인 뒤에는
**게이트웨이 `tools/list`** 로 뜨는지 본다 — MCP http 서버(`python -m mcp --http`, :8765)는 다시 띄워야 새 도구를 안다.
시험 `dist/llm-docx-toolkit/mcp/tests/test_wiki_tools.py`.

## Screens

apps/web — 'AI 위키'(상단 내비 — 위키가 켜졌을 때만, `useWikiEnabled` 가 인증 없는 `/wiki/health` 로 본다. MXWP 홈 `/home` 이 이미 '위키' 라 이름을 갈랐다).

| 화면 | 무엇 |
| --- | --- |
| `/wiki` | 목록(갈래마다 카드) · 최근 기록 8 · 검토 기다림 수(검토자만 — 아니면 403 이라 숨김) · 열린 질문 수 · 점검 결함 수 · 마지막 점검(W7 — 읽는 사람이 볼 수 있는 것만) |
| 문서 `/docs/:slug` | 위키 문서면 머리띠(AI · 사람 관리 · 유형 · 범위 · 검토 잠금 · 낡음 · '이 문서가 기대는 원천 N') + 블록 끝 각주 `[n]` → 원천 카드(종류 · 출처 · 생긴 때 · 위치 · 인용 · 원천 문서 · 원본). 근거 지도는 `GET /wiki/pages/{slug}` 를 문서 화면이 컨텍스트로 내리고 `SectionRenderer` 가 블록마다 `WikiCited` 로 감싼다(컨텍스트가 없으면 그대로). 번호는 기대는 원천 차례 — 같은 원천은 어디서나 같은 번호 |
| `/wiki/sources/:id` | 원천 — 배지 · 출처 · 생긴 때 · 원천 문서 · 첨부 · 본문(낱값 표 + 객체 목록마다 표) · 철회(주인) |
| `/wiki/changes` · `/wiki/changes/:id` | 검토 큐(상태 탭) · 한 건(요약 · 검증 표 · 문서마다 연산의 앞 · 뒤 · 까닭 · 근거 · 관계 카드(코드 · AI) · 승인 · 거절(까닭 꼭) · 되돌리기) |
| 의미 관계 패널(문서 오른쪽 레일) | 위키 관계는 '위키' 표지 · 지우기 단추 없음(묶음으로만 — [[graph#FE — triple 표시 + 입력]]) |
| `/wiki/log` | 기록 — log.md 꼴 · 작업으로 거르기 · 묶음으로 잇기 |
| `/wiki/candidates` | 내 후보 — 종류 · 제목(원천 문서) · 받은 때 · 기한 · 범위 고르기(보낸 범위 · 나만) · 승인 · 들이기 · 버림 |
| 메인 챗 `/` 의 '위키에 묻기' | 묻기 스트림 · 답의 `[n]` → 문서 · 근거 목록 · 위키에 남기기(결과 · 범위 `done.scope`) · MISS 면 질문으로 남기기 — [[chat#위키 모드]] |
| `/wiki/ontology` | 유형 표(key · 이름 · 약어 · 바깥 어휘 · 외부 id 칸 · 엔티티 수 · 상태) · 술어 표('A 는 B ○○' · 역 · 주어 → 목적어 · 대칭 · 상태) · 제안 폼(editor) · 승인 · 거절(admin, 까닭 꼭) |
| `/wiki/lint` | 점검(W7) — 규칙 갈래(수) · 상태(열림 · 질문 남김 / 고침 / 버림) · 결함마다 심각도 · 제목 · 문서 · 다른 점(모순) · 다시 들일 원천(낡음) · 없는 절(꼴) · 고침 묶음 · 남긴 질문 · 버리기(까닭 꼭 — 검토자) · '지금 점검'(검토자, LLM 없이) |
| `/wiki/questions` | 질문판(W7) — 물음 남기기(나만 · 전사) · 상태 갈래(열림 · 묻는 중 · 사람 필요 · 실험 제안 · 답함 · 닫힘 · 버림) · 출처(점검 · 들이기 · 사람 · 묻기 실패 · 상시) · 우선순위 · 결과(답 + 답 원천 · 제안 · 사람이 필요한 까닭 · 지난 시도) · 답하기(그 사람 명의의 원천) · 닫기 · 다시 열기 |
| `/wiki/entities` · `/wiki/entities/:id` | 등록부(유형 · 이름 찾기 · 중복 후보 — 검토자만, '뒤의 것을 앞의 것으로 합치기 제안') · 한 건(문서 · 범위 · 낡음, `full` 이면 별칭 · 외부 id 고치기 · 합칠 곳 골라 제안) |
| 검토 한 건의 합치기 카드 | 없어질 쪽 · 남을 쪽의 그때 모습(범위 · 별칭 · 외부 id) · 까닭 · 반영했으면 다시 이은 문서(낡음) · 다시 들일 원천 수 |

꺼지면(404 `wiki_disabled`) 화면은 '여기에는 없다' 를 보인다(`WikiError`). 다크 모드 시각 회귀 11 케이스 · 그림 26([[visual-regression]]).
알림 둘(W7) — `wiki_stuck_review` · `wiki_question` 은 문구 · 안내 줄만(알림 줄은 `/docs/<slug>` 로만 이어진다 — 위키 화면 링크는 없다). 위키 화면의 입력칸은 공용 `Input` 이 아니라 어두운 화면 꼴을 가진 칸(`FIELD`).

## Test bundle

`apps/api/tests/fixtures/wiki/` — 합성 원천 20 장(해석 6 · 사례 4 · 집계 2 · 문답 5 · 심의 2 · 정정 1)과 일부러 심은 결함(모순 · 낡음 ·
빈틈 · 사람의 정정 · 연락처 꼴). 무엇이 어디 심겼는지는 그 폴더 `README.md`, 심겨 있는지는 [[apps/api/tests/test_wiki_w0.py]] 가 못 박는다.
엔티티 해석 정답표 `resolve-gold.json`(초안 — 사람이 확인) — 등록부 13 · 사례 29(결정적 15 · 고르기 9 · 새 것 5) — [[#Resolution]].
찾기 재현율 정답표 `search-gold.json`(W7 · Q11) — 물음 16(이름 8 · 바꿔 말함 8) · 별칭 넷 — [[#Query]].

## Fake LLM

[[apps/api/tests/fakes/fake_llm.py#FakeLLM]] — 진짜 소켓 위 HTTP 서버(stdlib `ThreadingHTTPServer`), 시험 픽스처 `fake_llm`(conftest).
위키 쓰기 시험은 이것만 쓴다 — **mock LLM 금지**(WK-D7).

- 꼴은 vLLM OpenAI 호환 — `tool_calls` 는 없을 때 `[]`(null 아님) · 도구 모드 `content` 는 null · `arguments` 는 JSON **글** ·
  모르는 모델 404 `The model \`x\` does not exist.` · `--api-key` 꼴 401 `{"error": "Unauthorized"}`.
- 오류 본문은 둘 다 낼 수 있다(`error_style`) — 새 vLLM · OpenAI `{"error": {...}}` / 옛 vLLM `{"object": "error", ...}`.
  **클라이언트(W4 `llm.py`)는 둘 다 읽어야 한다** — 박스의 vLLM 판을 dev 에서 확인하지 못했다(dev 에 닿는 LLM 이 없다, 10-24).
- 시나리오 결함은 500 — 맞는 규칙 없음 · `json` 답이 요청 스키마에 안 맞음(`conform`, 진짜의 유도 디코딩 흉내) · `capture` 실패.
- `stream: true` — 글 모드만(json · 도구 모드는 400). vLLM 처럼 `data: {chat.completion.chunk}` … `data: [DONE]`, `include_usage` 면 끝에
  choices 가 빈 쓴 양 조각. 곁들임 `chunk_chars` · `chunk_delay_s`.

## Settings

[[src/app/core/config.py#Settings]] — `WIKI_ENABLED`(기본 끔 → `/api/v1/wiki/*` 404) · 배경 `WIKI_LLM_{BASE_URL,MODEL,API_KEY}` ·
구조화 출력 꼴 `WIKI_LLM_STRUCTURED`(json_schema · tools) ·
묻기 `WIKI_QUERY_LLM_*`(비면 배경과 같게) · 지속 질의의 읽기 전용 도구 `WIKI_TOOLS_URL` · `WIKI_TOOLS_TOKEN`(게이트웨이 MCP 끝점 ·
포털 읽기 전용 PAT — 비면 위키 안에서만 답한다) · 위임 `MXWP_SSO_SECRET`(비면 위임 창구 404) · `MXWP_SSO_JIT_CREATE`(기본 켬).
API 인스턴스는 `.env` 를 `_common.sh` 의 `set -a` 로 물려받는다 — 새 키에 start.sh `--env` 를 더할 필요가 없다.

## Propose

[[src/app/wiki/propose.py#propose]] — 바깥 에이전트(게이트웨이 · MCP · Claude Code)와 사람이 위키 문서에 연산을 낸다(CONTRACTS §7 `wiki_propose`).

| 무엇 | 어떻게 |
| --- | --- |
| 대상 | 이미 있는 위키 문서(원천 · 규칙서 · 목록 빼고) · 부른 사람이 볼 수 있어야. 새 문서 · 엔티티는 원천을 보내 들이기로 |
| 연산 | 들이기의 쓰기 · 관계와 같은 꼴(`ingest.InsertOp` · `UpdateOp` · `DeleteOp` · `PlanRelation`) — 블록 id · 근거의 원천 id 는 코드가 정한다. 근거 원천은 부른 사람이 볼 수 있는 것만(못 보면 V2) |
| 검증 | V1~V11 그대로 + V6 은 늘 검토('바깥 제안은 늘 검토'). 실패가 있으면 `failed`, 아니면 `pending_review` — 자동 반영 없음 |
| 묶음 | `human_request` · 계획에 `via`(api_token · delegated:… · web) · 범위는 고칠 문서들의 좁은 토큰 합 · `created_by` 부른 사람 · 기록 `review`(제안 받음). 승인 · 거절 · 되돌리기는 검토 큐 그대로 |
| 막는 길 | 기계 호출(API 토큰 · 위임)이 문서 쓰기 길로 위키 문서를 고치면 409 `WIKI_USE_PROPOSE`([[core#현재 사용자 해소]]) — 검증 · 근거 · 기록을 건너뛰는 길을 남기지 않는다 |

검토 한 건의 '앞' 은 판 기록에서 — 판 기록이 없는 문서는 지금 판이 계획의 판일 때 지금 내용. 시험 [[apps/api/tests/test_wiki_propose.py]].

## Candidates

[[src/app/wiki/candidates.py]] — 포털 챗이 '해결된 턴' 을 보내는 길(P7 · 사람 결정 Q1 — B 후보 + 한 번 승인, request §6-3).

| 무엇 | 어떻게 |
| --- | --- |
| 받기 | `POST /sources` 에 동의 `{mode: candidate}` — 생산자는 사람 대신 동의하지 못한다. 받기가 범위를 주인만으로 · `held` 로 두고 보낸 범위를 `suggested_audience` 로 남긴다 |
| 보이기 | 주인만 — 목록(`/sources`) · 한 건 · 원천 문서. admin 도 원천 목록 · 한 건에서 못 본다(`visible_sql`). 원천 문서는 범위가 주인만이라 admin 은 범위 밖 읽기(감사)로만 |
| 승인 | 범위를 고른다(보낸 범위 · 나만, 가진 토큰 안 · `["org"]` 는 admin). 고른 범위로 같은 봉투를 다시 받아 새 줄 · 들이기 — 후보 줄은 superseded(새 줄의 `supersedes_id`). 나만이면 그 줄을 그대로 `queued` + 작업. 첨부는 다시 싣지 않는다. 기록 `fileback`(고른 범위) |
| 버림 · 기한 | 버리면 철회. 규칙서 `qa.candidate_ttl_days`(기본 7) 가 지나면 목록 · 승인 때 철회(`withdraw` 기록 · 까닭 기한). 자동 승인은 없다 |

시험 [[apps/api/tests/test_wiki_candidates.py]] — 주인만(admin 도 못 봄) · 승인 → 새 원천 · 작업 · superseded · 나만 · 버림 · 전사는 admin · 기한 · 주인은 사용자.

## Fileback

[[src/app/wiki/fileback.py#fileback]] — 묻기의 답 아래 '위키에 남기기'(request §5-7). 받은 답을 그 사람 명의의 `qa` 원천으로 받고 들인다.

| 무엇 | 어떻게 |
| --- | --- |
| 근거 | 각주로 받은 (slug · block_id · n?) — 부른 사람이 볼 수 있는 위키 문서(원천 · 규칙서 · 목록 빼고)여야. 봉투 `evidence` 에 블록 글 발췌(300자) `doc` 들이 앞, 그 블록들이 기댄 원천(볼 수 있는 것) `source` 가 뒤 |
| 각주 번호 | 각주에 묻기의 번호 `n` 이 있으면 답의 `[n]` 을 남긴 근거 차례 `[k]`(k 째 `doc` 근거)로 바꾼다 — 묻기 번호는 그 묻기 밖에서 가리키는 곳이 없다. 알려 주지 않은 대괄호 숫자(`results[0]` 같은 것)는 그대로. 들이기는 이 번호를 근거로 읽지 않는다(포털 qa 는 번호 뜻이 다르다 — 시스템 프롬프트, WK-D65) |
| 범위 | 비면 근거 문서들의 좁은 토큰을 합친 것(모두 전사면 `["org"]`, 합칠 수 없으면 나만). **근거가 없으면 나만**. 고르면 가진 토큰 안에서 — 근거의 좁은 토큰을 다 담거나 나만(`user:<id>`). 좁은 문서에서 온 답이 넓은 문답 문서로 새지 않게. 전사 예외(`org_ok`)는 근거가 있고 모두 전사일 때만 — 근거 없는 답을 `["org"]` 로 고르면 받기 규칙대로 403 |
| 봉투 | `origin mxwp / wiki-fileback/<해시(사람 · 물음 열쇠 · 답)>`(멱등) · 주인 = 부른 사람 · 동의 `button` · 근거로 쓴 엔티티 문서의 엔티티를 주제 힌트로 · 질문자 이름은 본문에 없다(Q9) |
| 문답 문서 | 들이기가 문답 문서를 첫 후보로 — 같은 물음 열쇠면 그 문서, 비슷하면 그 문서 · 새 문서 중 계획이 고른다(같은 물음의 묶음). '비슷한 질문(자동)' 절이 인용한 문답 원천의 물음을 싣는다 |

시험 [[apps/api/tests/test_wiki_fileback.py]] — 문답 문서 · 멱등 · 합치기 · 비슷한 질문 · 범위(볼 수 없음 · 넓음 · 나만 · 토큰 밖 · 근거 없음) · 각주 번호.

## Query

[[src/app/wiki/query.py#run]] — 묻기 한 번. 단계는 코드가 이끌고 LLM 은 모은 근거로만 답을 흘린다(request §5-7).

| 단계 | 어떻게 |
| --- | --- |
| 목록 | `catalog.build` — 읽는 사람의 목록. 프롬프트에 제목 `INDEX_ITEMS` 40 줄까지 |
| 찾기 | 물음에 이름 · 별칭(열쇠)이 든 엔티티의 문서(긴 이름 먼저 · 낡음 없는 것 먼저) → Meili 검색(역할 · 범위 칸 — 위키 문서만, 원천 · 규칙서 · 목록 빼고). 검색이 죽어도 엔티티 길로 |
| 읽기 | 문서 `MAX_PAGES` 5 · 문서마다 블록 `MAX_BLOCKS` 12 · 블록 600자를 번호 붙은 근거로 — 코드가 짓는 절(원천 목록 등)은 빼고 관계(자동)는 둔다. 근거마다 볼 수 있는 원천(각주) |
| 원천 발췌 | 근거가 기댄 원천 앞에서 `MAX_SOURCES` 3 개의 요약 · 본문 800자(숫자 확인용) |
| 답 | `llm.interactive()`(`WIKI_QUERY_LLM_*`, 비면 배경) · `stream_text` — 근거는 `<<<위키 근거 … >>>` 구획(데이터다), 문장마다 `[n]`. 앞 대화는 6 턴까지 |
| MISS | 첫 줄이 `위키에 아직 없다` 면 `miss` — 화면은 질문으로 남길지 묻고, `file_question`(MCP `wiki_ask`)이면 물은 사람만 보는 질문(`query_miss`)을 바로 남긴다. 근거가 하나도 없으면 LLM 을 부르지 않고 MISS |
| LLM 없음 | 답을 짓지 않는다 — '설정되지 않았다' 토큰 + 찾은 문서(`done.llm = unset`). 스트림 중 오류는 `error` + `done` |
| 범위 | 답한 `done.scope` = 읽은 근거 문서 모두의 좁은 토큰을 합친 것(모두 전사면 `["org"]` · 합칠 수 없으면 나만, [[#Fileback]] 의 범위 규칙) — 되쌓기의 기본 범위. 각주를 덜 단 답도 읽은 좁은 문서보다 넓게 새지 않는다. `wiki_ask` 도 `scope` 를 준다 |
| 시간 | 연결 10초 < 조각 사이 침묵 120초(`stream_text`) < 묻기 전체 `QUERY_TOTAL_S` 300초. 넘으면 받은 데까지 두고 `error`(시간 제한) + `done.timeout` — 각주 · 되쌓기 없음. 시간 재기는 조각 기다림(`anext`)만 감싼다 |
| 기록 | `query`(제목 = 물음 · 범위 = 물은 사람만 — 질문자 비공개 Q9) — 문서 · 근거 수 · 쓴 각주 · 쓴 양 |

창구는 읽는 사람 문맥을 잡아 두고 제 세션으로 흘린다(스트림이 의존성 세션보다 오래 산다). 시험 [[apps/api/tests/test_wiki_query.py]].

찾기 재현율(Q11 — W7) — [[src/app/scripts/wiki_search_eval.py#measure]] 가 찾기 단계의 길 셋(엔티티 · 검색 · 합)을 위 k 개 hit · recall 로
잰다(`python -m app.scripts.wiki_search_eval --gold … [--as 이메일]` — 진짜 박스의 정답표는 사람이 실제 물음으로). 합성 정답표
`tests/fixtures/wiki/search-gold.json`(이름이 든 물음 8 · 바꿔 말한 물음 8 · 별칭 넷)으로 [[apps/api/tests/test_wiki_search_recall.py]] 가
잰다 — 10-29 dev 합성 위키에서 이름 물음 hit@5 1.00 · 바꿔 말한 물음 0.38, 등록부에 별칭을 달면 1.00(별칭은 정답표를 보고 골라 후하다).
그래서 의미 검색(임베더)은 아직 들이지 않는다 — 별칭으로 메우고 cae00 실제 물음으로 다시 잰다(WK-D78).

## Resolution

[[src/app/wiki/resolve.py#resolve_hints]] — 힌트 하나 = `Resolution`(찾은 엔티티 · `how` · 후보 · 확신 · 까닭 · 의심). 들이기가 `plan.resolve` 에 남긴다.

| 단계 | 어떻게 |
| --- | --- |
| 결정적 | 외부 id → 별칭 → 이름(공백 없앰 · casefold — SQL) → 열쇠(`strong_key` — 공백과 `-_.·/()[]` 없앰 · NFKC · casefold, 여럿이면 오래된 것). `how` = ext · alias · name · key |
| 후보 | 못 찾으면 같은 유형의 살아 있는 엔티티 중 **원천 범위가 볼 수 있는 것**(범위 토큰 ⊆ 원천 범위 — 이름 · 별칭 · 외부 id 가 프롬프트 · 계획에 실린다)을 글자쌍 Dice(`similarity`) 순으로 `CANDIDATE_MIN` 0.4 이상 · `CANDIDATE_MAX` 5 까지. 비슷한 것이 없고 그 유형이 `SMALL_REGISTRY` 12 이하면 전부(한글 · 영문처럼 글자쌍이 안 겹치는 이름) |
| 고르기 | 후보가 있는 힌트가 있으면 계획 앞에 `wiki_resolve` 한 번 — 힌트 이름표 `h1` · 후보 이름표 `h1c2`. [[src/app/wiki/ingest.py#apply_choices]] — 고른 후보는 그 엔티티(`llm`), `new` · 답 없음은 새 엔티티(잘못 잇느니 중복이 낫다 — 합치기가 있다), 없는 이름표 · 확신이 규칙서 `ingest.resolve_min_confidence`(기본 0.75 — 첫 판 YAML 에 없는 칸) 아래면 **의심** → V7 review |
| 별칭 | 배우지 않는다 — 잘못 고른 짝이 다음 해석으로 번지지 않게. 사람이 등록부에서 단다([[#Entities]]) |
| 재기 | [[src/app/scripts/wiki_resolve_eval.py]] — 정답표(`tests/fixtures/wiki/resolve-gold.json`, 초안)의 등록부를 한 트랜잭션에 심고 사례를 돌린 뒤 되돌린다. 정확도 · 결정적 정확도 · 후보 재현율 · 갈래별 · 틀린 사례. LLM 이 없거나 `--no-llm` 이면 고르기 없이. `existing: true` 등록부 줄은 박스의 진짜 엔티티를 쓴다 |

dev(LLM 없음 · 10-24) — 29 사례 중 결정적 15 건 100 % · 비슷한 다른 개체를 결정적으로 잇는 것 0 · 후보 재현율 100 % · 고르기 없이 정확도 69 %
(남은 9 건은 정답이 후보에 있다 — LLM 이 고를 몫). 시험 [[apps/api/tests/test_wiki_resolve.py]] · 들이기 둘(오타 → 고름 · 낮은 확신 → 검토).

## Relations

들이기가 쓰는 공학 개체 사이 관계(W5). 끝(주어 · 목적어)은 **고른 문서와 이미 있는 후보** — 둘 다 그 원천의 후보라 원천과 범위가 같다.

| 무엇 | 어떻게 |
| --- | --- |
| 코드가 단다 | 사례 문서가 끝이면 원천의 주제 힌트로 — 해석 사례 `about-model` · `about-part` · `simulated-with`, 시장 사례 `about-model` · `about-part`, 불량 유형 `observed-in` 시장 사례(`ingest._STRUCTURAL`). 근거는 그 원천(`loc {field: subject_hints}`) · 확신도 1 · `origin: code` |
| 계획이 낸다 | `PlanOut.relations[{subject, predicate, object, cites, confidence, why}]` — 술어 표의 key · 후보 slug. 끝이 후보 밖이면 버리고 `plan.relations_dropped` 에(V7 은 술어 · 정의역 · 치역). 같은 관계는 한 번(코드 것을 남긴다). 대칭 술어는 slug 순서로 |
| 연산 꼴 | `{op: relation.add, doc: 주어, subject, predicate, object, cites, confidence, why, origin}` — 블록 연산과 같은 `ops` 에. 계획 밖 끝점 문서는 `plan.endpoints` |
| 쓰기 | [[src/app/wiki/apply.py#_put_relations]] — source `wiki` · `predicate`(이름) · `inverse_predicate` · `predicate_key` · `source_ids` · `changeset_id` · `accepted`. 같은 (주어, 이름, 목적어) 가 있으면 원천을 더하고 확신도는 큰 쪽 |
| 관계(자동) 절 | [[src/app/wiki/apply.py#relation_items]] — 늘 표에서 다시 짓는다. 나가는 관계 `[[목적어|제목]] 이름`, 들어오는 관계 `[[주어|제목]] 역 이름`, 보관 · 없는 문서는 뺀다. 계획의 문서는 같은 판에, 계획 밖 끝점 문서는 `refresh_relations` 가 따로 한 판(판 메모 `wiki relations`). 절이 없는 유형(사례 · 대책 …)은 의미 관계 패널 · 그래프로만 |
| 되돌리기 | `applied.triples` 를 거꾸로 — 만든 줄은 지우고 고친 줄은 `prev` 로. **그 뒤 다른 묶음이 같은 관계를 다시 단 줄(changeset_id 가 바뀜)은 둔다**. 계획 밖 끝점 문서의 관계(자동)도 다시 짓는다 |
| 읽기 | `/triples` · 서브그래프 · 링크 그래프(`include_triples=1`) — 위키 관계도 같은 길, 범위는 주어 · 목적어 문서로 |

시험 [[apps/api/tests/test_wiki_ingest.py]] 의 관계 셋 — 쓰기 · 관계(자동) · 검토 상세 · 되돌리기 / 틀린 관계(V7 · 버림) / 이미 있는 끝점 문서를 다시 짓기.

## Entities

[[src/app/wiki/entities.py]] — 등록부(`wiki_entities`)를 읽고 고치고 합친다.

| 무엇 | 어떻게 |
| --- | --- |
| 보이기 | 읽는 사람이 볼 수 있는 문서(보관 아님)가 하나라도 있으면 보인다 · admin 은 다. 문서 목록도 볼 수 있는 것만 |
| full | 별칭 · 외부 id · 속성은 **엔티티를 처음 만든 범위(`audience`)의 토큰을 다 가진 사람만** — 좁은 원천이 단 외부 id(BOM 코드 등)가 넓은 문서의 사람에게 새지 않게. 이름 찾기(`q`)도 admin 만 별칭까지 |
| 고치기 | `full` 인 editor 가 별칭 · 외부 id 를 바꿔 넣는다. 열쇠(`strong_key` — NFKC · casefold · 공백과 `-_.·/()[]` 없앰)가 제 이름과 같은 별칭은 버리고, 같은 유형의 다른 살아 있는 엔티티 이름 · 별칭 · 같은 외부 id 와 겹치면 409. 기록 `ontology`(그 엔티티 범위) · 감사 `wiki.entity.edit` |
| 중복 후보 | 같은 유형에서 이름 · 별칭 열쇠가 같거나 같은 외부 id 칸 값 — 둘 다 `full` 인 짝(`why` = name · `ext:<칸>`) |
| 합치기 제안 | `human_request` 묶음 · 연산 `entity.merge{from, into, why}` · 계획에 두 엔티티의 그때 모습. 검증 — V6 늘 검토 · V7 같은 엔티티 · 유형이 다름 · 살아 있지 않음 · 같은 외부 id 칸의 값이 다름 · V4 `from` 범위 토큰이 `into` 범위에 없음(좁은 것을 넓은 것으로 — 샌다). 실패가 있으면 `failed`. 묶음 범위는 둘의 범위 합(org 뺌) |
| 반영 | `from` → merged(`merged_into`) · `into` 별칭에 `from` 의 이름 · 별칭(열쇠가 같은 것은 빼고) · 없던 외부 id. `from` 의 문서는 `into` 로 다시 잇고, 같은 범위에 `into` 문서가 이미 있으면 옮겨 온 문서에 **낡음 표시만**(보관하지 않는다) — 보관 · 다시 들이기(`reingest` 원천 → `POST /ingest`)는 사람이 |
| 되돌리기 | 문서 잇기 · 낡음 · `into` 별칭 · 외부 id 를 그 전으로, `from` 을 다시 active |

시험 [[apps/api/tests/test_wiki_entities.py]] — 보이기 · full · 고치기 · 겹침 · 중복 후보 · 합치기(검토 → 반영 → 해석 → 되돌리기) · V4 · V7.

## Ontology

[[src/app/wiki/ontology.py]] — 용어집과 같은 길(제안 → admin 승인 · 까닭 단 거절). 들이기는 **approved 만** 쓴다(새 엔티티의 유형 ·
관계의 술어 — V7). 위임 호출은 admin 이 owner 로 깎여 승인하지 못한다.

| 무엇 | 어떻게 |
| --- | --- |
| 첫 판 | 유형 14(0054) · 술어 18(0056 — SCHEMA-DRAFT §5, `about-model` · `about-part` 와 `in-stage` · `in-project` 는 둘씩) 모두 approved |
| 술어 이름 | `label_ko` 는 상대 문서 링크 뒤에 붙여 읽는다 — A 의 문서에서 'B 의 일부다', B 의 문서에서 역 'A 를 포함한다'. 초안에서 그렇게 안 읽히던 것 몇은 고쳤다(WK-D44) |
| 정의역 · 치역 | `Predicate.fits(주어 유형, 목적어 유형)` — 빈 칸은 아무 유형, 대칭은 뒤집어도 맞다, `same-as` 는 같은 유형끼리. 대칭 칸 이름은 `is_symmetric`(symmetric 은 예약어) |
| 바깥 어휘 | `wiki_entity_types.ext_axes` — `{ra, sp, other, ext_ids}`(축 이름 · 외부 id 칸 이름만, 값은 박스에서) |
| 상태 | `approved` · `proposed` · `rejected`(+ `decided_at` · `decision_note`). 거절한 key 는 다시 제안할 수 없다(409 — 다른 key) |
| 기록 | `wiki_log` op `ontology`(범위 `["org"]`) · 감사 `wiki.ontology.{propose,approve,reject}` |
| triple | `doc_triples` 에 `predicate_key` · `source_ids` · `changeset_id` · `wiki_status` · source `wiki`. 위키 관계는 `/triples` 에서 읽기만(지우기 409), `retired` 는 목록 · 서브그래프 · 링크 그래프에서 뺀다. 문서를 지우면 그 slug 의 triple 도 지운다(트리거 — [[graph#Gotchas]]) |

시험 [[apps/api/tests/test_wiki_ontology.py]] — 첫 판 · 제안 → 승인 · 거절 · 정의역 · 치역 · 지운 문서의 triple · 위키 관계는 읽기만.

## Gotchas

- **시험의 pytest · jsonschema 는 api.sif 안이 아니라 호스트 `~/.local` 에서 온다**(홈 마운트). `--no-mount home` 으로 sif 만 띄우면
  둘 다 없다. jsonschema 는 pyproject `dev` 에 적어 두었다. **그래서 운영 코드는 jsonschema 를 쓰지 않는다** — LLM 출력은 pydantic
  모델로 검사한다(가짜 LLM 의 `conform` 만 시험 쪽에서 jsonschema 를 쓴다). PyYAML 은 이미지에 있다(uvicorn[standard]).
- 시험은 **시험 전용 DB · 색인 · 버킷**을 쓴다([[core]] 함정 8). 같은 시험 DB 를 실행마다 다시 쓰므로 위키 시험이 만든 줄은 여전히 시험이 지운다.
- `pytest -q` 는 addopts 의 `-q` 와 겹쳐 요약 줄이 숨는다 — 결과 줄을 남기려면 `-q` 없이 돌린다.
- **요청 밖에서 서비스 · 저장소를 직접 부르는 코드(시험 · CLI · 배경 작업)는 읽는 사람을 골라야 한다** — 안 고르면 `ViewerMissing`.
  시험은 `audience.set_viewer(audience.SYSTEM)` 또는 `with audience.acting_as(...)`. CLI(`scripts/import_one.py`)는 시작할 때 시스템으로.
- 시험 문서는 SQL 로 직접 넣는다 — `document_service.create_document` 는 Meili 색인(시험은 `test_documents`) · 웹훅까지 부른다. 받기 시험처럼 그 길을
  꼭 지나야 하면 끝에 `meili_indexer.delete_document` 로 색인 줄까지 지운다.
- **판 메모(change_log)는 ASCII 80자까지**(`[A-Za-z0-9._:-\s]`) — 반영 · 원천 문서 갱신이 쓰는 메모는 `wiki cs_xxxxxxxx` ·
  `wiki source cited-by`. 한글을 넣으면 `replace_document` 가 거부한다.
- 시험에서 워커를 돌릴 때는 `run_once(…, ops=[…])` · `serve(…, ops=[…])` 로 집을 op 를 좁힌다 — 같은 시험 DB 의 다른 시험 작업을 집지 않게.
- **시각 회귀를 빌드본(vite preview)에 돌릴 때는 서비스 워커를 막는다**(`serviceWorkers: 'block'`) — 빌드본의 PWA 서비스 워커가 낸
  API 요청은 `page.route` 고정 응답에 걸리지 않아 진짜 dev API 로 간다(위키 문서 머리띠 경우가 404 로 깨진다, 10-30). dev 개발 서버는 이
  박스의 파일 감시 한도(ENOSPC)에 걸려 뜨지 않는다 — 다른 포트의 `vite preview` 로 본다.
- **배경 LLM 호출은 DB 를 본다**(W7) — 문지기 · 장부가 `wiki_llm_turns` · `wiki_llm_usage` 를 읽고 쓴다. 0059 전의 DB 에 새 코드를 올리면
  배경 호출이 표 없음으로 깨진다 — 이관 먼저(배포 순서 그대로).
- **반영은 작은 점검을 줄 세운다**(W7) — 반영 시험을 돌린 시험 DB 에는 `lint` 작업이 남는다(그 묶음을 지운 뒤라도). 집으면 '점검할 문서가
  없다' 로 끝난다. 점검 시험의 정리가 묶음이 없는 점검 작업을 함께 지운다.
- **워커는 `--reload` 가 없다** — 위키 코드를 고치면 `mxwp_wiki` 를 다시 띄워야 새 코드로 돈다(update.sh · sync-from-drive.sh 는
  알아서 한다). dev 에서 손으로 — `apptainer instance stop mxwp_wiki && ./infra/scripts/start.sh`.
- **dev 의 워커(`mxwp_wiki`)는 dev DB 만 본다** — 시험 작업은 시험 DB 에 있어 위키를 켜 둔 채 시험해도 집지 않는다(10-24 까지는 같은 DB
  라 시험 전에 워커를 내려야 했다).
- **`apptainer exec instance://mxwp_api` 는 인스턴스의 환경을 물려받지 않는다** — `setup_buckets` 같은 스크립트는 컨테이너 안에서
  `set -a; . /workspace/.env; set +a` 를 먼저(안 하면 기본값 `minio:9000` 으로 붙으려다 멈춘다). 시험은 conftest 가 `.env` 를 읽는다.
- 범위가 `["org"]` 보다 좁은 위키 문서는 바깥 웹훅 `doc_created` 를 보내지 않는다(WK-D34). 판 바꾸기 · 보관 웹훅은 아직 그대로 —
  W4 반영 경로가 `replace_document` 를 쓸 때 같은 규칙을 단다.
