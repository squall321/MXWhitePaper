# LLM 위키 · 포털 완전 연결 — 결정과 까닭

> 새 결정은 아래에 `WK-D<번호>` 로 덧붙인다(무엇을 · 왜 · 날짜). 사람이 정한 것은 '사용자 결정' 이라고 적는다. 날짜가 박힌 기록이라 지난 줄은 고쳐
> 쓰지 않는다 — 뒤집으면 새 줄로 '… 를 뒤집음' 이라고 적는다.

## 2026-10-24 — 요청서를 쓰며(HWAX 포털 세션)

- **WK-D1 구조는 Karpathy 'LLM Wiki'(gist `karpathy/442a6bf555914893e9891c11519de94f`, 2026-04-04)를 바탕으로 다섯을 더한다** — 블록 근거 · 보이기 범위 ·
  변경 묶음과 검토 · 온톨로지 · 작업 실행기와 예산. 까닭 — 원문은 한 사람이 큐레이션하는 개인 지식 베이스이고 일부러 추상적이다. 사내는 원천이 많고
  (해석 잡 · 불량 사례가 하루 수십 건) 권한으로 막힌 자료가 있으며 숫자가 틀리면 해가 된다.
- **WK-D2 DocumentJSON v1.0 은 바꾸지 않는다 — 위키 상태는 옆 표.** 까닭 — `DocumentMeta` · `BlockMeta` 가 `extra='forbid'` 인 생성물이고, 바꾸면 FE 타입 ·
  `dist/llm-docx-toolkit` RAG 색인 · 네 겹 drift 가드가 함께 흔들린다. 근거도 DocumentJSON 에 넣지 않고 `wiki_citations` 에 둔다(읽기 응답이 붙여 준다).
- **WK-D3 숫자 · 근거는 코드가 대조한다 — 모델에게 묻지 않는다**(V2 · V3). 까닭 — 지어낸 공학 숫자는 위키 전체의 신뢰를 깬다. 모델의 자기 판정은
  같은 착각을 되풀이한다.
- **WK-D4 보이기 범위가 들이기보다 먼저(W2 → W3 · W4).** 범위는 토큰(`org` · `aff:` · `plat:` · `user:`)의 **그리고**이고, 문서 범위는 인용 원천의 범위를
  다 담는다. 넓히기는 사람만, `plat:` 를 빼는 것은 admin 만. 까닭 — 시장불량 원천인 PLM 결함 검색은 포털에서 `plat:plmdefect` 로 막혀 있다. MXWP 는
  역할이 전역이고 `confidentiality` 를 GET 에서 강제하지 않으며 SSO 사용자는 기본 editor 라, 그대로 들이면 위키가 포털 권한표를 우회한다.
  그리고(AND)로 정한 까닭 — 원천 여럿의 범위 교집합을 토큰 합으로 바로 셀 수 있다. 소속 둘에 함께 보이기(또는)는 필요해지면 그때 넓힌다.
- **WK-D5 신원은 ste 방식 위임(공유 비밀 → 그 사람 토큰)으로.** 까닭 — ste · HWAX Risk · RA 와 같은 계약이고, 게이트웨이에는 앱별 코드 없이 붙는 일반 길
  (`PER_USER_SSO_APPS`)이 이미 있다. 토큰 등록(외부 연결 `connect:`)은 같은 키의 정적 백엔드가 있으면 게이트웨이가 겹침으로 보고 무시한다
  (`HWAXMcpGateway/provision-config.sh` 764~766행 근처) — 맞지 않는다.
- **WK-D6 작업은 DB 큐 + 별도 워커 프로세스(인스턴스 `mxwp_wiki`).** 까닭 — 지금의 프로세스 안 asyncio 티커는 API 재기동에 긴 LLM 작업이 끊기고 상태를 볼
  길이 없다. 인스턴스가 다섯에서 여섯이 되므로 기동 · 갱신 스크립트와 포털 services.yaml 을 같은 날 고친다.
- **WK-D7 위키 쓰기에 mock LLM 을 쓰지 않는다.** 까닭 — 챗의 mock 폴백을 쓰면 지어낸 문서가 근거를 단 채 쌓인다. LLM 이 없으면 작업이 줄에서 기다린다.
- **WK-D8 dev 는 합성 · cae00 은 실데이터. 덤프 · 합치기에서 위키를 뺀다.** 까닭 — dev 는 바깥에 드러난 박스다. 또 `data-dump.sh` 는 `documents` 를 전부
  싣고 cae00 `sync-from-drive.sh` 가 `newest` 로 합치므로, 그대로 두면 dev 의 합성 위키 문서가 근거 표 없이 cae00 위키에 섞인다.
- **WK-D9 대화는 주인 동의로만 위키에 간다 — 권장은 '후보 + 한 번 승인'**(request §6-3 B). 사람 결정 대기(request §11 Q1). 까닭 — 포털 대화 저장소는
  주인만 읽는다는 약속이 있다. 버튼만이면 잊어서 쌓이지 않고, 전부 자동이면 틀린 답 · 비밀 과제 · 사람 정보가 그대로 간다.
- **WK-D10 '시장불량 데이터' 후보는 둘 — PLM 결함 검색(게이트웨이 백엔드 `plm-defect`, cae00 에만) · SignalForge(바깥 VOC · 리콜). PLM 결함을 먼저 권한다.**
  사람 확인 대기(Q8). 까닭 — 사내 사례의 원인 · 대책 · 처리 이력이 위키의 '왜' 를 채운다. dev 에는 그 스키마가 없어 W8 첫 일로 cae00 에서 칸 이름만 받는다.
- **WK-D11 지속 질의는 읽기 전용이다 — 해석 · 시험은 제안만.** 위키 워커의 도구 호출은 포털 읽기 전용 PAT(허용 목록)로, 사람별로 막힌 자료는 `needs_human`
  으로 넘긴다. 까닭 — 자원 · 비용이 큰 잡을 AI 가 스스로 돌리지 않는다. 신원을 꾸며 남의 자료를 읽지 않는다.
- **WK-D12 여러 범위의 원천이 모이는 엔티티는 범위별 문서로 나눈다**(`…--plmdefect`). 넓은 문서는 좁은 문서가 있다는 것도 말하지 않는다. 까닭 — 제목 ·
  링크로도 막힌 정보가 샌다.
- **WK-D13 위키 문서의 쓰기는 `wiki_propose`(검토) 하나로 모으고 기존 MCP 쓰기 도구는 위키 문서를 거부한다.** 까닭 — 검증 · 근거 · 기록을 우회하는 길을
  남기지 않는다.
- **WK-D14 RA · AIDataHub 를 대신하지 않는다 — 원본은 그쪽, 위키는 인용하고 엮는다.** 위키 → 바깥 어휘로 되돌려 주기(RA 제안 큐 · FMEA · HWAX Risk 라벨)는
  이번 범위 밖(Q12). 까닭 — 원본이 둘이 되면 어느 쪽이 맞는지 다시 다투게 된다.

## 조사 메모(2026-10-24) — 사실은 request 의 경로 · 줄을 본다

- 게이트웨이 경유 MXWP 호출이 서비스 계정(`admin@mx.local`)인 것은 dev 감사 원장으로 확인했다(MXWP 호출에 사람 명의 모드가 없다).
- 게이트웨이는 위임 백엔드 호출에 이미 `X-Heax-User-Affiliation` + `X-Heax-Aff-Proof`(`v1|<email>|<소속>|<exp>` HMAC-SHA256, 앱별 위임 비밀)를 싣는다
  (`HWAXMcpGateway/gateway.py` `_aff_proof`). 플랫폼 권한(`plat:`)을 싣는 헤더는 아직 없다 → 포털 쪽 P4.
- 포털 진입 토큰 클레임은 `iss` · `sub` · `aud` · `email` · `name` · `groups` · `scope` · `iat` · `nbf` · `exp` · `jti` 다
  (`HWAXPortal/backend/app/auth/downstream.py`). `groups` 에는 AD 그룹과 함께 포털이 그 순간 원장으로 센 `feat:` · `plat:` 합성 그룹이
  원래 실린다(`deps.entitled`) — 처음엔 '플랫폼 권한이 없다' 로 잘못 읽었다. 없던 것은 소속뿐이라 포털이 `affiliation` 클레임을 MXWP
  진입 토큰에만 더했다(10-24, CONTRACTS §9).
- 대화 저장소는 주인만 읽고, 심의 잡은 주인 · 같은 소속 · 관리자 · 신원 없는 서비스 호출이 읽는다(`HWAXAgentServer/delib_jobs.py`). 띵킹은 요약만 남는다.

## 2026-10-24 — W0 시작(MXWP 세션)

- **WK-D15 사용자 결정 — Q4 범위 단위는 토큰 넷(`org` · `aff:` · `plat:` · `user:`)으로 시작하고, 위키가 아닌 기존 문서의
  `confidentiality=restricted` 도 같은 저장소 층 필터로 GET 을 막는다**(읽는 사람 — 작성자 · `metadata.owners` · `reviewers` · admin). 까닭 —
  위키와 같은 필터 한 곳에서 막으면 읽기 길 전수 시험(W2)이 두 경우를 함께 덮는다. 과제(SP) 단위는 SP 허브가 붙은 뒤 다시 본다.
- **WK-D16 사용자 결정 — Q3 · Q5 · Q6 · Q7 · Q10 은 권장안으로 확정.** Q3 자동 반영 + 검토 큐(검토됨 · 사람 문서 · 지우기는 늘 검토) ·
  Q5 배경 GLM · 묻기 챗 모델(박스 설정으로 바꿀 수 있게) · Q6 같은 MXWP 안 · 종류 표시로 구분 · Q7 새 표지 `wiki_reviewer` + 대상 문서 owners ·
  Q10 무기한(철회는 상태로 — 회사 정책이 있으면 따른다).
- **WK-D17 사용자 결정 — Q1 은 B(후보 + 한 번 승인) · Q9 질문자 비공개**(주인은 원천 `owner` 칸에만).
- **WK-D18 사용자 결정 — 규칙서는 초안(SCHEMA-DRAFT)을 그대로 v0 로 시작한다.** W4 에서 `wiki-schema` 문서로 올릴 때 다시 본다 — 그때까지
  checklist 의 '규칙서 초안 사람 검토' 칸은 비워 둔다.

- **WK-D19 가짜 LLM 의 쓰기 답 시나리오(지어낸 숫자 · 근거 없음 · 잠긴 블록 · 범위 섞임 · 계획 밖 문서 · 300자 넘는 인용)는 W4 로 미룬다.**
  W0 은 규칙 기계(match · times · capture · conform)와 스키마와 무관한 전송 넷(끊김 · 형식 틀림 · 느림 · 500)만. 까닭 — 쓰기 단계의 출력
  스키마보다 먼저 지으면 답의 꼴을 짐작으로 정하고, 스키마가 정해질 때 다시 쓰게 된다.
- **WK-D20 가짜 LLM 은 표준 라이브러리 `http.server`(진짜 소켓)로, 꼴은 vLLM OpenAI 호환으로 짓는다.** 까닭 — ASGI 안 가짜로는 '연결 끊김' 을
  진짜 `RemoteProtocolError` 로, '느림' 을 진짜 읽기 시간 초과로 낼 수 없다. dev 에 닿는 LLM 이 없어 박스의 vLLM 판(오류 본문 꼴)을 재지
  못했다 — 가짜는 두 꼴(`openai` · `vllm-legacy`)을 다 내고 W4 클라이언트가 둘 다 읽는다. 답이 요청 스키마에 맞는지는 가짜가 먼저 본다
  (`conform` — 진짜의 유도 디코딩처럼, 시나리오 결함을 500 으로).
- **WK-D21 봉투에 꼴이 없던 셋을 정했다** — `document{doc_slug, version}` · `note{text}` · `report.figures[{name, caption?, upload_id?}]`,
  `inquiry_answer.confidence` 는 0~1. 해석 조건도 숫자는 `{value, unit}` 만(Strict). `audience` 는 받을 때 정규화(org ∧ X = X)하고 만족 불가
  조합은 거부(CONTRACTS §3 갱신).

## 2026-10-24 — W1 연결 · 신원(MXWP 세션)

- **WK-D22 위임 토큰은 JWT `typ=delegated`(`sub` · `cli` · `gen` · `eml` · `sk` · `scope [read, write]` · 12시간), 세대는 `sso_delegations`(사람 ×
  클라이언트).** 발급은 아무것도 회수하지 않는다 — 회수는 관리자가 세대를 올리거나(즉시) · 사람을 비활성으로 · 비밀을 바꾸거나(`sk`) 비운다.
  까닭 — 다른 앱처럼 '같은 이름의 직전 토큰을 발급이 회수' 하면 게이트웨이 프로세스가 여럿일 때 서로의 토큰을 죽이며 핑퐁한다. PAT 줄
  (`api_tokens`)로 내지 않은 까닭 — 요청마다 argon2 검증 · 12시간마다 폐기 줄이 쌓이고 사용자의 '개인 API 토큰' 목록에 섞인다.
- **WK-D23 위임으로 온 요청은 admin 역할을 owner 로 낮추고 `/me/api-tokens` · `/me/2fa` 를 403 으로 막는다.** 까닭 — 범위가 read + write(`/admin/*`
  아님)여도 admin 역할 검사는 `/admin/*` 밖에도 있다(용어 승인 · 이후 온톨로지 승인 · `plat:` 빼는 넓히기). AI 가 사람 명의로 admin 승인을 하거나
  비밀을 쥔 쪽이 그 사람의 장수명 PAT 를 만드는 길을 남기지 않는다.
- **WK-D24 위임 호출의 소속 · 플랫폼 헤더는 저장하지 않고 그 호출에만 쓴다(CONTRACTS §2-10 을 바꿈).** 저장값(`users.portal_*`)은 진입 토큰
  (서명된 전체 스냅숏)에서만. 까닭 — 헤더가 없는 것이 '권한 없음' 인지 '`MXWP_SEND_PLAT` 꺼짐' 인지 모른다. 저장하면 잃은 `plat:` 이 새 시각으로
  살아나 브라우저 세션 · PAT 가 막힌 자료를 본다.
- **WK-D25 진입 토큰 jti 원장을 DB(`portal_launch_jti`)로.** `_verify_portal_token` 은 서명 · 클레임만, jti 는 `_claim_jti` 가 `INSERT … ON CONFLICT`.

## 2026-10-24 — W2 보이기 범위(MXWP 세션)

- **WK-D26 '읽는 사람' 은 요청 문맥(ContextVar)이고 저장소 층이 그것으로 거른다(`app/wiki/audience.py`).** 인증(`get_current_user`)이
  채우고 미들웨어가 요청마다 비운다. 문맥이 비어 있으면 술어를 짓지 않고 `ViewerMissing` — 인증 없는 길 · 배경 작업은 `acting_as(SYSTEM)`
  · `acting_as(ANONYMOUS)` 를 스스로 고른다. 까닭 — 문서 한 장 읽기가 `get_document_or_404`(28) · `find_by_slug`(17) 로 흩어져 있고 서비스의
  변경 함수들은 사용자 dict 를 받지 않는다. 인자를 45 자리에 끼우는 대신 한 곳에서 거르고, 빠뜨린 길은 조용히 새지 않고 깨지게 했다.
- **WK-D27 restricted 를 읽는 사람 = 작성자(`owner_id`) · `document_reviewers` · metadata owners/reviewers 에 이메일로 적힌 사람 · admin.**
  dev 의 restricted 2 장은 owners 가 사람 id 가 아닌 글(`u-pm-lead`)이라 그 칸만으로는 아무도 못 읽는다 — 작성자 · 검토자 표를 함께 본다.
- **WK-D28 공유 링크 · oEmbed 는 익명(`["org"]` · restricted 아님)으로 읽는다.** 그 범위 밖 문서는 링크를 만들 수 없고(403), 만든 뒤 범위가
  좁아지면 링크가 닫힌다(410). oEmbed 는 보관 · restricted 에 지금처럼 403, 좁은 위키 문서는 404(있는지도 말하지 않는다).

- **WK-D29 검색은 색인 칸 `aud1~3`(위키 audience 를 정렬해 셋, 빈 칸 `*`) · `readers`(restricted 를 읽을 사람)로 거른다.** 까닭 — Meili
  거르기로는 배열 칸이 '모두 가졌나'(그리고)를 못 쓰고, 읽는 사람 토큰의 부분집합을 늘어놓으면 `plat:` 이 많은 사람에서 2^n 으로 폭발한다.
  범위는 지금 생산자 기준 둘까지라 셋 칸이면 넉넉하다(넘으면 admin 만). 옛 색인 줄은 `NOT EXISTS` 로 지금처럼 보이게 해 배포 직후 검색이
  비지 않게 했다 — 재색인해야 restricted 가 빠진다.
- **WK-D30 홈 히어로(전역 5분 캐시)는 익명 기준(`["org"]` · restricted 아님)으로 센다.** 사람마다 다른 값을 전역 캐시에 둘 수 없다 —
  사람별로 다르게 하려면 캐시를 사람별로 쪼개야 하는데, 영역 타일은 넓게 보이는 문서로 충분하다.

- **WK-D31 앱 안 알림은 읽을 때 한 곳에서, 메일은 보낼 때 받는 사람별로 거른다.** 알림 생산자가 아홉 곳이라 하나씩 막으면 새 생산자가
  빠진다 — payload `slug` 로 목록 · 안 읽은 수에서 뺀다. 메일은 나간 뒤 되돌릴 수 없으니 보내기 전에 판정한다.
- **WK-D32 원천의 불변 칸은 계약 표보다 넓게 — 바꿀 수 있는 것만 적는다(`status` · `ingest_state` · `doc_id` · 사람 칸 둘).** 까닭 — 원천은
  '받은 그대로' 의 기록이라 제목 · 요약 · 민감도 · 동의도 바뀌면 안 된다. 지울 길은 트랜잭션 스위치 `mxwp.wiki_purge` 하나로 남겼다(시험이
  dev DB 를 쓰므로 정리할 길이 있어야 한다). 주의 — 후보 승인(W6)은 범위를 고르므로 새 줄(`supersedes_id`)이 되는데 payload 가 같으면
  멱등 열쇠가 겹친다 — W6 에서 정한다. 작업 상태에 `held`(§8 예산 넘침)와 점검용 op `noop` 을 더했다.
- dev 검색 색인에 DB 에서 이미 지워진 문서 100 장(그중 restricted 4)이 남아 제목이 검색에 뜨고 있었다(시험 · 초기화 잔재). 재색인이
  뷰에 없는 줄을 지우게 고치고 dev 를 다시 색인했다(427 장).

## 조사 메모(2026-10-24, W1)

- dev API 는 `uvicorn --reload` 다 — 코드를 저장하는 순간 살아 있는 API 가 바뀐다. 이번에 `users.portal_*` 를 읽는 코드가 `0050` 보다 몇 분
  먼저 올라가 그 사이 인증 요청이 실패했을 수 있다. 칸을 읽는 코드는 마이그레이션을 먼저 올린 뒤 저장한다.
- `infra/scripts/migrate.sh` 는 DB 비밀을 명령줄 `--env` 로 넘긴다(START §1 이 피하라는 꼴) — 이번엔 컨테이너 안에서 `.env` 를 물려받아
  `alembic upgrade head` 를 돌렸다. 스크립트를 고칠지는 사람에게 묻는다.
- 다크 모드 시각 회귀의 `doc-dark` 기준 그림은 실제로 **밝은 화면**이다 — `ThemeProvider`(기본 system)가 `addInitScript` 로 넣은 `dark` 를
  마운트 때 지운다. 소속 → 팀 새 케이스는 `emulateMedia({ colorScheme })` 로 짓고 기준 그림은 vite dev(:5174)에서 떴다(dev :5173 은 포털
  접두판 dist 라 이 스펙이 루트로 못 돈다). 기존 `doc-dark` 를 고칠지는 사람에게(lat visual-regression Gotchas).

## 조사 메모(2026-10-24, W0)

- 시험의 pytest · jsonschema 는 api.sif 안이 아니라 호스트 `~/.local` 에서 온다(홈 마운트 — `--no-mount home` 으로 띄우면 둘 다 없다).
  jsonschema 는 pyproject `dev` 에 적었다.
- 포털 세션 정정(10-24) — 포털 쪽 비밀 자리는 포털 `infra/.env` 가 아니라 게이트웨이 `HWAXMcpGateway/provision.env` 다(request §4-4 · P5 고침).

- 낡은 문서 셋을 고치다 `make build-web`(→ `make ship`)이 접두를 굽지 못하는 것을 찾았다 — `vite.config.ts` 는 `VITE_BASE_PATH` 만 읽는데
  `MXWP_BASE_PATH` 만 넘겼다(vite `resolveConfig` 로 base `/`). 지금 dist(09-13)는 접두가 있어 손수 지은 것으로 보인다. `8ff0d42` 로 고쳤다.
- 이 작업 사본은 포털 세션도 함께 쓴다(4c7962a 가 같은 디렉터리에서 커밋됐다) — 커밋 전에 `git status` 를 전부 보고 내 파일만 올린다.

## 열린 결정 — request §11 Q1~Q12(사람)

- 남은 것(2026-10-24) — Q2(W8 · 내 해석 잡 자동 보내기) · Q8(W8 · 시장불량 범위 · 워커 PAT 의 `plat:plmdefect`) · Q11(W7 · 의미 검색) ·
  Q12(되돌려 주기 — 권장 '이번엔 안 함').
