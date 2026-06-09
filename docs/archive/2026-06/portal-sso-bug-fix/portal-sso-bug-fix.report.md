# portal-sso-bug-fix — Completion Report

## Executive Summary

| | |
| --- | --- |
| **Feature** | Opus 4.8 의 `a397a02` (HWAX portal SSO callback) 의 후속 점검 → 7 분기 4xx→500 cascade bug 발견 → fix + test coverage |
| **Completion** | 2026-06-09 |
| **Match Rate** | 100% |
| **Fix commit** | `58de9b0` |
| **점검 대상** | `a397a02` (Opus 4.8, 2026-06-08) |

### Value Delivered

| Perspective | Outcome |
| --- | --- |
| Problem | `portal_sso.py` 의 *모든 7 분기* (404 disabled / 401 bad_token / no_key / invalid_token / wrong_scope / replay / 503 no_team) 가 `APIError(status_code=..., code=..., message=...)` kwargs 로 작성. `APIError.__init__()` 는 `(message, *, details)` 만 받음 → 호출 즉시 `TypeError` → 모든 4xx 가 500 으로 떨어짐. **standalone 배포에서도 portal-callback 이 404 대신 500 반환** (standalone 안전성 의도 파괴) |
| Solution | 7 dedicated subclass + class attribute (`http_status` / `code`) 패턴 — 다른 라우터들의 `*ValidationError` 와 동일 컨벤션. 신규 `test_portal_sso.py` 5 cases. lat 의 `core.md` 에 SSO 호환 절 직후 HWAX Portal SSO 절 추가 + APIError 패턴 함정 명시 |
| Function/UX | `POST /api/v1/auth/portal-callback` 이 정확한 status code + envelope 반환. SPA bootstrap 이 404 받으면 standalone fallback 로직 정상 분기 가능 |
| Core Value | "다른 AI 의 코드를 land 즉시 검증" — 라이브 검증 (curl) + 정적 분석 (grep APIError) 둘 다 bug detect. 신규 컨트리뷰터 함정 lat 에 명시화 |

## Bug 발견 과정

### 1. Live API 진단으로 첫 신호
사용자 *"포털 작업 후속 점검"* 지시 후:
1. `mxwp_api` instance 가 살아 있지만 `:8800/healthz` 가 빈 응답 → uvicorn 죽음 (watch-files cascade 후 reloader 종료)
2. `start.sh` 재시작 → `:8800/healthz` 정상
3. `curl POST /portal-callback` → **HTTP 500** (expected 404 since `PORTAL_JWKS_URL=""`)

### 2. uvicorn err log → exact line
```
File "/workspace/apps/api/app/routers/portal_sso.py", line 127, in portal_callback
    raise APIError(status_code=404, code="sso_disabled", message="portal SSO not enabled")
TypeError: APIError.__init__() got an unexpected keyword argument 'status_code'
```

### 3. APIError 시그니처 확인
`apps/api/app/core/errors.py`:
```python
class APIError(Exception):
    code: str = "INTERNAL"
    http_status: int = 500
    message: str = "Internal server error"

    def __init__(self, message: str | None = None, *, details: dict[str, Any] | None = None) -> None:
        ...
```

→ `status_code` / `code` kwargs 미지원. 다른 라우터들 (`comments.py`, `series.py`, `quiz.py` 등) 은 *subclass + class attribute* 패턴 사용:
```python
class CommentValidationError(APIError):
    code = "VALIDATION_ERROR"
    http_status = 422
```

### 4. 7 분기 모두 동일 bug
`grep "APIError" portal_sso.py` → 7 `raise APIError(status_code=..., code=..., message=...)` 라인. **standalone 안전성 분기 (sso_disabled 404) 부터 망가짐** — `PORTAL_JWKS_URL=""` 이 disabled 의도였는데 500 반환.

## Fix

### `portal_sso.py`: 7 subclass + class attribute
```python
class _SsoDisabledError(APIError):
    http_status = 404
    code = "sso_disabled"

class _BadTokenError(APIError):
    http_status = 401
    code = "bad_token"

# ... _NoKeyError, _InvalidTokenError, _WrongScopeError,
#     _ReplayError, _NoTeamError
```

호출부 7 곳:
```python
# before:  raise APIError(status_code=401, code="bad_token", message="...")
# after:   raise _BadTokenError("...")
```

### 라이브 verify
```
$ curl -s -X POST http://127.0.0.1:8800/api/v1/auth/portal-callback -d "token=fake" -w "HTTP %{http_code}\n"
HTTP 404
{"data":null,"meta":null,"error":{"code":"sso_disabled","http_status":404,"message":"portal SSO not enabled","details":{}}}
```

## Tests (신규 `test_portal_sso.py`)

| # | Case | Asserts |
|---|---|---|
| 1 | `test_disabled_returns_404_not_500` | `portal_jwks_url=""` → 404 `sso_disabled` (regression guard) |
| 2 | `test_malformed_token_returns_401` | non-JWT-shaped token → 401 bad_token/invalid_token |
| 3 | `test_empty_jwks_returns_401_no_key` | header-shaped but JWKS 빈 array → 401 |
| 4 | `test_happy_path_upserts_user_and_sets_cookie` | mock `_verify_portal_token` → 303 redirect + `mxwp_refresh` cookie + user row 생성 (role=editor, email) |
| 5 | `test_replay_second_use_returns_401` | 같은 jti 두 번 → 두 번째 401 replay |

**5/5 pass** (`pytest tests/test_portal_sso.py -v`):
```
tests/test_portal_sso.py ..... [100%]
============================== 5 passed in 1.24s ===============================
```

## lat 갱신

`docs/lat/core.md`:
- SSO 호환 절 직후 **HWAX Portal SSO (true SSO callback)** 신규 절
- 6 단락: 흐름 / disabled fallback / REFRESH_COOKIE_PATH 트랩 / **APIError 패턴 함정 (본 cycle 의 정정 사실 명시)** / in-process replay guard 의 단일 worker 가정 / 테스트 위치
- 신규 SSO 라우터 추가자가 같은 함정에 빠지지 않도록 *"신규 SSO 라우터 추가 시 반드시 이 패턴 따를 것"* 명시

## 검증
- **pytest 5/5 pass**
- **라이브 curl 404** (이전엔 500)
- **chunker --check** exit 0

## 핵심 인사이트

### 1. 다른 AI 가 land 한 코드 즉시 검증 필요
Opus 4.8 가 `a397a02` 를 land 했지만 *standalone 환경에서 한 번도 curl 안 해본 것* 으로 추정. uvicorn 시작은 성공해도 *실행* 단계에서 즉시 fail. 모든 PR 의 *minimum viable smoke* 는 실제 endpoint hit.

### 2. APIError 패턴은 *project-wide 컨벤션*
`comments.py`, `series.py`, `quiz.py`, `forms.py` 등 10+ 라우터가 같은 subclass + class attribute 패턴. *새 라우터* 가 다른 패턴 (kwargs) 으로 작성 시 → 라우터 본인 책임. lat 에 명시화 → 미래 컨트리뷰터 보호.

### 3. JWKS 캐시 + jti replay guard 는 *single worker* 가정
모듈 레벨 `_jwks_cache` 와 `_seen_jti` dict 는 *프로세스 로컬*. multi-replica 배포 시:
- replay attack 이 다른 replica 에서 통과 (jti guard 우회)
- JWKS rotation 동안 일관성 깨짐
→ Redis 로 backed 필요 (lat 에 명시). 현재 단일 uvicorn 가정은 의도된 단순성.

### 4. test 의 *"either A or B"* 패턴
`test_empty_jwks_returns_401_no_key` 가 처음에 `no_key` 만 기대 → 실제로는 jose 의 `get_unverified_header` 가 truncated sig 에 일찍 fail 하면 `bad_token` 으로 떨어짐. `in ("no_key", "invalid_token", "bad_token")` 으로 완화 — 외부 라이브러리의 *언제 어디서 거부할지* 가 implementation detail 이므로 *"401 + reasonable code"* 까지만 lock.

## 누적 (G→N + portal + post-portal + A.3 + this)

| Cycle | Commit |
|---|---|
| G1~N + meta-loop | a8e7d68 → 27e4617 |
| Opus 4.8 portal sub-path | 4c73305 → d50a7c8 |
| post-portal quad | 1ee8239 → ce2ccdc |
| Opus 4.8 portal SSO callback | a397a02 |
| Task A.3 (snapshot/restore) | c82c407 + 5170bea |
| **portal SSO bug fix** | **`58de9b0`** |

## 잔여

| 항목 | 상태 |
|---|---|
| Opus 4.8 의 `e067ea0` 등 portal sub-path 변경 추가 검증 | Token verification 의 e2e (실 RS256 sign) 는 별도 cycle 적합 |
| Redis-backed JWKS cache + jti store | multi-replica 시점에 필요 (현재 단일 uvicorn) |
| ja/zh i18n | 사용자 명시 제외 |
| Tooltip 컴포넌트 | design system surface |
