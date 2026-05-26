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

### 현재 사용자 해소

`get_current_user()` ([[src/app/core/auth.py#get_current_user]]) 는 dependency
chain 의 최상위. 우선순위:

1. **API token** (`Authorization: Bearer mxwp_…`) → `_resolve_api_token()` →
   사용자 + scopes 반환. 스코프가 verb 와 안 맞으면 `ScopeInsufficient` (403).
2. **JWT** (`Authorization: Bearer <jwt>`) → `security.decode_jwt()` → user id →
   `_fetch_user_by_id()`.
3. **X-MXWP-User 헤더** (편의 우회) — 일부 import/배치 흐름에서 ID 대신 이메일.
4. **개발 환경 폴백** — 미인증이면 `_fetch_admin()` 으로 첫 admin 반환 — 운영
   환경 (`app_env=production`) 에선 비활성.

dict 형태: `{id, email, role, ...}`.

### API token

`api_tokens` 테이블에 `token_hash` (argon2), `scopes` (JSON), `expires_at`.
평문 토큰은 발급 시점에만 노출. 검증:
1. `token_prefix` (앞 12자) 로 후보 row 선별
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
| MinIO | `minio_endpoint` | `http://minio:9000` |
| | `minio_public_endpoint` | `http://localhost:9000` |
| | `minio_access_key` / `_secret_key` | dev placeholder |
| | `minio_bucket_images` / `_files` / `_backups` / `_exports` | `mxwp-…` |
| JWT | `jwt_secret` | dev placeholder |
| | `jwt_access_ttl_seconds` | 3600 |
| | `jwt_refresh_ttl_seconds` | 604800 |
| CORS | `cors_origins` | `localhost:5173,localhost:80` |
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
`_reset_engine_per_test`) — asyncpg 의 event-loop affinity 때문.
운영 코드는 신경 쓸 필요 없음.

## 5. Security — JWT + 패스워드

[[src/app/core/security.py]]:
- `hash_password(plain)` / `verify_password(plain, hash)` — argon2
- `create_access_token(user_id, role, …)` — JWT
- `create_refresh_token(...)` — 별도 TTL
- `decode_jwt(token)` — 검증 + payload 반환, 실패 시 raise

JWT payload: `{sub: user_id, role: …, exp, iat}`. 변경 시 FE 미들웨어
([[src/apps/web/src/lib/auth.ts]]) 의 디코드도 같이 확인.

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
6. **CORS 는 컴마 분리 문자열** — `Settings.cors_origins` 의 split 은
   [[src/app/main.py]] 가 담당.
7. **JWT 알고리즘은 HS256 (대칭키)** — `jwt_secret` 만 갖고 있으면 누구나
   발급 가능. 운영에서 RS256 으로 전환 검토 시 발급/검증 양쪽 모두 코드 수정.

## 테스트 지도

| 파일 | 무엇 |
|---|---|
| [[src/tests/test_auth.py]] | role 체크, JWT |
| [[src/tests/test_auth_flows.py]] | 로그인/리프레시 흐름 |
| [[src/tests/test_api_tokens.py]] | API token 발급/검증 |
| [[src/tests/test_api_token_scopes.py]] | scope vs verb |
| [[src/tests/test_two_factor.py]] | 2FA |
| [[src/tests/test_sso.py]] | SSO |
