# Apptainer 크로스-호스트 배포 — 교훈 모음

MXWhitePaper 를 한 서버에서 다른 서버로 옮기면서 부딪힌 모든 함정과
그 해결책. 다른 Apptainer 프로젝트에도 그대로 적용 가능.

> **TL;DR** — Apptainer 는 Docker 보다 가볍지만 "묵시적 가정"이 많다.
> 사용자/네트워크/파일권한이 호스트와 컨테이너 사이에서 미묘하게
> 다르게 동작하며, 그 차이는 빌드한 호스트와 배포 호스트가 다를 때 폭발한다.

---

## 0. 빠른 회복 명령

상황 → 한 줄:

| 증상 | 명령 |
|---|---|
| 뭐가 안 되는지 한 페이지로 보기 | `./infra/scripts/diag.sh` |
| 각 인스턴스의 실제 stderr 보기 | `./infra/scripts/errors.sh --grep` |
| 다 망가졌을 때 핵폭탄 회복 | `./infra/scripts/recover.sh --yes` |
| sudo 잘못 썼다 → 권한 복구 | `./infra/scripts/desudo.sh --yes` |
| .env 만 바꿈, 새 env 적용 | `./infra/scripts/restart.sh` |
| 데이터 전부 날리고 다시 init | `./infra/scripts/fresh.sh --yes` |

---

## 1. sudo 함정 — Apptainer 는 rootless

**증상**:
- `sudo apptainer instance start` → 동작은 함
- 다음에 일반 사용자로 같은 명령 → `Permission denied`
- meilisearch/minio/postgres 데이터 디렉토리 쓰기 실패
- `/tmp/pnpm-install.log` 못 만듦

**원인**:
- Apptainer 는 기본적으로 **calling user 로 실행** (Docker 와 다름)
- sudo 로 띄우면 컨테이너 프로세스가 root → 바인드된 호스트 파일이 root 소유로 남음
- 다음에 일반 사용자가 같은 폴더 쓰려고 하면 EACCES

**해결**:
- 룰: **apptainer 명령에 sudo 절대 쓰지 말 것**. 예외는 호스트 패키지 설치(`apt-get install apptainer`) 와 `desudo.sh` 자체.
- 한 번이라도 sudo 썼다면: `./infra/scripts/desudo.sh --yes`
  - `~/.apptainer/instances` 내 root 소유 state 정리
  - `infra/data/`, `node_modules`, `.pnpm-store` 등 chown
  - `/tmp/pnpm-install.log` 삭제
  - `/root/.apptainer/instances/*` 비움

---

## 2. tar 번들로 옮길 때 — 데이터 디렉토리는 무조건 비워라

**증상**:
- `tar -xf bundle.tar` 직후 `start.sh` → meili `Permission denied (os error 13)`
- `migrate.sh` → `DuplicateTableError: relation "divisions" already exists`

**원인**:
- tar 안에 `infra/data/postgres/`, `infra/data/meili/`, `infra/data/minio/` 가 들어있으면
- 그 폴더들이 원본 서버의 컨테이너 내부 user 소유라 새 서버 UID 와 불일치
- 게다가 postgres 데이터 dir 만 있고 `alembic_version` 누락이면 alembic 이 0001 부터 다시 돌리려다 충돌

**해결 — 번들 만들 때 무조건 exclude**:
```bash
tar --exclude='MXWhitePaper/infra/data/postgres' \
    --exclude='MXWhitePaper/infra/data/postgres-run' \
    --exclude='MXWhitePaper/infra/data/meili' \
    --exclude='MXWhitePaper/infra/data/minio' \
    --exclude='MXWhitePaper/infra/data/web-tmp' \
    ...
```

받은 쪽에서 `clean.sh --yes` 또는 `fresh.sh --yes` 가 처음부터 init.

데이터 자체를 옮기고 싶으면 `pg_dump` / `mc mirror` / `meilisearch dump` 같은
**포맷 레벨 백업/복원**을 쓸 것.

---

## 3. Apptainer 네트워크 — "host network" 보장 아님

**증상**:
- 외부 IP로 `:5173` 접근 → 페이지 로딩
- 로그인 시 `ERR_EMPTY_RESPONSE` 또는 `ERR_CONNECTION_TIMEOUT`
- diag.sh 의 E 항목에 "web container CANNOT reach host loopback :8800"

**원인**:
- 가정: Apptainer 는 host network 공유 (container 127.0.0.1 == host 127.0.0.1)
- 실제: `/etc/apptainer/apptainer.conf` 에 따라 각 instance 가 자기 netns 에 들어갈 수 있음
- `--net --network=host` 가 stock 빌드엔 동작하지만 일부 빌드엔 `/etc/apptainer/network/host.conflist` 가 없어서 에러:
  ```
  FATAL: network setup failed: no net configuration with name "host"
  ```

**해결 — 3가지 옵션 중 가장 잘 되는 거**:

| 옵션 | env 변수 | 언제 |
|---|---|---|
| **A. proxy target 우회** | `VITE_PROXY_TARGET=http://<HOST_IP>:8800` | 가장 호환성 좋음 — 어떤 apptainer 든 동작 |
| **B. host network 명시** | `MXWP_APPT_HOST_NET=1` → start.sh가 `--net --network=host` 추가 | `host.conflist` 가 `/etc/apptainer/network/` 에 있을 때만 |
| **C. host CNI config 직접 생성** | (sudo 로 `/etc/apptainer/network/40_host.conflist` 작성) | A 가 안 되지만 sudo 권한 있을 때 |

**교훈**: 컨테이너 안 호스트 서비스 호출 코드/설정은 **환경변수로 외부 주입 가능하게**. 절대 코드에 `127.0.0.1` 하드코딩 X.

---

## 4. /tmp 가정 — host /tmp 자동 마운트 보장 아님

**증상**:
- web 컨테이너 startscript: `cannot create /tmp/pnpm-install.log: Permission denied`
- 그 결과 pnpm install 안 돌고 vite 안 뜸

**원인**:
- 기본 Apptainer: host /tmp 자동 bind (1777, 누구나 쓰기 가능)
- 일부 빌드/설정: 컨테이너에 private /tmp 가 따로 있고 in-container user 가 못 씀
- in-container user uid (예: node:1000) 와 host uid 매핑 불일치

**해결 — start.sh 가 dedicated 디렉토리를 /tmp 로 명시 bind**:
```bash
mkdir -p $DATA_DIR/web-tmp
chmod 777 $DATA_DIR/web-tmp
apptainer instance start --bind "$DATA_DIR/web-tmp:/tmp" ...
```

---

## 5. Vite 5 host check — 외부 도메인 디폴트 차단

**증상**:
- 로컬 `localhost:5173` → 200
- 외부 IP로 `http://<server>:5173` → **403 Forbidden** (vite 가 응답)

**원인**: Vite 5+ 의 `server.allowedHosts` — DNS rebinding 공격 방지로 알려지지 않은 Host 차단

**해결**:
```ts
// vite.config.ts
server: {
  host: true,
  allowedHosts: true,    // ← 모든 호스트 허용 (dev 환경 한정)
  ...
}
```

---

## 6. Corepack 의 죽음의 함정 (CATCH-22)

**증상**:
```
UNABLE_TO_VERIFY_LEAF_SIGNATURE
Error when performing the request to https://registry.npmjs.org/pnpm/-/pnpm-9.12.0.tgz
```
또는 반대로:
```
Network access disabled by the environment; can't reach https://registry.npmjs.org/...
```

**원인 — 두 가지가 동시에 막힘**:
1. 사내 SSL-intercepting 프록시가 npm registry TLS 를 MITM cert 로 재서명 → corepack 이 그 cert 못 믿어서 fetch 실패
2. `COREPACK_ENABLE_NETWORK=0` 으로 우회 시도 → corepack 이 캐시된 바이너리도 거부 ("Network access disabled by the environment")

**해결 — corepack 자체 제거, npm 으로 pnpm 직접 설치**:
```dockerfile
# web.def %post 에서
# 옛날: corepack enable && corepack prepare pnpm@9 --activate
# 지금:
corepack disable 2>/dev/null || true
npm install -g pnpm@9.12.0
```

**왜 이게 동작하는가**:
- npm install 은 build time 에 1회만 (인터넷 가능한 환경에서 빌드)
- 결과는 `/usr/local/bin/pnpm` 에 정적 설치
- runtime 에는 네트워크 verification 없음 — 그냥 동작

**완화책 (corepack 유지하면서)**: `MXWP_NODE_TLS_VERIFY=0` 으로 NODE_TLS_REJECT_UNAUTHORIZED=0 박기. 단 이건 일반 인터넷일 때만 동작 (사내 SSL 인터셉션도 종종 막힘).

---

## 7. .sif 의존성 drift — 코드는 진화, 이미지는 정지

**증상**:
- 새 서버에서 API: `ModuleNotFoundError: No module named 'docx'`
- 원래 서버는 동작 → 새 서버에서만 실패

**원인**:
- `.sif` 는 빌드 시점 의존성 동결
- 이후 코드에 `from docx import ...` 추가됐는데 `.def` 의 pip install list 갱신 안 됨
- **개발 서버에선 우연히 동작** — pip --user 로 host `~/.local` 에 설치된 게 있고 apptainer 가 자동 mount $HOME → 컨테이너 안 python 이 host 의 `~/.local` 에서 import
- 새 서버는 `~/.local` 비어있어서 진짜 에러

**해결**:
- `.def` 의 pip install list 를 코드 import 와 sync 유지
- `.def` 수정 시 무조건 `apptainer build --force` 재빌드
- 번들에 새 `.sif` 포함

**중요 — `.sif` 는 `.gitignore`** — `git pull` 로는 안 옮겨짐. 별도로 scp 또는 번들로 전송 필수.

---

## 8. .git 덮어쓰기 — 인증/remote 갈아엎힘

**증상**:
- tar 풀고 나면 `git pull` 멈춤 (SSH 키 없음)
- 또는 "there is no tracking information for current branch"
- 또는 "fatal: origin does not appear to be a git repository"

**원인**:
- tar 가 source 서버의 `.git/` 통째로 가져옴
- source 의 remote URL (SSH `git@github.com:...`) 이 target 에 박힘
- target 에는 source 의 SSH 키 / PAT 가 없음

**해결 — 번들에서 `.git` 무조건 제외**:
```bash
tar --exclude='MXWhitePaper/.git' ...
```

target 에 git 연결 복구 필요할 때:
```bash
cd MXWhitePaper
rm -rf .git
git init -b main
git remote add origin https://<PAT>@github.com/<owner>/<repo>.git
git fetch
git checkout -B main --track origin/main
```

PAT 발급: https://github.com/settings/tokens/new — Note: `mxwp-server`, scope: `repo`, Generate token → `ghp_XXXX` 복사 (다시 못 봄).

---

## 9. .env 도 번들에서 제외 — placeholder 로

**증상**:
- 번들 풀고 보니 `.env` 안의 `CORS_ORIGINS` 에 **dev 서버 IP** 박혀있음
- 외부 접속 거절됨

**원인**:
- `.env` 가 번들에 포함되면 source 서버의 hardcoded 값이 target 으로 끌려옴
- IP, 비밀번호, JWT secret 등 다 source 의 값

**해결**:
- `.env` 는 번들에서 **무조건 제외**
- `.env.example` 만 포함 — 거기엔 placeholder (`HOST_IP`, `CHANGE_ME`) 만
- target 에서 `cp .env.example .env && install.sh` 가 자동으로 HOST_IP 치환

```bash
# install.sh 의 동작
HOST_IP=$(curl -s ifconfig.me || hostname -I | awk '{print $1}')
sed -i "s/HOST_IP/$HOST_IP/g" .env
# CHANGE_ME 는 사용자가 직접 회전
```

---

## 10. Port 충돌 + stray 프로세스 외부 노출

**증상**: start.sh 정상 종료한 듯한데 외부에서 안 들어옴

**원인**: 다른 프로세스(예: 누군가 켜둔 `python -m http.server`) 가 같은 포트 점유
- 게다가 그 프로세스가 0.0.0.0 으로 떠있으면 인터넷에 노출 (보안 이슈, censys 같은 스캐너가 발견함)

**해결**:
- 배포 전: `ss -tlnp | grep -E "5432|7700|9000|8800|5173"`
- 충돌 시: `lsof -i :<port>` 로 누군지 찾아 kill
- `diag.sh` 가 자동 검사

---

## 11. instance idempotency 의 부작용

**증상**: `.env` 수정 후 `./start.sh` 다시 돌렸는데 변경 안 반영

**원인**: `apptainer instance start` 는 이미 같은 이름 instance 있으면 새로 안 만듦. 새 env / bind 는 instance lifecycle 동안 고정

**해결**:
- `.env` 또는 start.sh 수정 후엔 `./infra/scripts/restart.sh` (stop + start)
- 한 인스턴스만: `apptainer instance stop mxwp_api && ./infra/scripts/start.sh`

---

## 12. 서비스 상태 ≠ 인스턴스 상태

**증상**: `apptainer instance list` 에 5종 다 보이지만 curl 안 됨

**원인**: instance "running" = startscript fork 되었음. 안의 실제 service (uvicorn / vite / meilisearch) 가 startup 직후 crash 해도 instance 자체는 살아있음

**해결**:
- `apptainer instance list` 만 보지 말고:
  - `ss -tlnp | grep <port>` — 실제 LISTEN
  - `curl <health-url>` — HTTP 응답
  - `errors.sh` — 안의 서비스 stderr
- `diag.sh` 가 이 3개 자동 결합

---

## 13. Apptainer 버전 차이

- 1.3.3 stock: `--net --network=host` 내장
- 1.3.6 일부 빌드: 같은 명령 `no net configuration with name "host"` 로 실패
- 1.0.x: 일부 flag 자체 없음

**해결**: 최소 공통분모 가정 (host network 공유), 안 되는 환경에선 명시적 opt-in (env 변수)

---

## 운영 체크리스트

### A. 새 서버 — 번들로 옮기기 (가장 안전)

```bash
# 1. 호스트 패키지 (한 번만, sudo)
sudo bash scripts/bootstrap-host.sh

# 2. dev 서버에서 번들 만들기 + 전송
scp /home/koopark/bundles/* user@<TARGET>:~/bundles/

# 3. 타겟에서 한 줄
ssh user@<TARGET>
cd ~/bundles
bash install.sh --target ~/Projects

# install.sh 가 자동으로:
#   - SHA256 검증
#   - tar 추출 (.env / .git 안 건드림)
#   - .env 만들고 HOST_IP 자동 치환
#   - fresh.sh — clean + start + migrate + seed
```

### B. 새 서버 — git clone 으로

```bash
# 1. 호스트 패키지
sudo bash scripts/bootstrap-host.sh

# 2. clone
git clone https://<PAT>@github.com/<owner>/<repo>.git ~/Projects/MXWhitePaper
cd ~/Projects/MXWhitePaper

# 3. .env
cp .env.example .env
HOST_IP=$(hostname -I | awk '{print $1}')
sed -i "s/HOST_IP/$HOST_IP/g" .env
# CHANGE_ME 자리 비밀번호 수동 채우기

# 4. .sif 가 .gitignore 라 git clone 으론 안 옴 — 별도 전송 필요
scp <dev>:~/claude/MXWhitePaper/infra/apptainer/*.sif infra/apptainer/

# 5. fresh
./infra/scripts/fresh.sh --yes
```

### C. 문제 진단 + 회복

```bash
# 한 페이지 상태 확인
./infra/scripts/diag.sh
./infra/scripts/diag.sh --tail-logs       # 인스턴스별 80줄

# 인스턴스 stderr 모음
./infra/scripts/errors.sh --grep          # 컬러 하이라이트
./infra/scripts/errors.sh web meili       # 특정 인스턴스만
./infra/scripts/errors.sh --follow web    # 실시간

# 다 망가짐 — 핵 회복
./infra/scripts/recover.sh --yes
```

---

## 우리 프로젝트의 스크립트 인벤토리

### 호스트 셋업 (sudo 필요)
| 스크립트 | 역할 |
|---|---|
| `scripts/bootstrap-host.sh` | apt 패키지 (apptainer/node/pnpm/python) |
| `infra/scripts/desudo.sh` | sudo 흔적 회복 (chown 되돌리기 등) |

### 일반 lifecycle (sudo 금지)
| 스크립트 | 역할 |
|---|---|
| `infra/scripts/build.sh` | `.sif` 6종 빌드/풀 (보통 skip) |
| `infra/scripts/start.sh` | 5종 인스턴스 기동 |
| `infra/scripts/stop.sh` | 인스턴스만 정지 (데이터 보존) |
| `infra/scripts/restart.sh` | stop + start (env 변경 후) |
| `infra/scripts/migrate.sh` | alembic upgrade head |
| `infra/scripts/seed.sh` | 시드 데이터 |

### 클린/회복
| 스크립트 | 데이터 | 사용 시점 |
|---|---|---|
| `infra/scripts/clean.sh` | 전부 삭제 | data dir 권한 꼬임 |
| `infra/scripts/fresh.sh` | 전부 삭제 후 처음부터 | 새 서버 첫 셋업 |
| `infra/scripts/recover.sh` | 전부 삭제 + sudo 흔적 정리 | 최후의 수단 (한 방) |
| `infra/scripts/reset-db.sh` | DB만 | 자동 백업 떠줌 |
| `infra/scripts/backup-db.sh` | 보존 | .sql.gz dump |
| `infra/scripts/restore-db.sh` | 덮어씀 | .sql.gz 복원 |

### 진단
| 스크립트 | 역할 |
|---|---|
| `infra/scripts/status.sh` | 인스턴스 + 헬스체크 (간단) |
| `infra/scripts/diag.sh` | 7섹션 상세 점검 |
| `infra/scripts/diag.sh --tail-logs` | + 인스턴스별 로그 80줄 |
| `infra/scripts/errors.sh` | 로그 전용 — 깊게/하이라이트/실시간 |
| `infra/scripts/logs.sh <svc>` | 단일 인스턴스 `tail -F` |

### 엔트리 포인트
| 스크립트 | 역할 |
|---|---|
| `quickstart.sh` | 0~7단계 전 과정 (preflight 포함) |
| `bundles/install.sh` | 번들 → 압축 풀고 fresh.sh 자동 호출 |

---

## 핵심 환경변수

```bash
# 호스트 IP — placeholder, install.sh 가 자동 치환
HOST_IP                           # .env.example 에서 literal token

# 네트워크 우회
VITE_PROXY_TARGET=http://HOST_IP:8800   # 권장 — 어떤 apptainer 든 동작
MXWP_APPT_HOST_NET=0                     # host CNI 있을 때만 1

# 사내망 corporate workaround
MXWP_FALLBACK_PROXY=http://168.219.61.252:8080   # outbound 프록시 (Samsung MX)
MXWP_COREPACK_OFFLINE=0                          # corepack 네트워크 차단 (지금은 unused — corepack 자체 제거됨)
MXWP_NODE_TLS_VERIFY=0                           # NODE_TLS_REJECT_UNAUTHORIZED=0 (SSL 인터셉션 우회)

# 비밀번호 — placeholder
CHANGE_ME                         # POSTGRES_PASSWORD, MEILI_MASTER_KEY,
                                  # MINIO_SECRET_KEY, JWT_SECRET, SMTP_PASSWORD
```

---

## 번들 만들기 (dev 서버에서)

```bash
# 제외 항목 명확히
cd ~/claude
tar --exclude='MXWhitePaper/.git' \
    --exclude='MXWhitePaper/.env' \
    --exclude='MXWhitePaper/infra/data/postgres' \
    --exclude='MXWhitePaper/infra/data/postgres-run' \
    --exclude='MXWhitePaper/infra/data/meili' \
    --exclude='MXWhitePaper/infra/data/minio' \
    --exclude='MXWhitePaper/infra/data/web-tmp' \
    --exclude='MXWhitePaper/infra/logs' \
    --exclude='MXWhitePaper/infra/backups' \
    --exclude='MXWhitePaper/node_modules/.cache' \
    --exclude='MXWhitePaper/apps/web/dist' \
    --exclude='MXWhitePaper/.pnpm-store' \
    --exclude='MXWhitePaper/.tsbuild-node' \
    --exclude='*.tsbuildinfo' \
    --exclude='*.log' \
    -cf - MXWhitePaper | split -b 1G -d --suffix-length=2 - ~/bundles/mxwp.tar.part

cd ~/bundles
sha256sum mxwp.tar.part* > SHA256SUMS
ls -lh
# total ~1.5GB:
#   mxwp.tar.part00  1.0G
#   mxwp.tar.part01   ~500M
#   SHA256SUMS
#   install.sh
```

---

## sif 파일 인벤토리

| 파일 | 크기 | 역할 |
|---|---|---|
| `api.sif` | 218M | FastAPI + python-docx/pptx/openpyxl 포함 |
| `web.sif` | 102M | Vite dev + pnpm 9.12 (corepack 없이) |
| `postgres.sif` | 143M | PostgreSQL 15 + pgvector |
| `meili.sif` | 89M | Meilisearch v1.10 |
| `minio.sif` | 55M | MinIO 2024-09 |
| `mc.sif` | 17M | MinIO client (bucket init 용) |
| `*-base.sif` | — | 중간 단계 (런타임에 안 씀, 빌드 시만) |

**런타임 필요**: api + web + postgres + meili + minio + mc = **624MB**
**업데이트 시 자주 갱신되는 건**: api.sif, web.sif (코드 의존성 따라)
**전송 시 우선**: api + web (코드 변경에 따라가는 것들)

---

## 마지막 한 줄

**컨테이너 자체는 가벼워도, 그 컨테이너가 host 와 맺는 계약 (네트워크 /
FS 권한 / 환경변수 / 인증) 은 host 마다 다르게 깨진다. 모든
host-dependent assumption 을 environment variable 로 환원시키면 이식성이
생긴다.**
