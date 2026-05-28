# signup — Completion Report

## Executive Summary
| | |
|---|---|
| **Feature** | 사내 자가가입 + SSO 우선 머지 정책 |
| **Completion** | 2026-05-17 (100%) |
| **Match Rate** | 100% (8 tests pass) |

### Value Delivered

| Perspective | Outcome |
|---|---|
| Problem | dev 폴백 admin 만 있고 일반 사용자 가입 경로 부재 |
| Solution | POST /auth/signup + rate-limit + 조직 트리 (divisions/teams/groups) 24 endpoint + bootstrap_admin CLI |
| Function/UX | 사내망 사용자 직접 가입 + admin 부트스트랩 → SSO 진화 호환 |
| Core Value | 프로덕션 전환 가능한 인증 경로 완성 |

## 구현 위치
- `apps/api/app/services/signup_service.py` (6208 바이트)
- `apps/api/app/routers/auth.py` 의 POST /auth/signup + `_signup_rate_ok()`
- `apps/api/app/routers/orgs.py` 24 endpoint (divisions/teams/groups GET+POST)
- `apps/api/alembic/versions/0045_signup_users_groups.py`
- `apps/api/app/scripts/bootstrap_admin.py` (멱등)

## 테스트
- `test_signup.py` 8건

## 후속
- SSO 본격 도입 (Phase 3 잔여) — signup 은 SSO 우선 머지 정책 호환 설계
