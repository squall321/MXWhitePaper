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
- [ ] 포털 쪽 P1~P5 가 끝난 뒤 — 게이트웨이 감사 원장에서 MXWP 호출이 사람 명의(request §4-5)

## W2 보이기 범위
- [x] 범위 토큰 계산(org · aff · plat · user — 그리고) · `access.max_age_h` — `app/wiki/audience.py`(규칙서 전까지 24 고정)
- [ ] 저장소 층 필터(문서 GET · 목록 · 판 · diff · 복원) — GET · 목록 · 판 · 복원 · 역링크 · export.html 됨, diff 남음
- [x] Meilisearch `audience` 필터 칸 · 재색인 — `aud1~3` · `readers`(WK-D29) · 기동 때 설정 · **배포 뒤 재색인은 사람 몫**(dev 는 했다)
- [ ] 그래프 넷(링크 · 의존 · 고아 · 역링크 · triple) · 다른 문서 안 미리보기 — 그래프 넷 · 홈 됨, 미리보기 남음
- [x] 내보내기 · 발표 · 공유 링크 · oEmbed — 내보내기 · 발표는 `get_document_or_404` 로, 공유는 익명 기준(WK-D28)
- [ ] 댓글 · 알림 · 요약 메일 · 구독 · 분석 — 알림(읽을 때) · 요약 메일 · 구독 이벤트 · 결재 · 자동화 · 알림 예약 메일 됨, 댓글 목록 · 분석 남음
- [x] 챗 도구 · MXWP MCP 읽기 도구 · AIDataHub 밀어내기(`["org"]` 만) — 챗 · MCP 는 API 를 거쳐 거르고, AIDataHub 는 `?audience=org`
- [ ] 길마다 시험(범위 셋 × 길 전부) 누설 0 — `test_block_permissions_paths.py` 꼴
- [x] (Q4 답에 따라) 기존 `restricted` 문서도 같은 필터 — 작성자 · 검토자 · 이메일 owners/reviewers · admin(WK-D27)

## W3 원천 · 작업 실행기
- [ ] 표 — `wiki_sources`(불변 트리거) · `wiki_jobs` · `wiki_log`(덧붙이기만) · `wiki_pages`
- [ ] 봉투 검증(종류별 body) · 첨부(업로드 파이프라인) · 버킷 `wiki-sources`
- [ ] `POST /sources` 멱등 · 철회 · 원천 문서(`src-…`)
- [ ] 워커 `python -m app.wiki.worker` · 인스턴스 `mxwp_wiki` · start · stop · status · update(여섯) · diag · sync-from-drive
- [ ] `/api/v1/wiki/health`
- [ ] **데이터 덤프 · 합치기에서 위키 제외** · 스냅숏에는 포함 확인

## W4 들이기 · 검토 · 근거(첫 동작판)
- [ ] 가짜 LLM 쓰기 답 시나리오 여섯(정상 · 지어낸 숫자 · 근거 없음 · 잠긴 블록 · 범위 섞임 · 계획 밖 문서 · 300자 넘는 인용) — 쓰기 스키마와 함께(W0 에서 옮김)
- [ ] 엔티티 해석(결정적) · 계획 · 쓰기 · 검증 V1~V11 · 반영(document_service 경로) · 되돌리기
- [ ] 자동 반영 조건 · 검토 큐 API
- [ ] `wiki_citations` · 읽기 응답에 근거 붙이기
- [ ] 화면 — 위키 홈 · 문서 배지 · 각주 · 원천 카드 · 검토 큐 · 기록
- [ ] `index.md` · `log.md`(원문 꼴)
- [ ] 규칙서 `wiki-schema` 문서 · YAML 검증 · 판
- [ ] 완료 기준 — 합성 20 → 문서 · 틀린 가짜 답 여섯 가지가 다 걸림 · 되돌리기 복원

## W5 온톨로지
- [ ] 유형 · 술어 표(제안 → 승인) · 첫 판(SCHEMA-DRAFT §4 · §5)
- [ ] 엔티티 등록부 · 별칭 · 외부 id · 합치기
- [ ] `doc_triples` 칸 더하기 · 지운 문서의 triple 정리
- [ ] 그래프 화면에 엔티티 관계
- [ ] 완료 기준 — 해석 정확도 90% 이상(사람 정답표) · 중복 0

## W6 묻기 · 되쌓기 · MCP
- [ ] `/wiki/query` SSE · 답 없으면 그렇다고 · 질문으로 남기기
- [ ] `/wiki/fileback` · `qa` 문서 합치기
- [ ] MXWP 챗 위키 모드(스트리밍 · 시간 제한)
- [ ] MCP `wiki_*` 열넷 · 기존 쓰기 도구는 위키 문서 거부 · 시스템 프롬프트
- [ ] 내 후보 화면(주인만 · 7일)
- [ ] 게이트웨이 `tools/list` 확인 · 포털 P6 · P7 · P8 뒤 끝에서 끝

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
