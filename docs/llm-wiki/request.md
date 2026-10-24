# MX WhitePaper — LLM 위키 · 포털 완전 연결 개발 요청서

> 대상 — MX WhitePaper 개발 세션(이 리포). 날짜 — 2026-10-24(KST). 보낸 쪽 — HWAX 포털 세션(사용자 요청).
>
> 요청 원문(요지) — "다른 플랫폼 연결들이 어느 정도 되었으니 **mx whitepaper 도 SSO 연동 포함해서 다 연결**되었으면 좋겠다. 그리고 mx whitepaper 에
> **공식적으로 알려진 llm wiki** 에 필요한 기능들을 넣었으면 좋겠다. 그것으로 **AI 에게 시뮬레이션 결과들에 대해 지속적으로 물어보고 정리**하고,
> **시장불량 데이터(cae00 에 있는 데이터)와 시뮬레이션 플랫폼에서 얻는 인사이트를 온톨로지화**하고, **사람들이 묻거나 해결한 문제들로 자연스럽게
> 위키에 지식이 쌓이는 구조**를 만들고 싶다. 제안된 구조가 있는지와, 있다면 mx-whitepaper 에 개발 요청으로 자세히."
>
> 읽는 순서 — **이 문서**(무엇을 · 왜 · 어떤 순서로) → [CONTRACTS.md](CONTRACTS.md)(표 · 봉투 · API · MCP · 검증의 정확한 꼴) →
> [SCHEMA-DRAFT.md](SCHEMA-DRAFT.md)(위키 규칙서 · 온톨로지 초안) → [START.md](START.md)(작업 시작점) · [checklist.md](checklist.md) ·
> [context-notes.md](context-notes.md)(결정과 까닭).
>
> 근거 — 사실 주장에는 파일 · 줄을 붙였다(2026-10-24 기준 조사). 줄 번호는 시간이 지나면 어긋나니 **함수 · 표 이름으로 다시 찾는다.** 다른 리포 경로는
> 리포 이름부터 적었다(`HWAXPortal/…`). 이 문서에는 내부 주소 · 토큰을 적지 않았다.

## 0. 한 장 요약

**요청은 둘이다.**

- **(A) 포털에 다 붙이기.** 타일 SSO · 라우트 · 배포 · 상태판 · 권한 열쇠는 이미 다른 앱과 같은 수준으로 붙어 있다. 빠진 핵심은 하나다 —
  포털 챗 · 심의 · Claude 가 게이트웨이를 거쳐 MXWP 를 부르면 **모두 서비스 계정 `admin@mx.local` 명의**로 간다(§4). RA · TestScope · HWAX Risk 는
  사람 명의로 간다. 이것을 같은 방식(공유 비밀로 그 사람 토큰을 받는 위임)으로 맞추고, 포털의 소속 · 플랫폼 권한을 MXWP 가 알게 한다.
- **(B) LLM 위키를 얹기.** Karpathy 의 LLM Wiki 패턴(§1)을 조직용으로 넓혀 MXWP 위에 짓는다. 시뮬레이션 결과 · 시장불량 · 사람들의 문답과
  해결 · 심의 결정문이 **불변 원천**으로 들어오고, AI 가 그것을 읽어 **엔티티 · 사례 · 분석 문서를 쓰고 고치며**, 모든 문장은 **원천에 근거를 달고**,
  주기적으로 **모순 · 낡음 · 빈틈을 점검**하고, 빈틈은 **질문으로 바꿔 다시 묻는다.**

**제안된 구조는 있다** — Karpathy 가 2026-04-04 공개한 'LLM Wiki' 아이디어 파일이다(원천 · 위키 · 규칙서 세 층, 들이기 · 묻기 · 점검 세 작업, `index.md` ·
`log.md` 두 파일). 다만 원문은 **한 사람이 큐레이션하는 개인 지식 베이스**를 전제하고 일부러 추상적으로 썼다("intentionally abstract"). 사내에 쓰려면
다섯을 더해야 한다 — ① 블록 단위 근거 ② 포털 권한을 그대로 따르는 보이기 범위 ③ 변경 묶음과 검토 ④ 사내 어휘에 맞춘 온톨로지 ⑤ 작업 실행기와 예산(§1-3).

**MXWP 는 출발점이 좋다.** 이미 나무위키형 위키다 — 문서 · `[[slug]]` 링크 · 역링크 · 버전 · ETag · 의미 관계(triple) · 용어집(제안 → 승인) · 검색 ·
MCP 29종(§3). 없는 것은 원천 층 · 블록 근거 · 변경 묶음 · 작업 큐 · 타입 있는 엔티티 · 문서 단위 권한이다. **DocumentJSON v1.0 은 바꾸지 않고 옆 표로**
짓는다.

**순서** — W0 준비 → W1 연결 · 신원 → W2 보이기 범위 → W3 원천 · 작업 실행기 → W4 들이기 · 검토(첫 동작판) → W5 온톨로지 → W6 묻기 · 되쌓기 · MCP →
W7 점검 · 지속 질의 → W8 실원천 · cae00(§9). W0~W7 은 **dev 에서 합성 데이터**로, 실데이터(시장불량 · 실제 해석 결과 · 실제 대화)는 W8 에 **cae00 에서만** 다룬다.

**사람이 정할 것** 열둘(§11) — 권장안으로 W0~W4 는 막힘 없이 갈 수 있다. W1 의 비밀 전달, W2 의 범위 단위, W6 의 대화 수확 방식, W8 의 시장불량
범위가 그 단계 전에 정해져야 한다.

## 1. 제안된 구조가 있나 — 있다(Karpathy 'LLM Wiki')

### 1-1. 원문 요지

원문 — gist `karpathy/442a6bf555914893e9891c11519de94f`(2026-04-04). LLM 에이전트에게 붙여 넣어 각자 맞는 판을 함께 짓게 하는 '아이디어 파일'이다.

- **핵심 생각** — 질의 때마다 원문을 다시 찾는 RAG 대신, LLM 이 원천과 사람 사이에 **서로 링크된 마크다운 위키를 점진적으로 짓고 유지**한다.
  "the wiki is a persistent, compounding artifact." 사람은 원천을 고르고 질문한다. 요약 · 교차 참조 · 장부 정리는 LLM 이 한다.
  비유는 "Obsidian is the IDE; the LLM is the programmer; the wiki is the codebase."
- **세 층** — ① **원천(raw sources)** 불변 — LLM 은 읽기만 한다. ② **위키** — LLM 이 쓴 요약 · 엔티티 · 개념 · 비교 · 개요 문서. LLM 이 온전히 소유한다.
  ③ **규칙서(schema)** — CLAUDE.md · AGENTS.md 같은 설정 문서. 구조 · 관례 · 작업 절차를 적고 사람과 함께 진화한다. 이것이 LLM 을 "일반 챗봇이 아니라
  규율 있는 위키 관리자"로 만든다.
- **세 작업** — **들이기(ingest)** — 원천 하나를 읽고 요점을 나누고 요약을 쓰고 목록을 고치고 관련 엔티티 · 개념 문서를 고친다("한 원천이 10~15 문서를
  건드린다"), 기록에 덧붙인다. 원문 저자는 한 번에 하나씩 들이며 곁에서 본다. **묻기(query)** — 위키를 찾아 읽고 근거를 달아 답한다. 좋은 답은 새 문서로
  **되쌓아(file back)** 탐색이 쌓이게 한다. **점검(lint)** — 모순 · 낡은 주장 · 고아 문서 · 빠진 개념 문서 · 빠진 교차 참조 · 자료 빈틈을 주기적으로 본다.
- **두 파일** — `index.md` 는 내용 목록(문서마다 링크 + 한 줄 요약, 질의 때 **먼저 읽는다** — 원천 100개 · 문서 수백 장까지는 임베딩 없이 잘 된다).
  `log.md` 는 시간순 덧붙이기 기록(`## [2026-04-02] ingest | 제목` 꼴이라 `grep "^## \[" log.md | tail -5` 가 된다).
- **도구(전부 선택)** — qmd(BM25 + 벡터 + LLM 재정렬, CLI · MCP), Obsidian Web Clipper, 그림 내려받기, 그래프 보기 · Marp · Dataview, git("그냥 마크다운
  git 리포").
- **왜 되나** — 지식 베이스에서 어려운 것은 **장부 정리**(교차 참조 갱신 · 요약 최신화 · 모순 표시)다. 사람은 유지 비용이 가치보다 빨리 커져서 위키를
  버린다. LLM 은 지루해하지 않고 한 번에 15개 파일을 고친다 — 유지 비용이 0 에 가까워진다. Vannevar Bush 의 Memex(1945)가 못 푼 '누가 유지하나'를 LLM 이 푼다.
- **단서** — "optional and modular — pick what's useful, ignore what isn't." 디렉터리 · 규칙서 · 문서 꼴 · 도구는 분야와 LLM 에 맞춰 정한다.

### 1-2. 왜 우리에게 맞나

지금 생태계의 지식은 **질문할 때마다 다시 만들어진다.** 포털 챗 · 심의 · 띵킹 · 리스크 심사가 같은 부품 · 같은 불량을 놓고 매번 도구를 다시 부르고
카드를 다시 찾는다. 답은 대화 저장소에 갇혀 주인만 본다(`HWAXPortal/backend/app/agent/conv_store.py` — 주인 외 읽기 길 없음). 심의 결정문은 RA 에
보고서로 남지만(`HWAXAgentServer/deliberation.py` `create_report_draft`) 엔티티별로 모이지 않는다. HWAX Risk 의 학습 고리는 시장 사례 입력이 비어 돌지
않는다(`HWAXRisk/backend/app/metrics.py` `sync_labels` → `no_source`). 위키는 이 셋을 **한 곳에 엔티티별로 쌓고, 쌓인 것을 다음 질문이 먼저 읽게** 한다.

### 1-3. 그대로 가져올 것과 넓힐 것

| 원문 | 이 요청에서 | 까닭 |
| --- | --- | --- |
| 원천은 불변 | **그대로** — DB 트리거로 강제(CONTRACTS §2-2) | 근거가 가리키는 대상이 바뀌면 근거가 거짓이 된다 |
| 위키는 LLM 이 소유 | **AI 관리 문서 + 사람 문서**를 함께 둔다. 사람이 고친 것은 `correction` 원천이 되어 다음 들이기가 따른다 | MXWP 에는 사람이 쓴 백서가 이미 많다. 전문가 정정을 AI 가 덮어쓰면 안 된다 |
| 규칙서는 CLAUDE.md | MXWP 문서 `wiki-schema`(판 있음) + 기계가 읽는 칸(SCHEMA-DRAFT) | 사람이 화면에서 고치고, 변경 묶음마다 어느 판으로 썼는지 남긴다 |
| 들이기는 사람이 곁에서 하나씩 | **자동 반영 + 검토 큐** — 검증을 다 통과하고 AI 문서만 건드리면 바로, 아니면 검토 | 원천이 하루 수십 건(해석 잡 · 불량 사례)이라 사람이 하나씩 못 본다 |
| 근거(citation) | **블록 단위 근거 + 숫자 대조**(V2 · V3) | 공학 숫자를 지어내면 위키가 해가 된다. 모델이 아니라 코드가 숫자를 대조한다 |
| (없음 — 개인용) | **보이기 범위**(`org` · 소속 · 플랫폼 · 개인) — 포털 권한표를 그대로 따르고 넓히기는 사람만 | PLM 결함 자료는 `plat:plmdefect` 로 막혀 있다. 위키가 그것을 모두에게 풀면 권한표를 우회한다 |
| 엔티티 · 개념 문서 | **타입 있는 온톨로지** — 유형 · 술어 표(제안 → 승인), 바깥 어휘(RA 엔티티 축 · SP · FMEA · HWAX Risk 분류)에 맞춘 외부 id | 시장불량 ↔ 해석 ↔ 대책을 이어 묻으려면 같은 부품 · 같은 불량을 같은 개체로 알아봐야 한다 |
| 점검 | 원문 여섯 + **빈틈 규칙**(시장에서 났는데 해석으로 재현 안 됨 · 해석으로 봤는데 시장 확인 없음 …) | 사용자가 말한 '지속적으로 물어보고 정리' 의 입력이 된다 |
| (없음) | **지속 질의** — 점검 · 들이기 · 사람이 남긴 질문을 대기열로, 예산 안에서 다시 묻고 답을 원천으로 되돌린다 | 같음 |
| `index.md` · `log.md` | **그대로**(꼴까지 — CONTRACTS §10) + 범위로 거름 | 사람과 LLM 이 먼저 읽는 곳 |
| 임베딩 없이도 된다 | 목록 + 엔티티 해석 + Meilisearch 로 시작, 의미 검색(pgvector)은 재 보고(§11 Q11) | 원문 규모(원천 100)를 넘으면 필요해질 수 있다 — 재고 정한다 |

## 2. 목표 그림

### 2-1. 층 셋 · 작업 넷

```text
 생산자                         MX WhitePaper                                         읽는 쪽
 ─────────                      ───────────────────────────────────────────           ─────────
 시뮬레이션 플랫폼 ──┐           ① 원천(불변) wiki_sources + MinIO wiki-sources
 시장불량(cae00) ────┼─ 봉투 ──▶    │                                                  MXWP 화면(위키 홈 · 문서 · 검토 큐)
 포털 문답 · 해결 ───┤ mxwp-        │ 들이기(ingest)                                    포털 챗 · 심의 · Claude
 심의 결정문 ────────┤ source/1     ▼  계획 → 쓰기 → 코드 검증 → 자동 반영 | 검토        ── 게이트웨이 MCP wiki_* ──
 RA · AIDataHub ─────┘           ② 위키(문서 = 엔티티 · 사례 · 분석 · 문답 …)            AIDataHub(지금처럼 밀어내기,
                                      블록 근거 · 관계(triple) · 엔티티 등록부             범위가 org 인 문서만)
                                      index · log
                                     ▲  │ 점검(lint) — 모순 · 낡음 · 고아 · 빈틈
                                     │  ▼
                                  질문 대기열 ── 지속 질의(inquire) ── 답 = 새 원천
                                     ▲
 사람: 질문 · 정정 · 검토 · 넓히기     │ 묻기(query) · 되쌓기(file back)
                                  ③ 규칙서(wiki-schema, 사람이 쓴다 · 판 있음)
```

### 2-2. 지식이 쌓이는 길 넷 — 사용자 요청의 네 문장에 하나씩

| 요청 | 길 | 무엇이 저절로 일어나나 |
| --- | --- | --- |
| "AI 에게 시뮬레이션 결과들에 대해 지속적으로 물어보고 정리" | 해석 결과 → `sim_result` 원천 → 들이기(해석 사례 문서 · 부품 · 불량 유형 문서 갱신) → 점검이 '이 결과가 시장과 맞나' 같은 질문을 만든다 → 지속 질의 | 잡이 끝나면(또는 사람이 보내면) 그 결과가 같은 부품 · 같은 시나리오의 이전 결과와 나란히 정리되고, 비교 · 추세 · 모순이 문서에 남는다 |
| "시장불량 데이터 · 시뮬레이션 인사이트를 온톨로지화" | PLM 문제점 사례 · VOC 집계 → `field_defect` 원천 → 엔티티 해석(모델 · 부품 · 불량 유형) → 관계 `observed-in` · `reproduced-by` · `caused-by` · `mitigated-by` | 같은 불량 유형 문서에 '시장에서' 와 '해석에서' 가 한 장에 모이고, 둘을 잇는 관계가 그래프로 남는다 |
| "사람들이 묻거나 해결한 문제로 자연스럽게 쌓이는 구조" | 포털 챗 · 심의 · MXWP 챗의 해결된 문답 → (동의) → `qa` · `deliberation` 원천 → 들이기 | 다음에 같은 것을 묻는 사람은 위키 답(근거 포함)을 먼저 받는다. 버튼 하나 또는 후보 승인 한 번이면 된다(§6-3, §11 Q1) |
| (위 셋을 잇는 고리) | 점검 → 질문 → 지속 질의(위키 · 읽기 전용 도구) → `inquiry_answer` 원천 → 들이기 | 빈틈이 질문이 되고 답이 다시 원천이 된다. 실험 · 해석이 필요한 질문은 사람에게 '제안'으로 넘긴다(돌리지 않는다) |

### 2-3. 하지 않는 것

- **RA · AIDataHub 를 대신하지 않는다.** 보고서 원본은 RA, 지식카드 원본은 AIDataHub 에 남는다. 위키는 그것을 원천으로 **인용**하고 엔티티별로 **엮는다.**
  (지금의 MXWP → AIDataHub 밀어내기 `integrations/aidatahub/` 는 그대로 두되 범위가 `["org"]` 인 문서만 보낸다 — §5-12.)
- **해석 · 시험을 스스로 돌리지 않는다.** 지속 질의는 읽기 전용이다. 새 해석이 필요하면 '제안' 문서와 질문 상태 `needs_experiment` 로 사람에게 넘긴다.
- **동의 없이 대화를 긁지 않는다.** 대화 저장소는 주인만 읽는다(포털의 약속). 위키로 가는 것은 주인이 보낸 것 · 승인한 후보뿐이다(§6-3).
- **다른 시스템에 쓰지 않는다.** RA 엔티티 제안 큐 등에 넣는 것은 나중 일(§11 Q12)이고, 넣더라도 그쪽 API 로만 한다(RA 리포는 고치지 않는다).
- **DocumentJSON v1.0 을 바꾸지 않는다.** 위키 상태는 옆 표(CONTRACTS §2). 스키마를 바꾸면 FE 타입 · toolkit RAG · drift 가드가 함께 흔들린다.
- **mock LLM 으로 위키를 쓰지 않는다.** 챗의 mock 폴백(`app/services/chat_agent.py` `_run_mock`)을 위키 쓰기에 쓰면 지어낸 문서가 근거를 단 채 쌓인다.
  LLM 이 없으면 작업은 줄에서 기다린다(CONTRACTS §11).

## 3. 지금 MXWP — 쓸 것과 빈 곳

MXWP 리포 기준 경로(`apps/api/app/…`). 조사 2026-10-24.

| 있다 — 그대로 쓴다 | 어디 |
| --- | --- |
| 문서 모델 DocumentJSON v1.0 — 재귀 절 · 39가지 블록 · `metadata`(소유자 · 검토자 · 태그 · `confidentiality`) | `schemas/document.py`(생성물, 원본 `packages/shared/schemas/document.json`) |
| 상태 `draft` · `in_review` · `approved` · `published` · `archived`, 버전 전체 사본 + `change_log`, ETag `W/"<id>-<ver>"` + 버전 CAS | alembic `0001_init` · `0012`, `services/document_service.py`, `repos/document_repo.py` |
| 위키 링크 `[[slug]]` · `[[slug#1.2|라벨]]` → `links` 표(저장 때마다), 역링크, 의존 그래프 + 고아 목록 | `services/wiki_link_extractor.py`, `routers/links_graph.py`, `routers/dep_graph.py` |
| 의미 관계(triple) — 술어 열 가지 표준(전제 · 인용 · 일부 · 종류 · 대체 · 의존 · 파생 · 예시 · 관련 · 대비) + LLM 추출(수동 실행) | alembic `0047` · `0049`, `lib/relationship_types.py`, `services/triple_extractor.py` |
| 용어집 — 분야 · 별칭 · 제안 → 관리자 승인 · CSV 일괄 | alembic `0048`, `routers/glossary.py` |
| 블록 권한(`meta.permission` = all · editor · admin — 역할 기준) 과 응답 가림 | `services/document_service.py` `_scrub_*`(51~140행 근처) |
| 검색 Meilisearch `documents`(제목 · 요약 · 절 제목 · 본문 · 그림 글 · 태그 · 작성자, 필터 소속 · 태그 · 상태 · 기밀도) | `search/meili_indexer.py` |
| 챗 `POST /api/v1/chat`(SSE · 도구 넷 · OpenAI 호환 · mock 폴백) | `routers/chat.py`, `services/chat_agent.py`, `services/llm_client.py` |
| MCP 서버 `mxwp-rag` — 29종(읽기 · 쓰기 · 그림 · 관계 · 내보내기), stdio 와 `--http`(:8765 `/mcp`), 요청마다 Bearer 를 API 로 넘김 | `dist/llm-docx-toolkit/mcp/server.py` |
| 기계 토큰 `mxwp_…`(범위 read · write · admin) | `routers/api_tokens.py`, `services/api_token_scopes.py` |
| 포털 타일 SSO(jwt-handoff) — 포털 JWKS 로 RS256 검증 · `scope=launch` · jti 재사용 막기 · 이메일로 사용자 생성 | `routers/portal_sso.py`(10-18 `c164dda` jose `require_*`) |
| 결재(승인 흐름) · 활동 피드 · 감사 로그 · 백업 · 스냅숏 | `routers/approvals.py` · `activity.py` · `audit.py`, `services/snapshots.py` |
| 프로세스 안 asyncio 티커(백업 · 요약 메일 · 보존 · 자동화 cron …) — 한 replica 전제 | `main.py`(393~466행 근처) |

| 없다 · 모자라다 | 무엇이 문제인가 | 이 요청에서 |
| --- | --- | --- |
| 원천 객체 | 가져오기는 원본 파일을 바꾸고 버린다. `references` · bibliography 는 자유 글 | 원천 층(§5-1) |
| 블록 · 주장 단위 근거 | 문서 단위 참고문헌뿐 — 어느 문장이 어디서 왔는지 모른다 | 근거 표(§5-4) |
| 작업 큐 · 워커 | 프로세스 안 티커뿐 — 재기동하면 끊기고 상태 API 가 없다 | DB 큐 + 별도 워커(§5-13) |
| 타입 있는 엔티티 | triple 은 문서 slug 끼리 · 술어 열 가지 고정 · 문서를 지우면 triple 이 남는다(FK 없음) | 온톨로지(§5-10) |
| 문서 단위 권한 | 역할이 전역(reader < editor < owner < admin)이다. **`confidentiality` 는 GET 에서 강제되지 않는다**(oEmbed 만 막는다 — `routers/oembed.py`). SSO 로 들어온 사람은 기본 editor | 보이기 범위(§5-12) — 위키가 막힌 자료를 담기 전에 먼저 |
| 검토 큐 | 결재는 있지만 editor 누구나 draft → published 로 갈 수 있다(`routers/approvals.py` 59~66행) · triple 은 검토 없음 | 변경 묶음 검토(§5-5) |
| 점검 | 스키마 · 고유 id 검사, 고아 목록뿐 — 모순 · 낡음 없음 | 점검(§5-8) |
| 의미 검색 | postgres 이미지에 pgvector 는 있지만 벡터 칸이 없다 | 재고 정한다(§11 Q11) |
| 챗 대화 저장 · 되쌓기 | MXWP 챗 대화는 화면 저장소에만 산다 | 묻기 · 되쌓기(§5-7) |
| AI 저작 기능 | `/api/v1/ai/*` 는 자리만 있다(`routers/ai.py` `_call_llm` 이 NotImplementedError) | 위키는 이것과 무관하게 `app/wiki/` 로 짓는다(자리를 채우지 않는다) |

**같이 바로잡을 낡은 문서 셋** — ① `docs/HWAX-PORTAL-INTEGRATION.md` 3~6행은 포털이 접두를 "그대로 넘긴다" 고 하지만 지금은 **떼어서** 넘긴다
(`HWAXPortal/backend/config/routes.env` 50~51행), 54~72행의 `vite preview` 설명도 지금은 `serve -s` 다. ② `docs/llm-widgets-via-api.md` 1318~1330행이
`documents:write` 같은 범위를 적었는데 API 는 read · write · admin 만 받는다. ③ `docs/mcp-parity/checklist.md` 는 다 지었는데 칸이 비어 있다.

## 4. 포털 완전 연결(SSO 포함)

### 4-1. 지금 상태

| 항목 | 상태 | 근거 |
| --- | --- | --- |
| 타일 SSO(jwt-handoff) | **됨**(코드) — 실제 로그인 끝까지 확인한 기록은 못 찾았다 | `HWAXPortal/backend/config/systems.yaml` 53~66행, `backend/app/auth/downstream.py`(90초 RS256), MXWP `routers/portal_sso.py` |
| 포털 로그아웃 → MXWP 로그아웃 | 됨 | `HWAXPortal/backend/app/auth/routes/session.py` 330~368행 |
| nginx 라우트 | 됨 — `/mx-white-paper/` → :5173, `/mx-white-paper/api/` → :8800 | `HWAXPortal/backend/config/routes.env` 46~51행 |
| 배포 · 기동 · 자가 수리 · 상태판 | 됨 | `HWAXPortal/infra/services.yaml` 102~127 · 346~353행, `infra/scripts/update-all.sh` |
| 권한 열쇠 | 됨 — `plat:mxwhitepaper`(타일 + 게이트웨이 백엔드) | `HWAXPortal/backend/config/access.yaml` 62~65행 |
| 게이트웨이 MCP | 됨 — 백엔드 키 `mx-white-paper` · `MXWP_MCP_URL`(기본 루프백 :8765) | `HWAXMcpGateway/provision-config.sh` 490~493행 |
| **게이트웨이 경유 신원** | **없음** — `admin@mx.local`(또는 첫 사용자) 명의 서비스 토큰 둘(`hwax-gateway-mcp` · `hwax-gateway-rest`). dev 감사 원장에서 MXWP 호출은 `service` · 모드 없음뿐(RA 는 `as-conn`, HWAX Risk 는 `as-user-pat`) | `HWAXMcpGateway/provision-config.sh` 98~130행, `gateway.py` 4522~4525행 |
| 게이트웨이 REST 다리 | 서비스 토큰 주입(`inject`)이라 GET · HEAD 만 | `HWAXMcpGateway/provision-config.sh` 534~536행, `rest_proxy.py` 75~94행 |
| 포털 → MXWP 쓰기 | 챗 문서 메뉴의 '위키' 는 입력창에 지시문만 채운다 · 업로드 목적지 없음 · 심의 결정문은 RA 로만 | `HWAXPortal/frontend/src/components/chat/DocActions.tsx` 104~117행, `backend/app/agent/upload.py` 14~57행, `HWAXAgentServer/app.py` 5090 · 5356행 |
| 소속 · 권한 | 포털 소속 · 플랫폼 권한이 MXWP 로 안 간다 — 새 SSO 사용자는 '첫 팀' · editor | MXWP `routers/portal_sso.py` 141~145행 |
| 설정 킷 | `infra/env-kits/mx-white-paper.env` 는 새 박스에서 손으로 — update-all 은 에이전트 서버 킷만 | `HWAXPortal/infra/scripts/update-all.sh` 1194행 근처, `infra/env-kits/README.md` |

### 4-2. MXWP 몫(이 리포)

| # | 할 일 | 계약 · 메모 |
| --- | --- | --- |
| C1 | **위임 창구 `POST /api/v1/auth/sso`** — 헤더 `X-Heax-Gateway-Secret` · `X-Heax-User-Email`(필수) · `X-Heax-User-Name`(퍼센트 인코딩) · `X-Heax-Client`(`gateway` · `hwax-portal`). 200 `{access_token, token_type:"bearer", expires_in}` | ste · HWAX Risk · RA(옛 `sso/heax.py`)와 같은 계약(`HWAXPortal/docs/sso-delegation/PLAN.md` §1). 비밀이 비면 **404(꺼짐)** · 틀리면 401 · 비활성 · 자동 생성 꺼짐 403 · 이메일 없음 400. 비밀 비교는 `hmac.compare_digest` |
| C2 | 위임 토큰 — 12시간 이상 · 범위 read + write(admin 아님) · 발급 클라이언트별로 따로(같은 사람의 `gateway` 발급이 `hwax-portal` 발급 · 웹 세션을 회수하지 않게) · 세대 번호로 회수 가능 | 게이트웨이는 최대 12시간 캐시하고 401 이면 한 번 다시 받는다(`HWAXMcpGateway/gateway.py` `USER_PAT_TTL_S`) |
| C3 | 사용자 자동 생성은 지금의 `_upsert_user` 를 그대로 쓰되 설정 `MXWP_SSO_JIT_CREATE`(기본 켬)로 끌 수 있게 | 처음 보는 사람이 게이트웨이로 먼저 오면 그때 생긴다 |
| C4 | **소속 · 플랫폼 권한 받기** — 위임 호출의 `X-Heax-User-Affiliation` + `X-Heax-Aff-Proof` 를 검증해 `users.portal_affiliation` 에(평문만이면 무시), 진입 토큰의 `affiliation` 클레임 · `groups` 의 `plat:` 항목(P3 — 포털 10-24 구현)을 같은 칸에 | CONTRACTS §2-10 · §9. 증명 꼴은 게이트웨이 `_aff_proof` 와 **같아야** 한다(`v1|<email>|<소속>|<exp>` 의 HMAC-SHA256, 같은 비밀) |
| C5 | **소속 → 팀** — `wiki_aff_team_map` 으로 처음 들어온 사람의 팀을 정한다(비면 지금처럼 첫 팀) | 관리자 화면 한 장 |
| C6 | 진입 토큰 jti 재사용 막기를 DB 로(지금은 프로세스 메모리 — 워커가 둘이 되면 뚫린다) | 위키 워커와 무관하지만 연결 점검 김에 |
| C7 | MCP 서버 — `wiki_*` 도구(§5-15)와, 위키 문서를 고치는 기존 쓰기 도구 막기 | CONTRACTS §7 |
| C8 | 문서 — `docs/HWAX-PORTAL-INTEGRATION.md` 를 지금 모습으로(접두 떼기 · `serve -s` · 위임 · 소속), 새 lat 노드 `docs/lat/wiki.md` | lat 유지 룰 |

### 4-3. 포털 · 게이트웨이 · 에이전트 서버 몫(이 리포에서 고치지 않는다)

HWAXPortal `docs/mxwp-wiki/PLAN.md` 가 정본이다. 여기는 MXWP 쪽이 기대해도 되는 계약만 적는다.

| # | 어디 | 할 일 |
| --- | --- | --- |
| P1 | 게이트웨이 provision | `PER_USER_SSO_APPS="mx-white-paper:MXWP"` · `MXWP_SSO_SECRET` · `MXWP_SSO_URL`(기본 `http://127.0.0.1:8800/api/v1/auth/sso` — API 직결, Caddy 를 안 거친다) — **코드 수정 없는 일반 길**(`HWAXMcpGateway/provision-config.sh` 703~737행). 목록 조회용 서비스 헤더는 RA 처럼 남긴다 |
| P2 | 게이트웨이 provision | REST 다리 `rest.mx-white-paper` 를 `inject` → `per_user` 로(ste 와 같은 모양) — 이 줄은 **코드 수정**이다. 그러면 `rest_call` 쓰기도 그 사람 명의로 열린다 |
| P3 | 포털 진입 토큰 | **10-24 구현** — `plat:` 은 원래 `groups` 에 실렸고, 소속 `affiliation` 클레임을 MXWP 진입 토큰에만 더했다(값이 없거나 권한표에 없는 소속이면 칸이 없다 — 빈 값을 '소속 없음' 이라는 소속으로 묶지 않게) |
| P4 | 게이트웨이 | **10-24 구현**(켜기는 박스 설정 `MXWP_SEND_PLAT=1`) — 위임 호출에 `X-Heax-User-Plat` + `X-Heax-Plat-Proof`(소속 증명과 같은 규칙, CONTRACTS §9). 헤더가 없는 호출에서 MXWP 는 `plat:` 범위 문서를 보여 주지 않는다 |
| P5 | update-all | **10-24 구현**(f7c9c7b) — 비밀 · 주소는 게이트웨이 `provision.env` 에 둔다(일반 길). update-all 은 그 값을 provision 에 넘기고 · 비면 `PER_USER_SSO_OFF` 로 끄고 · 어긋나면 재프로비저닝한다(`MXWP_SEND_PLAT` 포함). MXWP `.env` 의 같은 비밀은 사람이 넣는다 · 비밀은 **자동 생성하지 않는다**(MXWP 가 준비되기 전에 생기면 그 순간 MXWP 호출이 거부로 바뀐다) |
| P6 | 포털 챗 | 문서 메뉴 '위키에 남기기' 를 진짜 동작으로 — 그 턴의 질문 · 답 · 근거(활동의 도구 호출 요약)를 `qa` 봉투로 만들어 그 사람 명의로 `POST /api/v1/wiki/sources`(포털 → MXWP 위임 — P1 과 같은 비밀, `X-Heax-Client: hwax-portal`) |
| P7 | 포털 챗 | '해결됨' 표시(턴 단위) → 위키 후보(주인만 보는 `held` 원천) — §6-3, 사람 결정 §11 Q1 |
| P8 | 에이전트 서버 | 심의 결정문을 RA 와 함께 위키에도(사람이 고른 범위 · 동의가 있을 때) — `deliberation` 봉투 |
| P9 | 포털 상태판 · 이력 | MXWP `/api/v1/wiki/health` 를 상태판에 · 변경마다 업데이트 이력(`backend/config/changelog.yaml`) |

### 4-4. 사람 몫(cae00 · 각 박스)

1. 비밀 하나를 만들어(`openssl rand -hex 32`) MXWP `.env` 의 `MXWP_SSO_SECRET` 과 게이트웨이 `HWAXMcpGateway/provision.env` 에 같은 값으로 —
   메신저 평문 말고. provision.env 에는 넷 — `PER_USER_SSO_APPS` 에 `mx-white-paper:MXWP` 쌍 · `MXWP_SSO_SECRET` ·
   `MXWP_SSO_URL=http://127.0.0.1:8800/api/v1/auth/sso` · `MXWP_SEND_PLAT=1`(HWAXPortal `docs/mxwp-wiki/PLAN.md` §6 이 정본, 10-24 포털 세션 정정).
2. update-all → 로그에 `✓ mx-white-paper 사람별 위임 — <주소>` 줄이 나오는지(게이트웨이 provision 이 찍는다 — `/health` 에는 위임 목록이 없다).
3. 타일 로그인을 dev · cae00 에서 끝까지 한 번(브라우저) — 지금까지 실제 로그인 확인 기록이 없다.

### 4-5. 다 됐는지 확인

- 비밀 없이 `POST /api/v1/auth/sso` → 404 · 게이트웨이는 지금처럼 서비스 계정(되돌리기가 된다).
- 비밀을 넣고 포털 챗에서 MXWP 문서를 만들면 — 문서 소유자가 **그 사람**, 게이트웨이 감사 원장의 그 호출이 사람 명의 모드.
- 신원이 **있는** 호출의 위임 발급이 실패하면 게이트웨이는 서비스 계정으로 **강등하지 않고** 거부한다. 신원이 **없는** 내부 호출은
  서비스 계정 시야로 가고 게이트웨이 감사에 `mode=service note=no-identity` 가 남는다(게이트웨이 설계 — 10-24 끝에서 끝에서 확인,
  처음 이 줄은 '신원 없는 호출도 거부' 로 잘못 적었다). ⚠ MXWP 에서 서비스 계정은 admin 이라 그 시야는 모든 범위를 본다(WK-D43).
- 다른 사람 이메일을 헤더에 적어 MXWP API 를 직접 부르면 — 비밀이 없으니 401. 소속 헤더만 위조하면 — 증명이 안 맞아 무시.

## 5. 위키 기능 명세

정확한 표 · 칸 · 꼴은 [CONTRACTS.md](CONTRACTS.md), 문서 꼴 · 술어 · 정책 기본값은 [SCHEMA-DRAFT.md](SCHEMA-DRAFT.md). 여기는 **무엇을 왜** 다.

### 5-1. 원천(raw sources)

- 생산자가 봉투 `mxwp-source/1` 로 보낸다(CONTRACTS §3). 종류 열 가지 — `sim_result` · `field_defect` · `qa` · `deliberation` · `report` · `card` ·
  `document` · `correction` · `inquiry_answer` · `note`.
- **불변 · 멱등 · 철회 가능.** 새 판은 새 줄(`supersedes_id`). 같은 것을 두 번 보내면 같은 id. 주인이 철회하면 그 원천을 인용한 문장은 점검이 잡아
  고침 묶음(늘 검토)을 만든다.
- 원천 하나에 **원천 문서**(`kind='source'`) 한 장 — 원천의 사람용 요약 · 출처 링크 · 인용한 문서 목록. 원문 '요약 문서' 에 해당한다.
- 첨부(그림 · 원자료)는 MinIO 버킷 `wiki-sources` 에 sha256 로. 큰 원자료(d3plot · STEP)는 싣지 않는다 — 원천 시스템의 링크만.

### 5-2. 위키 문서

- 위키 문서 = `wiki_pages` 에 한 줄이 있는 MXWP 문서. 종류 열 — `source` · `entity` · `concept` · `case` · `analysis` · `qa` · `overview` · `index` ·
  `lint-report` · `schema`. 종류마다 절 꼴이 정해져 있다(SCHEMA-DRAFT §2).
- `managed='ai'` 는 AI 가 고치고 사람도 고칠 수 있다. 사람이 고치면 저장 훅이 그 차이를 `correction` 원천으로 만들고, 다음 들이기는 그것을 이긴 쪽으로
  따른다. 사람이 '이 블록은 내가 지킨다' 면 기존 `BlockMeta.locked` 를 켠다 — AI 묶음은 그 블록을 못 고친다(V5).
- `managed='human'` 은 사람이 쓴 백서다. AI 는 고칠 수 없고 **제안만** 한다(검토 큐). 백서는 `document` 원천으로 들여 엔티티 문서가 인용할 수 있다.
- 문서 slug 는 종류 접두 + 유형 + 이름(SCHEMA-DRAFT §3) — 예 `ent-part-hinge-bracket`, `case-sim-<원천 짧은 id>`.
- 위키 문서는 처음부터 `published`(검토를 통과한 묶음만 반영되므로). `review_lock` 을 켠 문서는 AI 변경을 늘 검토로 돌린다.

### 5-3. 규칙서(schema)

- MXWP 문서 `wiki-schema`(종류 `schema`, `managed='human'`, admin 만 고친다) + 그 안의 기계용 블록(코드 블록 YAML — 종류별 절 꼴 · slug 규칙 · 술어 · 정책 ·
  예산 · 점검 문턱). 저장하면 판이 오르고, 서버는 YAML 을 검증한 뒤에만 새 판을 쓴다(틀리면 저장 거부).
- 모든 프롬프트는 규칙서의 그 판을 싣고, 변경 묶음은 판 번호를 남긴다. 판이 오르면 점검이 '옛 판으로 쓴 문서' 를 천천히 다시 쓴다(예산 안에서).
- 초안은 [SCHEMA-DRAFT.md](SCHEMA-DRAFT.md) — W0 에 사람이 읽고 고친다.

### 5-4. 근거(citation)

- **사실을 담은 블록마다 원천 하나 이상**(V2). 근거는 `wiki_citations`(블록 id → 원천 id + 위치 + 짧은 인용).
- 화면은 블록 끝에 각주 번호를 그리고, 누르면 원천 카드(종류 · 출처 시스템 · 날짜 · 위치 · 인용 · 원본 링크)를 연다. MCP `wiki_read` 는 블록마다 근거를
  붙여 준다 — 바깥 에이전트가 '어디서 왔나' 를 따라갈 수 있게.
- **숫자는 코드가 대조한다**(V3) — 새 글의 숫자 + 단위가 인용한 원천 `payload` 에 있어야 한다(단위 정규화 · 반올림 허용). 계산한 수(비율 · 차이)는
  `계산:` 과 식을 달아야 한다. 모델에게 "맞느냐" 를 묻지 않는다.

### 5-5. 변경 묶음 · 검토

- AI 의 모든 쓰기는 변경 묶음(CONTRACTS §2-4 · §4) 하나다 — 여러 문서의 블록 연산 · 관계 · 엔티티 · 질문을 묶어 **함께 검증하고 함께 반영하고 함께
  되돌린다.**
- 검증은 코드(CONTRACTS §5 V1~V11). **자동 반영**은 다 통과하고 AI 문서만 건드리고 지우는 연산이 없을 때. 아니면 **검토 큐**.
- 반영은 기존 `document_service` 경로(ETag · 버전 · 저장 훅 · 재색인)로 — 판의 `change_log` 에 `wiki cs_xxxxxxxx`. 되돌리기는 그 판들로 복원.
- **검토 화면** — 묶음 하나 = 문서별 블록 diff(앞 · 뒤) · 연산마다 `why` · 검증 결과 · 인용 원천 미리보기 · 승인 · 거절(까닭 한 줄) · 일괄 승인.
  검토자는 그 묶음의 범위를 볼 수 있는 사람 중 `wiki_reviewer`(새 역할 표지 — §11 Q7) 또는 대상 문서의 owners · reviewers.
- 바깥 에이전트(포털 Claude · Claude Code)가 MCP `wiki_propose` 로 낸 묶음은 **늘 검토**.

### 5-6. 들이기(ingest)

한 원천 → 한 작업. 단계는 코드가 이끌고 LLM 은 정해진 칸만 채운다(구조화 출력).

1. **준비** — 규칙서 판 · 원천 · `subject_hints` · 범위.
2. **엔티티 해석** — 결정적인 것부터(외부 id 같음 → 별칭 같음 → 정규화 이름 같음), 남은 것만 LLM 이 후보(검색 상위 K) 중에서 고른다. 못 고르면 새 엔티티
   제안(유형이 승인된 것만).
3. **계획** — LLM 이 `{원천 문서 요약, 건드릴 문서[slug|새로, 종류, 까닭], 새 엔티티, 관계, 질문, 의심되는 모순}` 을 낸다. 문서 수 상한(규칙서 기본 12 —
   원문의 10~15).
4. **쓰기** — 문서마다 LLM 에게 그 문서의 지금 절 · 블록(id 포함) · 원천 · 종류 꼴을 주고 블록 연산과 근거를 받는다. AI 가 관리하는 절만 고친다.
5. **검증 → 반영 또는 검토 → 목록 · 기록 · 재색인** — 반영된 문서만 대상으로 작은 점검(모순 · 링크)을 줄에 넣는다.

- 원천 **하나씩** 순서대로(원문 권고). 같은 엔티티를 건드리는 두 작업이 겹치면 늦은 쪽이 다시 읽는다(버전 CAS).
- 들이기 하나의 예산(기본 6만 토큰)을 넘기면 계획을 줄여 다시 하지 않고 `held` 로 둔다 — 조용히 일부만 쓰지 않는다.
- 그림 — v1 은 원천의 글 · 숫자만 쓰고 그림은 원천 문서에 붙여 보여 준다. 그림을 읽어 쓰는 것(VLM)은 W8 이후 선택(§7).

### 5-7. 묻기 · 되쌓기(query · file back)

- **묻기** — `POST /api/v1/wiki/query`(SSE, 챗 프레임 + `citation`) · MCP `wiki_ask` · MXWP 챗의 '위키' 모드가 같은 서버 함수를 쓴다.
  순서는 원문 그대로 — 목록(index)을 먼저 읽고 → 검색 · 엔티티 해석 → 문서를 읽고 → 숫자가 필요하면 원천까지 → 근거를 달아 답한다.
- **답이 없으면 그렇다고 말한다** — "위키에 아직 없다" + 질문 대기열에 넣을지 묻는다(`origin='query_miss'`). 위키 밖 지식으로 메우지 않는다(메우면 근거
  없는 답이 위키 답처럼 보인다).
- **되쌓기** — 답 아래 '위키에 남기기' → `qa` 원천(질문 · 답 · 근거 · 결과 `solved|partial|unknown`) → 들이기. 좋은 탐색이 다음 사람의 출발점이 된다.
- MXWP 챗(`services/chat_agent.py`)의 위키 모드는 문서를 직접 만들던 도구(`create_document` · `append_section`) 대신 `search_wiki` · `read_wiki` ·
  `file_answer` 를 쓴다. 지금 챗은 LLM 응답을 한 번에 받는다(비스트리밍 · 60초) — 묻기는 스트리밍으로 바꾸고 시간 제한을 늘린다(§7).

### 5-8. 점검(lint)

| 규칙 | 무엇을 보나 | 고침 |
| --- | --- | --- |
| `orphan` | 들어오는 링크 없고 목록에도 없는 위키 문서(지금의 `/dep-graph/orphans` 를 쓴다) | 상위 문서에 링크 · 합치기 제안 |
| `uncited` | 근거 없는 사실 블록(사람이 편집기로 넣은 것 포함) | 근거 찾기 질문 · 표시 |
| `stale` | 인용 원천이 `superseded` · `withdrawn` · 같은 엔티티 · 같은 지표의 더 새 원천이 있음 | 다시 들이기 |
| `contradiction` | 같은 엔티티의 같은 지표를 서로 다른 원천이 다르게 말함 — 숫자는 코드로, 글은 LLM 이 짝 K 개만 | '서로 다른 말' 절에 둘 다 + 질문 |
| `missing_page` | 위키 여러 곳(규칙서 기본 3)에 나오는 이름인데 엔티티 문서가 없음 | 엔티티 제안 |
| `missing_link` | 본문에 엔티티 이름 · 별칭이 있는데 `[[링크]]` 가 없음 | **결정적 자동 고침**(링크만 다는 묶음) |
| `gap` | 온톨로지 빈틈 — 시장 불량이 있는데 `reproduced-by` 없음 · 해석 위험이 있는데 `observed-in` 없음 · 대책에 `verified-by` 없음 · 부품에 시험 없음 | 질문(대개 `needs_experiment` 후보) |
| `schema` | 종류 꼴의 필수 절이 없음 · 옛 판으로 씀 | 다시 쓰기 |
| `stuck_review` | 검토가 규칙서 기본 7일 넘게 밀림 | 검토자에게 알림(MXWP 알림 기능) |

- 주기 — 반영 직후 작은 점검(그 묶음의 문서) · 밤 전체 점검(조용한 시간, 예산 20만 토큰).
- 결과는 `lint-report` 문서(날짜별 한 장) + 결함 표 + 질문. 같은 결함은 한 줄로 이어진다(날마다 새로 쌓지 않는다).

### 5-9. 지속 질의(inquiry) — "지속적으로 물어보고 정리"

- **질문이 생기는 곳** — 점검(빈틈 · 모순) · 들이기(이 원천이 남긴 물음) · 묻기 실패 · 사람이 남긴 질문 · 규칙서의 **상시 질문**(예 — 모델마다 "낙하 해석과
  시장 불량이 맞는가", 부품마다 "시험이 덮는가").
- **답하는 순서** — ① 위키로 답이 되나(묻기) ② 읽기 전용 도구(게이트웨이 MCP — 허용 목록만, 아래)로 더 모으면 되나 ③ 사람이 답해야 하나(`needs_human` —
  담당 · 질문을 남기고 MXWP 알림) ④ 실험 · 해석이 필요한가(`needs_experiment` — '제안' 으로 남김, 돌리지 않는다).
- **답 = 원천** — `inquiry_answer`(질문 · 답 · 도구 호출 요약 · 확신도) → 들이기. 질문은 `answered` 로 닫고 답 원천에 잇는다.
- **도구 호출 신원** — 위키 워커는 포털에서 발급한 **읽기 전용 PAT**(포털의 읽기 토큰 허용 목록 — `HWAXPortal/docs/followups-1017`)를 쓴다. 이 PAT 의
  시야는 '사람 없는 서비스' 의 시야라, 사람별로 막힌 자료(주인만 보는 잡 등)는 보지 못한다 — 그런 질문은 `needs_human` 으로 넘긴다. 신원을 꾸며 남의
  자료를 읽지 않는다.
- **예산 · 시간** — 하루 상한 · 질문당 상한 · LLM 동시 1 · 조용한 시간(규칙서). 사람이 기다리는 묻기와 포털 챗 · 심의를 밀어내지 않는다(§7).

### 5-10. 온톨로지

- **유형 표 · 술어 표**(CONTRACTS §2-6) — 초기값은 SCHEMA-DRAFT §4 · §5(제품 모델 · 부품 · 재료 · 불량 유형 · 메커니즘 · 시장 사례 · 해석 사례 · 해석 종류 ·
  신뢰성 시험 · 대책 · 개발 단계 · 과제 · 개념). 새 유형 · 술어는 **제안 → admin 승인**(용어집과 같은 길).
- **엔티티 등록부** — 이름 · 별칭 · 외부 id(`ext_ids`) · 속성 · 문서 한 장. 바깥 어휘와 맞추는 열쇠가 외부 id 다.

| 바깥 어휘 | 무엇 | 맞추는 법 |
| --- | --- | --- |
| RA 엔티티 | 축 `model` · `part` · `bom` · `phase` · `defect` · `rel_test` · `sim_type` + 레코드 `project` · `supplier` · `test_run` · `incident` · `failure_mode` · `cae_part`, 관계 `part_of` · `variant_of` · `supplied_by` · `tested` · `caused_by` · `same_as`, 제안 큐 | `ext_ids.ra_entity` · 유형 대응(SCHEMA-DRAFT §5). RA 는 API 로 읽기만 |
| StandardPlatform(SP) | `plm_project` · `plm_task`(과제 상태 · 시험 종류 …) · `plm_model`(모델 종류 · 양산 모델 코드 · 기준 코드 · 시리즈 · 지역 · 개정) · 관계 `plm_derived_from` | `ext_ids.sp_project` · `sp_task` · `sp_model`. cae00 허브는 아직 안 붙었다(`HWAXPortal/docs/doc-to-ra/PLAN.md`) — 붙으면 StepForge `core/sp_core.py` 방식의 읽기 전용 거울 |
| StepForge | 부품 역할 16(glass · frame · bracket · pcb · shield_can · tim · battery · fastener …) · 고장 모드 7 | 부품의 `attrs.part_role` |
| HWAX Risk 분류 v1.2 | 영역 15 · 메커니즘 52 · 검출성(해석으로 · 시험만 · 시장만 · 모름) · 근거 등급 | 메커니즘 엔티티의 `ext_ids.risk_mechanism` · 검출성은 불량 유형 속성 |
| FMEA | 기능 → 고장 모드 → 영향 → 원인 → 예방 · 검출 관리 → S · O · D | 불량 유형 문서의 절 꼴이 FMEA 꼴을 따른다(나중에 FMEA Agent 와 주고받기 쉽게) |
| MaterialTwin | 재료 · 물성 정의(분야.이름 · 단위 · 조건 축) | 재료 엔티티 `ext_ids.mt_material` |
| AIDataHub | data_type 7 · doc_type 약 40 · 동의어 사전 · 지식카드(약 1만 장 — 층 core · deep · checklist · failure_mode) | 카드는 원천(`card`) · 분야는 개념의 `attrs.domain` |
| MXWP 용어집 | 분야 · 별칭 | 개념 엔티티 ↔ 용어(같은 이름이면 잇고 별칭을 나눈다) |

- **관계** — 지금의 `doc_triples` 에 칸을 더해(술어 열쇠 · 원천 · 묶음 · 확신도 · 상태) 그래프 화면(`include_triples=1`)이 그대로 보이게 한다.
  문서를 지우면 남던 triple 을 이번에 정리한다.
- **중복** — 같은 개체가 둘 생기면 `entity.merge`(늘 검토). 해석 정확도는 W5 완료 기준(§9).

### 5-11. 목록 · 기록

CONTRACTS §10 그대로 — `index.md` · `log.md` 꼴을 원문과 같게(사람 · LLM 이 같은 방식으로 읽게). 목록은 범위로 거른 뒤 짓는다.

### 5-12. 보이기 범위 · 권한 — **막힌 자료를 들이기 전에 먼저**

- 범위 토큰 넷(`org` · `aff:` · `plat:` · `user:`)의 **그리고**(CONTRACTS §2-11). 문서의 범위는 인용 원천의 범위를 다 담는다(넓히지 않는다). 넓히기는
  사람만, `plat:` 를 빼는 것은 admin 만.
- **읽기 길 전수** — 아래를 하나도 빠짐없이 거른다. 한 곳에서 거르도록 저장소 층(`repos/document_repo.py`)과 검색 필터에 넣고, 길마다 시험 하나를 둔다.

| 길 | 메모 |
| --- | --- |
| 문서 GET · 목록 · 판 · diff · 복원 | |
| 검색(Meilisearch) | 문서에 `audience` 필터 칸을 더해 사람의 토큰으로 거른다. `body_text` 에 범위 밖 글이 섞이지 않게 위키 문서는 범위 하나로만 색인 |
| 링크 그래프 · 의존 그래프 · 고아 · 역링크 · triple 그래프 | 범위 밖 노드는 이름도 내지 않는다(`status='missing'` 처럼 보이게도 하지 않는다 — 빠진다) |
| 내보내기(docx · pptx · md · html · pdf) · 발표 모드 | |
| 공유 링크 `/share/:token` · oEmbed | 위키 문서 중 `["org"]` 가 아닌 것은 공유 링크를 만들 수 없게 |
| 문서 링크 카드 · 관련 문서 · 그림 목록 같은 **다른 문서 안의 미리보기** | |
| 댓글 · 알림 · 요약 메일(digest) · 구독 · 분석 화면 | 메일 본문에 제목이 새지 않게 |
| 챗 `search_corpus` · `get_document` · MXWP MCP 읽기 도구 | |
| AIDataHub 밀어내기(`integrations/aidatahub/`) | `["org"]` 만 |
| 데이터 덤프(`infra/scripts/data-dump.sh` — `documents` 전부를 싣는다) | 아래 §8 |

- 기존(위키가 아닌) 문서의 권한 모델은 이번에 바꾸지 않는다. 다만 `confidentiality=restricted` 가 GET 에서 강제되지 않는 것은 위키와 같은 저장소 층
  필터로 함께 막을지 사람에게 묻는다(§11 Q4).

### 5-13. 작업 실행기 · 예산

- DB 큐 `wiki_jobs`(`SKIP LOCKED` · lease · 재시도 3 · 우선순위 · `not_before`) + **별도 워커 프로세스**(`python -m app.wiki.worker`, 같은 api.sif).
  인스턴스는 새로 하나 — 이름 제안 `mxwp_wiki`. 그러면 `infra/scripts/start.sh` · `stop.sh` · `status.sh` · `update.sh`(지금 "이 스택의 인스턴스 다섯만"
  내린다 — 095f8e9) · `diag.sh` · `sync-from-drive.sh` · 포털 `HWAXPortal/infra/services.yaml` 의 MXWP 항목이 **여섯**을 알아야 한다(포털 몫은 P9 옆에
  적는다).
- 프로세스 안 asyncio 티커(지금 방식)는 쓰지 않는다 — API 재기동이 긴 LLM 작업을 끊고, 상태를 볼 길이 없다.
- 예산(규칙서) — 하루 토큰 · 작업당 토큰 · LLM 동시 수 · 조용한 시간. 넘치면 `held` + 기록. `/api/v1/wiki/health` 에 큐 길이 · 가장 오래 기다린 작업 ·
  최근 실패 · LLM 닿음.

### 5-14. 화면(apps/web)

| 화면 | 무엇 |
| --- | --- |
| 위키 홈 `/wiki` | 목록(종류 · 유형별) · 최근 기록 · 열린 질문 · 점검 요약 · 내가 볼 검토 수 |
| 위키 문서 | 기존 문서 보기 + 배지(AI 관리 · 검토됨 · 낡음) · 블록 각주 · 원천 카드 · '이 문서가 기대는 원천' · 모순 띠 · '위키에 질문 남기기' |
| 원천 | 원천 본문(종류별 렌더) · 첨부 · 출처 링크 · 인용한 문서들 · 철회(주인) |
| 검토 큐 | §5-5 |
| 기록 | `log.md` 를 그대로 + 거르기(작업 · 기간) |
| 점검 보고서 · 질문판 | 결함 → '고침 묶음 만들기' · 질문 상태 · 담당 |
| 온톨로지 | 유형 · 술어 표 · 제안 승인 · 엔티티 찾기 · 합치기 · 그래프(기존 그래프 화면 재사용) |
| 규칙서 | `wiki-schema` 문서(편집은 admin) · 판 이력 |
| 내 후보 | 내 대화에서 온 `held` 원천(§6-3) — 승인 · 버림 · 범위 고르기 |

화면을 고치면 브라우저로 직접 확인한다(MXWP CLAUDE.md). 다크 모드 시각 회귀(`apps/web/tests/e2e/visual-darkmode.spec.ts`)에 새 화면을 더한다.

### 5-15. MCP · REST

CONTRACTS §6 · §7. 게이트웨이에 붙은 뒤 **게이트웨이 `tools/list` 로** `wiki_*` 가 뜨는지 확인한다(앱 소스에 있어도 배포판이 낡으면 안 뜬다 — 포털
CLAUDE.md 의 `unknown tool` 선례). 위키 문서를 고치는 길은 `wiki_propose` 하나로 모으고 기존 쓰기 도구는 위키 문서에서 거부한다.

## 6. 원천별 연결

생산자 쪽 코드는 그 리포의 몫이다. MXWP 는 **봉투를 받는 창구 + (필요하면) 끌어오는 연결기**를 둔다. 연결기는 `app/wiki/connectors/<이름>.py` 하나씩,
같은 꼴(목록 → 새것만 → 봉투 → `POST /sources` 와 같은 서버 함수).

### 6-1. 시뮬레이션 플랫폼

| 플랫폼 | 결과가 있는 곳(조사) | 범위 · 신원 | 연결 방식 제안 | 순서 |
| --- | --- | --- | --- | --- |
| DynaForge(KooRemapper platform) | `impact_reports` — kind(deep · sphere · impact) · scenario · `eng_meta{project, dev_revision, design_variation, doe}` · worst_stress · worst_g · max_severity · drop_height · parts · findings · summary · media · **`shared_affiliation`**. 도구 `report_summary` · `report_findings` · `report_worst_cases` · `report_part_risk` · `compare_reports` · `report_query` · `publish_report_to_datahub` | 보고서마다 공유 소속이 있다 → `aff:` 범위가 바로 나온다 | 1순위 — DynaForge 가 이미 AIDataHub 로 내보내는 길(`publish_report_to_datahub`) 옆에 'MXWP 위키로' 를 더하거나, 연결기가 `report_query` 로 끌어온다(소속 공유 보고서만) | W8 첫째 |
| SmartTwinMCP(stcx — 356대) | 전각도 · 단일 낙하. `job_collect`(simulation_index.json) · `job_postprocess`(deep HTML + JSON) · `job_diagnose` · `get_job_details` | 잡 주인 | 잡이 끝나 후처리된 뒤 주인이 '위키로' 또는 주인 설정 '내 잡 자동 보내기'(§11 Q2) | W8 |
| SmartTwinExplorer(ste — 24대) | `jobs`{app, state, exit_code, params, owner_id} · `get_job_result`(파일 목록) · `get_job_file`(글 꼬리 64KB) | 잡 주인 | 결과 꼴이 파일이라 요약 봉투를 ste 쪽이 만들어야 한다 — ste 리포에 요청(나중) | 뒤 |
| StepForge | 프로젝트 · 부품 · 개정 · `risk_verdicts{verdict, reason, decided_by}` · `structure_report` · `precheck_report` · `field_check_report` · `drop_check` · `find_plm_task` | 프로젝트 주인 · 허브 권한 | 부품 엔티티의 **바탕**(부품 이름 · 역할 · 개정 · SP 과제)으로 먼저, 판정은 `sim_result` 비슷한 꼴로 | W5(엔티티) · W8 |
| HWAX Risk | `rr_findings{domain, mechanism, change_kind, trigger_condition, severity, judgement, detectability, evidence_grade, precedent, status, visibility private|org, owner_sub}` · `risk_get_report` · `risk_precedents` | `visibility=org` 인 것만 · 주인 | `org` 판정만 끌어온다. 메커니즘 · 검출성은 온톨로지에 그대로 | W8 |
| RA 바깥 해석 결과 | `analysis_runs` · `analysis_facts(run, part_key, quantity, value)` · `get_analysis_summary` · `compare_analysis_runs` | RA 작업 공간 | 사람이 RA 에서 고른 실행만(그 사람 명의) | 뒤 |
| MaterialTwin | 재료 · 시험 · 물성 · 구성식 맞춤 · `coverage_gaps` · `measurement_gaps` | 전사 | 재료 엔티티의 바탕 + 빈틈 질문의 재료 | 뒤 |

- 해석 결과 봉투(`sim_result`)의 숫자는 **결과 파일에서 기계로** 뽑은 값만 싣는다(요약 글에서 다시 읽지 않는다). 단위를 늘 붙인다.
- 같은 잡을 다시 후처리하면 `origin_rev` 를 올려 새 판으로(옛 판은 `superseded` → 점검 `stale`).

### 6-2. 시장불량(cae00 에만)

조사 결과 cae00 의 시장불량 쪽 자료는 둘이다. **dev 에는 스키마도 표본도 없다**(dev 게이트웨이 카탈로그에 없다 — `HWAXMcpGateway/test_gateway.py`
'cae00 실측 2026-10-08').

| 자료 | 무엇 | 지금 쓰는 곳 | 권한 |
| --- | --- | --- | --- |
| **PLM 결함 검색** — 게이트웨이 백엔드 `plm-defect` | 사내 PLM 문제점(불량) — 사례 상세 · 처리 이력 · 첨부, 과제 · 모델 · 담당자 검색, 증상으로 비슷한 사례. 알려진 도구 이름은 `plm_case_detail` · `plm_similar_cases` 둘 | 심의 품질 좌석이 VOC 보다 먼저 받는다(`HWAXAgentServer/deliberation.py` 3705~3709행) | `plat:plmdefect`(`HWAXPortal/backend/config/access.yaml` 150~157행) |
| **SignalForge** | 바깥 커뮤니티 VOC + 미국 CPSC 리콜("시장 불량 정본" — `SignalForge/crawler/platforms/recalls.py`). `voc_records` · `voc_defects{component, symptom, severity, modality}` · 도구 35(`search_voc` · `get_top_issues` · `defect_profile` · `defect_timeline` …). 10-23 cae00 에 모델 코드 사전 · PLM 거울 | 심의 'VOC 먼저 보기' · HWAX Risk 브리프 | 플랫폼 권한(포털 권한표) |

- **어느 것이 사용자가 말한 '시장불량 데이터' 인지 확인이 필요하다**(§11 Q8). 이 요청은 둘 다 연결기 후보로 두고 **PLM 결함 검색을 먼저** 권한다 —
  사내 사례(원인 · 대책 · 처리 이력)가 위키의 '왜' 를 채운다. SignalForge 는 '시장 반응 · 빈도' 를 채운다.
- **W8 첫 일(cae00, 사람 또는 cae00 세션)** — 게이트웨이 `tools/list` 로 `plm-defect` 의 도구 · 인자 · 결과 **칸 이름**을 받아 `docs/llm-wiki/cae00-sources.md`
  에 적는다. **값은 적지 않는다**(리포는 GitHub 에 있다). 그 뒤 연결기를 그 꼴에 맞춘다.
- **범위** — PLM 결함에서 온 원천은 `["plat:plmdefect"]`(+ 필요하면 소속). 엔티티 문서는 범위별로 나뉜다(CONTRACTS §2-11 끝).
- **사람 정보** — 담당자 이름 · 사번 · 연락처 · 고객 · 단말 식별자는 **연결기가 떼고** 보낸다. 서버는 V9 로 한 번 더 가린다. 위키 문서에는 사례 id 와
  내용(증상 · 원인 · 대책 · 상태 · 날짜)만.
- **사례 vs 집계** — 사례 단위(원인 · 대책을 배운다)와 집계(모델 · 부품 · 불량 유형 · 기간별 건수 — 추세를 본다) 둘 다 받는다(CONTRACTS §3 `field_defect`).
  사례를 받을지는 사람 결정(§11 Q8).
- 연결 방식 — 위키 워커가 읽기 전용 PAT 로 게이트웨이를 불러 끌어온다. 이 PAT 에 `plat:plmdefect` 를 줄지는 포털 권한표 담당이 정한다(§11 Q8).
- HWAX Risk 의 학습 고리는 시장 사례 입력이 비어 있다(`HWAXRisk/backend/app/metrics.py` `sync_labels`). 위키의 `field_defect` 사례 ↔ 불량 유형 ↔ 메커니즘
  관계가 쌓이면 그쪽 라벨 원천이 될 수 있다 — 이 요청 범위 밖, 기록만.

### 6-3. 사람들의 문답 · 해결 — "자연스럽게 쌓이는 구조"

**지금** — 포털 대화는 `data/conversations.sqlite`(`conversations` · `messages` · `message_vectors`), 읽기 · 쓰기 모두 주인만(`HWAXPortal/backend/app/agent/conv_store.py`).
메시지 `meta` 에 도구 호출 활동(도구 · 인자 · 결과 · 성공 · 시간) · 심의 근거가 있다(`agent/routes.py`). 내보내기 · 수확 길은 없다. MXWP 챗 대화는
저장되지 않는다.

**제안(사용자 결정 §11 Q1, 권장은 B)**

| | 방식 | 마찰 | 위험 |
| --- | --- | --- | --- |
| A | 버튼만 — 사람이 '위키에 남기기' 를 누른 턴만 | 큼(잊는다) | 작음 |
| **B(권장)** | **후보 + 한 번 승인** — 포털이 '해결된 턴' 을 알아보면(사람이 '해결됨' 을 누름 · 자기검증 통과 + 도구 근거 있음 + 이어지는 '고마워 · 됐다' …) 그 턴을 **주인만 보는 후보**(`held` 원천)로 MXWP 에 보낸다. 주인이 '내 후보' 에서 한 번 눌러 범위를 고르고 승인하면 들이기 | 작음 | 작음 — 주인이 본 것만 나간다 |
| C | 전부 자동(가명) | 없음 | 큼 — 틀린 답 · 비밀 과제 · 사람 정보가 그대로 위키로 |

- 후보는 주인의 MXWP 에만 보이고, 기본 7일(규칙서)이 지나면 저절로 버려진다. **자동 승인은 없다**(C 를 고르지 않는 한).
- 보내는 것 — 질문 · 최종 답(자기검증으로 고친 답) · 근거(도구 이름 · 인자 요약 · 결과 발췌 — 원문 전부가 아니라) · 쓴 모델 · 결과(`solved|partial|unknown`).
  **이름 · 이메일은 본문에 싣지 않는다**(주인은 `owner` 칸으로만, 화면은 '질문자 비공개' 기본 — §11 Q9).
- 심의(`deliberation`) — 결정문 · 표 · 소수 의견 · 근거. 심의 잡은 주인 · 같은 소속 · 관리자가 읽는다(`HWAXAgentServer/delib_jobs.py`) → 범위 기본
  `aff:<주인 소속>`. 버린 근거 · 소수 의견을 지우지 않는다(포털 심의 원칙).
- 띵킹 모드는 요약 글만 남는다(좌석별 판정은 저장되지 않는다 — `HWAXAgentServer/thinking.py`) — 띵킹은 `qa` 로만, 좌석별은 나중.
- MXWP 챗 — 위키 모드의 답 아래 '위키에 남기기'(§5-7).
- 같은 문답이 여러 번 오면(같은 사람이 비슷한 질문을 반복) 들이기가 기존 `qa` 문서에 합친다 — 문답 문서는 '질문 묶음' 이다(SCHEMA-DRAFT §2 `qa`).

### 6-4. 보고서 · 카드 · 백서

- **RA 보고서** — 사람이 RA 에서 고른 보고서(그 사람 명의 API) → `report` 원천. 심의 결정문 보고서는 6-3 의 `deliberation` 으로 이미 오므로 두 번 들이지
  않는다(`origin_ref` 로 잇는다).
- **AIDataHub 카드** — 엔티티 문서가 인용할 '정리된 지식'. 카드를 통째로 옮기지 않고 필요한 카드만 `card` 원천으로(지속 질의가 찾아 들인다).
  카드 → 위키는 있어도 위키 → 카드는 이 요청 밖(지금도 대화 · 심의 → 카드 길은 없다).
- **MXWP 사람 백서** — `document` 원천으로 들여 인용한다(백서는 고치지 않는다).

### 6-5. 연결 순서(권장)

1. 포털 문답 버튼 · 후보(P6 · P7) — 가장 많고, 사람이 고른 것이라 안전하다(W6).
2. 심의 결정문(P8)(W6).
3. DynaForge 보고서 — 소속 공유가 이미 있다(W8).
4. PLM 결함 검색 — cae00 에서 꼴을 받은 뒤(W8).
5. SmartTwinMCP(stcx) 잡 — 주인 설정(W8).
6. HWAX Risk `org` 판정 · StepForge 판정 · SignalForge 집계 · RA 해석 · MaterialTwin(W8 뒤).

## 7. LLM

- **두 자리로 나눈다** — 배경(들이기 · 점검 · 지속 질의)과 대화형(묻기). 설정 `WIKI_LLM_BASE_URL` · `WIKI_LLM_MODEL` · `WIKI_LLM_API_KEY`(배경) ·
  `WIKI_QUERY_LLM_*`(대화형, 비면 배경과 같게). 지금 챗의 `LLM_*` 와 따로 둔다 — 박스마다 고른다.
- 박스의 사정(2026-10-24) — 포털은 챗을 stcx GPU Qwen 으로, 심의 · 띵킹 · 카드 대조를 GLM 으로 나눠 쓴다(`HWAXPortal/docs/chat-llm-stcx/`). GLM 은
  20만 토큰 창(GLM 5.3 Flash — `HWAXPortal/docs/risk-200k/`)이다. **권장** — 배경은 GLM(포털 LLM 풀 라우터를 켠 박스면 그 주소), 묻기는 사람이 기다리므로
  챗 모델. 정할 때 포털 상태판의 챗 첫 조각 지연이 늘지 않는지 본다(§11 Q5).
- **창** — 프롬프트 = 규칙서 판 + 원천 + 그 문서. 20만 창에 맞게 원천을 쪼개지 않고, 큰 원천은 생산자가 요약 봉투를 보낸다(원천의 숫자는 그대로).
  넘치면 잘라 보내지 않고 `held` + 까닭(잘림은 조용한 결함이었다 — 포털 `docs/risk-review-redesign/truncation.md`).
- **구조화 출력** — OpenAI 호환 `response_format: json_schema` 를 먼저, 안 되는 서버면 도구 호출 꼴로. 틀리면 한 번 다시, 또 틀리면 실패(CONTRACTS §11).
  DocForge 의 M0 실측(`DocForge/docs/M0.md` §4 — 같은 vLLM 에서 json_schema · Pydantic AI 견줌) 결과가 나오면 그 판단을 따른다.
- **생각 모드** — 배경 쓰기는 끄고(속도 · 형식), 모순 판정만 켜 볼 값.
- **원천 글은 데이터다** — 프롬프트 주입 방어 — 원천 · 대화 글을 '지시' 자리에 넣지 않고 구획 표시 안에 넣는다. 원천 글이 "문서를 지워라" 라고 해도 연산은
  계획에 있는 문서로만(V6) · 지우기는 늘 검토.
- **챗 LLM 호출 고침** — 지금 `services/llm_client.py` 는 비스트리밍 · 60초다. 묻기는 스트리밍 + 넉넉한 시간 제한(포털 시간 층 — 연결 10초 < 호출 수 분),
  배경은 작업 lease 안에서.
- **그림(VLM)** — v1 은 쓰지 않는다. 쓰게 되면 stcx Qwen 판독(포털이 이미 쓰는 길 — `HWAXPortal/docs/chat-depth-context/`)을 빌리고, 판독문은 `card` 처럼
  원천의 일부로 남긴다(숫자 대조 V3 는 판독문에도 같은 규칙).

## 8. 보안 · 개인정보 · 운영

- **dev 는 바깥에 드러난 박스다** — 실데이터(시장불량 · 실제 해석 결과 · 실제 대화)를 dev 에 두지 않는다. W0~W7 은 `tests/fixtures/wiki/` 의 **합성 원천**과
  가짜 LLM 서버로. 리포(GitHub)에 실데이터 · 내부 주소 · 토큰을 넣지 않는다.
- **데이터 덤프가 위키를 cae00 으로 옮기지 않게** — `infra/scripts/data-dump.sh` 는 `documents` 를 전부 싣고 `sync-from-drive.sh` 가 cae00 에서
  `newest` 로 합친다. 그대로 두면 dev 의 합성 위키 문서가 cae00 위키에 섞인다(그리고 원천 · 근거 표는 덤프에 없어 근거 없는 문서가 된다). **덤프 · 합치기에서
  위키 문서(`wiki_pages` 가 있는 문서)와 `wiki_*` 표를 뺀다** — W3 완료 기준.
- **동의 · 철회 · 가림** — 문답은 주인 동의로만(§6-3). 주인 · 관리자는 원천을 철회할 수 있고 그 원천의 문장은 고침 묶음으로 빠진다. 사람 정보는 연결기에서
  떼고 V9 로 한 번 더.
- **감사** — 변경 묶음(누가 승인했나) · 기록 · 범위 넓히기 · admin 의 범위 밖 읽기를 남긴다. 기록은 덧붙이기만(트리거).
- **비밀** — `.env` 로만. 명령줄 인자 · 로그에 남기지 않는다(`bash -x` 로 `.env` 를 읽는 스크립트를 따라가지 않는다 — 대입 줄에 비밀이 찍힌다).
- **백업** — 스냅숏(전체 pg_dump + MinIO)에 `wiki_*` 표와 `wiki-sources` 버킷이 들어가는지 W3 에서 확인한다(`docs/lat/snapshots.md`).
- **보존** — 원천 · 기록은 지우지 않는다(철회는 상태). 보존 기간 정책은 사람 결정(§11 Q10 옆 메모).

## 9. 단계 · 완료 기준

| 단계 | 어디서 | 무엇 | 완료 기준 |
| --- | --- | --- | --- |
| **W0 준비** | dev | 결정 확인(§11) · 낡은 문서 셋 고침 · 합성 원천 묶음(해석 결과 6 · 시장불량 사례 4 · 집계 2 · 문답 5 · 심의 2 · 정정 1) · OpenAI 호환 **가짜 LLM 서버**(구조화 출력을 정해진 답으로 돌려준다 — 시험용) · 규칙서 초안 확정 · `docs/lat/wiki.md` 뼈 | 가짜 LLM + 합성 묶음으로 빈 시험이 돈다 |
| **W1 연결 · 신원** | dev(MXWP) + 포털 리포 | C1~C6 · 포털 P1~P5 | §4-5 넷 · 위임 창구 시험(404 · 401 · 403 · 400 · 200 · 클라이언트별 발급) · 소속 증명 시험(맞음 · 만료 · 다른 이메일 · 평문만) |
| **W2 보이기 범위** | dev | 범위 계산 · 저장소 층 필터 · 검색 필터 · §5-12 읽기 길 전수 | 길마다 시험(범위 셋 × 길 전부) **누설 0** · 기존 시험 전부 통과 |
| **W3 원천 · 작업 실행기** | dev | `wiki_sources`(불변 트리거) · MinIO · `POST /sources` · `wiki_jobs` · 워커 인스턴스 · 기록 · `/health` · 덤프 제외 | 멱등(두 번 → 한 줄) · 불변(UPDATE 거부) · 작업이 워커 재기동을 넘김 · 덤프에 위키가 없음 · 스냅숏에 있음 |
| **W4 들이기 · 검토 · 근거**(첫 동작판) | dev | 들이기 다섯 단계 · 변경 묶음 · V1~V11 · 자동 반영 · 검토 큐 화면 · 근거 각주 · 되돌리기 · 목록 · 기록 | 합성 원천 20 → 문서가 생기고 고쳐진다 · **일부러 틀린 가짜 LLM 답**(지어낸 숫자 · 근거 없음 · 잠긴 블록 · 범위 섞임 · 계획 밖 문서 · 300자 넘는 인용)이 하나씩 다 걸린다 · 되돌리면 판이 복원된다 |
| **W5 온톨로지** | dev | 유형 · 술어 표(제안 → 승인) · 엔티티 등록부 · 결정적 해석 + LLM 후보 · triple 확장 · 바깥 어휘 대응표 · 그래프 · 합치기 | 합성 묶음에서 엔티티 해석 정확도(사람이 정답표를 만든다) 90% 이상 · 같은 개체 중복 0(합친 뒤) |
| **W6 묻기 · 되쌓기 · MCP** | dev + 포털 리포 | `/query` SSE · MXWP 챗 위키 모드 · `wiki_*` MCP · 게이트웨이 `tools/list` · 포털 P6 · P7 · P8 · 내 후보 화면 | 포털 챗에서 위키 근거를 단 답 · '위키에 남기기' → 들이기 → 문서 반영(그 사람 명의) · 후보는 주인만 본다 |
| **W7 점검 · 지속 질의** | dev | 점검 아홉 · 보고서 · 질문판 · 지속 질의(위키 → 읽기 전용 도구 → 사람 · 실험 제안) · 예산 · 조용한 시간 | 일부러 심은 모순 · 낡음 · 고아 · 빠진 문서 · 빠진 링크 · 빈틈이 다 잡힌다 · 예산 상한을 지킨다 · 가짜 LLM 이 느릴 때도 묻기가 앞선다 |
| **W8 실원천 · cae00** | cae00 | `plm-defect` 꼴 받기 · 연결기(DynaForge · PLM 결함 · stcx 잡) · 배포(§아래) · 실데이터 평가 · 규칙서 조정 | §10 목표 · 사람 검토 표본 · 포털 챗 지연 영향 없음 |

**배포(cae00)** — cae00 은 SIF 를 못 짓는다(사내 TLS 가로채기 — `docs/HWAX-PORTAL-INTEGRATION.md`). 새 의존성이 있으면 dev 에서 api.sif 를 다시 지어
Drive 로(`infra/scripts/images-to-drive.sh`) 보내고 cae00 은 `images-from-drive.sh` · `sync-from-drive.sh`(git pull · alembic) 로 받는다. 워커 인스턴스가 하나
늘어나는 것은 그 스크립트들과 포털 `infra/services.yaml` 에 같은 날 반영한다.

## 10. 평가

| 지표 | 어떻게 재나 | 목표(W8) |
| --- | --- | --- |
| 숫자 충실 | 반영된 블록의 숫자 중 원천에 없는 것(V3 가 통과시킨 뒤 사람이 표본 100 블록 대조) | 0 |
| 근거 정밀 | 표본 100 블록 — 근거가 그 문장을 실제로 뒷받침하나(사람) | 95% 이상 |
| 범위 누설 | 시험 + cae00 에서 범위 셋의 계정으로 화면 · MCP 대조 | 0 |
| 자동 반영 비율 · 거절률 | 변경 묶음 상태 | 자동 60% 이상 · 검토 중 거절 15% 이하(넘으면 규칙서 · 프롬프트를 고친다) |
| 위키 건강 | 고아 비율 · 근거 없는 블록 비율 · 열린 모순 · 원천 → 반영 지연(중앙값) | 고아 5% 이하 · 근거 없음 1% 이하 · 지연 1시간 이하 |
| 쓸모(A/B) | 실제로 있었던 질문 50개(cae00, 주인 동의)로 포털 챗 답을 위키 도구 있음 · 없음으로 — 사람이 1~5점 | 있음이 평균 0.5점 이상 높다 · 근거 단 답 비율 |
| 다시 묻는 질문 | 같은 질문의 두 번째부터 위키 답이 먼저 나오는 비율 | 70% 이상 |
| 비용 | 들이기당 토큰 · 하루 토큰 · 챗 첫 조각 지연(포털 상태판) 변화 | 예산 안 · 지연 변화 없음 |

## 11. 사람이 정할 것

| # | 질문 | 선택지 | 권장 | 막히는 단계 |
| --- | --- | --- | --- | --- |
| Q1 | 대화를 어떻게 위키로 | A 버튼만 · **B 후보 + 한 번 승인** · C 전부 자동 | B | W6 |
| Q2 | 내 해석 잡 결과를 자동으로 보내나 | 기본 꺼짐(사람이 켬) · 기본 켬 | 꺼짐 — 소속 공유 보고서(DynaForge)만 기본으로 끌어온다 | W8 |
| Q3 | 검증을 통과한 AI 변경을 바로 반영하나 | **자동 + 검토 큐** · 전부 검토 | 자동 + 검토 큐(검토됨 · 사람 문서 · 지우기는 늘 검토) | W4 |
| Q4 | 보이기 범위 단위 · 기존 문서 | **org · 소속 · 플랫폼 · 개인** · + 과제(SP) 단위 / 기존 `restricted` 문서도 같은 필터로 막나 | 넷으로 시작 · 기존 `restricted` 도 막는다 | W2 |
| Q5 | 위키 LLM | 배경 GLM · 묻기 챗 모델 / 둘 다 GLM / 둘 다 챗 모델 | 배경 GLM · 묻기 챗 모델(박스 설정으로 바꿀 수 있게) | W4 |
| Q6 | 위키 문서와 사람 백서 | **같은 MXWP 안 · 종류 표시로 구분** · 따로 | 같은 곳 — 링크 · 검색 · 그래프를 같이 쓴다 | W4 |
| Q7 | 검토자 | 문서 owners · reviewers / 소속 관리자 / **새 표지 `wiki_reviewer`** | `wiki_reviewer` + 대상 문서 owners | W4 |
| Q8 | '시장불량 데이터' 는 무엇이고 어디까지 | PLM 결함 검색 · SignalForge · 둘 다 / **사례 단위 + 집계** · 집계만 / 위키 워커 PAT 에 `plat:plmdefect` | 둘 다 · PLM 결함 먼저 · 사례 단위(사람 정보 뗌) · 범위 `plat:plmdefect` | W8 |
| Q9 | 문답 문서에 질문자 표시 | **비공개** · 이름 | 비공개(주인은 원천 칸에만) | W6 |
| Q10 | 기록 · 원천 보존 | 무기한 · N년 | 무기한(철회는 상태로) — 회사 정책이 있으면 따른다 | W3 |
| Q11 | 의미 검색(pgvector + 임베더) | 처음부터 · **재고 정함** | 목록 + 엔티티 + Meilisearch 로 시작해 W7 에 재현율을 재고 정한다(임베더는 포털이 쓰는 AIDataHub `/api/embed` — BGE-M3 전환은 박스마다 다르다) | W7 |
| Q12 | 바깥 어휘로 되돌려 주기 | RA 엔티티 제안 큐 · FMEA Agent · HWAX Risk 라벨 / 안 함 | 이번엔 안 함 — 기록만(§2-3) | 없음 |

## 12. 위험과 대응

| 위험 | 대응 |
| --- | --- |
| 지어낸 숫자 · 근거 | V2 · V3 코드 검증 · 자동 반영 조건 · 표본 대조(§10) |
| 권한 우회(막힌 자료가 위키로 풀림) | 보이기 범위를 들이기보다 **먼저**(W2) · 넓히기는 사람만 · `plat:` 는 admin 만 · 범위별 문서 나누기 |
| 프롬프트 주입(대화 · 보고서 글) | 원천은 데이터 구획 · 계획 밖 연산 거부 · 지우기 늘 검토 |
| LLM 이 챗 · 심의를 밀어냄 | 동시 1 · 조용한 시간 · 사람이 기다리는 묻기가 앞 · 상태판 지연 지표 |
| 검토가 밀려 쌓임 | 자동 반영 조건을 너무 좁히지 않는다 · `stuck_review` 점검 · 일괄 승인 |
| 엔티티 난립 · 중복 | 결정적 해석 먼저 · 외부 id · 유형 승인제 · 합치기 · W5 기준 |
| dev 합성 위키가 cae00 에 섞임 | 덤프 · 합치기에서 위키 제외(W3 완료 기준) |
| 위키가 RA · AIDataHub 와 겹침 | 원본은 그쪽 · 위키는 인용 · 엮기(§2-3) |
| 원천이 끊김(연결기 실패가 조용함) | 연결기마다 마지막 성공 · 실패를 `/health` 에 · 상태판(P9) |
| MXWP 쓰기가 사람 명의가 아님(지금) | W1 이 W6 보다 먼저 — 그 전까지 포털에서 위키로 쓰는 길을 열지 않는다 |

## 부록 A. 원천 하나가 위키가 되기까지(예시 — 값은 지어낸 것)

1. stcx 전각도 낙하 잡이 끝나고 주인이 '위키로' → 포털이 `sim_result` 봉투(모델 · 힌지 브래킷 · 최대 응력 `{value: 412, unit: "MPa"}` · 최악 각도 ·
   판정 · 그림 둘)를 그 사람 명의로 `POST /api/v1/wiki/sources`.
2. 워커가 집는다 → 엔티티 해석: 모델은 `ext_ids.sp_model` 로 바로 · 부품 '힌지 브래킷' 은 별칭으로 · 불량 유형 '브래킷 균열' 은 LLM 이 후보 셋 중 고름.
3. 계획 — 해석 사례 문서 새로 · 부품 문서 '해석에서' 절 · 불량 유형 문서 '해석에서' 절 · 관계 `reproduced-by`(불량 유형 → 해석 사례) · 질문 "같은 모델의
   시장 사례에서 브래킷 균열이 보고됐나".
4. 쓰기 → 검증 — 부품 문서 새 문단의 '412 MPa' 는 원천 `/results/max_stress` 에 있다(V3 통과) · 근거 셋(V2) · 문서 범위 `["aff:<소속>"]` 는 원천과 같다(V4).
5. 자동 반영 → 판 셋 · 근거 다섯 · 관계 하나 · 질문 하나 · 기록 `## [2026-10-24 10:21] ingest | <모델> 전각도 낙하 — 힌지 브래킷 (src_…)`.
6. 밤 점검 — 그 불량 유형에 `observed-in` 이 없다(`gap`) → 질문 → 지속 질의가 PLM 결함 검색(읽기 전용)으로 비슷한 사례를 찾는다 → 있으면
   `inquiry_answer` 원천 → 들이기 → 그 불량 유형 문서의 '시장에서' 절이 채워진다(범위가 좁아지면 범위별 문서로).

## 부록 B. 낱말 대조

| Karpathy 원문 | 이 문서 | 코드 · 표 |
| --- | --- | --- |
| raw sources | 원천 | `wiki_sources` · 버킷 `wiki-sources` |
| wiki | 위키 문서 | `documents` + `wiki_pages` |
| schema(CLAUDE.md · AGENTS.md) | 규칙서 | 문서 `wiki-schema` |
| ingest | 들이기 | `wiki_jobs.op='ingest'` |
| query · file back | 묻기 · 되쌓기 | `/wiki/query` · `/wiki/fileback` · `qa` 원천 |
| lint | 점검 | `wiki_lint_*` |
| (없음) | 지속 질의 · 질문 대기열 | `wiki_questions` · `op='inquire'` |
| index.md · log.md | 목록 · 기록 | `/wiki/index.md` · `/wiki/log.md` · `wiki_log` |
| (없음) | 변경 묶음 · 근거 · 보이기 범위 · 엔티티 | `wiki_changesets` · `wiki_citations` · `audience` · `wiki_entities` |
