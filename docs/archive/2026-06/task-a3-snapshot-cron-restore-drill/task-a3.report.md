# task-a3-snapshot-cron-restore-drill — Completion Report

## Executive Summary

| | |
| --- | --- |
| **Feature** | Task A.3 — nightly snapshot timer + weekly restore drill CI + lat update |
| **Completion** | 2026-06-08 |
| **Match Rate** | 100% |
| **Commit** | `c82c407` |
| **Workflow** | 3 scout (snapshot/restore API + CI patterns) + 3 parallel impl |

### Value Delivered

| Perspective | Outcome |
| --- | --- |
| Problem | A.1 (.env.example placeholder) + A.2 (_common.sh guard) 가 land 됐지만 **자동 스케줄링 + 자동 검증 부재**. 17+ 일 검증 안 된 backup = DR posture 가 *theatre*. scout: "audit-grade finding" |
| Solution | (A.3-1) systemd user timer + retention. (A.3-2) GitHub Actions weekly restore drill (snapshot → mutate → restore → diff). (A.3-3) lat 갱신 |
| Function/UX | nightly snapshot 자동 생성 + 7일 retention. 매주 월요일 CI 가 *실제로 restore-snapshot.sh 가 동작하는지* 검증 |
| Core Value | DR 이 *theatre* → *verified posture*. silent exit-0 trap (stack down 시 restore-snapshot.sh 가 0 반환) 까지 catch |

### Scout 의 진짜 통찰

restore-snapshot.sh scout 가 **silent exit-0 trap 발견**:
- `restore-snapshot.sh` 가 stack down 상태에서도 0 반환 (psql/mc 가 0 받으면 OK 판정)
- post-restore *0 verification* — 데이터 무결성 검사 없음
- `--yes` 가 *positional arg 2* — `restore-snapshot.sh --yes` 만 주면 1 로 해석되어 fail

→ CI drill 의 *counts diff* + */healthz probe* 가 이 silent path 를 catch.

## A.3-1: systemd user timer

### 신규 파일
- `infra/systemd/mxwp-snapshot.service` — `ExecStart=__REPO_ROOT__/infra/scripts/snapshot-retention.sh` (placeholder)
- `infra/systemd/mxwp-snapshot.timer` — `OnCalendar=daily, RandomizedDelaySec=15min, Persistent=true`
- `infra/systemd/install-snapshot-timer.sh` — `--install/--uninstall/--status/--help`
- `infra/scripts/snapshot-retention.sh` — wrapper: snapshot.sh + retention prune

### 핵심 설계 결정
- **user systemd** (no root, apptainer rootless 와 일치) — install 시 `~/.config/systemd/user/` 로 copy
- **`__REPO_ROOT__` placeholder** — checked-in unit 이 zone-portable. install 시 `sed` 로 실 path 주입
- **`Persistent=true`** — host 재부팅 후 missed run catch
- **`RandomizedDelaySec=15min`** — 다중 host 환경에서 동시 부하 회피
- **retention** — `MXWP_SNAPSHOT_RETAIN_DAYS` (default 7), `find -mtime +N -delete` + sidecar `.sha256` 도 함께
- **3-zone safety** — timer 는 *install 된 zone* 만 영향. cross-zone replication 은 별도 (`make ship` Drive 파이프라인)

## A.3-2: restore-drill workflow

### 신규 파일
- `.github/workflows/restore-drill.yml`

### 트리거
- `schedule '0 6 * * 1'` — 매주 월요일 06:00 UTC (= 일요일 밤 한국)
- `workflow_dispatch` — manual
- `push to main` on `snapshot.sh` / `restore-snapshot.sh` / 본 workflow 변경

### Drill 단계
```
e2e.yml spine 재사용 (checkout → apptainer → deps → schema:gen →
  cp .env.example → ALLOW_PLACEHOLDER_SECRETS=1 → build → start →
  healthz wait → migrate → seed)
↓
pre-state hash (postgres doc count + mc ls --recursive | wc -l → pre.json)
snapshot.sh --note "ci-restore-drill"
mutate (DELETE 1 doc, verify count moved)
restore-snapshot.sh latest --yes
post-state hash → post.json
diff pre.json post.json (실패 시 job fail)
curl /healthz + GET /api/v1/documents smoke
upload artifacts (snapshot tar + sha256 + counts + infra logs)
teardown
```

### 핵심 결정
- **counts diff** — silent exit-0 trap (psql/mc 가 0 받았지만 데이터 비어있음) 의 마지막 방어선
- **healthz smoke** — stack-down 시 restore 0 반환 trap 의 두 번째 방어선
- **mutate guard** — DELETE 후 count 안 움직이면 fail (no-op mutation 이 no-op restore 가리는 케이스 catch)
- **concurrency** `restore-drill-${{ github.ref }}` + `cancel-in-progress`
- **timeout 60 min** — drill 자체는 ~25-30 분, 여유 잡음

## A.3-3: lat 갱신

### `docs/lat/snapshots.md`
**Settings / 환경변수** 와 **테스트 지도** 사이 4 섹션 추가:
1. **자동화 (systemd timer)** — 파일 위치, install 명령, `--status` 진단
2. **복원 드릴 (restore-drill.yml)** — 주간 cron, 4 verify step, artifact 이름 규칙
3. **보존** — `snapshot-retention.sh` + `MXWP_SNAPSHOT_RETAIN_DAYS` env
4. **3-zone 안전** — timer 는 per-zone, cross-zone 은 별도 Drive 파이프라인

기존 한국어 톤 + `[[src/...]]` 링크 스타일 + pipe-table 형식 유지.

## 검증
- **yaml lint pass** (`python3 -c "import yaml; yaml.safe_load(...)"`)
- **bash -n syntax** clean (install-snapshot-timer.sh + snapshot-retention.sh)
- **systemd-analyze verify** clean after placeholder resolution
- **install --help** 정상 렌더 + resolved repo path 보임
- **chunker --check** 0

## 3-zone 매핑

| 작업 | 영향 zone | 격리 |
|---|---|---|
| A.3-1 (systemd timer) | install 된 zone (online build host OR cae00) | 다른 zone 무관 — *cross-zone replication 은 별도* |
| A.3-2 (restore-drill CI) | GitHub Actions runner (CI 전용) | cae00 / hwax portal 무관 |
| A.3-3 (lat doc) | 읽는 사람만 | runtime 영향 0 |

## 누적

| Cycle | Commit |
|---|---|
| G1~N + meta-loop | a8e7d68 → 27e4617 |
| Opus 4.8 portal sub-path | 4c73305 → d50a7c8 |
| post-portal quad (D+B-1+C+B-2) | 1ee8239 → ce2ccdc |
| HWAX portal SSO callback (Opus 4.8) | a397a02 |
| **Task A.3** | **`c82c407`** |

## 잔여 (A.3 이후)

| 항목 | 상태 |
|---|---|
| ja/zh i18n | ⏸ 사용자 명시 제외 |
| Tooltip 컴포넌트 | ⏸ design system surface |
| Memoize buildCsv/buildTsv | ⏸ premature opt |
| Opus 4.8 의 portal SSO callback 후속 (HWAX 측 wiring 확인) | 사용자 portal 작업 영역 |

**🟢 scout 가 식별한 A/B/C 모든 task land 완료.**

## 핵심 인사이트

### 1. scout 가 silent exit-0 trap 을 발견
restore-snapshot.sh 가 *psql/mc 가 0 받으면 무조건 OK 판정* 하던 path 를 scout 가 코드 라인 단위로 분석해 적발. **이걸 모르고 CI drill 만 만들었으면** drill 도 함께 통과 → silent 데이터 손실 risk. counts diff + healthz probe 두 layer 가 cross-verify.

### 2. systemd unit 의 zone-portability
checked-in unit 에 `__REPO_ROOT__` placeholder → install 시 sed 주입. 같은 unit 파일이 *online build host* / *cae00* / *future-zone* 어디서든 작동. 하드코딩된 abs path 가 zone 마다 다른 문제 회피.

### 3. counts diff > "did psql exit 0"
*행위 검증* 이 아니라 *데이터 동등성 검증*. pre/post hash diff 가 단순하지만 강력 — `restore-snapshot.sh` 가 silently 빈 dump 를 load 해도 count 가 0 으로 떨어지면 즉시 catch.

### 4. CI cron + push 트리거 조합
주간 schedule 만으로는 *snapshot 스크립트 변경 후 다음 월요일까지 검증 안 됨*. push 트리거를 `snapshot.sh` / `restore-snapshot.sh` 자체 변경에도 걸어 *변경 즉시 drill*. 두 layer 가 *cadence* 와 *responsiveness* 둘 다 만족.
