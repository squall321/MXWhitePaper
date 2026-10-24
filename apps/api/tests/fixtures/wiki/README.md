# 위키 시험 묶음 — 합성 원천 · 가짜 LLM 시나리오

> 값은 **모두 지어낸 것**이다(dev 는 바깥에 드러난 박스 — `docs/llm-wiki/START.md` §1). 모델 · 부품 코드는 `SYN-` 로 시작하고 사람은
> `@example.com` 이다. 사내 모델 코드 · BOM 코드 · 실제 해석 결과 · 실제 대화를 여기에 넣지 않는다.

## `sources/` — 원천 봉투(`mxwp-source/1`) 20 장

| 종류 | 수 | 파일 |
| --- | --- | --- |
| 해석 결과 `sim_result` | 6 | `01`~`06` |
| 시장불량 사례 `field_defect`(case) | 4 | `07`~`10` |
| 시장불량 집계 `field_defect`(aggregate) | 2 | `11` · `12` |
| 문답 `qa` | 5 | `13`~`17` |
| 심의 `deliberation` | 2 | `18` · `19` |
| 정정 `correction` | 1 | `20` |

세계 — 제품 모델 둘(가상폴드 A1 `SYN-M-A1` · 가상바 B2 `SYN-M-B2`) · 부품 셋(힌지 브래킷 · 커버 글라스 · 배터리 팩) · 불량 유형 셋
(힌지 브래킷 균열 · 커버 글라스 깨짐 · 배터리 스웰링). 같은 부품 · 같은 불량 유형이 해석 · 시장 · 문답 · 심의에 겹쳐 나온다.

범위 — `org`(03 · 05 · 14 · 15 · 17 · 19 · 20) · `aff:SYN-CAE1`(01 · 02 · 04 · 06 · 13 · 16) · `plat:plmdefect`(07~12) ·
`aff:SYN-CAE1` 그리고 `plat:plmdefect`(18 — PLM 사례를 근거로 든 심의). 민감도는 모두 `internal` — 보이기는 범위 토큰이 정하고,
`restricted`(주인 무리만)는 들이지 않는다(WK-D37 — W4 에서 07~12 를 restricted 에서 고쳤다).

**일부러 심은 것**(점검 W7 · 검증 W4 가 잡아야 한다)

| 무엇 | 어디 | 잡을 규칙 |
| --- | --- | --- |
| 모순 | 01 · 02(412 · 405 MPa, 위험) 와 04(296 MPa, 안전) — 같은 부품 · 같은 조건(1.5 m 전각도 낙하) · 같은 지표 `max_von_mises_stress`. 메시(0.5 · 1.0 mm) · FE 모델 판(v3 · v2)이 다르다 | lint `contradiction` |
| 낡음 | 01 과 02 는 같은 잡(`stcx` · `SYN-JOB-0001`)의 rev 1 · 2 — 02 가 들어오면 01 은 `superseded` | lint `stale` |
| 빈틈 | 배터리 스웰링은 시장(10 · 12)과 문답(15)에만 있고 재현한 해석이 없다 | lint `gap`(`reproduced-by` 없음) |
| 사람의 정정 | 20 이 힌지 브래킷 재료를 SUS304(01~03 의 조건)에서 SUS301 로 고친다 | 들이기가 정정을 따르고 둘 다 적는다 |
| 연락처 꼴 | 17 의 답에 전화 · 이메일 꼴 | 검증 V9(가려서 통과 + 경고) |

## `scenarios/` — 가짜 LLM(`tests/fakes/fake_llm.py`) 시나리오

어느 요청에나 맞는 전송 시나리오 넷 — `disconnect`(연결 끊김) · `malformed`(형식 틀림) · `slow`(30초 뒤) · `server_error`(500).
들이기(W4)의 답 일곱 — 계획(`wiki_plan`)은 모두 첫 후보를 고르고, 쓰기(`wiki_write`)가 갈린다. 실행 때 정해지는 값은 `capture` 로
프롬프트에서 뽑는다(`후보:` · `문서:` · `<<<원천` · `요약:` · `## … (AI)` · `- 블록 …`).

| 파일 | 답 | 잡을 규칙 |
| --- | --- | --- |
| `ingest-normal` | 첫 AI 절에 원천 요약 · 근거 | — (자동 반영) |
| `ingest-invented-number` | 원천에 없는 999 MPa | V3 → failed |
| `ingest-no-cite` | 근거 없는 사실 블록 | V2 → failed |
| `ingest-locked-block` | 있는 문서의 첫 블록을 고침(그 블록이 잠겼으면) | V5 → 검토 |
| `ingest-mixed-scope` | 다른 범위 원천도 인용 — `{{foreign_sid}}` 는 시험이 채운다 | V4 → failed |
| `ingest-off-plan` | 계획에 없는 문서도 건드림 | V6 → 검토 |
| `ingest-long-quote` | 301자 인용 | V10 → failed |
| `ingest-relations` | 사례 · 부품 · 불량 유형 · 해석 종류를 고르고 관계 둘(부품 → 불량 유형 · 불량 유형 → 사례)을 근거와 함께(W5) | — (자동 반영 · 코드가 둘을 더한다) |
| `ingest-bad-relation` | 없는 술어 · 정의역 밖 · 후보 밖 끝 | V7 → failed · 후보 밖은 버린다 |
