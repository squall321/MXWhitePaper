# Snapshots lat — 시점 백업 + 완전 복원

> 운영 서버를 특정 시점으로 되돌리기 위한 풀스택 백업. PostgreSQL 덤프 +
> MinIO 객체 미러를 한 아카이브로 묶고, 초 단위 UTC 타임스탬프로 라벨링.
>
> 연관 lat: [[storage]] (MinIO 버킷) · [[core]] (admin 인증)

## 무엇이 들어가나 (그리고 무엇이 빠지나)

| 포함 | 이유 |
|---|---|
| PostgreSQL 전체 (`pg_dump --clean --if-exists \| gzip`) | 모든 문서/메타 |
| MinIO `mxwp-images` 버킷 전체 | 본문 이미지 |
| MinIO `mxwp-files` 버킷 전체 | 첨부 파일 |
| MinIO `mxwp-exports` 버킷 (있으면) | export artifacts |
| `manifest.json` | snapshot id, created_at (초 단위), sha256, 호스트 정보, note |

| 제외 | 이유 |
|---|---|
| Meilisearch 인덱스 | derived — 복원 후 API 가 documents 로부터 재구축 |
| `mxwp-backups` 버킷 | 백업의 백업은 안 만듦 (순환 방지) |
| 컨테이너 이미지 (.sif) | 별도 관리 — 백업이 아니라 배포 산출물 |
| `.env` / 자격증명 | 보안 — 별도 채널로 보관 |

## 산출물 모양

압축 풀면:
```text
mxwp-snapshot-YYYYMMDD-HHMMSSZ/
├── manifest.json
├── postgres.sql.gz
└── minio/
    ├── mxwp-images/
    │   └── <sha-prefix>/<sha>/orig.webp, view.webp, thumb.webp
    ├── mxwp-files/
    └── mxwp-exports/
```

파일명 예시: `mxwp-snapshot-20260513-143027Z.tar.gz` (UTC, 초 단위).
사이드카 SHA256: `mxwp-snapshot-….tar.gz.sha256`.

## 흐름도

```text
                  ┌─────────────────────────────────────────────┐
                  │ infra/scripts/snapshot.sh                   │
                  ├─────────────────────────────────────────────┤
                  │ 1. pg_dump (mxwp_postgres exec)             │
                  │ 2. for each bucket (≠ backups):             │
                  │      mc mirror minio/<b> ./<workdir>/<b>    │
                  │ 3. manifest.json 생성 (sizes, sha256)        │
                  │ 4. tar + gzip + 사이드카 sha256             │
                  │ 5. SNAPSHOT_DIR 로 이동                      │
                  └─────────────────────────────────────────────┘
                              │
                              ▼
                  ┌─────────────────────────────────────────────┐
                  │ POST /api/v1/snapshots ← 미구현              │
                  │ (현재 API 는 read-only — 생성은 쉘 스크립트만)│
                  └─────────────────────────────────────────────┘

         복원:
                  ┌─────────────────────────────────────────────┐
                  │ infra/scripts/restore-snapshot.sh <id|path> │
                  ├─────────────────────────────────────────────┤
                  │ 1. 사이드카 sha256 검증                       │
                  │ 2. tar 풀고 manifest 검사                     │
                  │ 3. psql 로 pg dump 적용 (--clean --if-exists)│
                  │ 4. mc mirror --remove ./minio/<b> minio/<b> │
                  │ 5. Meilisearch reindex 트리거 (또는 안내)    │
                  └─────────────────────────────────────────────┘
```

## API 엔드포인트

[[src/app/routers/snapshots.py]] (`/api/v1/snapshots`), **admin only**.

| Method | Path | 역할 |
|---|---|---|
| GET | `/` | 모든 스냅샷 메타데이터 + 사이즈 |
| GET | `/{id}` | 단일 스냅샷 상세 |
| GET | `/{id}/download` | tar.gz 스트림 다운로드 (chunked) |
| DELETE | `/{id}` | 스냅샷 파일 + 사이드카 삭제 |

**의도적으로 POST 가 없다.** 스냅샷 생성은 `pg_dump` / `mc` 가 필요한데
`api.sif` 컨테이너에 둘 다 없음. 호스트에서 apptainer + minio-mc 를 가진
환경이 실행해야 함 → 쉘 스크립트로만 노출.

서비스 측 진입점: [[src/app/services/snapshots.py]]
- `snapshots_dir()` — 스냅샷 보관 디렉토리 결정 (settings 또는 default)
- `list_snapshots()` — 디렉토리 스캔 → tar 안 manifest 읽기 + stat
- `get_snapshot()` — 단일 조회
- `iter_snapshot_bytes()` — chunked 스트림 다운로드
- `delete_snapshot()` — 파일 + .sha256 사이드카 삭제
- `_read_manifest_from_tar()` — tar 안 manifest.json 읽기 (전체 압축 풀지 않고)

## manifest.json 스키마

manifest.json 의 실제 shape 는 `snapshot.sh` 가 빌드한다 — 아래는 그
스크립트 출력에 맞춰진 키. (DB 인디케이터/host/components 같은 풍부한 정보는
없음 — pg_dump / mc mirror 결과의 sha256 + 크기 + tool 버전만 기록.)

```json
{
  "snapshot_id": "mxwp-snapshot-20260513-143027Z",
  "created_at":  "2026-05-13T14:30:27Z",
  "created_at_epoch": 1747139427,
  "note":        "before v2 migration",
  "tool_version": "...",
  "components": {
    "postgres": { "filename": "postgres.sql.gz", "sha256": "..." },
    "buckets": [
      { "name": "mxwp-images", "filename": "mxwp-images.tar", "sha256": "..." }
    ]
  }
}
```

## 스크립트 (infra/scripts)

| 스크립트 | 역할 |
|---|---|
| [[src/infra/scripts/snapshot.sh]] | 스냅샷 생성 |
| [[src/infra/scripts/restore-snapshot.sh]] | 복원 |
| [[src/infra/scripts/_common.sh]] | 공통 (`require_apptainer`, `instance_running`, `INST_*` 등) |

### snapshot.sh 사용법

```bash
./infra/scripts/snapshot.sh                                # 기본 위치 + 타임스탬프
./infra/scripts/snapshot.sh --note "before v2 migration"   # 메모 첨부
SNAPSHOT_DIR=/data/snapshots ./infra/scripts/snapshot.sh   # 위치 오버라이드
```

내부에서 `apptainer exec instance://mxwp_postgres pg_dump …` 로 호출. mc 는
별도 `mc.sif` 컨테이너 (없으면 호스트 `mc` 사용 — 스크립트가 자동 검출).

### restore-snapshot.sh 주의

복원은 **파괴적** — 현재 DB / MinIO 객체를 모두 덮어씀. 스크립트는 시작 시
확인 프롬프트를 띄움 (`y` 입력 필요). 자동화 시엔 `FORCE=1` 환경변수.

복원 후:
1. API 컨테이너 재시작 (`apptainer instance stop mxwp_api && start ...`)
2. Meilisearch 인덱스 자동 재구축 (첫 검색 요청 시) — 즉시 재구축 원하면
   admin 의 reindex 엔드포인트 호출

## mc 호환성

스크립트는 두 가지 mc 사양을 모두 지원해야 함:
- **표준 mc** (호스트 시스템) — `mc ls --json` 출력이 표준
- **`mc.sif` 컨테이너** 안의 mc — 일부 minimal 컨테이너엔 `sed` 없음

과거 버그: bucket 열거 시 쉘 sed 파이프라인을 썼다가 `mc.sif` 에 sed
없어서 실패 → **python3 stdin 파서**로 교체됨. mc 출력 가공 시 python3
fallback 사용 패턴 유지.

## Gotchas

1. **시간대**: 파일명/manifest 의 `created_at` 은 **UTC + Z 접미사**.
   복원 시 사용자 표시는 로컬 변환.
2. **두 스냅샷이 같은 초에 생성**되면 파일명이 충돌 — 현재 스크립트는
   tie-break 로직이 없어 그냥 **두 번째가 첫 번째를 덮어쓴다** (`.tar.gz`
   + `.sha256` 사이드카 모두). 자동화에서 sub-second 빈도로 돌리지 말 것 —
   필요하면 호출 측에서 `--note` 와 함께 SNAPSHOT_DIR 을 분리하거나
   1 초 이상 텀.
3. **PostgreSQL 버전 차이** — `pg_dump` 메이저 버전이 복원 대상보다 높아야 함.
   복원 환경에 16+ pg 가 있는지 확인.
4. **MinIO bucket 정책** — `mc mirror --remove` 가 dest 에 있는 객체를 지움.
   복원 직전에 dest 가 비어있지 않으면 의도된 동작이지만, 다른 데이터를
   섞어두고 있다면 사고. 복원은 **빈 환경 또는 같은 스냅샷 출처**에서만.
5. **이메일/SSO/Webhook 자격증명**은 DB 에 저장되어 함께 복원되지만 `.env`
   의 마스터 키가 다르면 복호화 실패. `.env` 도 같은 백업 정책으로 관리.
6. **manifest 의 sha256** 는 **검증용** — 변조 탐지. 강력한 보안은 아니지만
   디스크 손상 / 부분 다운로드 잡아냄.

## Settings / 환경변수

`app.core.config` 에는 snapshot 관련 키가 *없다.* 다음 두 가지로 동작:

- **API 의 디렉토리 결정** — [[src/app/services/snapshots.py#snapshots_dir]] 가
  `SNAPSHOT_DIR` 환경변수 (기본 `infra/backups/snapshots`) 를 읽는다.
  Settings 가 아니라 직접 `os.environ.get(...)` 사용.
- **파일명 prefix** — `snapshot.sh` 가 하드코딩 (`mxwp-snapshot-`). 변경하려면
  스크립트 수정.

설정값을 Settings 로 옮기고 싶으면 두 곳 모두 같이 갱신해야 한다.

## 자동화 (systemd timer)

스냅샷 생성을 cron 대신 **systemd user timer** 로 돌린다 — `mxwp-stack.service`
와 같은 user-level 단위로 묶여 linger 만 켜져 있으면 reboot 후에도 살아 있음.

| 파일 | 역할 |
|---|---|
| [[src/infra/systemd/mxwp-snapshot.service]] | `snapshot.sh --note "auto-timer"` 를 oneshot 으로 실행 |
| [[src/infra/systemd/mxwp-snapshot.timer]] | `OnCalendar=*-*-* 03:30:00` (로컬 TZ, persistent=true) |

### 설치

```bash
cp infra/systemd/mxwp-snapshot.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now mxwp-snapshot.timer
```

linger 가 꺼져 있으면 [[src/infra/systemd/README.md]] 참조 (1회 sudo 필요).

### 상태 확인

```bash
./infra/scripts/snapshot.sh --status
# 내부적으로:
#   systemctl --user list-timers mxwp-snapshot.timer
#   systemctl --user status mxwp-snapshot.service --no-pager
#   ls -lh "$SNAPSHOT_DIR" | tail -5
```

`--status` 는 실제 스냅샷을 만들지 않는다 — timer 의 다음 실행 시각 / 마지막
종료 코드 / 최근 산출물 5 개만 보여주는 read-only 진단 플래그.

## 복원 드릴 (restore-drill.yml)

[[src/.github/workflows/restore-drill.yml]] — **주 1 회** (`schedule: cron '0 4 * * 1'`,
월요일 04:00 UTC) GitHub Actions 가 가장 최근 스냅샷을 임시 postgres + minio
컨테이너에 풀어 검증한다. 실 운영 인스턴스는 건드리지 않음 — runner 안
ephemeral 환경.

검증 항목:

1. 사이드카 sha256 일치
2. `manifest.json` 의 components 가 tar 안 실제 파일과 1:1 매칭
3. `psql` 로 dump 적용 후 `SELECT count(*) FROM documents` 가 > 0
4. `mc mirror` 로 `mxwp-images` 복원 후 임의 객체 `HEAD` 200

산출물 (artifact name: `restore-drill-<run-id>`):

- `drill-report.md` — 위 4 단계 PASS/FAIL 표 + 사용된 스냅샷 id
- `psql-restore.log`, `mc-mirror.log` — 원시 로그
- 실패 시 GitHub issue 자동 생성 (`label: snapshot-drill-failure`)

수동 trigger: workflow_dispatch (특정 snapshot id 지정 가능).

## 보존 (snapshot-retention.sh)

타이머가 매일 돌면 디스크가 금방 찬다 — wrapper 가 보존 정책을 강제.

[[src/infra/scripts/snapshot-retention.sh]] — `SNAPSHOT_DIR` 안에서 mtime 기준
`MXWP_SNAPSHOT_RETAIN_DAYS` (기본 **7 일**) 보다 오래된 `mxwp-snapshot-*.tar.gz`
와 짝꿍 `.sha256` 사이드카를 함께 삭제. `.deleted` suffix 없이 즉시 unlink
(재현 가능한 generator 가 아니므로 trash 보관 안 함).

```bash
./infra/scripts/snapshot-retention.sh                          # 기본 7 일
MXWP_SNAPSHOT_RETAIN_DAYS=30 ./infra/scripts/snapshot-retention.sh
MXWP_SNAPSHOT_RETAIN_DAYS=30 SNAPSHOT_DIR=/data/snapshots ./infra/scripts/snapshot-retention.sh
```

`mxwp-snapshot.service` 의 `ExecStartPost=` 에서 호출되므로 timer 가 돌 때마다
**생성 직후** retention 이 같이 실행 — 별도 timer 가 필요 없음.

## 3-zone 안전 (timer 의 범위)

본 timer 는 **설치된 zone 한 곳만** 백업한다. MXWhitePaper 는 3-zone (dev /
staging / prod) 으로 운영되는데, `mxwp-snapshot.timer` 를 zone A 호스트의
`~/.config/systemd/user/` 에 깔면 zone A 의 postgres + MinIO 만 스냅샷이
잡힌다. zone B/C 가 자동으로 따라오지 않음.

3-zone 간 **교차 복제는 별도 채널** — 기존 Google Drive sync
([[src/infra/scripts/data-dump-to-drive.sh]], [[src/infra/scripts/data-merge-from-drive.sh]],
setup-drive-sync.sh) 가 담당하며 snapshot timer 와 독립적으로 동작한다.

운영 룰:

| zone | timer 설치 | drive sync |
|---|---|---|
| prod | enable (매일 03:30 로컬) | dump → Drive |
| staging | enable (테스트용 — 짧은 retention 권장) | merge ← Drive (필요 시) |
| dev | disable | manual |

timer 가 동작 중인 zone 의 호스트 장애 = 해당 zone 의 백업 손실. Drive
복제가 있어야 zone 간 회복 가능. timer 와 Drive sync 는 **AND 조건**으로
설계되어 있다 — 한쪽만으로는 다중 zone 복구가 불가능.

## 테스트 지도

| 파일 | 무엇 |
|---|---|
| [[src/tests/test_snapshots.py]] | list/get/download/delete + 사이드카 동작 |

생성/복원 스크립트는 **integration test 가 없다** — 실 DB / MinIO 가
필요해서 CI 에서 못 돌림. 수동 검증 SOP 는 [[docs/deployment-playbook.md]].
