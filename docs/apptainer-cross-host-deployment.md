# Apptainer 크로스-호스트 배포 — 교훈 모음

이 프로젝트(MX White Paper)를 한 서버에서 다른 서버로 옮기면서 부딪힌
모든 문제 + 그 원인 + 해결책. 다른 Apptainer 프로젝트에도 그대로 적용 가능.

> **TL;DR** — Apptainer는 Docker보다 가볍지만 "묵시적 가정"이 많다.
> 사용자/네트워크/파일권한이 호스트와 컨테이너 사이에서 미묘하게 다르게
> 동작하며, 그 차이는 빌드한 호스트와 배포 호스트가 다를 때 폭발한다.

---

## 1. sudo 함정 — Apptainer는 rootless다

**증상**:
- `sudo apptainer instance start` → 인스턴스 동작하는 듯 보임
- 다음에 일반 사용자로 같은 명령 → `Permission denied`
- meilisearch / minio / postgres 데이터 디렉토리 쓰기 실패
- `/tmp/pnpm-install.log` 못 만듦

**원인**:
- Apptainer는 기본적으로 **calling user 로 실행** (Docker와 다름)
- sudo 로 띄우면 컨테이너 프로세스가 root → 그 프로세스가 만든 바인드된 호스트 파일이 root 소유로 남음
- 다음에 일반 사용자가 같은 폴더 쓰려고 하면 EACCES

**해결**:
- 룰: **apptainer 명령에 sudo 절대 쓰지 말 것**. 단 예외는 호스트 패키지 설치(`apt-get install apptainer`).
- 한 번이라도 sudo 썼다면 회복: `infra/scripts/desudo.sh`
  - `~/.apptainer/instances` 내 root 소유 state 정리
  - `infra/data/`, `node_modules`, `.pnpm-store` 등 chown
  - `/tmp/pnpm-install.log` 삭제
  - `/root/.apptainer/instances/*` 비움

---

## 2. tar 번들로 옮길 때 — 데이터 디렉토리는 무조건 비워라

**증상**:
- `tar -xf bundle.tar` 직후 `start.sh` 돌리면 meili `Permission denied (os error 13)`
- `migrate.sh` 가 `DuplicateTableError: relation "divisions" already exists`

**원인**:
- tar 안에 `infra/data/postgres/`, `infra/data/meili/`, `infra/data/minio/` 가 그대로 들어옴
- 그 폴더들은 원본 서버에서 컨테이너 내부 user(meilisearch · postgres · minio 각자 다름)가 소유
- 새 서버에선 호스트 user uid 가 다르거나 fakeroot mapping 이 달라서 그 파일들 못 씀
- 게다가 postgres 데이터 디렉토리는 그대로지만 `alembic_version` 만 빠진 상태일 수도 → alembic 이 0001부터 다시 돌리려다 충돌

**해결**:
1. tar 만들 때 `--exclude` 로 데이터 디렉토리 빼기:
   ```bash
   tar --exclude='infra/data/postgres' \
       --exclude='infra/data/meili' \
       --exclude='infra/data/minio' \
       ...
   ```
2. 또는 받은 쪽에서 `clean.sh --yes` 로 비우고 `fresh.sh --yes` 로 처음부터 init.
3. 데이터 자체를 옮기고 싶다면 `pg_dump` / `mc mirror` / `meilisearch dump` 같은 **포맷 레벨 백업/복원**을 쓰지, 파일시스템 dir 통째 복사하지 말 것.

---

## 3. Apptainer 네트워크 — "host network" 는 보장이 아니다

**증상**:
- 외부 IP로 `:5173` 은 접근되는데 컨테이너에서 host의 `127.0.0.1:8800` 못 닿음
- vite proxy 가 API 못 호출 → 로그인 시 `ERR_EMPTY_RESPONSE`
- diag 에서 web 컨테이너 → API "CONN_REFUSED"

**원인**:
- 일반적인 가정: Apptainer 는 host network 공유 (컨테이너 안 127.0.0.1 == host 127.0.0.1)
- 실제: `/etc/apptainer/apptainer.conf` 에 따라 각 instance 가 자기 netns 에 들어갈 수 있음
- 그러면 컨테이너 127.0.0.1 = 자기 자신의 loopback, host의 그것과 다름
- `--net --network=host` 도 stock 빌드엔 동작하지만 일부 빌드는 `/etc/apptainer/network/host.conflist` 가 없어서 에러:
  ```
  FATAL: network setup failed: no net configuration with name "host"
  ```

**해결 — 3가지 옵션 중 가장 잘 되는 거**:

| 옵션 | 방법 | 언제 |
|---|---|---|
| **A. host network 명시** | `MXWP_APPT_HOST_NET=1` → start.sh 가 `--net --network=host` 붙임 | `host.conflist` 가 `/etc/apptainer/network/` 에 있을 때 |
| **B. proxy target 우회** | `VITE_PROXY_TARGET=http://<server-public-ip>:8800` | A 가 동작 안 할 때. 컨테이너가 외부 IP 로 다이얼 → host 의 외부 인터페이스가 받아서 API로 라우팅 |
| **C. host CNI config 직접 추가** | `sudo /etc/apptainer/network/40_host.conflist` 직접 작성 | A 가 안 되지만 sudo 권한 있을 때 |

**교훈**: 컨테이너 안에서 host service 부르는 코드/설정 (vite proxy target 등) 은
**환경변수로 외부에서 주입 가능하게** 짤 것. 절대 코드에 `127.0.0.1` 박지 말것.

---

## 4. /tmp 가정 — host /tmp 자동 마운트도 보장 아님

**증상**:
- web 컨테이너 startscript: `cannot create /tmp/pnpm-install.log: Permission denied`
- 그 결과 `pnpm install` 안 돌고 vite 가 안 뜸

**원인**:
- 디폴트 Apptainer: host /tmp 를 컨테이너에 자동 bind (1777, 누구나 쓰기 가능)
- 일부 빌드/설정: 컨테이너에 **private /tmp** 가 따로 있고 in-container user 가 못 씀
- in-container user uid (예: node:1000) 가 host의 uid 1000 과 다른 user namespace 매핑일 수도

**해결**:
- 명시적으로 host의 writable dir 을 `/tmp` 로 bind:
  ```bash
  mkdir -p infra/data/web-tmp
  chmod 777 infra/data/web-tmp
  apptainer instance start --bind "$DATA_DIR/web-tmp:/tmp" ...
  ```
- 또는 startscript 가 로그를 `/workspace/.cache/` 등 분명히 writable 한 곳으로 쓰게 .def 수정

**교훈**: 컨테이너 안에서 파일 쓰는 위치는 `/tmp` 라도 **명시적 bind 가 안전**.

---

## 5. Vite 5 host check — 외부 도메인은 디폴트로 차단

**증상**:
- 로컬 `localhost:5173` → 200
- 외부 IP로 `http://<server>:5173` → **403 Forbidden** (vite 가 응답)

**원인**:
- Vite 5+ 는 보안상 `server.allowedHosts` 디폴트 체크 — 알려지지 않은 Host 헤더면 차단
- DNS rebinding 공격 방지 기능

**해결**:
```ts
// vite.config.ts
server: {
  host: true,
  allowedHosts: true,    // ← 모든 호스트 허용 (dev 환경 한정)
  ...
}
```

배포 환경이면 특정 도메인만 화이트리스트.

---

## 6. Corepack 의 함정 — `COREPACK_ENABLE_NETWORK=0` 은 양날의 검

**증상**:
- 사내 corp 망: `corepack prepare pnpm@9` 가 registry.npmjs.org 검증 못 해서 timeout → pnpm 안 깔림
- 그래서 `COREPACK_ENABLE_NETWORK=0` 으로 검증 skip → 캐시된 pnpm 쓰게 함
- 그런데 일반 인터넷 환경에서 같은 옵션 켜놓으면: **pnpm install 자체가 막힘** (corepack 이 "Network access disabled by the environment" 던지고 캐시 binary 도 못 씀)

**해결**:
- Opt-in 으로: `MXWP_COREPACK_OFFLINE=1` 일 때만 `COREPACK_ENABLE_NETWORK=0` 통과
- 디폴트 = off → 일반 인터넷 환경에서 동작

**교훈**: "사내망 workaround" 는 절대 unconditional 로 박지 말 것. Opt-in 으로.

---

## 7. .sif 의존성 drift — 코드는 진화, 이미지는 정지

**증상**:
- 새 서버에서 API 시작 시: `ModuleNotFoundError: No module named 'docx'`
- 이 서버에서는 동작 → 새 서버에서만 실패

**원인**:
- `api.sif` 는 빌드 시점의 의존성 동결
- 그 이후 코드가 `from docx import Document` 추가 → `.def` 의 pip install list 안 따라옴
- **개발 서버에선 우연히 동작** — pip --user 로 `~/.local` 에 따로 설치한 게 있고, apptainer 가 자동으로 `$HOME` 마운트 → 컨테이너 안 python 이 host 의 `~/.local/lib/python3.12/` 에서 import
- 새 서버는 `~/.local` 비어있음 → 진짜 에러

**해결**:
- `.def` 의 pip install list 를 코드의 import 와 sync 유지 (CI 가 검출해야 함)
- 변경 시: `apptainer build --force` 로 재빌드
- bundle 에 .sif 포함시 빌드 직후 떠야 함

**교훈**: 컨테이너 이미지는 **불변 산출물**. host의 `~/.local`, `~/.cache` 같은 자동 마운트 때문에 "동작하는 듯" 보일 수 있어서 더 위험.

---

## 8. .git 덮어쓰기 — 인증 정보 같이 갈아엎힘

**증상**:
- tar 풀고 나면 `git pull` 에서 SSH 키 없다고 멈춤 / "there is no tracking information for current branch" / "fatal: origin does not appear to be a git repository"

**원인**:
- tar 가 source 서버의 `.git/` 통째로 가져옴
- source 의 remote URL (예: SSH `git@github.com:...`) 이 target 서버에 박힘
- target 서버에는 source 의 SSH 키나 PAT 가 없음 → fetch/pull 실패

**해결**:
- 묶을 때 `--exclude='.git'` 하거나
- 받은 쪽에서 `.git` 만 rm + `git init` + `git remote add` + `git fetch` + `git reset --hard origin/main`
- 또는 정상 clone 한 디렉토리에서 `.git/` 만 추출해 옮기기

**교훈**: 코드 동기화는 git pull (또는 rsync) 으로. 통 tar 는 **데이터/이미지/노드모듈 등 비 git 항목** 만 옮길 때.

---

## 9. CORS_ORIGINS — 환경별로 다른 IP

**증상**:
- 외부 IP 로 접속한 브라우저에서 API 호출 시 CORS 에러

**원인**:
- `.env.example` 에 `CORS_ORIGINS=http://localhost:5173` 만 있음
- 외부에서 `http://<server-public-ip>:5173` 으로 접속 → 그 origin 이 화이트리스트에 없음

**해결**:
- 배포 시 그 서버의 public IP 변형을 `CORS_ORIGINS` 에 추가:
  ```
  CORS_ORIGINS=http://localhost:5173,http://10.252.39.181:5173,http://10.252.39.181
  ```

**교훈**: `.env.example` 은 target 환경 가정 명시. 또는 배포 스크립트가 `ifconfig.me` 로 자동 IP 박게.

---

## 10. Port 인덱스 충돌 — 사용 중 포트는 빼앗을 수 없다

**증상**:
- start.sh 가 정상 종료된 듯한데 외부에서 안 들어옴
- `lsof -i :8000` 보니 누가 모르는 사이에 `python -m http.server` 띄워둠 (인터넷에 노출까지!)

**원인**:
- 다른 프로세스가 같은 포트 점유 중이면 apptainer instance 는 시작은 되지만 LISTEN 못 함 (host network 공유 모드일 때)
- 또는 instance 가 자기 netns 에 띄우긴 했지만 외부에서 접근 못 함

**해결**:
- 배포 전: `ss -tlnp | grep -E "5432|7700|9000|8800|5173"` 로 충돌 확인
- 충돌 발견 시: `lsof -i :<port>` 로 누군지 찾아 kill
- diag.sh 가 자동 점검

**교훈**: 디플로이 직전에 "포트 클린" 단계 필수. 모르는 사이 stray 가 외부에 노출돼 있을 수 있음 (보안 이슈).

---

## 11. instance idempotency 의 부작용

**증상**:
- `.env` 수정하고 `./start.sh` 다시 돌렸는데 변경 안 반영
- 인스턴스 만들기는 `already running` 으로 skip 됨

**원인**:
- `apptainer instance start` 는 이미 같은 이름 instance 있으면 새로 안 만듦
- start.sh 의 `start_instance` 도 그렇게 작성됨 (의도된 idempotency)
- 새 env / bind 는 instance lifecycle 동안 고정 — 변경하려면 stop → start

**해결**:
- `.env` 또는 start.sh 수정 후엔 반드시 `restart.sh` (stop + start)
- 빠르게 한 인스턴스만: `apptainer instance stop mxwp_api && ./start.sh`

**교훈**: 환경변수 / bind 변경은 runtime 동안 mutable 아님. 적용 = 재기동.

---

## 12. 서비스 상태 ≠ 인스턴스 상태

**증상**:
- `apptainer instance list` 에 5종 다 보임
- 그런데 `curl http://127.0.0.1:8800/docs` 는 timeout

**원인**:
- Apptainer instance "running" = instance 의 startscript 가 fork 되어 동작 중
- 그 안의 실제 서비스(uvicorn / vite / meilisearch)가 startup 직후 crash 해도 instance 자체는 "running" 으로 표시
- instance 껍데기 살아있지만 안의 서비스는 죽어있는 상태가 흔함

**해결**:
- `apptainer instance list` 만 보지 말고:
  - `ss -tlnp | grep <port>` — 실제 LISTEN 하는지
  - `curl <health-url>` — HTTP 응답
  - `tail ~/.apptainer/instances/logs/$(hostname)/$(whoami)/mxwp_*.{out,err}` — 안의 서비스 로그
- `diag.sh` 가 이 3개를 자동 결합

**교훈**: 컨테이너 살아있음 != 서비스 동작. 항상 application-level health check 까지 확인.

---

## 13. Apptainer 버전 차이

**증상**:
- 1.3.3: `--net --network=host` 의 `host` CNI 가 builtin
- 1.3.6 (다른 빌드): 같은 명령이 `no net configuration with name "host"` 로 실패
- 1.0.x: 일부 flag 자체가 없음

**원인**:
- Apptainer 가 fork (Singularity → Apptainer / SingularityCE) 후 빠른 변화
- 배포판마다 빌드 옵션이 다름 (CNI 플러그인 포함 여부 등)
- 일부 사내/HPC 빌드는 보안상 fakeroot / user namespace 제한

**해결**:
- 배포 스크립트는 **최소 공통분모 가정**: host 가 fakeroot 가능, user ns 활성, /tmp 1777
- 안 되는 환경에서는 명시적 옵트인 (위 #3, #4, #6 모두 그 패턴)

**교훈**: Apptainer "그냥 다 똑같이 동작" 가정 깨질 수 있음. CI 또는 배포 전 `diag.sh` 같은 sanity check 필수.

---

## 운영 체크리스트 — 새 서버 셋업 시

순서대로 진행:

```bash
# 1. 호스트 패키지 (한 번만, sudo OK)
sudo bash scripts/bootstrap-host.sh

# 2. 코드 받기 (압축 풀거나 git clone)
git clone https://<token>@github.com/<owner>/<repo>.git ~/Projects/MXWhitePaper
cd ~/Projects/MXWhitePaper

# 3. .env 작성 (그 서버에 맞게)
cp .env.example .env
sed -i "s/10.252.39.181/$(curl -s ifconfig.me)/g" .env

# 4. (sudo 실수 있었으면) 정리
./infra/scripts/desudo.sh --yes

# 5. (옵션) .sif 재빌드 — code 와 sync 보장
apptainer build --force infra/apptainer/api.sif infra/apptainer/api.def
apptainer build --force infra/apptainer/web.sif infra/apptainer/web.def

# 6. 풀 부팅
./infra/scripts/fresh.sh --yes

# 7. 검증
./infra/scripts/diag.sh
./infra/scripts/diag.sh --tail-logs    # 실패가 있다면

# 8. 로그인 안 되면
#   E 항목이 FAIL 이면: VITE_PROXY_TARGET=http://<public-ip>:8800 채우고 restart
#   또는: MXWP_APPT_HOST_NET=1 시도 (host CNI 있는 서버라면)
```

---

## 우리 프로젝트의 스크립트들

| 스크립트 | 역할 |
|---|---|
| `scripts/bootstrap-host.sh` | 호스트 패키지 (apptainer/node/pnpm/python). **sudo 필요** |
| `infra/scripts/build.sh` | `.sif` 5종 빌드/풀 (이미 있으면 skip) |
| `infra/scripts/start.sh` | 5종 인스턴스 기동 |
| `infra/scripts/stop.sh` | 인스턴스만 정지 (데이터 보존) |
| `infra/scripts/restart.sh` | stop + start |
| `infra/scripts/migrate.sh` | alembic upgrade head |
| `infra/scripts/seed.sh` | 시드 데이터 적재 |
| `infra/scripts/status.sh` | 인스턴스 + 헬스 체크 |
| `infra/scripts/logs.sh` | 로그 뷰어 |
| `infra/scripts/diag.sh` | **전체 진단 리포트** (가장 자주 쓰는 도구) |
| `infra/scripts/backup-db.sh` | DB → .sql.gz |
| `infra/scripts/restore-db.sh` | .sql.gz → DB |
| `infra/scripts/reset-db.sh` | DROP SCHEMA + 자동 백업 + migrate |
| `infra/scripts/clean.sh` | data dir 전부 비움 (서비스 동작 X) |
| `infra/scripts/fresh.sh` | clean + start + migrate + seed (한 방) |
| `infra/scripts/desudo.sh` | sudo 흔적 회복 |
| `quickstart.sh` | 0~7단계 전 과정 (preflight 포함) |

---

## 핵심 환경변수 정리

```bash
# 네트워크 우회 (host network 자동 안 될 때)
VITE_PROXY_TARGET=http://<server-public-ip>:8800   # 권장 (어떤 apptainer 든 동작)
MXWP_APPT_HOST_NET=1                                # host CNI 있을 때만

# 사내망 corporate workaround
MXWP_FALLBACK_PROXY=http://168.219.61.252:8080      # outbound 프록시
MXWP_COREPACK_OFFLINE=1                             # registry.npmjs.org 막힐 때만

# CORS (운영 환경 IP 추가)
CORS_ORIGINS=http://localhost:5173,http://<public-ip>:5173,http://<public-ip>
```

---

## 마지막 한 줄

**컨테이너 자체는 가벼워도, 그 컨테이너가 host와 맺는 계약 (네트워크 / FS 권한 /
환경변수 / 인증)은 host 마다 다르게 깨진다. 모든 host-dependent assumption 을
environment variable 로 환원시키면 이식성이 생긴다.**
