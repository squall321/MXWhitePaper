# LLM 위키 계약 — 데이터 · 원천 봉투 · 변경 묶음 · 검증 · API · MCP

> [request.md](request.md) §5 의 기능을 코드로 옮길 때 기준으로 삼는 계약이다. 이름 · 모양은 **제안**이다 — 구현하면서 더 나은 이름을 고르면
> 이 문서를 같은 커밋에서 고친다(lat 유지 룰과 같다). 구현이 끝난 부분은 `docs/lat/wiki.md`(새 lat 노드)가 정본이 되고 이 문서는 그쪽을 가리킨다.

## 1. 낱말

| 낱말 | 뜻 |
| --- | --- |
| 원천(source) | 위키가 기대는 **불변** 자료 한 건 — 시뮬레이션 결과 · 시장불량(사례 · 집계) · 사람의 문답 · 심의 결정문 · 보고서 · 지식카드 · 사람의 고침 · 지속 질의의 답 |
| 위키 문서 | `wiki_pages` 에 한 줄이 있는 MXWP 문서. 기본은 AI 가 관리한다(`managed='ai'`) |
| 변경 묶음(changeset) | AI 의 쓰기 한 번. 여러 문서에 걸친 블록 연산 · 관계 · 엔티티 · 질문 · 기록을 한 단위로 검증 · 반영 · 되돌린다 |
| 근거(citation) | 위키 블록 → 원천(+ 원천 안의 위치) |
| 엔티티(entity) | 온톨로지의 개체(제품 모델 · 부품 · 불량 유형 · 해석 사례 …). 위키 문서 한 장을 가진다 |
| 규칙서(schema) | 위키의 헌법. 사람이 쓰고 판(version)이 있다 — [SCHEMA-DRAFT.md](SCHEMA-DRAFT.md) |
| 보이기 범위(audience) | 누가 읽을 수 있나. 토큰 넷 — `org`(MXWP 를 쓰는 모두) · `aff:<포털 소속 id>` · `plat:<포털 플랫폼 열쇠>`(그 플랫폼을 쓸 수 있는 사람 — 예 `plat:plmdefect`) · `user:<MXWP 사용자 id>` |

## 2. 데이터 모델(alembic `0050_*` 부터)

DocumentJSON v1.0(`packages/shared/schemas/document.json` → datamodel-codegen)은 **바꾸지 않는다**. `DocumentMeta` · `BlockMeta` 는
`extra='forbid'` 이고, 바꾸면 FE 타입 · `dist/llm-docx-toolkit` RAG 색인 · 네 겹의 drift 가드가 함께 움직인다. 위키 상태는 모두 옆 표에 둔다.

### 2-1. `wiki_pages` — 위키 문서 한 장에 한 줄

| 칸 | 꼴 | 뜻 |
| --- | --- | --- |
| `doc_id` | uuid PK · FK `documents(id)` ON DELETE CASCADE | |
| `kind` | text | `source` · `entity` · `concept` · `case` · `analysis` · `qa` · `overview` · `index` · `lint-report` · `schema`(SCHEMA-DRAFT §2) |
| `managed` | text | `ai`(AI 가 고친다) · `human`(사람 문서 — AI 는 변경 묶음을 **제안만**, 늘 검토) |
| `entity_id` | uuid null · FK `wiki_entities` | `kind='entity'` 일 때 |
| `audience` | text[] NOT NULL(빈 배열 금지) | 보이기 범위 토큰. 여럿이면 모두 만족해야 한다(그리고). §2-11 |
| `review_lock` | bool default false | 사람이 '검토됨' 으로 잠그면 이 문서를 고치는 AI 변경은 검토 큐로 간다 |
| `schema_version` | int | 이 문서를 마지막으로 쓴 규칙서 판 |
| `last_changeset_id` | uuid null | |
| `stale_since` | timestamptz null | 점검이 '낡음' 을 본 때. 고치면 비운다 |
| `created_at` · `updated_at` | timestamptz | |

구현 — alembic `0051`(W2, 범위가 사는 자리라 원천 · 작업 표보다 먼저). `entity_id` 의 외래 키는 `wiki_entities` 가 생길 때(W5) 단다.

### 2-2. `wiki_sources` — 원천(불변)

| 칸 | 꼴 | 뜻 |
| --- | --- | --- |
| `id` | uuid PK | 화면 · 근거에 보이는 짧은 꼴은 `src_` + 앞 8자 |
| `kind` | text | `sim_result` · `field_defect` · `qa` · `deliberation` · `report` · `card` · `document` · `correction` · `inquiry_answer` · `note` |
| `origin_system` | text | `stepforge` · `dynaforge` · `stcx`(SmartTwinMCP — 356대) · `ste`(SmartTwinExplorer — 24대) · `signalforge` · `plm-defect` · `hwax-risk` · `material-twin` · `hwax-portal` · `report-archive` · `aidatahub` · `mxwp` · `human` |
| `origin_ref` · `origin_rev` | text · text null | 그 시스템 안의 id(잡 id · 레코드 id · 대화 id + 턴) · 판 |
| `origin_url` | text null | 사람이 눌러 볼 주소. 포털 경로(`/ste/…`, `/apps/…`) 같은 **상대 경로**로 — 박스마다 호스트가 다르다 |
| `title` · `summary` | text · text null | |
| `payload` | jsonb | 봉투의 `body`(§3) — 정규화한 본문 |
| `payload_sha256` | char(64) | 정규 JSON(키 정렬 · 공백 없음)의 해시 |
| `blobs` | jsonb default `[]` | `[{key, name, mime, sha256, bytes, role}]` — MinIO 버킷 `mxwp-wiki-sources`(설정 `MINIO_BUCKET_WIKI_SOURCES` — 다른 버킷처럼 `mxwp-` 접두). role 은 `figure` · `raw` · `table` |
| `subject_hints` | jsonb default `[]` | 봉투의 `subject_hints`(§3) 그대로 — 엔티티 해석(W4)의 첫 실마리 |
| `audience` | text[] NOT NULL | 이 원천을 볼 수 있는 사람 |
| `sensitivity` | text | `public` · `internal` · `restricted`(문서 `confidentiality` 와 같은 낱말) |
| `owner_user_id` | uuid null | 원천의 주인(사람). 위임 호출이면 호출자와 같아야 한다 |
| `owner_email` | text null | 봉투의 `owner.email`(소문자 · 비면 보낸 사람) — 불변. `owner_user_id` 는 이 이메일의 사람(아직 없으면 null) |
| `submitted_by` | uuid null | 들인 계정(사람 또는 서비스). 그 사람이 지워지면 null(`owner_user_id` 도) |
| `via` | text | `portal-chat` · `gateway` · `connector:<이름>` · `upload` · `inquiry` |
| `consent` | jsonb null | 문답 원천의 동의 — `{by, at, mode:'button'|'candidate'|'auto', note}` |
| `captured_at` · `received_at` | timestamptz | 원천이 생긴 때(잡 끝난 시각 등) · 받은 때 |
| `supersedes_id` | uuid null | 같은 원천의 새 판이면 옛 판 |
| `status` | text | `active` · `superseded` · `withdrawn` |
| `ingest_state` | text | `new` · `queued` · `running` · `done` · `failed` · `skipped` · `held`(사람 확인 대기) |
| `doc_id` | uuid null | 원천 문서(`src-…` — `wiki_pages.kind='source'`). 사람이 원천을 문서로 읽는 자리 |

- **불변** — 바꿀 수 있는 칸은 `status` · `ingest_state` · `doc_id` · `owner_user_id` · `submitted_by` 뿐이다. 나머지를 바꾸는 UPDATE 와
  DELETE 는 DB 트리거가 거부한다(0052). 고침은 새 줄 + `supersedes_id`. 지우기는 손 정리 · 시험 정리만 — 트랜잭션 안에서
  `SET LOCAL mxwp.wiki_purge = 'on'` 을 건 뒤(`wiki_log` 도 같다). 구현은 `docs/lat/wiki.md` §Sources · Jobs 가 정본.
- **멱등** — UNIQUE(`origin_system`, `origin_ref`, COALESCE(`origin_rev`, ''), `payload_sha256`). 같은 것을 두 번 보내면 200 + 기존 id.
- **철회** — `status='withdrawn'`(주인 · 관리자). 그 원천을 인용한 블록은 점검이 `stale` 로 잡고 고침 변경 묶음을 만든다(§5 V-규칙과 별개로 늘 검토).

### 2-3. `wiki_citations` — 근거

| 칸 | 꼴 | 뜻 |
| --- | --- | --- |
| `doc_id` · `block_id` | uuid · text(ULID) | 블록 id 는 DocumentJSON 의 그 블록 id. `update_block` 은 id 를 지킨다 |
| `source_id` | uuid FK `wiki_sources` | |
| `locator` | jsonb | 원천 안의 위치 — `{path:"/results/max_stress"}` · `{page:3}` · `{row:12}` · `{figure:"fig2"}` |
| `quote` | text null(≤ 300자) | 짧은 인용. 원천을 통째로 문서에 옮기지 않는다 |
| `changeset_id` | uuid | 이 근거를 단 변경 묶음 |
| PK | (`doc_id`, `block_id`, `source_id`, md5(`locator`)) | |

블록이 지워지면 근거도 지운다(반영 트랜잭션 안에서). 사람이 편집기로 블록을 지워 남은 근거는 점검이 정리한다. 읽기 응답은 근거를 블록 옆에 붙여
준다(REST `?with=citations` · MCP `wiki_read`) — DocumentJSON 에 넣지 않는다.

### 2-4. `wiki_changesets` — 변경 묶음

| 칸 | 꼴 | 뜻 |
| --- | --- | --- |
| `id` | uuid PK | 짧은 꼴 `cs_` + 앞 8자 |
| `op` | text | `ingest` · `fileback` · `lint_fix` · `inquiry` · `human_request` · `revert` |
| `trigger` | jsonb | `{source_ids:[…]}` · `{question_id}` · `{finding_ids:[…]}` · `{user_id, request}` |
| `job_id` | uuid null | |
| `schema_version` · `model` · `prompt_hash` | int · text · text | 재현용 |
| `plan` | jsonb | 계획 단계의 출력 — 건드릴 문서 · 까닭 · 그 문서를 읽은 판(V6 · 반영 때 CAS 가 본다). 0054 에서 더함 |
| `ops` | jsonb | §4 연산 목록 |
| `validation` | jsonb | §5 결과 `[{rule, verdict:'pass'|'warn'|'fail', detail}]` |
| `status` | text | `proposed` → `validating` → (`auto_applied` \| `pending_review` \| `failed`) · `pending_review` → (`approved` → `applied`) \| `rejected` · `applied`/`auto_applied` → `reverted` |
| `audience` | text[] | 이 묶음이 닿는 문서들의 범위 합집합 — 검토 큐를 볼 수 있는 사람을 가른다 |
| `decided_by` · `decided_at` · `decision_note` | | 검토자 |
| `applied` | jsonb | `{<doc_id>: [from_version, to_version]}` — 되돌리기는 이 판으로 `restore` |
| `usage` | jsonb | `{prompt_tokens, completion_tokens, calls, seconds}` |
| `created_by` · `created_at` · `finished_at` · `error` | | 묶음을 부른 사람(들이기면 원천을 보낸 사람) · 실패 까닭 한 줄 |

반영은 **기존 document_service 경로**로 한다(ETag · 버전 CAS · 저장 훅 · 재색인). 판의 `change_log` 에는 `wiki cs_xxxxxxxx`
(X-MXWP-Change-Log 허용 문자 안 — document_service.py `_CHANGE_LOG_RE`).

### 2-5. `wiki_jobs` — 작업 큐(DB)

| 칸 | 꼴 | 뜻 |
| --- | --- | --- |
| `id` | uuid PK | |
| `op` | text | `ingest` · `query` · `lint` · `inquire` · `reindex` · `apply` · `noop`(줄 · lease · 재시도를 점검하는 빈 작업) |
| `args` | jsonb | |
| `state` | text | `queued` · `running` · `done` · `failed` · `cancelled` · `held`(예산 넘침 등 사람 확인 대기 — §8) |
| `priority` · `not_before` | int · timestamptz | 사람이 기다리는 `query` 가 앞, 배경 `lint` · `inquire` 는 뒤 · 조용한 시간에 |
| `attempts` · `max_attempts` | int | 기본 3 |
| `lease_until` · `worker` | timestamptz · text | `SELECT … FOR UPDATE SKIP LOCKED` 로 집고 lease 를 늘려 가며 돈다. lease 가 지나면 다른 워커가 다시 집는다 |
| `budget` · `usage` | jsonb | `{max_tokens, max_calls, max_seconds}` · 실제 쓴 것 |
| `created_by` · `created_at` · `started_at` · `finished_at` | | |
| `result` · `error` | jsonb · text | 실패 까닭은 사람이 읽는 한국어 한 줄 + 꼬리(`error` 앞 300자) |

### 2-6. 온톨로지

**`wiki_entity_types`** — `key` PK · `label_ko` · `label_en` · `parent_key` · `description` · `ext_axes`(jsonb — 바깥 어휘의 대응, SCHEMA-DRAFT §5) ·
`status`(`approved` · `proposed`) · `proposed_by` · `approved_by`.

**`wiki_predicates`** — `key` PK · `label_ko`("A 는 B 를 …") · `inverse_ko` · `domain_types` text[] · `range_types` text[] · `symmetric` ·
`description` · `status` · `proposed_by` · `approved_by`. 지금의 `app/lib/relationship_types.py` 열 가지는 그대로 두고 이 표가 **더한다**
(그 열 가지는 문서 사이 관계 — 전제 · 인용 · 대체 …, 이 표는 공학 개체 사이 관계).

**`wiki_entities`** — `id` uuid PK · `type_key` FK · `canonical_name` · `aliases` text[] · `ext_ids` jsonb(`{ra_entity, sp_model, sp_project, bom_code,
fmea_item, mt_material, …}`) · `attrs` jsonb · `audience` text[] · `status`(`active` · `merged` · `retired`) · `merged_into` ·
`created_by_changeset`. UNIQUE(`type_key`, lower(`canonical_name`)) — active 끼리만. 별칭 · 외부 id 는 GIN 색인.
엔티티 하나의 문서는 범위마다 한 장일 수 있어(§2-11) 문서 연결은 `wiki_pages.entity_id` 로 한다 — `page_doc_id` 는 두지 않았다(0054).
`wiki_entity_types` 에는 slug 약어 `abbr`(SCHEMA-DRAFT §3)를 더했다. 첫 판 14 가지는 0054 가 approved 로 넣는다.

**`doc_triples` 확장** — 컬럼을 **더한다**(기존 기능은 그대로) — `predicate_key` FK `wiki_predicates` null · `source_ids` uuid[] · `changeset_id` ·
`confidence` real · `wiki_status`(`proposed` · `accepted` · `retired`). 주어 · 목적어는 지금처럼 문서 slug(엔티티 문서). 문서가 지워지면 남는
triple(지금의 결함 — FK 없음)을 이번에 함께 정리한다.

### 2-7. `wiki_questions` — 지속 질의 대기열

`id` · `text` · `origin`(`lint` · `ingest` · `user` · `query_miss` · `standing`) · `origin_ref` · `about_entities` uuid[] · `audience` text[] ·
`priority`(1~5) · `status`(`open` · `asking` · `answered` · `needs_human` · `needs_experiment` · `closed` · `dropped`) · `asked_count` · `last_asked_at` ·
`answer_source_id` · `assignee` · `created_by` · `created_at`. 같은 질문이 쌓이지 않게 정규화 문장 해시로 UNIQUE(`audience` 별).

### 2-8. `wiki_lint_runs` · `wiki_lint_findings`

run — `id` · `scope`(`full` · `incremental:<cs id>`) · `started_at` · `finished_at` · `counts` jsonb.
finding — `id` · `run_id` · `rule`(request §5-8 표의 열쇠) · `severity`(`info` · `warn` · `error`) · `doc_ids` · `source_ids` · `entity_ids` · `detail` jsonb ·
`status`(`open` · `fixed` · `dismissed` · `question_raised`) · `fixed_by_changeset` · `closed_by` · `closed_at`. 같은 결함은 한 줄(열쇠 + 대상 해시).

### 2-9. `wiki_log` — 기록(덧붙이기만)

`id` bigserial · `at` timestamptz · `op`(`ingest` · `query` · `fileback` · `lint` · `inquire` · `review` · `revert` · `withdraw` · `schema`) · `title` ·
`detail` jsonb · `actor` · `job_id` · `changeset_id` · `audience` text[]. UPDATE · DELETE 는 트리거가 거부한다(보존 정책은 request §8 —
DELETE 는 `SET LOCAL mxwp.wiki_purge = 'on'` 아래에서만).

### 2-10. 신원 · 소속 · 플랫폼 권한

- `users` 에 `portal_affiliation` text null · `portal_plat` text[] null · `portal_access_at` timestamptz 를 **더한다** — 포털 진입 토큰의 `affiliation`
  클레임 · `groups` 의 `plat:` 항목(§9)으로 채운다. 진입 토큰은 서명된 전체 스냅숏이라 들어올 때마다 덮어쓴다(클레임이 없으면 NULL, `plat:` 이 없으면
  빈 배열). `portal_access_at` 이 오래되면(규칙서 `access.max_age_h`, 기본 24) 그 사람의 `aff:` · `plat:` 토큰은 **없는 것으로** 본다(닫힌 쪽).
- **게이트웨이 위임 호출의 서명된 헤더(§9)는 저장하지 않고 그 호출에만 쓴다**(10-24 구현에서 바꿈 — `docs/lat/core.md` §게이트웨이 · 포털 위임).
  헤더가 없는 것이 '권한 없음' 인지 '게이트웨이 `MXWP_SEND_PLAT` 꺼짐' 인지 모르니, 저장하면 옛 `plat:` 이 새 시각으로 살아난다.
- `wiki_aff_team_map` — `affiliation` PK · `team_id` FK — 처음 들어온 SSO 사용자를 '첫 팀' 대신 소속에 맞는 팀에 넣는다(관리자가 채운다,
  비면 지금처럼 기본 팀).

### 2-11. 보이기 범위 계산

- 범위는 토큰들의 **그리고**(AND)다. `["org"]` 는 MXWP 를 쓰는 모두 · `["aff:X"]` 는 소속 X · `["aff:X","plat:plmdefect"]` 는 소속 X 이면서
  PLM 결함 플랫폼을 쓸 수 있는 사람 · `["user:U"]` 는 U 혼자. 빈 배열은 금지(뜻이 헷갈린다 — 모두는 `["org"]` 로 적는다).
- 사람이 토큰을 만족하나 — `org` 는 늘 · `aff:X` ⇔ `portal_affiliation = X` · `plat:P` ⇔ `P ∈ portal_plat` · `user:U` ⇔ 그 사람. admin 은 전부
  (admin 의 범위 밖 읽기는 감사에 남긴다).
- 원천 여럿을 인용한 문서의 **최소 범위** = 인용한 원천 범위 토큰을 모두 더한 것(그리고 조건이 늘수록 좁다). 문서 범위는 그 토큰을 다 담아야
  한다(V4). 서로 다른 `aff:` 둘 · 서로 다른 `user:` 둘이 섞이면 만족하는 사람이 없으므로 반영을 거부하고 사람에게 넘긴다.
- **넓히지 않는다** — 넓히기(예 — 소속 문서를 `["org"]` 로)는 **사람만** 한다. 원천 주인 또는 그 범위의 검토자가 `POST /wiki/pages/{slug}/audience` 로,
  기록에 남긴다. `plat:` 토큰을 빼는 넓히기는 admin 만(포털 권한표가 막는 자료를 위키가 풀어 주는 길이 되기 때문).
- **restricted(사용자 결정 Q4 — WK-D15 · D27)** — 위키든 아니든 `confidentiality=restricted` 는 작성자(`owner_id`) · `document_reviewers` ·
  metadata owners/reviewers 에 이메일로 적힌 사람 · admin 만 본다. 구현 — `app/wiki/audience.py`(`docs/lat/wiki.md` §Audience 가 정본).
- 엔티티 문서처럼 여러 범위의 원천이 모이는 문서는 **범위별로 나눈다** — `ent-part-hinge-bracket`(org 사실만) 과
  `ent-part-hinge-bracket--plmdefect`(PLM 결함 사실, 범위 `["plat:plmdefect"]`). 넓은 문서는 좁은 문서가 있다는 것도 말하지 않는다(제목이 새는 것을
  막는다 — 링크는 좁은 문서 쪽에서 넓은 문서로만).

## 3. 원천 봉투 `mxwp-source/1`

생산자(포털 · 플랫폼 연결기 · 사람)가 `POST /api/v1/wiki/sources` 로 보내는 꼴이다.

```json
{
  "schema": "mxwp-source/1",
  "kind": "sim_result",
  "origin": {"system": "stcx", "ref": "<잡 id>", "rev": "1", "url": null},
  "title": "<모델> 전각도 낙하 — 힌지 브래킷 최대 응력",
  "captured_at": "2026-10-24T10:00:00+09:00",
  "owner": {"email": "<주인 이메일>"},
  "audience": ["aff:<소속 id>"],
  "sensitivity": "internal",
  "subject_hints": [
    {"type": "product-model", "name": "<모델명>", "ext": {"sp_model": "<id>"}},
    {"type": "part", "name": "힌지 브래킷", "ext": {"bom_code": "<코드>"}}
  ],
  "body": { "...": "kind 별 꼴 — 아래 표" },
  "attachments": [{"name": "fig1.png", "mime": "image/png", "upload_id": "<먼저 올린 업로드 id>"}],
  "consent": null
}
```

| kind | `body` 의 필수 칸 | 메모 |
| --- | --- | --- |
| `sim_result` | `summary` · `setup{solver, model, conditions{…}}` · `results[{name, value, unit, where?}]` · `verdict?` · `artifacts[{name, url}]` | 숫자는 늘 `{value, unit}`. 그림은 `attachments` 로 |
| `field_defect` | `form:'case'|'aggregate'` · (case) `case_ref` · `symptom` · `failure_mode?` · `cause?` · `action?` · `status` · `dates{opened, closed?}` · `model?` · `part?` · `stage?` · (aggregate) `period{from,to}` · `scope{model?, part?, region?}` · `counts[{failure_mode, count, rate?, unit}]` · 공통 `dataset{name, version}` | 사례 한 건 또는 집계 한 묶음(request §6-2). **사람 이름 · 사번 · 연락처 · 고객 · 단말 식별자는 연결기가 떼고 보낸다** — 서버도 V9 로 한 번 더 본다 |
| `qa` | `question` · `answer` · `evidence[{kind:'tool'|'doc'|'source', ref, excerpt}]` · `model` · `outcome:'solved'|'partial'|'unknown'` · `asker_note?` | 질문자 이름은 싣지 않는다(주인은 `owner` 로만) |
| `deliberation` | `question` · `decision` · `votes[{seat, stance}]` · `evidence[…]` · `minority?` · `job_id` | 버린 근거 · 소수 의견을 지우지 않는다(포털 심의 원칙) |
| `report` | `ra_report_id` · `title` · `sections[{heading, text}]` · `figures[{name, caption?, upload_id?}]` | RA 는 API 로만 읽는다 |
| `card` | `card_id` · `domain` · `title` · `claims[{text, evidence?}]` | AIDataHub 지식카드 |
| `document` | `doc_slug` · `version` | MXWP 사람 백서를 그 판으로 원천에(request §6-4) |
| `correction` | `doc_slug` · `block_id?` · `text` · `reason` | 사람이 위키 문서를 고친 것 — 다음 들이기가 따라야 하는 원천 |
| `inquiry_answer` | `question_id` · `answer` · `tool_calls[{tool, args_digest, result_excerpt}]` · `confidence`(0~1) | 지속 질의의 답 |
| `note` | `text` | 사람이 남긴 짧은 메모 |

구현 — [[src/app/wiki/envelope.py]](`docs/lat/wiki.md` §Envelope 가 정본).

규칙.
- `audience` 는 받을 때 정규화한다 — 중복 제거 · 정렬 · 다른 토큰과 함께인 `org` 는 뺀다(org ∧ X = X). 빈 목록 · 틀린 꼴 · 서로 다른
  `aff:` 둘 · `user:` 둘(만족하는 사람이 없다)은 거부.
- 서버가 `schema` · `kind` 별 꼴을 검증하고(pydantic), 모르는 칸은 거부한다(조용히 버리지 않는다).
- `audience` 는 보낸 사람이 볼 수 있는 범위보다 넓을 수 없다(`org` 는 서비스 계정 또는 관리자만, 또는 원천 시스템이 원래 전사 공개인 자료).
- 위임 호출(게이트웨이 · 포털)은 `owner.email` 이 호출자와 같아야 한다. 서비스 연결기는 원천 시스템이 준 주인을 그대로 싣는다.
- `sensitivity: restricted` 는 '주인 무리만'(문서 confidentiality 와 같은 뜻 — Q4)이라 **들이지 않는다** — 원천 문서만 남는다(WK-D37).
  범위로 거르는 자료(PLM 결함 등)는 `internal` + 범위 토큰(`plat:plmdefect`)으로 보낸다 — 보이기는 범위가 정한다.
- 첨부는 기존 업로드 파이프라인(init · put · finalize, sha256 중복 제거)으로 먼저 올리고 id 만 싣는다. 원천 블롭은 `mxwp-wiki-sources` 버킷에 따로 둔다.

## 4. 변경 묶음 연산(`ops`)

| 연산 | 인자 | 메모 |
| --- | --- | --- |
| `page.create` | `tmp` · `kind` · `title` · `slug?` · `audience` · `entity?{type_key, canonical_name, aliases, ext_ids}` · `sections[…]` | 같은 묶음 안에서 `tmp` 로 서로 가리킨다 |
| `section.add` | `doc` · `path?` · `heading` | |
| `block.insert` | `doc` · `section` · `after?` · `block` · `cites[{sid, loc, quote?}]` | `block` 은 DocumentJSON 블록(validate_block 통과) |
| `block.update` | `doc` · `block_id` · `block` · `cites[…]` | id 를 지킨다 |
| `block.delete` | `doc` · `block_id` · `why` | 근거가 달린 블록을 지우면 늘 검토 |
| `relation.add` | `subject` · `predicate` · `object` · `cites[…]` · `confidence` | `doc_triples` 확장 칸 |
| `relation.retire` | `triple_id` · `why` · `cites[…]` | 지우지 않고 `retired` |
| `entity.create` · `entity.alias` | | 유형이 `approved` 여야 한다 |
| `entity.merge` | `from` · `into` | 늘 검토 |
| `term.propose` | `term` · `definition` · `domain` | 기존 용어집 제안 길(propose → admin approve) |
| `question.add` | `text` · `about[…]` · `priority` | |
| `page.stale` | `doc` · `why` | |

연산마다 `why`(한 줄)를 단다 — 검토 화면이 그대로 보여 준다. 문서는 slug 또는 `tmp` 로 가리킨다.

## 5. 검증 규칙(코드가 판정한다 — 모델에게 묻지 않는다)

| 열쇠 | 무엇을 | 걸리면 |
| --- | --- | --- |
| V1 schema | 블록이 DocumentJSON 에 맞나(validate_block) · 문서 크기 상한 | 실패 |
| V2 cited | 사실을 담는 블록(paragraph · list · table · kpi-cards · chart · callout · timeline …)에 근거가 하나 이상인가. 제목 · 여백 · 목차는 면제 | 실패 |
| V3 numbers | 새 글의 숫자(+ 단위)가 인용한 원천 `payload` 에 있나 — 단위 정규화 · 반올림 허용 오차. 계산한 수는 블록에 `계산:` 표시와 식을 달아야 통과 | 실패 |
| V4 audience | 문서 범위가 인용한 원천들의 범위 토큰을 모두 담나(§2-11 — 그리고 조건) · 만족하는 사람이 있는 범위인가 | 실패(사람에게 넘김) |
| V5 locked | `BlockMeta.locked` · `managed='human'` · `review_lock` 대상을 건드리나 | 검토 큐 |
| V6 scope | 계획에 없던 문서를 건드리나 · 근거 달린 블록을 지우나 · 묶음 크기(문서 ≤ 12 · 블록 ≤ 80 — 규칙서 값) | 검토 큐 |
| V7 ontology | 술어 · 유형이 `approved` 인가 · 정의역 · 치역이 맞나 | 실패(제안이면 `term.propose` 처럼 제안 큐로) |
| V8 links | `[[slug]]` 가 있는 문서이거나 같은 묶음에서 생기나 | 실패 |
| V9 privacy | 문답 · 심의 원천에서 온 글에 이메일 · 전화 · 사번 꼴이 있나 | 가려서 통과 + 경고 |
| V10 quote | 근거 인용이 300자를 넘나 · 원천 본문을 통째 옮기나 | 실패 |
| V11 style | 규칙서의 말투 · 단위(SI) · 날짜(KST) | 경고만 |

자동 반영 조건(규칙서 `policy.auto_apply` 기본값) — V1~V10 이 모두 `pass`(V9 는 가림 뒤 `warn` 허용) **이고** 대상이 모두 `managed='ai'` ·
`review_lock=false` **이고** 지우는 연산이 없을 때. 하나라도 어긋나면 `pending_review`.

구현(W4)에서 정한 것 — `docs/lat/wiki.md` §Validation 이 정본. V4 는 `failed`(그대로 승인하면 좁은 사실이 넓은 문서로 샌다 — 사람은 실패
목록에서 본다) · V3 은 원천 제목의 숫자도 원천 값으로 본다 · V8 은 더 좁은 문서로의 링크도 막는다 · V9 는 모든 원천에 · fail 이 있는 묶음은
승인하지 않는다(거절하고 다시 들인다) · 계획 밖 문서의 연산은 승인해도 반영하지 않는다.

## 6. REST(`/api/v1/wiki`)

| 메서드 · 경로 | 권한 | 무엇 |
| --- | --- | --- |
| `POST /sources` | editor(위임 · 토큰) | 봉투 받기 → 201 `{id, dedup:false}` / 200 `{id, dedup:true}` · 들이기 작업을 줄 세운다(`?ingest=0` 이면 안 함) |
| `GET /sources` · `GET /sources/{id}` | reader + 범위 | 목록(종류 · 시스템 · 상태 · 기간) · 한 건(+ 이 원천을 인용한 문서들) |
| `POST /sources/{id}/withdraw` | 주인 · admin | 철회 |
| `POST /ingest` | editor | `{source_ids}` 다시 들이기 |
| `POST /query` | reader | SSE — 위키로 답한다(request §5-7). 프레임은 챗과 같은 `tool_call` · `tool_result` · `token` · `error` · `done` + `citation` |
| `POST /fileback` | reader | `{question, answer, citations, outcome}` → `qa` 원천 + 들이기 |
| `GET /changes` · `GET /changes/{id}` | 범위 안의 검토자 | 검토 큐 · 한 건(문서별 블록 diff · 검증 결과 · `why`) |
| `POST /changes/{id}/approve` · `/reject` · `/revert` | 검토자 · admin | |
| `GET /entities` · `GET /entities/{id}` · `POST /entities/resolve` | reader + 범위 | 이름 → 후보(정확 · 별칭 · 외부 id · 검색 순) |
| `GET /ontology` · `POST /ontology/{types|predicates}` · `POST …/{key}/approve` | 제안 editor · 승인 admin | |
| `GET /questions` · `POST /questions` · `PATCH /questions/{id}` | reader · editor | |
| `POST /lint` · `GET /lint/findings` · `POST /lint/findings/{id}/dismiss` | admin · 검토자 | |
| `GET /log` · `GET /log.md` | reader + 범위 | `log.md` 는 Karpathy 꼴 그대로(§10) — `grep "^## \["` 가 된다 |
| `GET /index` · `GET /index.md` | reader + 범위 | 목록(§10) |
| `GET /schema` · `PUT /schema` | reader · admin | 규칙서(판 올림) |
| `POST /pages/{slug}/audience` · `/lock` | 주인 · 검토자 | 넓히기 · 잠금 |
| `GET /health` | 없음(내부) | 큐 길이 · 가장 오래 기다린 작업 · 최근 실패 · 마지막 점검 · LLM 닿음 — 포털 상태판이 읽는다 |

모든 읽기는 §2-11 범위로 거른다 — 목록 · 검색 · 그래프 · 내보내기를 포함해서(request §5-12 의 전수 목록).

지은 것(W3 · W4) — `/sources` · `/sources/{id}` · `/sources/{id}/withdraw` · `/ingest` · `/changes` · `/changes/{id}` · `/approve` ·
`/reject` · `/revert` · `/log` · `/log.md` · `/index` · `/index.md` · `/schema`(GET · PUT) · `/health`, 그리고 `GET /api/v1/documents/{slug}?with=citations`. 꼴은 `docs/lat/wiki.md`
§REST 가 정본. 검토자 표지는 `users.wiki_reviewer`(0055 — 관리자 `PATCH /api/v1/admin/users/{id}`).

## 7. MCP 도구(`dist/llm-docx-toolkit/mcp/server.py` 에 더한다)

게이트웨이는 한 이름 공간에 300개가 넘는 도구를 모은다 — **`wiki_` 접두**로 겹침을 피하고, 붙인 뒤 게이트웨이 `tools/list` 로 확인한다
(이름이 다른 앱과 헷갈린 선례 — d723105 `get_section`).

| 도구 | 읽기/쓰기 | 인자 → 돌려줌 |
| --- | --- | --- |
| `wiki_index` | 읽기 | `domain?` · `kind?` · `page?` → 목록 마크다운(한 줄 요약) |
| `wiki_search` | 읽기 | `query` · `kinds?` · `entity_types?` · `limit` → 문서 · 엔티티 후보 |
| `wiki_read` | 읽기 | `slug` · `with_citations=true` → 절 · 블록 + 블록별 근거(원천 id · 위치 · 인용) |
| `wiki_source` | 읽기 | `id` → 원천 본문(범위 안일 때만) |
| `wiki_entity` | 읽기 | `name` 또는 `id` · `type?` → 엔티티 · 별칭 · 외부 id · 문서 slug · 관계(깊이 1) |
| `wiki_graph` | 읽기 | `slug` · `depth≤2` · `predicates?` → 노드 · 엣지 |
| `wiki_ask` | 읽기 | `question` → 위키로 지은 답 + 근거(서버의 묻기 연산 — request §5-7). 답이 없으면 그렇다고 말하고 `question_id` 를 준다 |
| `wiki_log` · `wiki_lint_report` · `wiki_questions` | 읽기 | 꼬리 N줄 · 최근 점검 요약 · 열린 질문 |
| `wiki_submit_source` | 쓰기 | 봉투(§3) → 원천 id |
| `wiki_fileback` | 쓰기 | `question` · `answer` · `citations` · `outcome` → 원천 id |
| `wiki_propose` | 쓰기 | 연산 목록(§4) → 변경 묶음 id — **바깥 에이전트(Claude Code 등)의 쓰기는 늘 검토 큐**로 |
| `wiki_add_question` | 쓰기 | `text` · `about?` → 질문 id |

기존 쓰기 도구(`create_document` · `insert_block` …)는 위키 문서(`wiki_pages` 가 있는 문서)를 고치지 못하게 막는다 — 위키 문서의 쓰기는
`wiki_propose` 하나로 모은다(검증 · 근거 · 기록을 우회하는 길을 남기지 않는다). `mxwp_system_prompt` 프롬프트에 위키 규칙 요약을 더한다.

## 8. 작업 · 예산

- 워커는 API 와 **다른 프로세스**다(api.sif 위에 시작 스크립트만 다른 `wiki.sif` · 인스턴스 `mxwp_wiki` · `python -m app.wiki.worker`)
  — API 재기동이 들이기를 끊지 않고, 긴 LLM 호출이 API 이벤트 루프를
  붙잡지 않는다. 여럿이 떠도 `SKIP LOCKED` 로 안전하다(지금은 하나).
- 예산은 규칙서 `budget` — 하루 토큰 상한 · 작업당 상한(들이기 기본 6만 · 점검 20만) · LLM 동시 수(기본 1) · 조용한 시간(배경 작업은 그때만).
  넘치면 작업을 `held` 로 두고 기록에 남긴다(조용히 버리지 않는다).
- 사람이 기다리는 `query` 는 예산 밖 · 우선순위 맨 앞. 배경 작업은 그것을 밀어내지 않는다.

## 9. 신원(포털 연결 — request §4)

| 길 | 받는 것 | MXWP 가 하는 것 |
| --- | --- | --- |
| 브라우저 타일 | 포털 진입 토큰(RS256 · 90초 · `scope=launch`) — `sub` · `email` · `name` · `groups` · **`affiliation`**. `groups` 에는 AD 그룹과 함께 포털이 그 진입 순간 원장으로 센 합성 그룹(`feat:…` · `plat:…`, 관리자면 `portal-admin`)이 **원래 실린다**(HWAXPortal `deps.entitled`). `affiliation`(소속 id)은 포털 10-24 구현 — 이 시스템(`claims_affiliation: true`)에만, 값이 있고 권한표에 있는 소속일 때만 실리고 아니면 **칸이 없다**(HWAXPortal `backend/app/auth/routes/launch.py` · `tests/test_launch_affiliation_claim.py`) | 지금의 `portal-callback` 그대로 + `affiliation` → `users.portal_affiliation`(칸이 없으면 NULL), `groups` 의 `plat:` 항목 → `users.portal_plat`, `wiki_aff_team_map` 으로 첫 팀. 진입 토큰은 포털 키로 서명돼 있으니 그대로 믿는다 |
| 게이트웨이 위임(새로) | `POST /api/v1/auth/sso` — `X-Heax-Gateway-Secret` · `X-Heax-User-Email` · `X-Heax-User-Name`(퍼센트 인코딩) · `X-Heax-Client`(`gateway` · `hwax-portal`) | 그 사람 토큰 발급 — 200 `{access_token, token_type:"bearer", expires_in}`(12시간 이상) · 비밀이 비면 **404** · 틀리면 401 · 비활성 403 · 이메일 없음 400. 클라이언트마다 따로 발급(서로 회수하지 않게). **구현(10-24)** — 봉투 `data` 안 · JWT `typ=delegated`(`sub` · `cli` · `gen` · `eml` · `sk` · `scope [read, write]` · 12시간) · `X-Hwax-Delegate-Email` 이 먼저 · 세대는 `sso_delegations` 이고 발급은 아무것도 회수하지 않는다 · 회수는 관리자 `POST /api/v1/admin/sso-delegations/{user_id}/revoke` |
| 위임 토큰으로 온 호출 | `Authorization: Bearer <위 토큰>` + `X-Heax-User-Affiliation`(퍼센트 인코딩) + `X-Heax-Aff-Proof`(`v1.<exp>.<hmac>`) — **지금 게이트웨이가 이미 싣는다** | 증명 검증 — HMAC-SHA256(같은 비밀, `v1|<email>|<소속>|<exp>`) · 만료 전 · 토큰 주인 이메일과 같을 때만 소속을 믿는다. 평문 헤더만이면 무시. 그 호출에만 쓰고 저장하지 않는다(§2-10). 위임으로 온 호출은 admin 역할을 owner 로 낮추고 `/me/api-tokens` · `/me/2fa` 를 막는다 |
| 플랫폼 권한(게이트웨이 — 10-24 구현, HWAXMcpGateway `_plat_proof`) | `X-Heax-User-Plat` — `plat:` 항목만 정렬해 쉼표로 이은 값을 퍼센트 인코딩(`quote(…, safe=",:")`) · `X-Heax-Plat-Proof` — `v1.<exp>.<hmac>`, 서명 대상은 **인코딩 전** `v1|<email>|<정렬해 쉼표로 이은 목록>|<exp>`(HMAC-SHA256, 같은 위임 비밀, 유효 120초 — `GATEWAY_AFF_PROOF_TTL`). 박스 설정 `MXWP_SEND_PLAT=1`(게이트웨이 provision.env)로 켠 앱에만 싣고, 목록이 비면 두 헤더가 없다 | 소속 증명과 같은 규칙 — unquote → 쉼표로 나눔 → 정렬해 다시 이음 → 같은 문자열로 HMAC → `compare_digest` · 만료 전 · 토큰 주인 이메일과 같을 때만 믿는다. 헤더가 없으면 그 호출에서 `plat:` 범위는 없는 것으로(닫힌 쪽) |

## 10. 목록(index) · 기록(log) 꼴

Karpathy 원문의 두 파일을 그대로 따른다 — 사람과 LLM 이 **먼저 읽는 곳**이다.

**`index.md`**(`GET /api/v1/wiki/index.md` · 위키 문서 `wiki-index` 로도 둔다 — 변경 묶음이 반영될 때마다 다시 짓는다)

```markdown
# 위키 목록 (규칙서 v3 · 2026-10-24 09:12 KST · 문서 412 · 원천 1,903)

## 불량 유형(failure-mode) — 37
- [[ent-fm-display-crack|디스플레이 깨짐]] — 낙하 모서리 충격에서 시작, 시장 3개 모델 · 해석 재현 5건
- …

## 해석 사례(case) — 120
- …
```

- 갈래는 규칙서의 문서 종류 · 엔티티 유형 순서. 한 줄 = 링크 + 한 줄 요약(문서의 `summary`).
- 범위가 다른 사람은 **다른 목록**을 본다(서버가 사람의 토큰으로 거른 뒤 짓는다 — 저장해 둔 `wiki-index` 문서는 `org` 범위만 담는다).
- 커지면 갈래별 하위 목록(`index/<유형>.md`)으로 나누고 맨 위 목록에는 갈래별 수와 상위 20개만 둔다(규칙서 `index.max_per_section`).

**`log.md`**(`GET /api/v1/wiki/log.md?since=`) — 덧붙이기만, 한 작업 = 한 덩이.

```markdown
## [2026-10-24 09:12] ingest | <모델> 전각도 낙하 — 힌지 브래킷 (src_1a2b3c4d)
- 변경 cs_9f8e7d6c · 자동 반영 · 문서 4(새 1) · 관계 3 · 질문 1 · 토큰 18,402
## [2026-10-24 09:40] query | 힌지 브래킷 낙하 균열은 어디서 시작하나
- 답 근거 문서 3 · 원천 5 · 되쌓기 요청 없음
## [2026-10-25 02:00] lint | full
- 모순 2 · 낡음 5 · 고아 3 · 빠진 문서 4 · 빈틈 7 → 질문 6 · 자동 고침 3(링크)
```

- 머리 꼴 `## [YYYY-MM-DD HH:MM] <op> | <제목>` 은 바꾸지 않는다(`grep "^## \[" log.md | tail -5` 가 되게 — 원문의 약속).
- 범위 밖 작업은 줄 자체가 안 보인다(제목에도 범위 밖 내용이 들 수 있다).

## 11. 꺼짐 · 실패의 모양

- `WIKI_ENABLED=0`(기본 — 켜기 전까지) — `/api/v1/wiki/*` 는 404, MCP `wiki_*` 는 "위키가 꺼져 있다" 오류(빈 결과로 위장하지 않는다).
- LLM 이 안 닿으면 — 들이기는 `queued` 로 남고 `/wiki/health` 가 `llm: unreachable` 을 낸다. **mock 으로 대신 쓰지 않는다**(챗의 mock 폴백을 위키
  쓰기에 쓰면 지어낸 문서가 근거를 단 채 쌓인다). 시험만 가짜 서버를 쓴다.
- 구조화 출력이 틀리면 — 한 번 다시 묻고, 또 틀리면 작업 `failed` + 까닭(무슨 칸이 어떻게 틀렸나). 반쯤 맞은 출력을 고쳐 쓰지 않는다.
- 반영 중 버전 충돌(412) — 그 문서만 다시 읽어 그 문서의 연산을 다시 짓는다(1회). 또 충돌하면 `pending_review`.
