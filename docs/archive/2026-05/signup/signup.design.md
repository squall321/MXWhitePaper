---
template: design
version: 1.0
feature: signup
date: 2026-05-17
author: squall321@gmail.com
project: MX White Paper
---

# Signup Design Document

> **Summary**: `POST /auth/signup` + 조직 셀렉터 + admin 전용 조직 등록 라우터.
> 사내망 즉시 활성화, 회사 도메인 화이트리스트, SSO 우선 머지, 첫 admin 부트
> 스트랩까지 한 사이클로 구현.
>
> **Planning Doc**: [signup.plan.md](../../01-plan/features/signup.plan.md)
> **Status**: Draft

---

## 1. Data Layer

### 1.1 Migration `0049_users_groups_signup.py`

```sql
-- (1) groups.kind ─ team 직속의 group 과 lab 을 한 테이블에서 구분.
ALTER TABLE groups
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'group'
    CHECK (kind IN ('group','lab'));

-- (2) users.group_id ─ 가입 시 선택 (nullable. team 만 정해도 가입 가능).
ALTER TABLE users
  ADD COLUMN group_id UUID REFERENCES groups(id) ON DELETE SET NULL;

-- (3) Seed: 첫 가입자가 막히지 않도록 MX division 1개만 미리 등록.
INSERT INTO divisions (slug, name, description)
  VALUES ('mx', 'MX', 'Default division (seeded)')
  ON CONFLICT (slug) DO NOTHING;

-- (4) Index ─ 가입 폼이 division → teams → groups 를 빠르게 조회.
CREATE INDEX IF NOT EXISTS idx_teams_division   ON teams(division_id);
CREATE INDEX IF NOT EXISTS idx_groups_team_kind ON groups(team_id, kind);
```

**Down**: 위 역순 (DROP COLUMN, DROP INDEX). seed 데이터 삭제하지 않음
(운영 데이터 보호 — down 후 다시 up 하면 idempotent INSERT 가 다시 처리).

### 1.2 무엇이 바뀌는가 (영향 매트릭스)

| 변경 | 영향받는 코드 |
|---|---|
| `groups.kind` | `repos/orgs_repo.py` (신규), 모든 groups SELECT 가 `kind` 컬럼을 노출 |
| `users.group_id` | `repos/user_repo.py` (있다면 SELECT 확장), `/me` 응답에 `group_id` 추가 |
| 신규 endpoint | `routers/auth.py` (signup 추가), `routers/orgs.py` (신규) |
| 마이그레이션 자체 | `alembic/versions/0049_*.py` |

기존 `users` row 들은 `group_id=NULL` 로 자동 초기화 — 별도 backfill 불요.

---

## 2. Service Layer

### 2.1 신규 함수 — `services/signup_service.py`

```python
async def create_user_account(
    s: AsyncSession,
    *,
    email: str,
    name: str,
    password: str,
    team_id: UUID,
    group_id: UUID | None,
    request_ip: str | None,
) -> dict[str, Any]:
    """단일 트랜잭션:
      1. _validate_payload() — email/password 형식, 도메인 화이트리스트
      2. _check_email_collision() — UNIQUE + SSO 우선 머지 룰
      3. _check_org_consistency() — team_id 존재, group_id ⊆ team_id
      4. INSERT INTO users + INSERT INTO audit_logs (동일 트랜잭션)
    """
```

검증 헬퍼는 모두 `services/signup_service.py` 안에 private 함수로 둠 (라우터
가 얇게 유지).

### 2.2 SSO 우선 머지 — 최종 채택안

Plan 문서 §2.4 의 두 안 중 **alternative (간단)** 채택:

> 자체 가입 시 email 이 이미 *어떤 상태로든* users 에 있으면 (활성/비활성/SSO/
> 자체 무관) → 409 Conflict 로 거부.

이유:
- "SSO row 충돌 시 자체 row 의 email suffix 처리" 는 동시성/auth 흐름이 복잡해짐.
- 사내망에서는 신규 사용자가 본인이 SSO 가능한지 알고 가입할 것이므로, 충돌
  시 거부 → "이미 가입된 계정이 있습니다, SSO 로 로그인하세요" 메시지로 안내
  가 더 단순.
- 향후 SSO 가 들어올 때 SSO 라우터는 *기존 자체가입 row 를 그대로 사용*
  하면 됨 (email 매칭). password_hash 는 SSO 가 무시.

### 2.3 비밀번호 정책 (`services/signup_service.py:_check_password()`)

```python
_PW_MIN = 12
_PW_NEEDS = (
    (lambda s: any(c.isalpha() for c in s), "letter"),
    (lambda s: any(c.isdigit() for c in s), "digit"),
    (lambda s: any(not c.isalnum() for c in s), "special"),
)

def _check_password(pw: str) -> None:
    if len(pw) < _PW_MIN:
        raise ValidationFailed(f"password must be ≥{_PW_MIN} chars")
    for ok, name in _PW_NEEDS:
        if not ok(pw):
            raise ValidationFailed(f"password must contain at least one {name}")
```

### 2.4 도메인 화이트리스트 (`services/signup_service.py:_check_email_domain()`)

```python
def _check_email_domain(email: str) -> None:
    domains = get_settings().signup_allowed_email_domains  # comma-separated str
    if not domains:  # 빈 문자열 → 모든 도메인 허용 (개발 편의)
        return
    allowed = {d.strip().lower() for d in domains.split(",") if d.strip()}
    suffix = email.lower().rsplit("@", 1)[-1]
    if suffix not in allowed:
        raise ValidationFailed(
            "email domain not allowed",
            details={"got": suffix, "allowed": sorted(allowed)},
        )
```

**config 추가**:
```python
signup_allowed_email_domains: str = Field(default="")  # "" = allow all
```

`production` 환경 + 빈 값이면 startup warning 로그 (보안 권고).

### 2.5 조직 정합성 (`_check_org_consistency()`)

```python
async def _check_org_consistency(
    s: AsyncSession, team_id: UUID, group_id: UUID | None,
) -> None:
    # 1. team_id 존재 확인
    team = await s.execute(text("SELECT id FROM teams WHERE id=:t"), {"t": team_id})
    if team.scalar_one_or_none() is None:
        raise ValidationFailed("team_id not found", details={"team_id": str(team_id)})

    # 2. group_id 가 주어졌으면 → team_id 산하인지 확인
    if group_id is not None:
        row = await s.execute(
            text("SELECT team_id FROM groups WHERE id=:g"), {"g": group_id}
        )
        gt = row.scalar_one_or_none()
        if gt is None:
            raise ValidationFailed("group_id not found")
        if gt != team_id:
            raise ValidationFailed(
                "group_id does not belong to the selected team",
                details={"group_team_id": str(gt), "user_team_id": str(team_id)},
            )
```

### 2.6 단일 트랜잭션

```python
async with s.begin():
    user_id = uuid4()
    await s.execute(text("""
        INSERT INTO users (id, email, name, password_hash, role, team_id, group_id, is_active)
        VALUES (:id, :email, :name, :pwh, 'reader', :tid, :gid, TRUE)
    """), {...})
    await s.execute(text("""
        INSERT INTO audit_logs (user_id, action, target, payload, ip)
        VALUES (:uid, 'user_signup', :uid, CAST(:p AS JSONB), :ip)
    """), {
        "uid": user_id, "p": json.dumps({"email": email, "team_id": str(team_id), "group_id": str(group_id) if group_id else None}),
        "ip": request_ip,
    })
```

---

## 3. Router Layer

### 3.1 `routers/auth.py` 에 추가

```python
@router.post("/auth/signup", status_code=201)
async def signup(
    body: SignupBody,                          # pydantic v2 model (3.5 참조)
    request: Request,
    s: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    if not _signup_rate_ok(_actor_key(request)):
        raise _RateLimited()
    user = await create_user_account(
        s,
        email=body.email, name=body.name, password=body.password,
        team_id=body.team_id, group_id=body.group_id,
        request_ip=request.client.host if request.client else None,
    )
    return envelope(data={"user": user})
```

Rate-limit: 기존 import 라우터의 `_check_rate_limit()` 패턴 재사용. IP 기반,
분당 5 회.

### 3.2 신규 `routers/orgs.py`

```python
router = APIRouter(prefix="/api/v1", tags=["orgs"])

# Public — 가입 폼이 채울 수 있도록.
@router.get("/divisions")               async def list_divisions(s) -> envelope
@router.get("/divisions/{id}/teams")    async def list_teams(s, id) -> envelope
@router.get("/teams/{id}/groups")       async def list_groups(s, id) -> envelope
    # 응답에 kind 컬럼 포함

# Admin only — 조직 등록.
@router.post("/divisions",              dependencies=[Depends(require_role("admin"))])
@router.post("/divisions/{id}/teams",   dependencies=[Depends(require_role("admin"))])
@router.post("/teams/{id}/groups",      dependencies=[Depends(require_role("admin"))])
    # body 에 kind: 'group' | 'lab' (기본 'group')
```

Slug 자동 생성: name 을 lowercase + 비-ASCII 는 `slugify()` 로 변환. 충돌 시
`-2`, `-3` suffix. `routers/imports.py:_derive_slug()` 패턴 재사용.

### 3.3 `main.py` 에 라우터 등록

```python
from app.routers import orgs
app.include_router(orgs.router)
```

### 3.4 에러 매트릭스 (라우터 응답)

| HTTP | code | 발생 |
|---|---|---|
| 201 | — | 신규 user 생성 성공 |
| 400 | VALIDATION_FAILED | 요청 body 형식 오류 (pydantic) |
| 422 | VALIDATION_FAILED | 도메인/비밀번호 정책 위반, 조직 정합성 |
| 409 | CONFLICT | email 이미 존재 |
| 429 | RATE_LIMITED | 분당 5회 초과 |
| 403 | FORBIDDEN | admin-only 라우터에 비-admin 접근 |

### 3.5 Pydantic v2 Body Model

```python
from pydantic import BaseModel, EmailStr, Field

class SignupBody(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1, max_length=200)
    password: str = Field(min_length=12, max_length=200)
    team_id: UUID
    group_id: UUID | None = None
```

비밀번호 정책 검증은 service 레이어에서 (pydantic 은 길이만 1차 차단).

---

## 4. Bootstrap Script

### 4.1 `apps/api/app/scripts/bootstrap_admin.py`

```python
"""env 의 BOOTSTRAP_ADMIN_EMAIL/PASSWORD 로 첫 admin user 1개 INSERT.

멱등: 이미 'admin' role user 가 1명 이상 있으면 skip.

  apptainer exec instance://mxwp_api bash -lc \\
    'cd /workspace/apps/api && BOOTSTRAP_ADMIN_EMAIL=admin@... \\
       BOOTSTRAP_ADMIN_PASSWORD=... python3 -m app.scripts.bootstrap_admin'
"""

async def main() -> int:
    email = os.environ.get("BOOTSTRAP_ADMIN_EMAIL")
    password = os.environ.get("BOOTSTRAP_ADMIN_PASSWORD")
    if not email or not password:
        print("missing env: BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD", file=sys.stderr)
        return 2

    async with sessionmaker() as s, s.begin():
        existing = await s.execute(
            text("SELECT 1 FROM users WHERE role='admin' AND is_active=TRUE LIMIT 1")
        )
        if existing.scalar_one_or_none():
            print("admin already exists — skip"); return 0

        await s.execute(text("""
            INSERT INTO users (email, name, password_hash, role, is_active)
            VALUES (:e, :n, :ph, 'admin', TRUE)
        """), {"e": email, "n": "Bootstrap Admin", "ph": hash_password(password)})
        print(f"created admin: {email}")
    return 0
```

---

## 5. Test Plan

### 5.1 신규 테스트 파일

| 파일 | 케이스 |
|---|---|
| `tests/test_signup_router.py` | happy path / 409 / 422 (5종) / 429 / role=reader |
| `tests/test_orgs_router.py` | public GET / admin POST / 비-admin 403 |
| `tests/test_signup_service.py` | unit: password 정책 4종, 도메인 화이트리스트 3종, 조직 정합성 3종 |
| `tests/test_bootstrap_admin.py` | env 없음 → exit 2, 첫 실행 → INSERT, 두 번째 실행 → skip |

### 5.2 기존 테스트 영향

| 파일 | 점검 |
|---|---|
| `tests/test_auth.py` | login 라우터 무변경이라 영향 없음 |
| `tests/conftest.py` | seed admin user 패턴이 있으면 그대로 |

### 5.3 결정적 시드

각 테스트는 자체 transaction 안에서 사용자/조직 INSERT 후 rollback. 다른
테스트와 격리.

---

## 6. SSO 호환 보장 (forward-looking)

본 사이클은 SSO 라우터 구현체를 변경하지 않는다. 다만 다음을 보장:

1. SSO 라우터가 user INSERT 시 `password_hash = ''` (또는 sentinel) 로 두는
   기존 패턴을 유지.
2. login 라우터는 password_hash 가 sentinel 인 user 에 대해 직접 login 거부
   (현재 동작 그대로 — 변경 없음).
3. 자체가입 + 같은 email SSO 시 → 자체가입이 먼저 일어났으면 SSO 가
   `email_already_used` 로 거부 (SSO 측 추가 처리는 SSO 통합 사이클에서).

이로써 본 사이클이 *SSO 도입을 막지 않음* 을 보장.

---

## 7. Settings / Env

추가:

| Env | Default | 의미 |
|---|---|---|
| `SIGNUP_ALLOWED_EMAIL_DOMAINS` | `""` (= 모두 허용) | 콤마 구분 도메인 화이트리스트 |
| `BOOTSTRAP_ADMIN_EMAIL` | — | 부트스트랩 스크립트 전용, 라우터는 미사용 |
| `BOOTSTRAP_ADMIN_PASSWORD` | — | 동일 |

config.py 변경:
```python
signup_allowed_email_domains: str = Field(default="")
```

---

## 8. Implementation Order (Do 단계 권장 순서)

1. 마이그레이션 작성 + 로컬 적용 → `\d users` 로 컬럼 확인
2. `services/signup_service.py` + unit tests
3. `routers/orgs.py` + tests
4. `routers/auth.py` 에 signup endpoint 추가 + tests
5. `bootstrap_admin.py` + test
6. `main.py` 에 orgs router 등록
7. lat/core.md 새 엔드포인트 표 추가
8. 통합 테스트: curl 로 전체 흐름 (signup → login → /me)
9. CI 통과 확인

---

## 9. Acceptance Criteria (plan 과 동일)

1. ✅ `POST /auth/signup` 동작 + curl 검증
2. ✅ 모든 잘못된 입력 422/409
3. ✅ admin 만 조직 등록 가능
4. ✅ public GET 으로 가입 폼이 데이터 받음
5. ✅ `bootstrap_admin.py` 멱등 동작
6. ✅ SSO 호환 (sso 라우터 변경 없이 통과)
7. ✅ 모든 테스트 그린 + CI matrix 통과
8. ✅ lat/core.md 갱신
