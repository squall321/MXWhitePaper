# LLM 위키 — 작업 시작점

> 이 리포에서 LLM 위키 · 포털 완전 연결을 개발하는 세션은 **이 파일부터** 읽는다. 무엇을 · 왜는 [request.md](request.md), 정확한 꼴은
> [CONTRACTS.md](CONTRACTS.md), 위키 규칙서 초안은 [SCHEMA-DRAFT.md](SCHEMA-DRAFT.md), 할 일 칸은 [checklist.md](checklist.md), 결정과 까닭은
> [context-notes.md](context-notes.md).

## 0. 읽는 순서

1. [request.md](request.md) §0(요약) · §1(구조) · §9(단계) — 20분이면 전체 그림이 잡힌다.
2. [context-notes.md](context-notes.md) — 이미 내린 결정(WK-D)과 **사람이 아직 안 정한 것**(request §11).
3. 리포 `CLAUDE.md` → `docs/lat/README.md` → 이번 단계가 닿는 lat 한 장(아래 표).
4. [CONTRACTS.md](CONTRACTS.md) 의 그 단계 절.

| 단계 | 먼저 읽을 lat · 코드 |
| --- | --- |
| W1 연결 · 신원 | `docs/lat/core.md` · `app/routers/portal_sso.py` · `app/core/auth.py` · HWAXPortal `docs/sso-delegation/PLAN.md` §1(위임 계약) |
| W2 보이기 범위 | `docs/lat/documents.md` · `app/repos/document_repo.py` · `app/search/meili_indexer.py` · `tests/test_block_permissions_paths.py`(읽기 길 전수 시험의 선례) |
| W3 원천 · 작업 | `docs/lat/storage.md` · `docs/lat/snapshots.md` · `app/main.py`(티커 — 쓰지 않을 방식) · `infra/scripts/{start,stop,status,update,diag}.sh` |
| W4 들이기 · 검토 | `docs/lat/documents.md` · `app/services/document_service.py`(저장 경로 · ETag · 훅) · `docs/lat/chat.md`(LLM 클라이언트) |
| W5 온톨로지 | `docs/lat/graph.md` · `docs/lat/glossary.md` · `app/lib/relationship_types.py` · alembic `0047` · `0048` · `0049` |
| W6 묻기 · MCP | `docs/lat/chat.md` · `dist/llm-docx-toolkit/mcp/server.py` · `dist/llm-docx-toolkit/README.md` |

## 1. 지킬 것

- **lat 우선 · lat 유지** — 새 lat 노드 `docs/lat/wiki.md` 를 W0 에 뼈로 만들고, 단계마다 같은 커밋에서 고친다. `docs/lat/README.md` 노드 표에 한 줄.
- **시험은 컨테이너 안** — `apptainer exec instance://mxwp_api bash -lc 'cd /workspace/apps/api && python -m pytest tests/ -q'`. 이 박스(dev)는 메모리가
  빠듯하다 — **시험 묶음은 한 번에 하나**(여러 스위트를 함께 돌리다 earlyoom 이 서비스를 내린 적이 있다).
- **dev 는 바깥에 드러난 박스다** — 실데이터(시장불량 · 실제 해석 결과 · 실제 대화) 금지. 합성 원천(`apps/api/tests/fixtures/wiki/`)과 가짜 LLM 서버만.
  모델 · 부품 이름도 지어낸 것으로(사내 모델 코드 · BOM 코드를 리포에 넣지 않는다).
- **비밀은 `.env` 로만** — 명령줄 인자 · 로그 · 커밋에 넣지 않는다. `.env` 를 읽는 스크립트를 `bash -x` 로 따라가지 않는다(대입 줄에 비밀이 찍힌다).
- **이 리포만 고친다** — 포털 · 게이트웨이 · 에이전트 서버 몫(request §4-3 P1~P9)은 HWAXPortal `docs/mxwp-wiki/` 에 있고 그 리포 세션이 한다. 계약
  (CONTRACTS §3 봉투 · §9 신원)을 바꿔야 하면 사람에게 알리고 이 리포 context-notes 에 한 줄을 남긴다.
- **프로세스는 pid 로** — `pkill -f` 금지(남의 프로세스까지 죽인다). 인스턴스는 이 스택 것만 내린다(`update.sh` 095f8e9 규칙).
- **DocumentJSON v1.0 은 바꾸지 않는다** — 위키 상태는 옆 표(WK-D2).
- **위키 쓰기에 mock LLM 을 쓰지 않는다** — 시험은 가짜 LLM 서버(W0). 운영에서 LLM 이 없으면 작업은 줄에서 기다린다.
- **DB 는 `sqlalchemy.text()` + AsyncSession** — 이 리포는 ORM 모델을 두지 않는다(`app/repos/document_repo.py` 머리). 위키 표도 같은 방식.
- **새 파일 첫 줄** — 한국어 한 줄 역할 주석(예 — `# 위키 원천 봉투(mxwp-source/1)를 검증하고 저장한다`).
- **커밋** — 논리 변경 하나마다 · 한국어 '무엇을 왜' · lat 은 같은 커밋 · 끝에 `Co-Authored-By` 줄. 남의 미커밋 파일을 같이 올리지 않는다(`git status` 를
  자르지 말고 전부 본다).
- **화면을 고치면 브라우저로 확인** — 다크 모드 시각 회귀(`apps/web/tests/e2e/visual-darkmode.spec.ts`)에 새 화면을 더한다.

## 2. W0 — 첫 걸음(dev)

1. **결정 확인** — request §11 을 사람과 본다. W0~W4 에 걸리는 Q3 · Q5 · Q6 · Q7 은 권장안으로 시작해도 되지만, 그 단계를 '완료' 로 적기 전에 사람 확인을
   받는다. Q4(범위 단위)는 W2 를 시작하기 전에 받는다. 받은 답은 context-notes 에 날짜와 함께(사람 결정이면 '사용자 결정' 이라고).
2. **낡은 문서 셋** — request §3 끝(통합 문서의 접두 · `serve -s` · 위젯 가이드의 토큰 범위 · mcp-parity 체크리스트).
3. **가짜 LLM 서버** — `apps/api/tests/fakes/fake_llm.py`. OpenAI 호환 `/v1/chat/completions`(`response_format: json_schema` · 도구 호출 둘 다) ·
   `/v1/models`. 시나리오 파일로 답을 고른다 — 정상 · 지어낸 숫자 · 근거 없음 · 잠긴 블록 건드림 · 범위 섞임 · 계획 밖 문서 · 300자 넘는 인용 · 형식 틀림 ·
   느림 · 연결 끊김. **진짜 서버와 같은 꼴**로(응답 봉투 · 오류 꼴) — 가짜가 진짜와 다르면 판정 결함을 숨긴다.
4. **합성 원천 묶음** — `apps/api/tests/fixtures/wiki/sources/*.json`(봉투 꼴 — CONTRACTS §3). 해석 결과 6 · 시장불량 사례 4 · 집계 2 · 문답 5 · 심의 2 · 정정 1.
   같은 부품 · 같은 불량 유형이 여러 원천에 겹치게(모순 하나 · 낡음 하나 · 빈틈 하나를 일부러 심는다 — W7 이 잡아야 한다).
5. **규칙서 초안** — [SCHEMA-DRAFT.md](SCHEMA-DRAFT.md) 를 사람과 읽고 고친다. W4 에서 `wiki-schema` 문서로 올린다.
6. **`docs/lat/wiki.md` 뼈** — 아래 §4 의 모듈 자리와 데이터 흐름.
7. **설정 자리** — `WIKI_ENABLED`(기본 0) · `WIKI_LLM_BASE_URL` · `WIKI_LLM_MODEL` · `WIKI_LLM_API_KEY` · `WIKI_QUERY_LLM_*` · `MXWP_SSO_SECRET` ·
   `MXWP_SSO_JIT_CREATE` — `app/core/config.py` 와 예시 env. 포털 설정 킷(HWAXPortal `infra/env-kits/mx-white-paper.env`)에 넣을 줄은 포털 세션에 넘긴다.

## 3. 단계 순서

```text
W0 ─▶ W1 연결·신원 ─▶ W2 보이기 범위 ─▶ W3 원천·작업 ─▶ W4 들이기·검토 ─┬▶ W5 온톨로지 ─┐
                                                                     └▶ W6 묻기·MCP ──┴▶ W7 점검·지속 질의 ─▶ W8 cae00
```

- W1 · W2 가 W6 보다 먼저다 — 사람 명의와 보이기 범위가 없으면 포털에서 위키로 쓰는 길을 열지 않는다.
- W2 가 W4 보다 먼저다 — 범위가 좁은 원천을 들이기 전에 읽기 길이 다 막혀 있어야 한다.
- W5 와 W6 은 나란히 가도 된다(엔티티 해석은 W4 의 결정적 부분으로 시작하고 W5 에서 넓힌다).

## 4. 코드 자리(제안)

```text
apps/api/app/wiki/
  envelope.py      # 원천 봉투 mxwp-source/1 (pydantic, 종류별 body)
  audience.py      # 범위 토큰 계산 · 저장소 층 필터 · 검색 필터
  sources.py       # 받기 · 멱등 · 불변 · 철회
  jobs.py          # DB 큐(SKIP LOCKED · lease)
  worker.py        # python -m app.wiki.worker — 별도 인스턴스 mxwp_wiki
  llm.py           # 구조화 출력 · 재시도 · 예산 · 시간 제한
  resolve.py       # 엔티티 해석(결정적 → LLM 후보)
  plan.py · write.py · validate.py · apply.py     # 들이기 다섯 단계
  query.py · fileback.py
  lint.py · inquire.py
  ontology.py      # 유형 · 술어 표 · 제안 → 승인
  index_log.py     # index.md · log.md
  connectors/      # 끌어오는 연결기(W8 — dynaforge · plm_defect · stcx …)
apps/api/app/routers/wiki.py            # /api/v1/wiki/*
apps/api/app/routers/auth_sso.py        # POST /api/v1/auth/sso (C1)
apps/api/alembic/versions/0050_*…       # 표(CONTRACTS §2)
apps/web/src/features/wiki/* · src/pages/Wiki*.tsx
dist/llm-docx-toolkit/mcp/server.py     # wiki_* 도구(CONTRACTS §7)
```

## 5. '다 됐다' 라고 말하기 전에

- 컨테이너 안 시험 전체 통과(결과 줄을 그대로 적는다) · 새 기능마다 시험 · lat 갱신 · checklist 칸 · context-notes 결정.
- 게이트웨이에 붙는 도구는 **게이트웨이 `tools/list`** 로 확인한다(앱 소스에 있어도 배포판이 낡으면 안 뜬다).
- 화면은 브라우저로 · 다크 모드 시각 회귀.
- 단계 완료 기준(request §9)을 하나씩 대조한다.

## 6. 포털 쪽과 맞출 것

| 이 리포가 끝내면 | 포털 쪽이 할 것 |
| --- | --- |
| C1 위임 창구(`/api/v1/auth/sso`) | P1 provision 설정 · P5 update-all · 사람이 비밀 전달(request §4-4) |
| C4 소속 증명 검증 | (게이트웨이는 이미 싣는다) · P3 진입 토큰 `affiliation` · P4 플랫폼 증명(둘 다 10-24 구현 — CONTRACTS §9) |
| W3 `/api/v1/wiki/sources` · `/health` | P6 '위키에 남기기' · P9 상태판 |
| W6 `wiki_*` MCP | 게이트웨이 `tools/list` 확인 · 에이전트 서버 도구 영역 · 페르소나 `he-doc-mxwhitepaper` 안내문 |
| 워커 인스턴스 `mxwp_wiki` | 포털 `infra/services.yaml` MXWP 항목에 여섯째 인스턴스 |
