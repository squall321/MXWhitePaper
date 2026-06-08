# post-portal-quad — Completion Report

## Executive Summary

| | |
| --- | --- |
| **Feature** | post-portal next-task quad (D → B-1 → C → B-2) |
| **Completion** | 2026-06-08 |
| **Match Rate** | 100% |
| **Commit** | `1ee8239` |
| **Trigger** | 4-lens scout 가 식별한 3 candidate (A=secrets/snapshot, B=maintenance/e2e, C=onboarding) + 빈 자리 D (Drive 자동화) |

### Value Delivered

| Perspective | Outcome |
| --- | --- |
| Problem | (a) Opus 4.8 의 portal 작업 후 release 가 매번 수동 build → to-drive → cae00 ssh → from-drive. (b) `images_pending` / `document_versions` 무한 grow (CLI 만 있고 ticker 없음). (c) 새 dev 가 5 분 안에 어디 봐야 할지 모름. (d) 12 E2E spec 이 committed 되어 있지만 CI 에서 한 번도 안 돔 |
| Solution | (D) `make ship` / `make pull-web` Makefile target 으로 3-zone 자동화. (B-1) `maintenance_runner` lifespan ticker. (C) `docs/README.md` map + 3-zone 다이어그램 + lat numbering/path fix. (B-2) `.github/workflows/e2e.yml` |
| Function/UX | 3-zone (online build host / cae00 / hwax portal) 배포 흐름이 *한 명령* 으로. silent DB grow 차단. 새 dev onboarding 마찰 감소. e2e 회귀 자동 catch |
| Core Value | 사용자 룰 *"전체 구조를 잘 지켜가면서 설계"* 충족 — 각 작업이 어느 zone 에 속하는지 명시 + zone 간 동작 격리 보장 |

## 3-zone 아키텍처 (재확인)

```
ONLINE BUILD HOST (인터넷 / npm / Docker-Hub 도달 가능)
  • MXWP_BASE_PATH=/mx-white-paper/ pnpm --filter @mx/web build
  • apptainer build web.sif (apps/web/dist 베이크)
  • make ship → Drive (rclone + sha256)
                              │
                              ▼
cae00 DEPLOY (corp TLS-intercept, no npm / no Docker-Hub)
  • make pull-web → web.sif 받음
  • make up → mxwp_web instance (no build)
  • serve -s /opt/web/dist on :5173
                              │
                              ▼
HWAX PORTAL (front nginx)
  • https://hwax.sec.samsung.net/mx-white-paper/ → :5173
  • /mx-white-paper/api/* → :8800 (API server, 별도)
```

각 작업의 zone 귀속:

| 작업 | 영향 zone | zone 간 격리 |
| --- | --- | --- |
| D (Makefile ship) | online build host + cae00 | hwax portal 영향 0 |
| B-1 (maintenance ticker) | API container (online + cae00 둘 다) | 외부 cron 의존 0, 단일 lifespan task |
| C (docs/onboarding) | 모든 zone 의 *읽는 사람* | runtime 영향 0 |
| B-2 (e2e CI) | online build host (CI runner) | cae00 / hwax 무관 |

## (D) Makefile Drive ship targets

### 추가 target
- `make build-web` — `MXWP_BASE_PATH` 베이크 + `apptainer build --force web.sif`
- `make ship-web` — `images-to-drive.sh` 위임 (rclone + sha256)
- `make ship` — `build-web + ship-web` 한 줄
- `make pull-web` — `images-from-drive.sh` 위임 (cae00 측)
- 모두 `.PHONY` 등록 + `make help` 에 *"Portal ship pipeline"* 섹션 명시

### 사용 흐름
```bash
[online host]   make ship                    # build + ship to Drive
[cae00]         make pull-web && make up     # pull + start (no build)
```

## (B-1) maintenance_runner ticker

### 변경 파일
- `apps/api/app/core/config.py` — `maintenance_runner_enabled: bool = True` 신규
- `apps/api/app/services/maintenance_runner.py` — 신규 ticker (audit_pruner 패턴 미러)
- `apps/api/app/main.py` — lifespan 의 8th task (기존 7 task 와 cancel 흐름 통합)
- `apps/api/tests/test_maintenance_runner.py` — 3 test 신규

### 동작
- `tick_once()` 가 **두 helper 동시** 호출:
  - `purge_expired_pending_uploads(s)` — TTL sweep (별도 session)
  - `compact_versions(s)` — per-doc 압축 (별도 session, TTL sweep 의 lock 해제 후)
- `settings.maintenance_runner_enabled=False` 시 no-op (CLI script 는 영향 없음)
- cadence 1h (housekeeping 은 second-resolution 불필요, `compact_versions` 가 무거움)

### test 결과
```
tests/test_maintenance_runner.py ...     [100%]   3 passed in 0.82s
```

## (C) docs onboarding

### 신규 파일
- `docs/README.md` — *"어디서부터 읽어야 하나"* 테이블 (10 row) + 3-zone ASCII 다이어그램 + 디렉토리 의미 표 + CLAUDE.md 강제 룰 4 줄 요약

### lat 정정
- `docs/lat/documents.md:171` — `[[apps/web/src/features/widgetExport.ts]]` (잘못된 경로) → `[[apps/web/src/lib/widgetExport.ts]]` (실 위치)
- `docs/lat/documents.md:614-632` — numbered list 가 `1..10..11..11..12..13` (duplicate 11, 잘못된 sequence) 였던 것을 `1..10..11..12..13..14` 로 회복 (3 항목 renumber)

## (B-2) e2e CI workflow

### 신규 파일
- `.github/workflows/e2e.yml`

### 트리거
1. `workflow_dispatch` — 수동 실행 + 옵션 `grep` 입력으로 spec 필터
2. `push to main` — `apps/web/tests/e2e/`, `apps/web/src/`, `apps/api/app/`, workflow 자체 변경 시

### Stage
```
checkout → install apptainer + node + python →
pnpm install → schema:gen → playwright install chromium →
cp .env.example .env (ALLOW_PLACEHOLDER_SECRETS=1) →
build.sh → start.sh →
wait for /healthz + :5173 (60 attempts × 2s) →
migrate.sh → seed.sh →
playwright test --project=chromium-desktop →
upload artifacts (HTML always, screenshots/videos on failure) →
stop.sh (always)
```

### 핵심 설계 결정
- `ALLOW_PLACEHOLDER_SECRETS=1` 으로 _common.sh guard 우회 (CI 의 ephemeral 환경만 — 회전된 production 영향 0)
- `chromium-desktop` project 만 — tablet/mobile 은 GitHub-hosted runner 시간 비용 절약 (필요 시 `inputs.grep` 으로 매뉴얼 선택)
- timeout 45 분 — apptainer build 가 무겁고 stack 부팅 + e2e 까지 합치면 30 분 근처
- self-hosted runner 보유 시 `runs-on: [self-hosted, linux, apptainer]` 로 변경 권장 주석 명시

## 검증
- **pytest** maintenance + maintenance_runner = **9/9 pass**
- **vitest 2513/2513 pass** (host node, mxwp_web instance 가 portal 작업으로 stopped 라 apptainer 우회)
- **typecheck clean**
- **app import smoke**: `create_app()` 호출 시 lifespan registry 정상
- **yaml lint pass** on `.github/workflows/e2e.yml`
- **chunker --check** exit 0

## 잔여 (이 cycle 이후)

| 항목 | 비고 |
|---|---|
| Scout 가 식별한 *Task A — snapshot cron + restore drill CI* | A.1 (.env.example placeholder) 와 A.2 (_common.sh guard) 은 이미 Opus 4.8 + 본 cycle 에서 끝. **A.3 (nightly snapshot cron + weekly restore drill CI)** 만 남음 — 별도 cycle 적합 (위험 / 영향 분리) |
| Tooltip 컴포넌트 replace native title | design system 변경 surface 큼 (이전 cycle 의 N self-review 시점 결정 유지) |
| 글로벌 i18n (ja/zh) | 사용자 명시 제외 |
| e2e 의 self-hosted runner migration | 사용자 환경 선택 (현재 ubuntu-latest 도 동작) |

## 누적 (G→N + post-portal)

| Cycle | Commit |
|---|---|
| G1~N (16 cycles, 20 commits) | a8e7d68 → d9f3934 |
| N meta-loop (1차/2차/3차 + suspected + polish) | cf3cfe3 → d468408 → 27e4617 |
| Opus 4.8 portal sub-path (별도 작업) | 4c73305 → e067ea0 → … → d50a7c8 |
| **post-portal quad (D+B-1+C+B-2)** | **1ee8239** |

## 핵심 인사이트

### 1. 다른 AI 와의 cooperative 작업
Opus 4.8 가 portal sub-path 9 commits 를 land 한 흔적 (`Co-Authored-By: Claude Opus 4.8`) 을 git log 에서 발견 → 사용자 알림으로 더 깊이 분석 → `.env.example` placeholder 가 **이미** Opus 4.8 의 e067ea0 에 묶여 commit 됨을 확인 → **내 변경이 중복 land 안 되도록** 진행 방향 조정.

### 2. CI runner cost 의 pragmatic balance
e2e workflow 를 *모든 push* 트리거로 만들면 무거움 (apptainer 설치 + 5 service stack + playwright). **path filter** (`apps/web/tests/e2e/`, `apps/web/src/`, `apps/api/app/`) 로 *진짜 회귀 가능* 변경 만 트리거. `workflow_dispatch` 로 매뉴얼 실행 보존.

### 3. lat 정정의 자동화 부재
`docs/lat/` 의 numbered list duplicate 가 *2 개 cycle 전* 부터 있었음 (scout 가 처음 식별). 코드 변경 시 같은 commit 에 lat 갱신하라는 룰 (CLAUDE.md) 이 *자동 enforcement 부재* 라 silent drift 누적. 향후 cycle 에서 `markdownlint --rules MD029` 를 pre-commit 에 추가 검토.

### 4. 3-zone 분리의 first-class 노출
이전 lat 에는 "online build host" / "cae00" / "hwax portal" 의 *3-zone 모델* 이 implicit (HWAX-PORTAL-INTEGRATION.md 안에 부분 설명만). `docs/README.md` 가 이 모델을 *first-class* 다이어그램으로 노출 → 새 dev 가 즉시 "어디 zone 의 어떤 작업인지" 분류 가능.
