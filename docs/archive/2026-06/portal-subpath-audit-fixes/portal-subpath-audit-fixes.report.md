# portal-subpath-audit-fixes — Completion Report

## Executive Summary

| | |
| --- | --- |
| **Feature** | Opus 4.8 portal sub-path commit chain (4c73305 → d50a7c8) adversarial audit → 5 high + 4 medium fix (M5 false-positive) |
| **Completion** | 2026-06-09 |
| **Match Rate** | 100% |
| **Audit workflow** | 3 parallel scout (vite-web / web.def+serve / SPA bootstrap) + synth |
| **Fix commit** | `d15542f` |

### Value Delivered

| Perspective | Outcome |
| --- | --- |
| Problem | portal-sso fix 후속 — Opus 4.8 의 10+ portal commits 가 *standalone* 환경에서만 검증됨. **portal mode 동작 검증 0**. 5 high (literals / base normalize / prefill leak / dist precheck / CORS) + 5 medium 잠재 silent bug |
| Solution | 3-scout adversarial workflow → 10 bug 발견 → 9 fix + 1 false-positive (M5 — fetch credentials 이미 존재) |
| Function/UX | portal sub-path 에서 API 호출 / login redirect / 자료 navigation 정상 작동. credential leak 차단 |
| Core Value | 다른 AI 의 land 후 *체계적 검증* 가 silent bug 조기 catch (portal SSO 의 APIError pattern 과 같은 종류) |

## 5 High severity fixes

### H1 — Hardcoded `/api/v1` + `/login` + `/docs/new` literals
**문제**: `lib/api/client.ts` + `features/sharing/api.ts` 두 곳만 `${BASE_URL}api/v1` 패턴 적용. 나머지 7 sites 가 `|| '/api/v1'` fallback 유지 → portal sub-path 에서 404.

**Sites fixed**:
- API fallback (7 files, 8 occurrences):
  - `features/admin/api.ts:146`
  - `features/presence/api.ts:55`
  - `features/backups/api.ts:122`
  - `pages/Diag.tsx:28, 133`
  - `pages/DocumentReader.tsx:122`
  - `components/BootBanner.tsx:23`
- `/login` redirect:
  - `pages/Diag.tsx:86` — `location.assign(BASE_URL+'login')`
  - `bootstrap.ts:81, 83` — pathname 비교 + redirect 둘 다 BASE_URL prefix
- `/docs/new` redirect:
  - `features/editor/components/SectionEditor.tsx:133`

**Pattern**: `${import.meta.env.BASE_URL}api/v1` 또는 `${import.meta.env.BASE_URL}login`.

### H2 — VITE_BASE_PATH trailing-slash normalization
**문제**: `apps/web/vite.config.ts:8` 가 `process.env.VITE_BASE_PATH || '/'` 만 — 사용자가 `/mx-white-paper` (trailing slash 없이) 설정 시:
- Vite base 가 broken (asset URL 생성 깨짐)
- API_PREFIX → `/mx-white-paperapi` (proxy match 실패)

**Fix**: `normalizeBase()` 함수가 항상 trailing slash 보장:
```ts
function normalizeBase(input: string | undefined): string {
  const v = (input || '/').trim()
  return v.endsWith('/') ? v : v + '/'
}
```

### H3 — VITE_PREFILL_LOGIN credential leak in prod
**문제**: `d50a7c8` 가 portal demo 용으로 `VITE_PREFILL_LOGIN=1` 추가 — 의도는 demo 빌드만. 하지만 *real production 빌드* 에 실수로 켜지면 `admin@mx.local / admin1234!` 자격증명이 사전입력된 채 노출.

**Fix** (`pages/Login.tsx:93-108`): 3-tier gate
1. `import.meta.env.DEV` → 항상 prefill (개발 편의)
2. `VITE_PREFILL_LOGIN=1` + `MODE !== 'production'` → prefill + `console.warn`
3. 그 외 → 빈 form

production build 는 *어떤 env* 라도 prefill 거부.

### H4 — web.def empty-dist silent breakage
**문제**: `49f5efd` 의 `%files apps/web/dist /opt/web/dist` 가 dist 부재 시 *silent 빈 디렉토리* 패키징 → `serve -s` 가 empty `index.html` 을 200 으로 응답 → instance 가 *healthy* 처럼 보이지만 broken SPA.

**Fix** (`infra/scripts/build.sh`): `web.sif` 빌드 직전 `apps/web/dist/index.html` 존재 검증, 부재 시 fail-fast + 빌드 명령 안내.

### H5 — CORS portal origin guidance
**문제**: `.env.example` 의 `CORS_ORIGINS` 가 localhost + 사내 IP 만 — portal 뒤에서 SPA 가 `https://hwax.sec.samsung.net` origin 으로 호출하면 preflight 거부.

**Fix** (`.env.example:163-170`): 주석에 portal origin 추가 가이드 + nginx 의 Origin forward 동작 설명.

## 4 Medium severity fixes

### M1 — web serve empty-dist runtime guard
**문제**: `start.sh:258` 의 `:5173` check 가 *HTTP 200* 만 보면 healthy 판정. 빈 dist 의 empty `index.html` 도 200.

**Fix** (`start.sh:260-269`): `<script type="module"` 매칭으로 *진짜 SPA build* 검증. 빈 dist 면 경고 + 재빌드 안내.

### M2 — API_PROXY shared object → factory
**문제**: `vite.config.ts:23` 의 `API_PROXY` 객체가 server + preview 둘 다에 같은 ref. `http-proxy` 가 옵션을 내부 mutate (listener 등록) → duplicated listener risk.

**Fix**: `makeApiProxy()` factory function 으로 매번 새 객체. server + preview 가 *독립 깨끗한 옵션* 받음.

### M3 — recharts `^3.8.1` → `~3.8.1`
**문제**: `f471903` 이 manualChunks 의 recharts/d3/redux 분할이 cycle dep 유발해 제거. `^` (minor 허용) 는 recharts 3.9 의 내부 구조 변경 시 같은 cycle 재유입 risk.

**Fix** (`apps/web/package.json:49`): `~` 로 patch 만 허용.

### M4 — start-behind-portal.sh dev-only 명시
**문제**: `9364070` 가 추가한 launcher 가 `49f5efd` 이후 *prod 흐름* (`make ship` + `make pull-web`) 으로 대체됐는데 헤더 주석은 ambiguous. cae00 에서 실수로 돌리면 `pnpm install` 깨짐.

**Fix** (`start-behind-portal.sh:9-17`): 헤더에 "DEV 전용" + 정확한 prod 흐름 안내.

### M5 — synth false-positive
`Diag.tsx:163` 의 fetch `/auth/login` 이 **이미 `credentials: 'include'` 보유**. actionable fix 없음, 보고만.

## 검증
- **typecheck clean**
- **vitest 2513/2513 pass** (회귀 0)
- **portal SSO bug fix test 5/5** 회귀 0
- **chunker --check** exit 0

## 핵심 인사이트

### 1. 다른 AI 의 *standalone-only* 검증 한계
Opus 4.8 가 10+ portal commits land 했지만 *portal mode 자체* 검증한 흔적 없음. portal SSO callback bug (이전 cycle) + 본 cycle 의 5 high 둘 다 *portal mode 에서만 발현*. **다른 AI 작업 후엔 그 작업의 *target mode* 로 실제 테스트** 가 필수.

### 2. 3-scout adversarial workflow 가 high-recall 보장
1 scout 가 놓치는 영역을 다른 scout 가 catch:
- vite-web scout: H2 + H3 + M2 + M3
- web.def+serve scout: H4 + H5 + M1 + M4
- SPA bootstrap scout: H1 (8 sites)

각 scout 의 *영역 정의가 비겹침* 이라 redundancy 보다 *coverage* 우선.

### 3. Fallback pattern 의 *project-wide* 강제
H1 의 7 sites 가 `|| '/api/v1'` 잘못된 fallback. **유일한 canonical fallback** 은 `${BASE_URL}api/v1`. 새 API 호출자 추가 시 *반드시* `lib/api/client.ts` 의 `baseURL` 을 재사용하거나 같은 패턴. lat 에 명시 (다음 사이클 후속).

### 4. fail-fast > silent-but-healthy
H4 + M1 이 같은 패턴: *200 응답 받았으니 healthy* 가정 → empty index.html 도 200. *컨텐츠 검증* (script tag 매칭) 이 *접속 검증* (HTTP 200) 보다 정직.

## 누적 (G → portal audit)

| Cycle | Commit |
|---|---|
| G1~N + meta-loop | a8e7d68 → 27e4617 |
| Opus 4.8 portal sub-path | 4c73305 → d50a7c8 |
| post-portal quad | 1ee8239 → ce2ccdc |
| Opus 4.8 portal SSO callback | a397a02 |
| Task A.3 (snapshot/restore) | c82c407 + 5170bea |
| portal SSO bug fix | 58de9b0 + 43af875 |
| **portal subpath audit fixes** | **`d15542f`** |
