# MXWhitePaper Deployment Playbook

이번 한 사이클에서 dev 서버 → 신규 사내 서버로 옮기면서 나온 모든 함정과 해결책.
`apptainer-cross-host-deployment.md` 가 카테고리별 깊이 있는 문서라면, 이 문서는
**실전 순서대로** 정리한 cheat sheet.

---

## 1. 번들 만들기 (dev 서버에서)

### 무엇을 제외할 것인가 — 안 빼면 터지는 것들

| 제외 | 안 빼면 |
|---|---|
| `.git` | target 서버의 git 인증/remote 가 덮여서 `git pull` 끊김 |
| `.env` | dev 서버 IP / 비밀번호가 target 에 그대로 박힘 |
| `infra/data/postgres` | UID 불일치로 postgres 시작 실패 + alembic 상태 깨짐 |
| `infra/data/meili` | 컨테이너 user 가 못 써서 `Permission denied (os error 13)` |
| `infra/data/minio` | 같은 권한 문제 |
| `infra/data/web-tmp` | 같은 권한 문제 |
| `node_modules/.cache` | 무의미한 용량 |
| `apps/web/dist` | 빌드 산출물 (dev 모드면 안 씀) |
| `.pnpm-store`, `.tsbuild-node` | 무의미한 용량 |
| `*.log`, `*.tsbuildinfo` | 무의미 |

명령:

```bash
cd ~/claude   # MXWhitePaper의 부모 디렉토리

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
    --exclude='MXWhitePaper/apps/web/test-results' \
    --exclude='MXWhitePaper/apps/web/playwright-report' \
    --exclude='MXWhitePaper/apps/api/__pycache__' \
    --exclude='MXWhitePaper/apps/api/.pytest_cache' \
    --exclude='MXWhitePaper/.pnpm-store' \
    --exclude='MXWhitePaper/.tsbuild-node' \
    --exclude='MXWhitePaper/.playwright-mcp' \
    --exclude='*.tsbuildinfo' \
    --exclude='*.log' \
    -cf - MXWhitePaper | split -b 1G -d --suffix-length=2 - ~/bundles/mxwp.tar.part

cd ~/bundles
sha256sum mxwp.tar.part* > SHA256SUMS
# total ~1.5 GB:
#   mxwp.tar.part00  1.0 GB
#   mxwp.tar.part01  ~500 MB
#   SHA256SUMS
#   install.sh   ← 이미 만들어둔 entry point
```

### 빌드 + 번들 동시에 갱신

코드 변경 → .sif 도 갱신 → 번들 다시:

```bash
# 1. 변경된 .def 확인
git diff infra/apptainer/*.def

# 2. 영향받는 sif 재빌드
apptainer instance stop mxwp_api    # 락 해제
apptainer build --force infra/apptainer/api.sif infra/apptainer/api.def

# 3. dev 서버에서 검증
./infra/scripts/restart.sh
./infra/scripts/diag.sh

# 4. 통과하면 번들 다시
rm -f ~/bundles/mxwp.tar.part* ~/bundles/SHA256SUMS
# (위 tar 명령 다시)
```

---

## 2. 전송

```bash
# dev 서버 → target
scp /home/koopark/bundles/* user@10.252.39.181:~/bundles/
```

또는 target 서버에서 pull:
```bash
ssh user@10.252.39.181
mkdir -p ~/bundles
scp koopark@<dev>:/home/koopark/bundles/* ~/bundles/
```

---

## 3. Target 서버 셋업 (한 줄)

```bash
cd ~/bundles
bash install.sh --target ~/Projects
```

`install.sh` 의 자동 흐름:
1. SHA256 체크섬 검증
2. `cat *.part* > combined.tar` 합치고 `MXWhitePaper/` 만 추출
3. `.env` 없으면 `.env.example` 복사 + `HOST_IP` placeholder 를 실제 IP 로 sed 치환
4. `CHANGE_ME` 비밀번호는 그대로 → 사용자가 회전하라는 경고 출력
5. apptainer 없으면 `bootstrap-host.sh` 자동 호출 (sudo)
6. `fresh.sh --yes` 호출 → clean + start + migrate + seed
7. `diag.sh` 로 상태 출력

추출 후 `combined.tar` 자동 삭제 (디스크 절약).

---

## 4. .env 디자인 — placeholder 만

dev 서버의 구체 값이 target 으로 끌려오는 사고를 막기 위해:

```bash
# .env.example 안에는 literal token 만:
HOST_IP=...          # target 의 실제 IP — install.sh 가 자동 치환
CHANGE_ME=...        # 비밀번호 placeholder — 사용자가 회전
```

`install.sh` 의 치환 로직:
```bash
HOST_IP=$(curl -s ifconfig.me || hostname -I | awk '{print $1}')
sed -i "s/HOST_IP/$HOST_IP/g" .env
# CHANGE_ME 는 그대로 두고 경고만
```

---

## 5. 회복 — 뭔가 망가졌을 때

증상별 한 줄:

| 증상 | 명령 |
|---|---|
| 전체 상태 보기 | `./infra/scripts/diag.sh` |
| `--tail-logs` 로 인스턴스별 80줄 | `./infra/scripts/diag.sh --tail-logs` |
| 인스턴스 stderr 만 (컬러 하이라이트) | `./infra/scripts/errors.sh --grep` |
| 특정 인스턴스만 | `./infra/scripts/errors.sh web meili` |
| 실시간 | `./infra/scripts/errors.sh --follow api web` |
| sudo 흔적 정리 | `./infra/scripts/desudo.sh --yes` (sudo 필요) |
| 데이터 디렉토리만 비움 | `./infra/scripts/clean.sh --yes` |
| `.env` 만 바꿈, 인스턴스 새 env 받게 | `./infra/scripts/restart.sh` |
| DB 만 초기화 (자동 백업 떠줌) | `./infra/scripts/reset-db.sh` |
| 다 망가짐 → 한 방 회복 | `./infra/scripts/recover.sh --yes` |
| 처음부터 깨끗하게 (data 다 날림) | `./infra/scripts/fresh.sh --yes` |

---

## 6. 이번 사이클의 결정적 함정 13개

### 가. sudo apptainer (절대 금지)
- 컨테이너 안 프로세스가 root → 바인드된 host 파일이 root 소유
- 회복: `./infra/scripts/desudo.sh --yes`

### 나. tar 안 data 디렉토리
- UID 불일치로 컨테이너가 못 씀
- 회복: `./infra/scripts/clean.sh --yes` 또는 `fresh.sh`

### 다. tar 안 .git
- target 의 SSH 키/PAT 없는데 dev 의 remote 가 박힘 → pull 끊김
- 회복: `rm -rf .git && git init -b main && git remote add origin https://<PAT>@... && git fetch && git checkout -B main --track origin/main`

### 라. tar 안 .env
- dev 의 hardcoded IP/비밀번호가 target 에 박힘
- 해결: 번들에 .env 빼고 .env.example 만 placeholder 로

### 마. Apptainer 네트워크 namespace 격리
- 컨테이너 안 127.0.0.1 ≠ host 127.0.0.1 인 경우 vite proxy 실패 → 로그인 ERR_EMPTY_RESPONSE
- 해결: `VITE_PROXY_TARGET=http://HOST_IP:8800` 으로 외부 IP 통과

### 바. /tmp bind 가정
- 일부 apptainer 빌드는 host /tmp 자동 마운트 안 함 → `/tmp/pnpm-install.log Permission denied`
- 해결: start.sh 가 `--bind $DATA_DIR/web-tmp:/tmp` 명시

### 사. Vite 5 allowedHosts (403)
- 외부 도메인/IP 로 접근 시 vite 가 default 로 차단
- 해결: `vite.config.ts` 에 `server.allowedHosts: true`

### 아. Corepack catch-22
- SSL 인터셉션 환경 → `UNABLE_TO_VERIFY_LEAF_SIGNATURE`
- `COREPACK_ENABLE_NETWORK=0` 으로 우회 → `Network access disabled by the environment`
- 둘 다 막힘. **해결: corepack 자체 제거, `npm install -g pnpm@9` 로 직접 설치**
- web.def 에 반영, 재빌드 필요

### 자. .sif 의존성 drift
- 코드는 `from docx import ...` 추가, .def 의 pip list 는 갱신 안 됨
- dev 서버에서 우연히 동작 (host `~/.local` 마운트), target 에선 실패
- 해결: .def 갱신 + `apptainer build --force`
- **`.sif` 는 `.gitignore` 라 `git pull` 로 안 전송됨** → 번들 또는 scp 필수

### 차. instance idempotency
- `.env` 바꾸고 `start.sh` 재실행해도 "already running" skip → 새 env 반영 X
- 해결: 무조건 `restart.sh` (stop + start)

### 카. 서비스 상태 ≠ 인스턴스 상태
- `apptainer instance list` 에 5개 다 보여도 안의 service 가 crash 한 채일 수 있음
- 해결: `diag.sh` 가 port LISTEN + HTTP 응답 + 로그 까지 3중 검증

### 타. ufw 차단
- Ubuntu Server 는 ufw 가 default active, 5173/8800 이 열려있지 않음
- 외부에서 `ERR_CONNECTION_TIMED_OUT`
- 해결: `sudo ./infra/scripts/firewall.sh` (사내망만 허용, sudo 필요)

### 파. 사설 IP 라우팅 한계
- `10.252.39.181` 같은 10.x.x.x 는 RFC1918 사설 — 인터넷에서 직접 도달 불가
- 같은 사내망 PC 또는 VPN 접속 후에만 접근 가능
- 확인: 접근 PC 에서 `ping 10.252.39.181` 이 통하는지

---

## 7. App-level 함정

### 가. Section level 강제 검증 (자동 보정으로 변경됨)
- 옛날: `section.level` 이 트리 깊이랑 불일치하면 422 거부
- 지금: `renumber_sections` 가 트리 위치 기반으로 `number` 와 `level` 둘 다 자동 재계산 (덮어씀)
- 사용자는 들여쓰기만 바르게 → save 시 자동 정합

### 나. FE / BE 스키마 동기화
- frontend bundle 이 stale 이면 새 필수 필드 누락된 채 PATCH → 422
- backend 가 stale 이면 frontend 가 보낸 새 필드 거부
- 해결:
  - dev 에서 `pnpm schema:gen` 으로 TS + Pydantic 동시 재생성
  - target 에서 web 인스턴스 hard refresh (Ctrl+Shift+R, 또는 web 컨테이너 재기동)
  - migrate 다시 (`./infra/scripts/migrate.sh`)

### 다. 422 디버깅
- 응답 본문에 `detail` 배열이 핵심
- DevTools Network 탭 → 빨강 PATCH → Response 또는 Preview 탭

---

## 8. Bash 함정 (스크립트 작성 시)

이번에 firewall.sh 작성하다 부딪힌 것:

### shell-quoting 함정
```bash
# 잘못된 패턴 — single quote 가 literal 로 남음
rule_op allow "from $net to any port $port proto tcp comment 'MXWP-${port}'"
# ufw 에 들어가는 값: comment 'MXWP-5173' (quotes 포함)
# → ufw 가 해석 못해서 룰 silent drop
```

```bash
# 올바른 패턴 — 각 인자 개별 positional
rule_op() {
  local op="$1"; shift
  ufw "$op" "$@"
}
rule_op allow from "$net" to any port "$port" proto tcp
```

### set -e 가 함수의 return 1 에 전파
`_common.sh` 가 `set -euo pipefail` 켜놓아서, 함수에서 `[ -s file ] || return` 으로 빠지면 부모 스크립트가 종료됨. 회피:
```bash
set -uo pipefail
. "$(dirname "$0")/_common.sh"
set +e   # _common.sh 의 errexit 끔
```

---

## 9. 환경변수 cheat sheet

```bash
# IP (install.sh 가 자동 치환)
HOST_IP                                    # placeholder, .env.example 안 literal

# 비밀번호 (사용자가 회전)
CHANGE_ME                                  # placeholder

# 네트워크 우회
VITE_PROXY_TARGET=http://HOST_IP:8800      # 권장 (어떤 apptainer 든 동작)
MXWP_APPT_HOST_NET=0                        # host CNI 있을 때만 1

# 사내망 corporate workaround
MXWP_FALLBACK_PROXY=http://168.219.61.252:8080
MXWP_NODE_TLS_VERIFY=0                      # SSL 인터셉션 우회 (insecure)
MXWP_COREPACK_OFFLINE=0                     # corepack 자체 제거 후엔 무의미

# CORS
CORS_ORIGINS=http://localhost:5173,http://localhost:80,http://HOST_IP:5173,http://HOST_IP

# Service ports
API_PORT=8800
WEB_PORT=5173
POSTGRES_PORT=5432
MEILI_PORT=7700
MINIO_API_PORT=9000
MINIO_CONSOLE_PORT=9001
```

---

## 10. 스크립트 인벤토리 (18개)

### 호스트 셋업 (sudo)
- `scripts/bootstrap-host.sh` — apptainer/node/pnpm/python apt 설치
- `infra/scripts/desudo.sh` — sudo 흔적 회복
- `infra/scripts/firewall.sh` — ufw 룰 (사내망 또는 anywhere)

### 일반 lifecycle (sudo X)
- `infra/scripts/build.sh` — .sif 빌드/풀
- `infra/scripts/start.sh` — 5종 인스턴스 기동
- `infra/scripts/stop.sh` — 인스턴스 정지
- `infra/scripts/restart.sh` — stop + start
- `infra/scripts/migrate.sh` — alembic upgrade head
- `infra/scripts/seed.sh` — 시드 데이터

### 회복
- `infra/scripts/clean.sh` — data dir 전부 비움
- `infra/scripts/fresh.sh` — clean + start + migrate + seed
- `infra/scripts/recover.sh` — desudo + clean + start + migrate + seed + diag (최후의 한 방)
- `infra/scripts/reset-db.sh` — DB 만 초기화 (자동 백업)
- `infra/scripts/backup-db.sh` — DB → .sql.gz
- `infra/scripts/restore-db.sh` — .sql.gz → DB

### 진단
- `infra/scripts/status.sh` — 간단 헬스체크
- `infra/scripts/diag.sh` — 7섹션 상세 점검
- `infra/scripts/errors.sh` — 인스턴스 로그 (깊이/하이라이트/실시간)
- `infra/scripts/logs.sh <svc>` — 단일 인스턴스 `tail -F`

### Entry point
- `quickstart.sh` — 0~7단계 전 과정
- `bundles/install.sh` — 번들 풀고 fresh 자동 호출

---

## 11. 마무리

이 사이클에서 추가/수정된 commit (시간 순):

```
feat(infra):     add clean/fresh/restart scripts
feat(infra):     diag.sh — single-shot stack health
feat(infra):     vite_proxy_target — bypass host loopback
chore(env):      preset .env.example for 10.252.39.181 (이후 placeholder 로)
feat(infra):     desudo.sh — recover from sudo apptainer runs
fix(infra):      unblock /tmp + corepack network + python-docx deps
fix(infra):      diag --tail-logs shows 80 lines
feat(infra):     errors.sh — dump recent logs across all instances
chore(env):      .env.example placeholders (HOST_IP / CHANGE_ME)
fix(infra):      NODE_TLS_REJECT_UNAUTHORIZED knob
fix(infra):      web.def installs pnpm via npm (drop corepack)
feat(infra):     recover.sh — single-shot nuclear reset
feat(infra):     firewall.sh — open ufw for service ports
fix(infra):      firewall.sh — pass ufw args as separate positionals
fix(api):        auto-correct section level (drop 422 rejection)
docs(infra):     apptainer cross-host deployment lessons
docs(infra):     deployment playbook (this file)
```

**핵심 통찰**: container 는 가벼워도 그 container 가 host 와 맺는 모든 계약 (UID
mapping, /tmp, /home, /etc/apptainer, network namespace, ufw, TLS chain, npm
registry reachability) 이 dev 서버에서 동작했다고 target 서버에서도 동작한다는
보장은 없다. 모든 host-dependent assumption 은 **opt-in env var** 또는 **자동
감지 + placeholder** 패턴으로 환원해야 portable 함.
