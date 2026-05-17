# Signup Planning Document

> **Summary**: 사내망 사용자가 본인 정보 (이메일/이름/팀/그룹) 와 비밀번호를
> 직접 입력해 계정을 생성하는 자가가입 기능. 향후 SSO 도입과 호환되도록 SSO
> 우선 머지 정책을 설계 단계에서 못 박는다.
>
> **Project**: MX White Paper
> **Feature**: signup
> **Version**: 0.1.0
> **Date**: 2026-05-17
> **Status**: Draft

---

## Executive Summary

| Perspective | Content |
|-------------|---------|
| **Problem** | 현재 MXWhitePaper 서버는 사용자 자체 가입 경로가 없다. `users` 테이블·login 라우터·email verify·password reset 까지 다 있지만 *최초 row 를 어떻게 만드나* 의 답이 비어 있다. 결과: dev 모드 자동 admin 폴백에 의존 중이며 production 으로 전환 불가. |
| **Solution** | `POST /auth/signup` 라우터 + 조직 셀렉터 (`GET /divisions`, `/divisions/{id}/teams`, `/teams/{id}/groups`) + admin 전용 조직 등록 라우터. 사내망이므로 즉시 활성화, 회사 도메인 화이트리스트, audit_log 기록. SSO 가 같은 email 로 들어오면 자체 가입 row 를 비활성화하고 SSO row 를 우선. |
| **Function/UX Effect** | 신규 사용자 1분 내 가입 → 즉시 reader 권한으로 로그인 가능. admin 은 새 조직 (division/team/group/lab) 을 UI 없이도 라우터 호출만으로 등록 가능. 가입자가 잘못된 조직 선택 시 422 로 즉시 거부. |
| **Core Value** | "production 으로 켤 수 있는 시스템" — dev 폴백 없이도 첫 admin 부트스트랩 → 자가가입으로 증식 → 향후 SSO 로 전환 가능한 **3-단계 진화 경로** 의 첫 단추. 사내 정책에 맞춘 도메인 화이트리스트로 외부 가입 차단. |

---

## 1. Overview

### 1.1 Purpose

`users` 테이블은 이미 존재하지만 row 를 만드는 *유일한 경로* 는 admin 의 수동
INSERT 또는 dev 모드 자동 폴백뿐이다. 본 사이클은 production 전환을 가능하게
하는 **자가가입 라우터** 와 그 부수 인프라 (조직 셀렉터, admin 부트스트랩,
SSO 우선 머지) 를 한 번에 도입한다.

### 1.2 Out of Scope

- web 측 signup UI 폼 — 별도 사이클 (backend API 만 본 사이클)
- LDAP/SAML SSO 실제 통합 — 본 사이클은 *호환 가능한 자료구조* 만 만들고 실
  연결은 후속
- 비밀번호 만료 정책, MFA 강제 — 후속
- 사용자 셀프 조직 변경 — 본 사이클은 admin only

### 1.3 Decisions (확정)

| # | 결정 | 값 |
|---|---|---|
| 1 | 가입 시 인증 단계 | 즉시 활성화 (사내망, email verify 는 선택) |
| 2 | 조직 선택 방식 | 드롭다운 (admin 사전 등록한 division/team/group 만) |
| 3 | 조직 구조 — 랩 | `groups.kind ∈ {'group','lab'}` 컬럼 추가. 랩은 팀 직속 (공식 위상). |
| 4 | 가입자 default role | `reader` |
| 5 | 이메일 도메인 제한 | 회사 도메인 화이트리스트 (env: `SIGNUP_ALLOWED_EMAIL_DOMAINS`, 콤마구분) |
| 6 | 비밀번호 정책 | 최소 12자 + 영문/숫자/특수문자 각 1자 이상 |
| 7 | seed | `MX` division 1개만 마이그레이션에서 INSERT. 나머지 admin 이 등록. |
| 8 | 조직 변경 권한 | admin only (본인 셀프 변경 불가) |
| 9 | 새 가입 알림 | audit_log 한 줄 (in-app notification 인프라가 있으면 후속에서 hook) |
| 10 | SSO 우선 머지 | 같은 email 로 SSO 가 들어오면 자체 가입 row 의 `is_active=false`, SSO row 가 활성. 라우터 단에서는 login 시 활성 row 만 매칭. |
| 11 | 첫 admin 부트스트랩 | `apps/api/app/scripts/bootstrap_admin.py` — env 에서 `BOOTSTRAP_ADMIN_EMAIL/PASSWORD` 받아 INSERT. 멱등 (이미 admin 있으면 skip). |

---

## 2. Functional Requirements

### 2.1 신규 라우터

| # | Method | Path | 인증 | 책임 |
|---|---|---|---|---|
| FR-1 | POST | `/api/v1/auth/signup` | 없음 (public) | 신규 user row 생성, reader role |
| FR-2 | GET  | `/api/v1/divisions` | 없음 | 가입 폼 드롭다운용 division 리스트 |
| FR-3 | GET  | `/api/v1/divisions/{id}/teams` | 없음 | division → teams |
| FR-4 | GET  | `/api/v1/teams/{id}/groups` | 없음 | team → groups (kind 포함) |
| FR-5 | POST | `/api/v1/divisions` | admin | 신규 division 등록 |
| FR-6 | POST | `/api/v1/divisions/{id}/teams` | admin | 신규 team 등록 |
| FR-7 | POST | `/api/v1/teams/{id}/groups` | admin | 신규 group/lab 등록 (kind 선택) |

### 2.2 가입 요청 스키마

```json
POST /auth/signup
{
  "email":      "alice@samsung.com",
  "name":       "김앨리스",
  "password":   "Sample!Pass2026",
  "team_id":    "<uuid>",
  "group_id":   "<uuid|null>"
}
```

응답 (성공, 201):
```json
{
  "data": {
    "user": { "id": "...", "email": "...", "name": "...", "role": "reader" }
  }
}
```

### 2.3 검증 규칙 (422 발생 케이스)

| 케이스 | 메시지 |
|---|---|
| email 형식 오류 | "invalid email format" |
| email 도메인 미허용 | "email domain not allowed; allowed: ..." |
| 비밀번호 정책 위반 | "password must be ≥12 chars with letter+digit+special" |
| email 이미 존재 + 활성 | 409 "email already registered" |
| team_id 존재하지 않음 | "team_id not found" |
| group_id 존재하지 않음 또는 team_id 와 불일치 | "group_id does not belong to the selected team" |

### 2.4 SSO 우선 머지 규칙

기존 `sso.py` 가 INSERT 하는 시점에 같은 email 의 자체 가입 row 가 있으면:
1. SSO row 가 신규 row 로 INSERT (UNIQUE 제약 회피 위해 자체 가입 row 의 email
   에 `+disabled-{timestamp}` suffix 를 임시로 붙여 충돌 회피 — 단, 데이터 보존)
2. 자체 가입 row 는 `is_active=false`, `email = email || '+disabled-T'`
3. login 라우터는 `is_active=true` row 만 매칭하므로 자동으로 SSO row 로
   라우팅됨

**대안 (간단)**: 자체 가입 시 email 이 이미 *비활성* SSO row 와 충돌하면 거부.
이 alternative 가 더 단순하므로 1차 구현은 alternative 채택, 본 룰은
설계 문서 (design.md) 에서 한 번 더 확정.

### 2.5 부트스트랩 스크립트

```bash
BOOTSTRAP_ADMIN_EMAIL=admin@samsung.com \
BOOTSTRAP_ADMIN_PASSWORD=Init!Setup2026 \
apptainer exec instance://mxwp_api python3 /workspace/apps/api/app/scripts/bootstrap_admin.py
```

- env 비어 있으면 에러 종료
- email 이 이미 존재하면 idempotent skip (정보 로그)
- 첫 admin user row INSERT (role='admin', is_active=true)

---

## 3. Non-Functional Requirements

| 항목 | 기준 |
|---|---|
| Signup rate-limit | 분당 5회/IP (사내망이라 느슨하게) |
| 비밀번호 hashing | 기존 argon2 그대로 |
| audit_log | 가입 시 1 row (`event_type='user_signup'`, actor=신규 user) |
| 응답 시간 | < 500ms (argon2 cost factor 영향) |
| 트랜잭션 | user INSERT + audit_log INSERT 동일 트랜잭션 |

---

## 4. 마이그레이션 영향

**0049_users_groups_signup.py** (단일 마이그레이션):

```sql
-- 1. groups kind 컬럼
ALTER TABLE groups
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'group'
    CHECK (kind IN ('group','lab'));

-- 2. users.group_id (nullable, 가입 시 선택 가능)
ALTER TABLE users
  ADD COLUMN group_id UUID REFERENCES groups(id) ON DELETE SET NULL;

-- 3. seed MX division
INSERT INTO divisions (slug, name, description)
  VALUES ('mx', 'MX', '디폴트 디비전 (시드)')
  ON CONFLICT (slug) DO NOTHING;
```

down 마이그레이션: 위 역순. seed 는 down 에서 삭제하지 않음 (운영 데이터 보호).

---

## 5. 의존성 / 영향 범위

| 영향 | 정도 |
|---|---|
| 기존 login (`auth.py`) | 무변경 |
| 기존 SSO (`sso.py`) | 알고리즘은 본 사이클에서 변경 없음 (호환 보장은 design 에서 다룸) |
| `api_tokens.py` | 무관 |
| dev 폴백 (`_fetch_admin`) | 무변경 — 본 기능과 직교 |
| lat 문서 | `core.md` 에 새 엔드포인트 표 추가 필요 |

---

## 6. 산출물 정의

1. 마이그레이션 1개
2. 신규 라우터 파일 또는 기존 `auth.py` 확장 + 새 `orgs.py`
3. 부트스트랩 스크립트
4. 테스트 (signup happy path / 422 / 409 / admin-only / SSO 우선)
5. lat 문서 업데이트
6. PDCA design + analyze + report 문서

---

## 7. 위험 / 미확정

| 위험 | 완화 |
|---|---|
| email 도메인 화이트리스트 env 누락 시 default 동작 | 비어 있으면 모든 도메인 허용 (개발 편의), production 환경에서는 startup warn |
| SSO 우선 머지 룰의 alternative vs 본 룰 선택 | design 단계에서 1회 더 확정. 현재 plan 은 alternative (충돌 시 거부) 우선 |
| 부트스트랩 스크립트 실수로 두 번 돌면 어찌? | 멱등 보장 (이미 존재 시 skip) |
| 사내 도메인이 여러 개일 가능성 | env 콤마구분으로 다중 허용 |
| group 의 team_id 와 가입자 team_id 불일치 | 라우터 단 cross-check (FR-2.3) |

---

## 8. Acceptance Criteria

1. ✅ `POST /auth/signup` 으로 신규 user 생성 가능 (curl 1줄로 검증)
2. ✅ 잘못된 입력은 모두 422 (또는 409 for duplicate email)
3. ✅ admin 이 `POST /divisions` 등으로 조직 등록 가능
4. ✅ public `GET /divisions` 등으로 가입 폼이 데이터 받을 수 있음
5. ✅ `bootstrap_admin.py` 실행 후 첫 admin login 가능
6. ✅ 동일 email 로 자체가입 후 SSO 시도 시 자체 가입 row 가 비활성, SSO 우선
7. ✅ 모든 테스트 그린, CI matrix 양쪽 OS 그린
8. ✅ lat/core.md 갱신
