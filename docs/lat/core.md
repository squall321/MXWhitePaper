# Core lat — auth / errors / config / db (모두가 의존하는 기반)

> 라우터 / 서비스 / 리포지토리 어디서나 import 되는 작은 모듈들. 코드량은
> 작지만 한 줄 잘못 만지면 모든 엔드포인트가 깨지는 곳.
>
> 연관 lat: [[documents]], [[imports]], [[export]], [[storage]], [[snapshots]] — 전부

## 모듈

| 모듈 | 책임 |
|---|---|
| [[src/app/core/auth.py]] | 현재 사용자 해소, role-based dependency, API token 인증 |
| [[src/app/core/errors.py]] | APIError 계층, JSON envelope, FastAPI 핸들러 |
| [[src/app/core/config.py]] | pydantic-settings 기반 환경변수, `get_settings()` |
| [[src/app/core/db.py]] | SQLAlchemy async engine + session, `get_db()` |
| [[src/app/core/security.py]] | JWT 발급/검증, argon2 패스워드 해시 |

## 1. Auth — 인증 + 권한

### Role 계층

```text
reader < editor < owner < admin
```

| Dependency | 허용 role | 사용처 |
|---|---|---|
| `require_reader` | reader, editor, owner, admin | 조회 |
| `require_editor` | editor, owner, admin | 본문 변경 |
| `require_admin` | admin | 사용자/시스템 |

`require_role(*roles)` ([[src/app/core/auth.py#require_role]]) 가 위 세 dependency
의 팩토리. 새 권한 만들 때 직접 호출.

역할 밖 표지 — `users.wiki_reviewer`(0055 · 위키 검토 큐를 보고 승인 · 거절 · 되돌린다, 사용자 결정 Q7). admin 은 표지 없이도
검토자다. 관리자가 `PATCH /api/v1/admin/users/{id}` 의 `wiki_reviewer` 로 켠다([[wiki#Review]]).

### 현재 사용자 해소

`get_current_user()` ([[src/app/core/auth.py#get_current_user]]) 는 dependency
chain 의 최상위. 우선순위:

1. **API token** (`Authorization: Bearer mxwp_…`) → `_resolve_api_token()` →
   사용자 + scopes 반환. 스코프가 verb 와 안 맞으면 `ScopeInsufficient` (403).
2. **JWT** (`Authorization: Bearer <jwt>`) → `security.decode_jwt()` → user id →
   `_fetch_user_by_id()`. `typ=delegated`(게이트웨이 · 포털 위임 토큰 — [[#게이트웨이 · 포털 위임]])이면
   `_resolve_delegated()` 로 간다 — 세대 · 비밀 지문 대조, 범위 read + write, admin → owner, 소속 · 플랫폼은 그 호출의 증명으로.
3. **개발 환경 폴백** — 미인증이면 `_fetch_admin()` 으로 첫 admin 반환. `app_env=development`
   **와** `ALLOW_DEV_ADMIN_FALLBACK=1` 이 둘 다일 때만 열린다 — 스위치 기본은 꺼짐(`b5b199c`, 예제
   `.env` 를 복사한 운영 박스가 인증 없이 뜨던 것을 막음). 시험은 conftest 가 시험 프로세스에서만 켠다.

> `X-MXWP-User` 헤더는 `get_current_user` 의 우선순위에는 포함되지 않는다.
> 일부 라우터 (예: bulk import) 가 author override 용으로 *직접* 읽어
> request.headers 에서 사용자를 바꿔치는 별도 helper — 인증이 아니라 작성자
> 표기다.

`get_current_user` 는 해소한 사람을 이 요청의 '읽는 사람'(보이기 범위 문맥 — [[wiki#Audience]])으로도 둔다.
기계 호출(API 토큰 · 위임 — `auth_via` 가 `api_token` · `delegated:*`)이 문서 내용을 바꾸는 길(`PUT · DELETE /documents/{slug}` · 판 복원 ·
제목 · 정보 상자 · 변수 · CSS · 절 · 블록 · 절 순서 · 상태 전이)로 **위키 문서**를 고치려 하면 409 `WIKI_USE_PROPOSE` — 위키 문서의 쓰기는
`POST /wiki/propose` 하나로([[src/app/core/auth.py#_guard_wiki_writes]], [[wiki#Propose]]). 사람의 웹 세션 · 위키 반영(시스템)은 그대로.

dict 형태: `{id, email, role, ..., portal_affiliation, portal_plat, portal_access_at}` — `portal_*` 는 포털 진입 토큰이
남긴 스냅숏(users 칸)이고, 위임 호출이면 그 호출의 증명값으로 바뀌며 `auth_via: "delegated:<client>"` 가 붙는다.
API 토큰 호출에는 `auth_via: "api_token"` 이 붙는다(위키 원천의 `via` 가 이것으로 가른다 — [[wiki#Intake]]).

### API token

`api_tokens` 테이블에 `token_hash` (argon2), `scopes` (JSON), `expires_at`.
평문 토큰은 발급 시점에만 노출. 검증:

1. `token_prefix` (앞 8자, `_API_TOKEN_PREFIX_LEN = 8`) 로 후보 row 선별
2. argon2.verify(평문, hash) 로 매치 확인
3. `last_used_at = NOW()` 업데이트 (비동기)
4. scopes 배열 caller 에 반환

scopes 와 endpoint 의 매핑은 [[src/app/services/api_token_scopes.py#required_scope_for]].

## 2. Errors — 응답 envelope

모든 API 응답은 동일한 envelope:

```json
{
  "data":  { … } | null,
  "meta":  { … } | null,
  "error": null | { "code": "...", "http_status": 422, "message": "...", "details": { … } }
}
```

### APIError 계층

[[src/app/core/errors.py]]:

| 클래스 | http_status | 사용처 |
|---|---|---|
| `ValidationFailed` | 422 | 입력 검증 실패 |
| `Unauthorized` | 401 | 토큰 없음/만료 |
| `Forbidden` | 403 | role/scope 부족 |
| `NotFound` | 404 | 리소스 없음 |
| `Conflict` | 409 | unique violation, ETag mismatch 가 아닌 경우 |
| `PreconditionFailed` | 412 | If-Match ETag mismatch |
| `Gone` | 410 | soft-deleted 리소스 |

새 에러 추가 시:
1. `APIError` 상속 + `code`, `http_status`, `message` 클래스 attr 정의
2. 라우터에서 `raise MyError(details={...})`
3. 핸들러는 자동 — `api_error_handler` 가 envelope 으로 직렬화

### `envelope()` 유틸

응답을 직접 빌드할 때:
```python
return envelope(data={...}, meta={"page": 1})
```

### FastAPI 핸들러 두 개

- `api_error_handler` — `APIError` 계층
- `validation_error_handler` — pydantic `RequestValidationError` →
  `format_pydantic_errors()` 로 친화적 메시지화

[[src/app/main.py]] 의 lifespan 에서 `app.add_exception_handler()` 로 등록.

## 3. Config — pydantic-settings

[[src/app/core/config.py#Settings]]. `.env` 자동 로드 (`env_file=".env"`).
`get_settings()` 은 `@lru_cache` — **앱 시작 시 한 번 평가됨**.

### 주요 키 (자주 보는 것만)

| 카테고리 | 키 | 기본 |
|---|---|---|
| App | `app_env` | `development` |
| | `log_level` | `info` |
| DB | `database_url` | dev placeholder (asyncpg) |
| Meili | `meili_host` | `http://meilisearch:7700` |
| | `meili_master_key` | dev placeholder |
| | `meili_index_prefix` | `""` — 색인 이름 접두(`documents` · `knowledge`). 시험은 `test_` |
| MinIO | `minio_endpoint` | `http://minio:9000` |
| | `minio_public_endpoint` | `http://localhost:9000` |
| | `minio_access_key` / `_secret_key` | dev placeholder |
| | `minio_bucket_images` / `_files` / `_backups` / `_exports` / `_wiki_sources` | `mxwp-…` |
| JWT | `jwt_secret` | dev placeholder |
| | `jwt_access_ttl_seconds` | 3600 |
| | `jwt_refresh_ttl_seconds` | 604800 |
| CORS | `cors_origins` | `http://localhost:5173,http://localhost:80` |
| Limits | `image_max_bytes` | 20 MB |
| | `gallery_max_bytes` | 100 MB |
| | `file_max_bytes` | 25 MB |
| | `rate_limit_per_minute` | 120 |
| Imports | `docx_import_max_bytes` | 30 MB |
| | `pptx_import_max_bytes` | 50 MB |
| | `csv_import_max_bytes` | 5 MB |
| | `csv_import_max_rows` | 500 |
| | `import_rate_limit_per_minute` | 5 |
| | `import_default_division` | `MX` |
| | `import_default_confidentiality` | `internal` |
| AI | `ai_enabled` | `False` |
| 위임 | `mxwp_sso_secret` | `""` — 비면 `/auth/sso` 404 · 위임 토큰 거부 · 소속 증명 무시 |
| | `mxwp_sso_jit_create` | `True` — 끄면 위임으로 처음 보는 사람은 403 |
| 위키 | `wiki_enabled` · `wiki_llm_*`(구조화 출력 꼴 `wiki_llm_structured` 포함) · `wiki_query_llm_*` | 끔 · 빈 값 · json_schema — [[wiki]] |
| Backup | `backup_enabled` | `True` |
| Subscription | `subscription_digest_enabled` | `True` |

### 권장 패턴

```python
# ✅ 매 호출시 lookup — env 가 바뀌면 reload 안 되지만, 단일 키는 lazy
def _docx_max_bytes() -> int:
    return get_settings().docx_import_max_bytes

# ❌ 모듈 상수로 박지 말 것 — test 에서 monkeypatch 어려움
MAX = get_settings().docx_import_max_bytes
```

## 4. DB — async SQLAlchemy

[[src/app/core/db.py]] 최소 구성:

- `_engine` — 모듈 레벨 캐시
- `make_engine()` — settings 의 `database_url` 로 `create_async_engine`
- `engine()` — 캐시 + lazy 생성
- `session_factory()` — `async_sessionmaker`
- `session_scope()` — async context manager
- `get_db()` — FastAPI dependency. 라우터에서 `s: AsyncSession = Depends(get_db)`

테스트는 매 함수마다 engine 을 재생성한다 ([[src/tests/conftest.py]] 의
`_reset_engine_per_test`) — asyncpg 의 event-loop affinity 때문. 같은 conftest 가 dev admin 폴백
(`ALLOW_DEV_ADMIN_FALLBACK=1`)을 시험 프로세스에서만 켠다 — 시험 대부분이 토큰 없이 부른다(`051acc3`).
운영 코드는 신경 쓸 필요 없음.

## 5. Security — JWT + 패스워드

[[src/app/core/security.py]]:

- `hash_password(plain)` / `verify_password(plain, hash)` — argon2
- `make_access_token(sub, extra=None)` — JWT (`sub` = user id 문자열)
- `make_refresh_token(sub)` — 별도 TTL
- `decode_token(token)` — 검증 + payload 반환, 실패 시 raise

JWT payload: `{sub: user_id, role: …, exp, iat}`. 변경 시 FE 인증 코드
([[apps/web/src/features/auth]]) 의 디코드도 같이 확인.

## 6. Signup — 자가 가입 + 조직 등록

`POST /api/v1/auth/signup` 으로 외부 사용자가 직접 계정을 만든다. 사내망
가정으로 즉시 활성화, role 은 `reader`. 라우터는 [[src/app/routers/auth.py#signup]]
이 진입점이고 모든 검증 로직은 [[src/app/services/signup_service.py#create_user_account]]
에 모여 있다 (라우터 = 얇은 어댑터, service = 단일 진실원).

### 가입 endpoint

| Method | Path | 인증 | 비고 |
|---|---|---|---|
| POST | `/api/v1/auth/signup` | 없음 (public) | body: email/name/password/team_id/group_id?, 분당 5회/IP rate-limit |

검증 순서 (실패 시 즉시 422 / 409):

1. email regex, 도메인 화이트리스트 (`SIGNUP_ALLOWED_EMAIL_DOMAINS` env, 비면 allow-all)
2. 비밀번호: 12자+ / 영문 / 숫자 / 특수 각 1자 이상
3. email UNIQUE collision → 409 (SSO 우선 머지 정책: 자체 가입은 거부, SSO 로 유도)
4. team_id 존재 + group_id ⊆ team_id

성공 시 `users` INSERT + `audit_logs` (`action='user_signup'`) 한 트랜잭션.

### 로그인이 쓰는 audit actions (G1)

`/auth/login` 과 `/auth/login/totp` 도 `audit_logs` 에 행을 남긴다
([[src/app/routers/auth.py#_write_auth_audit]]):

| action | 트리거 | user_id | payload |
|---|---|---|---|
| `auth.login` | 패스워드 로그인 성공 (2FA 없음) | 본인 | `{method:"password", email}` |
| `auth.login.totp` | 2FA exchange 성공 | 본인 | `{method:"totp", email}` |
| `auth.login.failed` | 패스워드 불일치 / unknown email / inactive / 잘못된 TOTP | 알려진 user 면 본인, 모르면 `NULL` | `{email?, method?, reason}` (절대 평문 password 안 넣음) |

`target` 은 `user:<uuid>` (이메일이 미매칭이면 `email:<addr>`). `ip` 는
`Request.client.host`. audit write 는 try/except 로 감싸지 않음 — DB 가 깨지면
로그인이 실패하는 게 맞다 (조용한 audit 손실 금지).

### 조직 셀렉터 (가입 폼이 채우는 cascading dropdown)

이미 존재하는 `routers/orgs.py` 가 그대로 쓰임:

| Method | Path | 인증 | 비고 |
|---|---|---|---|
| GET | `/api/v1/divisions` | 없음 | 모든 division |
| GET | `/api/v1/teams?division=<slug>` | 없음 | division 산하 teams |
| GET | `/api/v1/groups?division=<slug>&team=<slug>` | 없음 | team 산하 groups (kind 포함) |
| POST | `/api/v1/divisions`, `/teams`, `/groups` | admin | 조직 등록 — body 의 `kind ∈ {'group','lab'}` |

`groups.kind` 컬럼은 0045 마이그레이션이 추가. `'lab'` 은 공식적으로 팀 직속
인 단위로, `'group'` 과 같은 테이블에서 살림. UI 는 kind 로 필터/그룹핑 자유.

### 부트스트랩 첫 admin

production 환경에서 dev fallback `_fetch_admin()` 없이 첫 admin 을 만들려면:

```bash
apptainer exec instance://mxwp_api bash -lc '
  cd /workspace/apps/api &&
  BOOTSTRAP_ADMIN_EMAIL=admin@samsung.com \
  BOOTSTRAP_ADMIN_PASSWORD=Init!Setup2026 \
  python3 -m app.scripts.bootstrap_admin
'
```

스크립트 ([[src/app/scripts/bootstrap_admin.py]]) 는 idempotent — 이미 active
admin 이 1명 이상이면 skip + exit 0.

### SSO 호환

본 사이클은 [[src/app/routers/sso.py]] 를 변경하지 않는다. 자체 가입 시 email
collision 을 일찍 거부 (alternative 정책) 함으로써 SSO 머지 시점의 복잡성을
피한다. 자체가입 후 같은 email 로 SSO 시도 → SSO 라우터의 기존 collision
핸들링이 처리.

### HWAX Portal SSO (true SSO callback)

★ `a397a02` (Opus 4.8) 에서 추가, `c82c407` 후속 cycle 에서 4xx→500 cascade
bug fix. [[src/app/routers/portal_sso.py]] 가 `POST /api/v1/auth/portal-callback`
하나로 진정한 SSO 를 제공:

- HWAX portal 이 RS256 launch JWT (aud, scope=launch, exp, jti) mint → 사용자가
  portal 의 MXWP 타일 클릭 시 자동 POST.
- 서버: JWKS fetch (5min 캐시, `portal_jwks_url` 기반) → RS256 verify → aud /
  scope / jti 검사 → 사용자 upsert by email (없으면 자동 생성, `portal_sso_
  default_role` 기본 'editor') → refresh cookie set → 303 redirect to
  `portal_sso_landing` (기본 `/mx-white-paper/`).
- SPA bootstrap 이 `/auth/refresh` 로 access token 발급 → no 2nd login.

Disabled by default: `portal_jwks_url` 빈 문자열이면 endpoint 가 **404
sso_disabled** 반환 (standalone 안전성). REFRESH_COOKIE_PATH 가 settings 로
빠짐 — portal sub-path 뒤에서는 `.env` 에 `REFRESH_COOKIE_PATH=/` 설정 필수
(기본 `/api/v1/auth` 은 standalone 전용).

**APIError 패턴 함정**: portal_sso 의 7 분기 (`bad_token` / `no_key` /
`invalid_token` / `wrong_scope` / `replay` / `no_team` / `sso_disabled`) 가
한때 `APIError(status_code=..., code=..., message=...)` 로 작성되어 모두 500
TypeError 로 떨어졌음. 정정 후 각 분기마다 dedicated subclass + class
attribute (`http_status`/`code`) 패턴 적용 — 다른 라우터들의 `*ValidationError`
와 동일 컨벤션. 신규 SSO 라우터 추가 시 *반드시* 이 패턴 따를 것.

**jose require 함정**: `jwt.decode(options={"require": [...]})` 는 PyJWT 꼴이라 python-jose 가
말없이 버린다 — aud 없는 토큰이 청중 확인을 건너뛰고 jti · exp 가 없으면 아래 replay guard 에서
KeyError 500 이었다. 필수 클레임은 `require_exp` · `require_aud` · `require_sub` · `require_jti` 를
칸마다 준다(`c164dda`).

Replay guard 는 DB 표 `portal_launch_jti`(C6, `0050`) — `_claim_jti` 가 `INSERT … ON CONFLICT DO NOTHING` 으로 jti 를 한 번만
쓴다(지난 줄은 그때 지운다). 프로세스 메모리였을 때는 worker 가 둘이면 같은 토큰을 한 번씩 받았다. `_verify_portal_token` 은 서명 ·
클레임만 보고 jti 는 쓰지 않는다.

**포털 스냅숏(C4 · C5)** — 진입 토큰의 `affiliation` 클레임(없으면 칸이 없다) · `groups` 의 `plat:` 항목을 들어올 때마다
`users.portal_affiliation` · `portal_plat` · `portal_access_at` 에 **덮어쓴다**(`claims_portal_access` — 클레임이 없으면 NULL, plat 이 없으면
빈 배열 = '없음을 안다'). 처음 들어온 사람의 팀은 `wiki_aff_team_map`(관리자가 채운다)이 정하고 없으면 지금처럼 첫 팀.

**진입마다 소속 → 팀(10-25)** — 이미 있는 사람도 진입 때마다 표에 있으면 그 팀으로 옮긴다(`_sync_team` — 다른 팀의 그룹은 비우고 감사
`auth.portal.team_sync`). 표에 없는 소속 · 소속 없음이면 팀을 그대로 둔다. 팀은 문서 권한을 가르지 않는다(역할 · 범위가 가른다) — 팀
공유 스니펫 · 템플릿 · 홈 기본값만 따라 바뀐다.

### SSO 전용 — 사람은 포털로만(사용자 결정 10-25)

[[src/app/core/sso_only.py]] · 설정 `MXWP_SSO_ONLY`(기본 꺼짐) · `MXWP_LOCAL_LOGIN_ALLOW`(비상 관리자, 쉼표 이메일 · 대소문자 무시) ·
`PORTAL_LAUNCH_URL`(기본 `/launch/mx-white-paper`). 켜지면 —

| 길 | 어떻게 |
| --- | --- |
| 가입 · 등록 | 늘 403 `SSO_ONLY`(비상 관리자도) — `details.launch_url` |
| 비밀번호 로그인 · TOTP · 비밀번호 찾기 · 재설정 · 이메일 인증 | 비상 관리자만 — 나머지는 403. 로그인은 **비밀번호를 보기 전에** 막는다(뒤에 막으면 막힌 사람에게 비밀번호가 맞았는지 알려 준다). 토큰 길(재설정 · 인증)은 토큰을 쓴 뒤 주인을 보고 막는다 — 막힌 사람의 토큰은 어차피 쓸모없다 |
| refresh | 포털 사진(`portal_access_at`)이 24시간(`ACCESS_MAX_AGE_H`) 안일 때만 — 낡거나 없으면 401 `PORTAL_REENTRY`(비상 관리자 빼고). 켜기 전에 비밀번호로 연 7일 세션도 여기서 끝난다 |
| 포털 진입 세션 | refresh 수명 = min(`jwt_refresh_ttl`, 24시간) — 쿠키 Max-Age 도 같다 |
| `GET /api/v1/auth/mode` | 공개 — `{sso_only, launch_url}`(포털 SSO 가 꺼져 있으면 `launch_url` 은 null). 화면이 로그인 꼴을 고른다 |
| API 토큰 · 위임 | 그대로 — 사람 웹 로그인만 바뀐다 |

켜기 전 목록 — `python -m app.scripts.sso_only_check`(컨테이너 안, 읽기만): 살아 있고 포털로 들어온 적 없는 사람 계정(서비스 계정 뺌 ·
비상 관리자 표시). 켜면 그 계정은 웹으로 못 들어온다 — 같은 이메일로 포털에서 들어오면 그 계정에 이어진다. `.env` 는 리포 밖이라 배포가
저절로 켜지 않는다 — 박스마다 사람이 목록을 보고 켠다. 시험 [[apps/api/tests/test_sso_only.py]].

테스트 [[apps/api/tests/test_portal_sso.py]] — disabled 404 + malformed 401 +
no_key 401 + happy 303(+ 스냅숏) + replay 401(DB) + 필수 클레임(실제 RS256 서명 — aud · jti · exp · sub 가 빠지면
invalid_token 401) + 스냅숏 덮어쓰기 + 소속→팀 = 8 묶음 (cycle 19 의 test_sso.py 와는
별개 — 그건 SSO providers CRUD). jti 는 시험마다 `jti-test-…` 로 새로 만들고 지운다(DB 원장이라 고정 jti 는 다음 실행을 막는다).

### 게이트웨이 · 포털 위임

★ docs/llm-wiki W1(C1~C4). [[src/app/routers/auth_sso.py]] 의 `POST /api/v1/auth/sso` — ste · HWAX Risk · 옛 RA 와 같은 계약.
포털 챗 · 심의 · Claude 가 게이트웨이를 거쳐 MXWP 를 부를 때 서비스 계정이 아니라 **그 사람 명의**가 되게 한다.

| 무엇 | 어떻게 |
| --- | --- |
| 문 | `MXWP_SSO_SECRET` 이 비면 404 `sso_disabled` · `X-Heax-Gateway-Secret` 이 틀리면 401(`hmac.compare_digest`) |
| 사람 | `X-Hwax-Delegate-Email` 먼저, 없으면 `X-Heax-User-Email`(없으면 400). 처음 보는 이메일은 `_create_user`(끄면 403 `jit_disabled`) · 비활성 403 |
| 토큰 | JWT `typ=delegated` — `sub` · `cli`(X-Heax-Client, 기본 gateway) · `gen` · `eml`(받은 이메일 글자 그대로) · `sk`(비밀 지문) · `scope [read, write]` · 12시간. 봉투 `data` 에 `{access_token, token_type:"bearer", expires_in}` |
| 세대 | `sso_delegations`(사람 × 클라이언트). 발급은 **아무것도 회수하지 않는다**(게이트웨이 프로세스가 여럿이면 핑퐁). 회수는 `POST /api/v1/admin/sso-delegations/{user_id}/revoke {client?}` 가 세대를 올린다 |
| 검증 | [[src/app/core/auth.py#_resolve_delegated]] — 비밀 있음 · `sk` 같음 · `gen` 같음 · 살아 있는 사람. 범위는 `check_scope`(→ `/admin/*` 막힘), admin 은 owner 로 낮춘다, `/me/api-tokens` · `/me/2fa` 는 403 |
| 소속 · 플랫폼 | [[src/app/core/portal_identity.py]] — `X-Heax-User-Affiliation` + `X-Heax-Aff-Proof`, `X-Heax-User-Plat` + `X-Heax-Plat-Proof`(`v1.<exp>.<hmac>`, 서명 대상은 인코딩 전 `v1\|<eml>\|<값>\|<exp>`). 맞으면 그 호출의 `portal_*` 로, 평문만 · 틀림 · 만료 · 다른 이메일이면 없는 것으로. **users 칸에 저장하지 않는다** |

소속→팀 표 관리자 API — `GET /api/v1/admin/aff-team-map` · `PUT|DELETE /api/v1/admin/aff-team-map/{affiliation}`(감사
`wiki.aff_team_map.set|delete`). 발급은 감사 `auth.sso.delegate`, 회수는 `auth.sso.revoke`.

함정

- 발급 요청에는 소속 증명이 없다 — 게이트웨이로 **먼저** 온 사람은 소속→팀 표를 못 쓰고 첫 팀에 든다.
- 위임 호출의 헤더를 저장하지 않는 까닭 — 헤더가 없는 것이 '권한 없음' 인지 '게이트웨이 `MXWP_SEND_PLAT` 꺼짐' 인지 모른다. 저장하면
  옛 `plat:` 이 새 시각으로 살아난다. 저장값은 서명된 전체 스냅숏인 진입 토큰에서만.
- 비밀을 바꾸면(`sk`) · 비우면 그 전에 나간 위임 토큰이 바로 죽는다 — 게이트웨이는 401 을 보고 한 번 다시 받는다.
- **게이트웨이의 신원 없는 내부 호출은 위임이 아니라 서비스 계정(`admin@mx.local`, admin)의 API 토큰으로 온다**(게이트웨이 감사
  `mode=service note=no-identity`, 10-24 끝에서 끝). 그 호출의 읽는 사람은 `audience.SERVICE` — admin 이어도 `["org"]` 만 · restricted
  못 봄(사용자 결정 10-24 · WK-D43, 설정 `MXWP_SERVICE_ACCOUNTS`). 같은 계정의 웹 세션 · 위임 호출은 사람 admin 그대로다.
- plat 은 `X-Heax-User-Plat` + `X-Heax-Plat-Proof` 로만 받는다 — 포털이 게이트웨이에 싣는 `x-hwax-groups` 는 MXWP 가 읽지 않는다
  (게이트웨이가 `MXWP_SEND_PLAT=1` 일 때 증명 머리글로 바꿔 싣는다). 받은 머리글은 기록하지 않는다.

테스트 [[apps/api/tests/test_auth_sso.py]] — 창구 404 · 401 · 400 · 403(JIT 꺼짐 · 비활성) · 200 꼴 · 위임 헤더 우선 · 클라이언트별 세대
회수(웹 세션은 산다) · 비밀 바꿈/비움 · 범위(admin 경로 · PAT · 2FA) · 소속 증명(맞음 · 만료 · 다른 이메일 · 평문만 · 바꿔치기) · 플랫폼
증명 · 저장값 무시 · 소속→팀 표 CRUD.

## 7. mxwp-mcp write tools — API token 의 외부 소비자

`dist/llm-docx-toolkit/mcp/server.py` 의 stdio MCP 서버가 RAG 검색
(`query_rules`/`read_chunk`/`mxwp_system_prompt`) 에 더해 문서 read/write
도구를 제공한다. Claude Desktop/Code 가 위키 REST API 를 이 도구로 대신
호출하는 구조. 사용자 안내는 `dist/llm-docx-toolkit/mcp/README.md`.

| 구분 | 도구 |
|---|---|
| read (토큰 선택) | `list_documents(q, limit)` · `get_document_outline(slug)` · `get_section(slug, section_id)` · `get_block(slug, block_id)` |
| write (write scope 토큰 필수) | `create_document(title, slug?, part_slug?, summary?)` · `insert_block(slug, section_id, block, after_block_id?)` · `update_block(slug, block_id, block)` · `delete_block(slug, block_id)` · `move_block(slug, block_id, target_section_id, after_block_id?)` · `validate_block(block)` |

- **인증**: env `MXWP_API_URL` (기본 `http://127.0.0.1:8800`) +
  `MXWP_API_TOKEN` → `Authorization: Bearer`. 토큰은 위키 UI 프로필 메뉴
  → "개인 API 토큰" (`/me/api-tokens`) 에서 개인별 발급. write 도구는
  토큰 없으면 API 호출 없이 발급 안내 에러.
- **http 모드(:8765)는 위임 증명 머리글 넷을 넘긴다** — 게이트웨이가 실은 `X-Heax-User-Affiliation` · `X-Heax-Aff-Proof` ·
  `X-Heax-User-Plat` · `X-Heax-Plat-Proof` 를 받은 그대로 API 호출에 싣는다(`server._request_forward_headers` →
  `MxwpClient(extra_headers=…)`). 10-24 전에는 Bearer 만 넘겨 MCP 로는 `aff:` · `plat:` 범위 문서를 아무도 못 봤다(닫힌 쪽).
- **dev 의 http 모드는 `mxwp_api` 인스턴스 안에서 돈다**(포털 `services.sh` 가 `apptainer exec instance://mxwp_api` 로 올린다) —
  API 인스턴스를 다시 띄우면 MCP 서버도 같이 내려간다. 다시 띄우기 전 포털 세션에 알리고, 뜬 뒤 그쪽이 mxwp-mcp · 게이트웨이를
  다시 올린다(10-24).
- **ETag 자동**: write 도구가 내부에서 문서 ETag (`W/"<doc_id>-<version>"`)
  를 확보해 `If-Match` 로 전송. 충돌 시 "outline 다시 읽고 재시도" 에러로
  변환 — 호출자가 If-Match 를 직접 다룰 일 없음.
- **로컬 선검증**: `insert_block`/`update_block` 은 전송 전 block 을
  `packages/shared/schemas/document.json` 의 Block 정의로 jsonschema 검증.
  실패 시 API 호출 없이 path 별 에러 반환 (LLM 이 고쳐 재시도하는 루프).
  `validate_block` 은 이 검증만 단독 노출.
- HTTP 는 stdlib urllib 만 사용 (바이너리 의존성 최소). 에러 envelope 은
  사람이 읽을 메시지로 변환.

## 자주 묻는 것 / 함정

1. **`get_settings()` 은 lru_cache** — 테스트에서 환경변수 바꿔도 재로드 안 됨.
   재로드 필요 시 `get_settings.cache_clear()`.
2. **`require_role` 은 dependency factory** — 데코레이터로 쓰지 말 것.
   `Depends(require_editor)` 가 정답.
3. **`X-MXWP-User` 헤더 우회**는 dev/batch 편의. 운영에서 외부 노출 금지
   (지금은 admin role 만 우회 허용하는 가드 있음).
4. **envelope 의 `data` 또는 `error` 둘 중 하나는 None** — 둘 다 채워서 보내면
   클라이언트가 헷갈림. 라우터에서 둘 다 set 하는 패턴 보이면 버그.
5. **`http_status` 키는 응답 envelope 안의 메타 정보** — 실제 HTTP status code
   는 별도. 핸들러가 동기화하지만 직접 envelope 만들 땐 일치시킬 것.
6. **CORS 는 컴마 분리 문자열** — split 은 `Settings.cors_origin_list`
   property ([[src/app/core/config.py]]) 가 담당하고 main.py 는 그 property
   를 그대로 받아 `CORSMiddleware.allow_origins` 에 꽂는다. 기본값은
   `http://` prefix 가 포함된 `localhost:5173/80` URL 두 개.
7. **JWT 알고리즘은 HS256 (대칭키)** — `jwt_secret` 만 갖고 있으면 누구나
   발급 가능. 운영에서 RS256 으로 전환 검토 시 발급/검증 양쪽 모두 코드 수정.
8. **시험은 시험 전용 DB · 색인 · 버킷을 쓴다**(사용자 결정 10-24) —
   [[src/tests/conftest.py#_use_test_resources]] 가 같은 postgres 안의 `<dev DB>_test`(dev `mxwp` →
   `mxwp_test`)를 관리 DB `postgres` 로 붙어 만들고 alembic head · seed · setup_buckets 로 올린다.
   Meilisearch 색인은 `test_` 접두, MinIO 버킷은 `mxwp-test-*`. 시험 DB 가 dev DB 와 같거나 이름이
   `_test` 로 끝나지 않으면(`TEST_DATABASE_URL` 로 바꿀 수 있다) 시험을 시작하지 않는다. 시험 DB 는
   남겨 두고 실행마다 다시 올리기만 한다 — 처음부터 하려면 그 DB 를 지운다. 시험 몇이 기대는 조직
   고리(org_reset 의 mx → dev → he-team → cae)는 `_org_chain` 이 넣는다. 그 전엔 dev DB 를 그대로 써서
   표를 통째로 비우는 고정물이 dev 의 진짜 행을 지웠다(토큰 시험이 `api_tokens` 를 비워 게이트웨이 서비스
   토큰 · 개인 토큰이 날아갔다 — 그 둘은 [[src/tests/test_api_tokens.py#pat_user]] 로 고쳤다). 환경은
   설정 캐시(`get_settings` lru_cache)보다 먼저 바꾼다 — conftest 의 다른 환경 줄 뒤에 부른다.

## Notifications 흐름 — BE INSERT → FE poll → store → drawer

BE 가 `notifications` 테이블에 INSERT 하는 모든 알림은 FE 가 polling 으로
가져와 zustand store 에 합쳐서 TopBar 의 종 + drawer 에 표시한다.

| 단계 | 위치 | 비고 |
|---|---|---|
| INSERT | `routers/comments.py` (`comment_mention`), `routers/approvals.py` (`review_request`, `review_decision`), `routers/reactions.py` (`reaction_added`), `routers/read_receipts.py` (`read_ack_reminder`), `services/{reminder,digest,retention,automation}_runner.py` | 항상 `notification_prefs.is_channel_enabled(... channel="in_app")` 가드 |
| READ API | `GET /api/v1/notifications?unread=&limit=` (`routers/notifications.py`) | envelope `{data:[…], meta:{count, unread}}` |
| FE poll | `apps/web/src/features/notifications/hooks/useNotificationPolling.ts` | TanStack Query, 30 s 간격, `useAuthStore.user` 있을 때만, AppShell 에서 1회 mount |
| kind→message | `apps/web/src/features/notifications/kindToMessage.ts` | payload 키 (`actor_name`/`doc_title`/`slug`/`emoji`/`status` …) 누락 graceful |
| store | `apps/web/src/features/notifications/store.ts` | id 로 dedupe — 같은 row 가 다음 polling 라운드에 와도 무시 |
| MARK READ | `POST /api/v1/notifications/{id}/read` → `NotificationDrawer` 의 row click + 전체 읽음 처리 | 서버 UUID 만 POST, 로컬 `n-…` id 는 skip |

새 알림 kind 추가 시 `kindToMessage.ts` 의 `categoryForKind` + `buildMessage`
switch 에 case 추가. payload 키 컨벤션: `actor_name`, `doc_title`, `slug`,
`from_user_id`, kind 별 부가 키 (`emoji`/`status`/`message` 등).

## 테스트 지도

| 파일 | 무엇 |
|---|---|
| [[src/tests/test_auth.py]] | role 체크, JWT |
| [[src/tests/test_auth_flows.py]] | 로그인/리프레시 흐름 |
| [[src/tests/test_api_tokens.py]] | API token 발급/검증 |
| [[src/tests/test_api_token_scopes.py]] | scope vs verb |
| [[src/tests/test_totp.py]] | 2FA (TOTP) |
| [[src/tests/test_sso.py]] | SSO |
| [[src/tests/test_portal_sso.py]] | 포털 타일 SSO · 스냅숏 · jti 원장 · 소속→팀 |
| [[src/tests/test_auth_sso.py]] | 게이트웨이 · 포털 위임 · 소속 · 플랫폼 증명 |
