# LLM 위키 · 포털 완전 연결 — 체크리스트

> 단계 · 완료 기준은 [request.md](request.md) §9. 포털 · 게이트웨이 · 에이전트 서버 몫은 HWAXPortal `docs/mxwp-wiki/checklist.md`.

## 요청서(2026-10-24, 포털 세션)
- [x] 구조 조사(Karpathy 원문) · MXWP 현황 · 포털 연결 상태 · 원천 위치 조사
- [x] request · CONTRACTS · SCHEMA-DRAFT · START · checklist · context-notes

## W0 준비(dev)
- [x] request §11 결정 확인(Q3 · Q5 · Q6 · Q7 은 W4 완료 전, Q4 는 W2 시작 전) — 10-24 사용자 결정 WK-D15~D18(Q1 · Q3~Q7 · Q9 · Q10)
- [x] 낡은 문서 셋 — HWAX-PORTAL-INTEGRATION(접두 떼기 · `serve -s`) · llm-widgets-via-api(토큰 범위) · mcp-parity 체크리스트
  (+ 같은 낡은 말의 `.env.example` · 고치다 찾은 `make build-web` 접두 결함 `8ff0d42`)
- [x] 가짜 LLM 서버(json_schema · 도구 호출 · 시나리오 열) — 진짜 꼴과 같게 — `tests/fakes/fake_llm.py`. 시나리오는 전송 넷(끊김 · 형식
  틀림 · 느림 · 500) + 규칙 기계(match · times · capture · conform), 쓰기 답 여섯은 W4 칸으로 옮겼다(WK-D19)
- [x] 합성 원천 묶음 20(모순 · 낡음 · 빈틈 하나씩 심기) — `tests/fixtures/wiki/sources/`(+ 사람의 정정 · 연락처 꼴)
- [ ] 규칙서 초안 사람 검토 — v0 로 시작, W4 에서 다시 본다(WK-D18)
- [x] `docs/lat/wiki.md` 뼈 · lat README 노드 표
- [x] 설정 자리(`WIKI_*` · `MXWP_SSO_*`) — 포털 설정 킷에 넣을 줄은 없다(기본값으로 충분 · 비밀은 사람)
- [x] 완료 기준 — 가짜 LLM + 합성 묶음으로 빈 시험이 돈다(`test_wiki_w0.py` 24 passed · 전체 1228 passed, 4 skipped — 10-24)

## W1 연결 · 신원
- [x] C1 `POST /api/v1/auth/sso` — 404(비밀 없음) · 401 · 403 · 400 · 200, `compare_digest` — `routers/auth_sso.py`
- [x] C2 위임 토큰 — 12시간 이상 · read + write · 클라이언트별 발급 · 세대 회수 — JWT `typ=delegated` + `sso_delegations`(WK-D22 · D23)
- [x] C3 자동 생성 스위치 `MXWP_SSO_JIT_CREATE`
- [x] C4 소속 증명 검증(맞음 · 만료 · 다른 이메일 · 평문만) · 진입 토큰 `affiliation` · `groups` 의 `plat:` 받기 · 플랫폼 증명 검증 · `users.portal_*`
  — 위임 호출 값은 저장하지 않고 그 호출에만(WK-D24)
- [x] C5 `wiki_aff_team_map` + 관리자 화면 — `/admin/aff-team-map`(대시보드 바로가기) · 브라우저 확인 · 다크 모드 시각 회귀 두 케이스
- [x] C6 진입 토큰 jti 재사용 막기를 DB 로 — `portal_launch_jti`
- [x] C8 HWAX-PORTAL-INTEGRATION 을 지금 모습으로(위임 · 소속 포함) — 접두 · `serve -s`(W0) + 'Identity' 절
- [x] 포털 쪽 P1~P5 가 끝난 뒤 — 게이트웨이 감사 원장에서 MXWP 호출이 사람 명의(request §4-5) — 10-24 끝에서 끝: 게이트웨이로 만든
  문서의 주인 · 감사 `document.create` 가 그 사람(데모 계정 · editor), 게이트웨이 감사 `mode=as-user-pat`. plat 증명도 끝에서 끝으로
  닿는다(MCP 가 증명 머리글을 넘기게 고친 뒤 — 39c3c98, `plat:plmdefect` 문서가 plat 이 있으면 보이고 없으면 404)

## W2 보이기 범위
- [x] 범위 토큰 계산(org · aff · plat · user — 그리고) · `access.max_age_h` — `app/wiki/audience.py`(규칙서 전까지 24 고정)
- [x] 저장소 층 필터(문서 GET · 목록 · 판 · diff · 복원) — diff 는 FE 가 GET 둘로 짓는다(cross-doc-diff)
- [x] Meilisearch `audience` 필터 칸 · 재색인 — `aud1~3` · `readers`(WK-D29) · 기동 때 설정 · **배포 뒤 재색인은 사람 몫**(dev 는 했다)
- [x] 그래프 넷(링크 · 의존 · 고아 · 역링크 · triple) · 다른 문서 안 미리보기 — 링크 카드는 GET 으로, 용어 관련 문서 · 시리즈도 거른다
- [x] 내보내기 · 발표 · 공유 링크 · oEmbed — 내보내기 · 발표는 `get_document_or_404` 로, 공유는 익명 기준(WK-D28)
- [x] 댓글 · 알림 · 요약 메일 · 구독 · 분석 — 알림은 읽을 때, 메일은 받는 사람별로(WK-D31), 분석은 조회 감사 줄의 문서로
- [x] 챗 도구 · MXWP MCP 읽기 도구 · AIDataHub 밀어내기(`["org"]` 만) — 챗 · MCP 는 API 를 거쳐 거르고, AIDataHub 는 `?audience=org`
- [x] 길마다 시험(범위 셋 × 길 전부) 누설 0 — `test_block_permissions_paths.py` 꼴 — `tests/test_wiki_audience.py` 23(응답 어디든 범위 밖 slug 가 나오면 실패)
- [x] (Q4 답에 따라) 기존 `restricted` 문서도 같은 필터 — 작성자 · 검토자 · 이메일 owners/reviewers · admin(WK-D27)
- [x] admin 의 범위 밖 읽기는 감사(`document.read.admin_override`, `get_document_or_404` 한 곳)
- [ ] 배포 — cae00 에 0050 · 0051 · 재색인(`python -m app.scripts.reindex`). 재색인 전엔 restricted 가 검색에 남는다 — 재색인은 이제 `migrate.sh` 가 이관 뒤 한 번 한다(표지, 10-25)

## W3 원천 · 작업 실행기
- [x] 표 — `wiki_sources`(불변 트리거) · `wiki_jobs` · `wiki_log`(덧붙이기만) · `wiki_pages`(0051 · 0052 — 워커 심장박동 `wiki_workers` 더함)
- [x] 봉투 검증(종류별 body) · 첨부(업로드 파이프라인) · 버킷 `wiki-sources`(이름은 `mxwp-wiki-sources` — WK-D35)
- [x] `POST /sources` 멱등 · 철회 · 원천 문서(`src-…`) · 목록 · 한 건 · 기록(`/log` · `/log.md`)
- [x] 워커 `python -m app.wiki.worker` · 인스턴스 `mxwp_wiki` · start · stop · status · update(여섯) · diag · sync-from-drive
  (dev 에서 띄워 봄 — 심장박동 `disabled` · 정지 신호에 `stopped`)
- [x] `/api/v1/wiki/health`
- [x] **데이터 덤프 · 합치기에서 위키 제외** · 스냅숏에는 포함 확인(스냅숏은 코드로 확인 — 전체 pg_dump · 백업 밖 모든 버킷)

## W4 들이기 · 검토 · 근거(첫 동작판)
- [x] 가짜 LLM 쓰기 답 시나리오 여섯(정상 · 지어낸 숫자 · 근거 없음 · 잠긴 블록 · 범위 섞임 · 계획 밖 문서 · 300자 넘는 인용) — 쓰기 스키마와 함께(W0 에서 옮김)
- [x] 엔티티 해석(결정적) · 계획 · 쓰기 · 검증 V1~V11 · 반영(document_service 경로) · 되돌리기
- [x] 자동 반영 조건 · 검토 큐 API(검토자 표지 `wiki_reviewer` — 0055)
- [x] `wiki_citations` · 읽기 응답에 근거 붙이기(`?with=citations`)
- [x] 화면 — 위키 홈 · 문서 배지 · 각주 · 원천 카드 · 검토 큐 · 기록(+ 원천 화면 · 다크 모드 시각 회귀 4 — 위키 API 는 고정 응답)
- [x] `index.md` · `log.md`(원문 꼴) — 저장해 두는 `wiki-index` 문서는 아직(창구가 늘 새로 짓는다)
- [x] 규칙서 `wiki-schema` 문서 · YAML 검증 · 판 — 사용자 결정(10-24, 권장안)으로 첫 판을 dev 에 v1 로 올렸다(검증 · 판 · admin 만 · `PUT /schema`)
- [x] 완료 기준 — 합성 20 → 문서 · 틀린 가짜 답 여섯 가지가 다 걸림 · 되돌리기 복원(`tests/test_wiki_ingest.py`)

## W5 온톨로지
- [x] 유형 · 술어 표(제안 → 승인) · 첫 판(SCHEMA-DRAFT §4 · §5) — 0056 · REST · 화면 `/wiki/ontology`
- [x] 엔티티 등록부 · 별칭 · 외부 id · 합치기(API — 보이기 · full · 중복 후보 · 합치기는 늘 검토 · 되돌리기. 화면은 아래)
- [x] `doc_triples` 칸 더하기 · 지운 문서의 triple 정리(0056 — 트리거, 남은 것은 주어가 없는 것만)
- [x] 그래프 화면에 엔티티 관계(들이기가 쓴 관계 — 링크 그래프 triple 토글 · 의미 관계 패널 '위키' 표지 · 엔티티 문서 '관계(자동)' 절 · 검토 화면 관계 카드)
- [ ] 완료 기준 — 해석 정확도 90% 이상(사람 정답표) · 중복 0 — dev 몫 끝(정답표 초안 29 · 결정적 15/15 · 후보 재현율 100% · 합친 뒤 중복 0 시험). 남은 것 — 사람이 정답표 확인 · 진짜 LLM 박스에서 `wiki_resolve_eval` 90% 이상
- [x] 화면 — 온톨로지(유형 · 술어 제안 · 승인) · 엔티티 등록부(목록 · 한 건 · 고치기 · 중복 후보 · 합치기 제안) · 검토 한 건의 합치기 카드(다크 모드 시각 회귀 4 케이스 더함)

## W6 묻기 · 되쌓기 · MCP
- [x] `/wiki/query` SSE · 답 없으면 그렇다고 · 질문으로 남기기(0057 `wiki_questions` · `/questions`)
- [x] `/wiki/fileback` · `qa` 문서 합치기(근거보다 넓지 않은 범위 · 같은 물음 열쇠 · 비슷한 물음은 계획이 고른다)
- [x] MXWP 챗 위키 모드(스트리밍 · 시간 제한) — 메인 챗 '위키에 묻기' · 각주 · 위키에 남기기(`done.scope`) · 질문으로 남기기 · 묻기 전체 300초(`done.timeout`) · 다크 모드 시각 회귀 1 케이스(+ 되쌓기 고침 — 근거 없는 답은 나만 · 답의 `[n]` 을 근거 차례로)
- [x] MCP `wiki_*` 열넷 · 기존 쓰기 도구는 위키 문서 거부 · 시스템 프롬프트 — 거부는 서버(기계 호출의 직접 쓰기 409 · `/propose` 늘 검토), 도구 열넷(`/search` · `/ask` 더함), 프롬프트 §8
- [x] 내 후보 화면(주인만 · 7일) — 받기의 후보 길 · `/candidates` · `/wiki/candidates` · 0058(멱등 열쇠에 범위)
- [ ] 게이트웨이 `tools/list` 확인 · 포털 P6 · P7 · P8 뒤 끝에서 끝 — `tools/list` 의 wiki_* 열넷은 확인됨(10-24 포털 세션 — MCP 서버 · 게이트웨이 다시 띄움). 포털 P6 · P7 은 올라왔다(HWAXPortal 6c16d83 — 봉투 꼴 · 증명 사슬은 MXWP 쪽에서 맞대 봤다). dev 준비 끝(10-24 사용자 결정 — `WIKI_ENABLED=true` · koo.park editor · web.sif 다시 구움 · 포털 재기동). 게이트웨이 길 끝에서 끝 확인(10-24 — 포털 세션이 보낸 시험 원천 둘을 MXWP 에서 읽음: 바로 남기기 `src_b19ed62c` = qa · `aff:CAEG` · via gateway · 들이기 작업 queued(LLM 비어 미룸, 시도 0/3) · 해결됨 `src_4f1e15e6` = held · `user:<koo.park>` · 제안 `aff:CAEG` · 내 후보에 보임). '내 후보' 승인도 확인(10-24 — 사용자가 koo.park 으로 로그인한 세션에서 Claude 가 누름: 제안 범위 `aff:CAEG` 는 403(포털 진입 기록 없음 — 닫힌 쪽), '나만' 으로 승인 → `src_4f1e15e6` queued · 작업 queued · 기록 '후보 승인'. 그때 알림이 서버 까닭을 가려 위키 화면 여섯을 고쳤다 — 49e6485). 포털 P8 · P9 · P10 올라옴(심의 봉투는 MXWP 모델로 검증 · `/health` 모양과 함께 계약에 적음) · 위키 읽기 아홉 `readOnlyHint`(ed616c1 — 게이트웨이까지 확인). 남은 것 — 포털 챗의 실제 버튼 클릭 · 읽기 전용 PAT 로 실제 호출(둘 다 사람) · 문서 반영은 LLM 있는 박스(W8) · 시험 원천 둘 정리

## SSO 전용 — 사람은 포털로만 들어온다(사용자 결정 10-25 · 포털 세션 MW-D22)
- [x] 설정 — `MXWP_SSO_ONLY`(기본 꺼짐) · `MXWP_LOCAL_LOGIN_ALLOW`(비상 관리자 이메일) · `PORTAL_LAUNCH_URL`(기본 `/launch/mx-white-paper`) · `.env.example`
- [x] 막기(403 `SSO_ONLY` + 진입 링크) — 가입 · 등록은 예외 없이, 비밀번호 로그인 · TOTP · 비밀번호 찾기 · 재설정 · 이메일 인증은 비상 관리자만
- [x] `GET /auth/mode`(공개) — 화면이 SSO 전용인지 · 진입 링크를 안다
- [x] 세션 = 포털 진입 한 번 — SSO 전용이면 진입 세션의 refresh 를 24시간(ACCESS_MAX_AGE_H) 이하로 · 사진이 낡거나 없는 refresh 는 401 `PORTAL_REENTRY`(비상 관리자 빼고)
- [x] 소속 → 팀 — 진입 때마다 표(`wiki_aff_team_map`)에 있으면 그 팀으로(다른 팀의 그룹은 비움 · 감사)
- [x] 목록 명령 — 포털로 들어온 적 없는 사람 계정(서비스 계정 빼고 · 비상 관리자 표시) — 켜면 웹 로그인을 못 한다
- [x] 웹 — 로그인 화면은 '포털로 들어가기' 하나(`?local=1` 이면 비상 관리자 폼) · 가입 화면 막음 · 세션이 끝나면 진입 링크로 저절로(돌아올 자리 sessionStorage · 되풀이 막기) · e2e 도우미는 `?local=1`
- [x] 시험 — pytest · vitest · e2e(저절로 다녀오기 · 되돌아오기 · 되풀이 막기) · 시각 회귀(SSO 전용 로그인 화면)
- [x] dev 켜기 — 목록 확인 · `.env` · API · 웹 다시 띄우기(포털 세션에 먼저 알림 — mxwp-mcp 가 같이 내려간다) · 포털 진입 확인 — 10-25 켬(진입 링크는 포털 정식 주소 `PUBLIC_BASE_URL` + `/launch/mx-white-paper`, 비상 관리자 admin@mx.local). 창구 확인(가입 · 비밀번호 로그인 403 · 비상 관리자 200) · 포털 앞단 화면(단추 하나 · 저절로 진입 링크) · SSO 전용 API 위 e2e 통과. 켜며 고침 — 부팅 refresh 의 사용자 빈 틈(fef6733). 포털 진입 확인(10-25 — hwax.demo 가 타일로 들어옴: 진입 토큰 1 · 플랫폼 권한 저장 · 소속 없음(포털 원장 그대로) · 팀 그대로). SSO 전용 아래 Claude 길도 확인(게이트웨이 as-user-pat · koo.park 명의 wiki_index). 남은 것 — koo.park 이 포털로 한 번 들어오기(소속 CAEG 저장)
- [ ] cae00 — 저절로 켜지지 않는다(`.env` 는 리포 밖, 기본 꺼짐) · 사람이 목록을 본 뒤 켠다(절차 `docs/deployment-playbook.md` 'SSO 전용 켜기')

## W7 점검 · 지속 질의
- [ ] 점검 아홉 · 작은 점검 · 밤 점검 · `lint-report` 문서 · 결함 표
- [ ] 질문 대기열 · 상시 질문 · 지속 질의(위키 → 읽기 전용 도구 → 사람 · 실험 제안)
- [ ] 예산 · 조용한 시간 · 묻기 우선
- [ ] 의미 검색 재현율 재기(Q11)
- [ ] 완료 기준 — 심은 결함이 다 잡힘 · 예산 지킴

## W8 실원천 · cae00
- [ ] `plm-defect` 도구 · 인자 · 결과 칸 이름 받기(값 없이) → `cae00-sources.md`
- [ ] 연결기 — DynaForge · PLM 결함 · stcx 잡(사람 정보 떼기)
- [ ] 배포 — api.sif(새 의존성 있으면 dev 빌드 → Drive) · 워커 인스턴스 · 포털 services.yaml
- [ ] 평가(request §10) · 규칙서 값 고치기
