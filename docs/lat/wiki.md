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
| W1 연결 · 신원 | (다음) | — |
| W2 보이기 범위 ~ W8 cae00 | (아직) | — |

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
| 범위 계산 · 저장소 층 필터 | `app/wiki/audience.py` | W2 |
| 받기 · 멱등 · 철회 · DB 큐 · 워커 | `app/wiki/{sources,jobs,worker}.py` | W3 |
| LLM(구조화 출력) · 해석 · 계획 · 쓰기 · 검증 · 반영 | `app/wiki/{llm,resolve,plan,write,validate,apply}.py` | W4 |
| REST | `app/routers/wiki.py`(`/api/v1/wiki/*`) | W3~ |
| 위임 창구 | `app/routers/auth_sso.py`(`POST /api/v1/auth/sso`) | W1 |

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
