# 데이터 이전 가이드 — Snapshot vs Data-Merge

> 두 서버 간 데이터를 옮기는 두 가지 방법. 상황에 맞게 골라 쓰면 된다.

## 한눈에 비교

| 도구 | 동작 | 기존 데이터 | 용도 |
|---|---|---|---|
| **`snapshot.sh` + `restore-snapshot.sh`** | 완전 백업 / 복원 | **덮어씀** (DROP+CREATE) | 새 서버 초기 설치, 서버 이전, 백업 복구 |
| **`data-dump.sh` + `data-merge.sh`** | 컨텐츠만 추출 / 추가 | **보존** (skip/overwrite/newest 선택) | 이미 운영 중 서버에 다른 서버 데이터 합치기 |
| **`data-dump-to-drive.sh` + `data-merge-from-drive.sh`** | Drive 경유 자동화 (rclone) | 동일 | 두 서버 정기 동기화 (예: cron) |

핵심 차이: `restore-snapshot` 은 *모든 테이블을 비우고* 백업으로 채워넣는다. `data-merge` 는 *기존 row 는 그대로 두고* 새 row 만 추가하거나 정책에 따라 덮어쓴다.

---

## 1. Snapshot (전체 백업·복원)

### 1.1 무엇이 포함되나

- **PostgreSQL** — 모든 테이블 (users, sessions 포함)
- **MinIO** — 모든 bucket (백업 bucket 자동 제외)
- **Meilisearch 제외** — derived index. 복원 후 자동 재인덱스
- **manifest.json** — id, 시각, 크기, sha256 체크섬

### 1.2 만들기

```bash
# 기본
./infra/scripts/snapshot.sh

# 메모 첨부 (어떤 시점인지 식별용)
./infra/scripts/snapshot.sh --note "before-v2-migration"

# 다른 위치 (외장 HDD, NFS 등)
SNAPSHOT_DIR=/mnt/external/snapshots ./infra/scripts/snapshot.sh
```

출력: `infra/backups/snapshots/mxwp-snapshot-YYYYMMDD-HHMMSSZ.tar.gz` + `latest.tar.gz` symlink.

### 1.3 복원 (대상 서버에서)

```bash
# 최신 snapshot 사용
./infra/scripts/restore-snapshot.sh latest --yes

# 특정 파일 지정
./infra/scripts/restore-snapshot.sh ~/mxwp-snapshot-20260521-041527Z.tar.gz --yes

# 환경 변수로 confirm (CI/스크립트용)
CONFIRM=yes ./infra/scripts/restore-snapshot.sh latest
```

### 1.4 동작 흐름 (자동)

1. snapshot tar.gz 의 sha256 + manifest 검증
2. **`mxwp_api` instance stop** (라이브 쓰기와 race 방지)
3. PostgreSQL: 모든 테이블 DROP+CREATE → `postgres.sql.gz` 복원
4. MinIO: 각 bucket 비우고 mirror 복원
5. 전체 스택 restart
6. Meilisearch 는 *비어있는 상태* — 첫 요청 시 또는 `/api/v1/admin/reindex` 호출 시 재인덱스

### 1.5 새 서버에 처음 깔 때 전체 흐름

```bash
# 1) 현재 서버에서 snapshot
./infra/scripts/snapshot.sh --note "to-new-server"

# 2) 전송
scp infra/backups/snapshots/mxwp-snapshot-*.tar.gz user@new-server:~/

# 3) 새 서버 — 코드 + 환경 준비
git clone <repo> /opt/MXWhitePaper && cd /opt/MXWhitePaper
cp .env.example .env   # 현재 서버의 .env 같이 복사하면 더 매끄러움
./quickstart.sh        # apptainer 1.3.6 vendor + image build + instance start

# 4) 복원
mv ~/mxwp-snapshot-*.tar.gz infra/backups/snapshots/
./infra/scripts/restore-snapshot.sh latest --yes

# 5) 확인
curl http://127.0.0.1:8800/api/v1/healthz
```

---

## 2. Data-Merge (추가만 — 데이터 합치기)

### 2.1 무엇이 포함되나

- **컨텐츠 테이블** — documents (본문/제목/상태), tags, document_tags, divisions, teams, groups, parts
- **MinIO** — 업로드된 이미지/파일 (sha256 content-addressed 라 자연 dedup)
- **제외** — users, sessions, api_tokens (각 서버 고유)

### 2.2 만들기 (export 측)

```bash
./infra/scripts/data-dump.sh
./infra/scripts/data-dump.sh --note "merge-from-prod"
./infra/scripts/data-dump.sh --no-minio   # 컨텐츠만, MinIO 제외
```

출력: `infra/backups/data-dumps/mxwp-data-YYYYMMDD-HHMMSSZ.tar.gz`.

구조:
```
mxwp-data-YYYYMMDD-HHMMSSZ/
├── manifest.json
├── jsonl/
│   ├── manifest.json
│   ├── divisions.jsonl
│   ├── teams.jsonl
│   ├── groups.jsonl
│   ├── parts.jsonl
│   ├── tags.jsonl
│   ├── documents.jsonl       (본문 포함 — 대부분 용량 차지)
│   └── document_tags.jsonl
└── minio/
    └── mxwp-images/...        (선택)
```

### 2.3 적용 (대상 서버에서)

**1단계 — Dry-Run 으로 영향 확인** (강력 권장):
```bash
./infra/scripts/data-merge.sh latest --dry-run
```

예상 출력:
```
  divisions  : +0 inserted / 1 skipped
  teams      : +0 inserted / 3 skipped
  groups     : +0 inserted / 2 skipped
  parts      : +0 inserted / 2 skipped
  tags       : 1200 reused / +120 new
  docs       : +450 inserted / 80 skipped / 0 overwritten
  doc_tags   : +1530
  links      : skipped — rebuild via refresh_links
  (dry-run: no changes written)
```

→ 450 doc 이 새로 들어오고 80 doc 은 이미 있으므로 skip.

**2단계 — 실제 적용**:
```bash
./infra/scripts/data-merge.sh latest
# 또는 자동 confirm
CONFIRM=yes ./infra/scripts/data-merge.sh latest
```

### 2.4 충돌 정책

같은 slug 가 양쪽에 있을 때:

| 옵션 | 동작 | 언제 쓸지 |
|---|---|---|
| `--on-conflict=skip` (**default**) | source 무시, 대상 서버 row 유지 | 대상 서버가 마스터. 안전. *재실행해도 멱등* |
| `--on-conflict=overwrite` | source 가 대상 row 를 덮어씀 (content_json, title, status, updated_at=NOW) | source 가 마스터. 표준화/통합 |
| `--on-conflict=newest` | 양쪽 updated_at 비교 → *더 최신* 쪽으로 덮어씀. source.updated_at 보존 | 양쪽 모두 작업 진행 중. 두 서버 cross-sync. **Drive 자동화의 default** |

### 2.5 다른 옵션

```bash
# 모든 새 doc 의 owner 를 지정 사용자로 (이메일 → user lookup)
./infra/scripts/data-merge.sh latest --owner-email=admin@example.com

# 기본은 첫 admin user 가 owner. 없으면 에러.

# MinIO 제외 (이미지 안 합치고 컨텐츠만)
./infra/scripts/data-merge.sh latest --no-minio
```

### 2.6 후처리 (자동)

merge 완료 후 자동 실행:
1. `refresh_links` — 새 doc 의 본문에서 `[[wiki]]` 파싱 → links 테이블 채움
2. `indegree` 백필 — links 기반으로 `documents.indegree` 재계산
3. (있으면) Meili reindex

수동 트리거 필요한 경우:
```bash
apptainer exec --env DATABASE_URL=... instance://mxwp_api \
  python -m app.scripts.refresh_links

apptainer exec --env DATABASE_URL=... --env MEILI_HOST=... --env MEILI_MASTER_KEY=... \
  instance://mxwp_api python -m app.scripts.reindex
```

### 2.7 전체 흐름 — 운영 중 서버에 합치기

```bash
# 1) 출처 서버
./infra/scripts/data-dump.sh --note "from-prod-A"
scp infra/backups/data-dumps/mxwp-data-*.tar.gz user@prod-B:~/

# 2) 목적지 서버 — 먼저 dry-run
mv ~/mxwp-data-*.tar.gz /opt/MXWhitePaper/infra/backups/data-dumps/
./infra/scripts/data-merge.sh latest --dry-run

# 3) 결과 확인 → 만족스러우면 실제 적용
./infra/scripts/data-merge.sh latest

# 4) 검증
curl http://127.0.0.1:8800/api/v1/healthz
curl http://127.0.0.1:8800/api/v1/home/hero | jq '.data.domains[].doc_count'
```

---

## 3. Google Drive 경유 자동화

매번 scp 하기 귀찮을 때, *rclone + Google Drive* 로 두 서버를 잇는다.
한 서버가 *dump → Drive 업로드*, 다른 서버가 *Drive 다운 → 자동 merge*. cron 으로 정기 동기화 가능.

### 3.1 사전 준비 (양쪽 서버 1회)

```bash
# rclone 설치
apt-get install -y rclone           # Ubuntu/Debian
# 또는: https://rclone.org/install/ 의 install.sh

# Drive remote 설정 — 대화식
rclone config
# → n (new remote)
# → name: MxwpDrive  (편한 이름)
# → storage: drive
# → client_id / secret: blank (rclone 기본 사용)
# → scope: drive  (full access)
# → 인증: 헤드리스면 'auto config: n' → 로컬에서 token 얻고 paste
# → team drive: 보통 n
# → 검증 → quit

# .env 에 변수 추가 (양쪽 서버 같은 값)
echo 'MXWP_DRIVE_REMOTE=MxwpDrive:MXWhitePaper/data-dumps' >> .env
echo 'MXWP_DRIVE_RETAIN=5' >> .env   # 가장 최근 5개만 Drive 에 유지
```

### 3.2 export 서버 — Drive 로 업로드

```bash
./infra/scripts/data-dump-to-drive.sh
# 또는 메모 첨부
MXWP_DUMP_NOTE="weekly-sync" ./infra/scripts/data-dump-to-drive.sh
```

자동 동작:
1. `data-dump.sh` 실행 → tar.gz 생성
2. *복원 가이드 md* 도 같이 생성 (어떤 archive 인지, 어떻게 복원하는지 — 다른 사람도 받아서 바로 사용)
3. tar.gz + 가이드 md 둘 다 Drive 로 업로드
4. shareable link 출력
5. retention 적용 — 오래된 archive 자동 삭제 (MXWP_DRIVE_RETAIN 기준)

### 3.3 import 서버 — Drive 에서 받아 자동 merge

```bash
# 가장 최근 dump 자동 선택 → 다운로드 → newest 정책으로 merge
./infra/scripts/data-merge-from-drive.sh

# dry-run 먼저
./infra/scripts/data-merge-from-drive.sh --dry-run

# 정책 변경
MXWP_MERGE_POLICY=skip ./infra/scripts/data-merge-from-drive.sh
# 또는
./infra/scripts/data-merge-from-drive.sh --on-conflict=overwrite
```

자동 동작:
1. Drive `$MXWP_DRIVE_REMOTE/` 에서 최신 `mxwp-data-*.tar.gz` 찾기
2. `infra/backups/data-dumps/` 로 다운로드 (이미 있으면 skip — 멱등)
3. 가이드 md 도 같이 다운 (있으면)
4. `data-merge.sh` 호출 — 정책 + dry-run/no-minio/owner-email 그대로 전달

### 3.4 cron 으로 정기 동기화

export 서버 — 매일 새벽 3시 dump+upload:
```cron
0 3 * * * cd /opt/MXWhitePaper && ./infra/scripts/data-dump-to-drive.sh >> /var/log/mxwp-dump.log 2>&1
```

import 서버 — 매일 새벽 4시 download+merge:
```cron
0 4 * * * cd /opt/MXWhitePaper && ./infra/scripts/data-merge-from-drive.sh >> /var/log/mxwp-merge.log 2>&1
```

`newest` 정책이라 *양쪽이 따로 작업* 해도 두 서버가 결국 *같은 최신 상태* 로 수렴.

### 3.5 양방향 sync

서버 A·B 가 *각자 작업하면서 서로 동기화* 하려면:

- A: dump-to-drive (자기 변경 업로드) → B: merge-from-drive (받아서 합침, newest)
- B: dump-to-drive (B 의 변경 — 합쳐진 결과 포함 업로드) → A: merge-from-drive

각 cycle 끝나면 *양쪽 다 같은 최신 컨텐츠*. `newest` 가 *각 doc 별로* 더 최신 쪽 선택.

---

## 4. 자주 묻는 질문

### Q1. 두 서버의 user 계정이 다른데?

`data-merge` 는 *users 테이블을 옮기지 않는다*. 새 doc 의 owner 는:
- `--owner-email=<email>` 으로 명시한 사용자 (대상 서버에 lookup)
- 명시 안 하면 대상 서버의 *첫 admin user*

owner 가 정확히 일치할 필요는 없다 — slug, 본문, tag, 조직 매핑이 핵심.

### Q2. 같은 slug 인데 본문이 다른 경우?

- `skip`: 대상 서버 본문 유지 (default)
- `overwrite`: source 본문으로 덮어씀
- `version`: 양쪽 보존, 새 version 행

판단 어려우면 `version` 으로 안전하게 합친 뒤 사람이 검토.

### Q3. 두 서버 user 가 같은 email 이면?

users 는 안 옮기므로 충돌 없음. doc 의 `owner_id` 가 source 측 UUID 였더라도 *대상 서버의 owner_email 사용자* 로 재매핑됨.

### Q4. snapshot 위에 data-merge 하면 어떻게 되나?

`snapshot.sh restore` 후 곧바로 `data-merge.sh` 도 가능. 일반적인 워크플로:
1. snapshot 으로 *기본 상태* 복원 (예: 백업 시점 데이터)
2. data-merge 로 *그 후* 진행된 변경 추가

### Q5. MinIO 이미지가 도중 끊겼다?

MinIO 는 sha256 content-addressed — 같은 객체 path 는 같은 내용. `mc mirror` 가 재실행 시 멱등. 안전하게 다시 돌리면 됨.

### Q6. dry-run 도 시간이 오래 걸리나?

전체 doc 수만큼 SELECT 가 돌아 *충돌 체크* 함. 3000 doc 기준 5-15초. 실제 INSERT 가 빠지므로 실 실행보다는 짧다.

### Q7. dump 파일 크기?

- 본문 + 메타만이면 도큐먼트 1000개 당 약 1 MB (gzipped)
- MinIO 포함하면 업로드 이미지 용량 + 1 MB
- 우리 현재 데이터 (3737 docs, MinIO 10 KB) → **약 1.1 MB**

### Q8. 실패하면 rollback 되나?

`data-merge` 는 *한 트랜잭션* 안에서 적용. 중간 실패 시 자동 rollback. 멱등이라 다시 돌려도 됨.

`restore-snapshot` 은 *DROP+CREATE* 라 중간 실패 시 DB 가 불일치 상태일 수 있음. 실패 시:
1. 같은 snapshot 으로 다시 시도
2. 그래도 안 되면 더 이전 snapshot 으로

---

## 5. 안전 수칙

| 상황 | 권장 |
|---|---|
| 처음 새 서버 깔 때 | `snapshot.sh` + `restore-snapshot.sh` |
| 운영 중 다른 서버에서 데이터 가져올 때 | `data-merge.sh --dry-run` 먼저, *반드시* |
| 같은 데이터를 여러 서버에 동기화 | `data-merge.sh --on-conflict=overwrite` (마스터 서버 → 다른 서버들) |
| **두 서버 cross-sync (양쪽 작업)** | **`--on-conflict=newest`** + Drive 자동화 (cron) |
| 시점 백업 (재해 대비) | `snapshot.sh` 매일 cron |
| 큰 변경 직전 보험 | `snapshot.sh --note "before-XXX"` |

**위험 신호**:
- `--on-conflict=overwrite` 를 *dry-run 없이* 실행 → 대상 본문 손실 가능
- `restore-snapshot.sh` 를 *운영 데이터* 위에 실행 → 운영 데이터 wipe

`--dry-run` 은 항상 무료. 의심되면 일단 돌려라.

---

## 6. 관련 스크립트

| 파일 | 역할 |
|---|---|
| `infra/scripts/snapshot.sh` | 전체 백업 생성 |
| `infra/scripts/restore-snapshot.sh` | 전체 복원 (wipe + restore) |
| `infra/scripts/backup-db.sh` | DB만 백업 (MinIO 제외) |
| `infra/scripts/restore-db.sh` | DB만 복원 |
| `infra/scripts/data-dump.sh` | 컨텐츠 jsonl 추출 |
| `infra/scripts/data-merge.sh` | jsonl additive 적용 |
| `infra/scripts/data-dump-to-drive.sh` | dump + rclone 으로 Drive 업로드 + 가이드 md |
| `infra/scripts/data-merge-from-drive.sh` | Drive 에서 최신 dump 받아 자동 merge |
| `apps/api/app/scripts/dump_data.py` | data-dump 의 BE 부분 (직접 호출 가능) |
| `apps/api/app/scripts/import_dump.py` | data-merge 의 BE 부분 (직접 호출 가능) |
| `apps/api/app/scripts/refresh_links.py` | links 테이블 재계산 |
| `apps/api/app/scripts/reindex.py` | Meili 재인덱스 |

---

**최종 갱신**: 2026-05-21
**관련 문서**: `docs/deployment-playbook.md` (전체 배포), `docs/apptainer-cross-host-deployment.md` (apptainer 가이드)
