# Windows Server 배포 가이드

이 문서는 현재 Linux + Apptainer 기반으로 동작하는 MX White Paper 스택을
**Windows Server**(2019 / 2022) 환경에서 어떻게 운영하는지 정리합니다.

> 결론 먼저: **WSL2 + Apptainer 방식이 가장 변경 없이 가장 빠르게 됩니다.**
> 운영 부담이 적고, 코드/스크립트를 손대지 않습니다. 다른 옵션은 그 아래에
> 트레이드오프와 함께 정리.

---

## 0. 사전 정보

| 항목 | 현재 (Linux) | Windows에서 필요한 것 |
|------|--------------|---------------------|
| 컨테이너 런타임 | Apptainer (Linux-only) | WSL2 또는 Docker 또는 Hyper-V |
| 베이스 OS | Ubuntu 22.04 권장 | Windows Server 2019(1709+) / 2022 |
| 디스크 | ~700MB (sif 이미지) + DB 데이터 | 동일 + WSL2 디스크 |
| 메모리 | 4~8GB 권장 | WSL2에 4~8GB 할당 |
| CPU | 2 vCPU 이상 | 동일 |
| 네트워크 포트 | 5173 (web), 8800 (api), 5432 (PG), 7700 (meili), 9000/9001 (minio) | Windows Firewall 인바운드 룰 |

---

## 1. 옵션 비교 (요약)

| 옵션 | 난이도 | 코드 변경 | 속도 | 운영 부담 | 권장도 |
|------|--------|----------|------|---------|--------|
| **A. WSL2 + Apptainer** | 낮음 | 없음 | 네이티브 99% | 낮음 | ⭐ **권장** |
| B. Docker Desktop | 중 | Dockerfile 신규 | 빠름 | 중 (라이선스) | 차선 |
| C. Hyper-V Linux VM | 중 | 없음 | 네이티브 95% | 중-상 (VM 관리) | 격리 필요시 |
| D. 네이티브 Windows | 높음 | 많음 | 네이티브 | 상 | 비권장 |

---

## A. WSL2 + Apptainer (권장)

### A-1. WSL2 활성화 (Windows Server 2019 1709+ / 2022)

PowerShell 관리자 권한으로:

```powershell
# 가상화 + WSL 기능 켜기 (재부팅 1회 필요)
Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux -All
Enable-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform -All
Restart-Computer

# 재부팅 후 WSL2를 기본 버전으로
wsl --set-default-version 2

# Ubuntu 22.04 LTS 설치
wsl --install -d Ubuntu-22.04
```

서버 OS에서 `wsl --install`이 안 되면 [Microsoft 공식 가이드](https://learn.microsoft.com/windows-server/virtualization/wsl/install)의 수동 .appx 설치 절차를 따르면 됩니다.

### A-2. WSL 안에서 Apptainer 설치

WSL Ubuntu 셸에서:

```bash
# 의존성
sudo apt update
sudo apt install -y software-properties-common
sudo add-apt-repository -y ppa:apptainer/ppa
sudo apt update
sudo apt install -y apptainer

# 동작 확인
apptainer --version
```

### A-3. 추가로 필요한 도구

```bash
sudo apt install -y git curl unzip make build-essential
# Node.js 20 (FE 빌드용; .sif 안에 이미 들어있지만 dev/build엔 호스트에도 필요)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pnpm@9.12.0
# Python 3.12 (BE 로컬 디버그용; 컨테이너만 쓸 거면 생략 가능)
sudo apt install -y python3.12 python3.12-venv
```

### A-4. 코드 가져오기 + 부트스트랩

```bash
# 홈 디렉터리에서
git clone git@github.com:squall321/MXWhitePaper.git
cd MXWhitePaper
cp .env.example .env
# .env 의 비밀번호들(POSTGRES_PASSWORD, MEILI_MASTER_KEY, MINIO_*, JWT_SECRET) 변경

# 컨테이너 이미지 빌드 (~10분, 700MB)
./infra/scripts/build.sh

# 스택 부팅
./infra/scripts/start.sh

# 마이그레이션 + 초기 데이터
./infra/scripts/migrate.sh
./infra/scripts/seed.sh
```

### A-5. Windows에서 접속

WSL2의 서비스는 자동으로 `localhost`로 포워딩됩니다. Windows 브라우저에서:

- `http://localhost:5173` (Web)
- `http://localhost:8800/docs` (API + Swagger)
- `http://localhost:9001` (MinIO 콘솔)

**다른 PC에서 접속 (사내 LAN)**:

WSL2는 NAT 모드라 외부에서 직접 접근이 안 됩니다. 두 가지:

**방법 1: 포트 프록시 (간단)**

PowerShell 관리자 권한으로:

```powershell
# WSL의 IP 확인
$wslIp = (wsl hostname -I).Trim().Split(' ')[0]

# 5173, 8800 포트를 호스트로 포워딩
netsh interface portproxy add v4tov4 listenport=5173 listenaddress=0.0.0.0 connectport=5173 connectaddress=$wslIp
netsh interface portproxy add v4tov4 listenport=8800 listenaddress=0.0.0.0 connectport=8800 connectaddress=$wslIp

# Windows Firewall 인바운드 허용
New-NetFirewallRule -DisplayName "MXWP Web" -Direction Inbound -Protocol TCP -LocalPort 5173 -Action Allow
New-NetFirewallRule -DisplayName "MXWP API" -Direction Inbound -Protocol TCP -LocalPort 8800 -Action Allow
```

WSL을 재시작할 때마다 IP가 바뀔 수 있어 위 스크립트를 `Restart-MXWP.ps1`로 만들어 작업 스케줄러에 등록하면 편합니다.

**방법 2: WSL2 미러 모드 (Windows 11 / Server 2025)**

`%USERPROFILE%\.wslconfig`:
```ini
[wsl2]
networkingMode=mirrored
```
이러면 WSL2 서비스가 호스트 IP에서 바로 보입니다 (포트 프록시 불필요).

### A-6. Windows 부팅 시 자동 시작

WSL2는 첫 명령 실행 시에만 시작됩니다. 자동 시작용 스케줄러 작업:

PowerShell 관리자 권한:

```powershell
$action = New-ScheduledTaskAction -Execute "wsl.exe" `
  -Argument "-d Ubuntu-22.04 --user koopark --cd /home/koopark/MXWhitePaper -- bash -c './infra/scripts/start.sh; sleep infinity'"
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Highest
Register-ScheduledTask -TaskName "MXWP-AutoStart" -Action $action -Trigger $trigger -Principal $principal
```

### A-7. 스토리지 위치

WSL2 파일시스템(`\\wsl$\Ubuntu-22.04\home\koopark\MXWhitePaper`)에 두면 IO가 가장 빠릅니다 (Linux ext4). Windows 디렉터리(`/mnt/c/...`)에 두면 약 5~10배 느려집니다.

DB 데이터는 `infra/data/postgres/`, MinIO 데이터는 `infra/data/minio/`에 영속됩니다 — 백업은 우리 [`backup-db.sh`](../infra/scripts/backup-db.sh)로 동일하게.

---

## B. Docker Desktop on Windows (대안)

코드를 Apptainer에서 Docker로 바꾸는 작업이 필요. 단, 이미 sif 빌드 정의 (`infra/apptainer/*.def`)가 OCI 표준에 가까워서 변환이 어렵지 않음.

### B-1. 필요한 작업

1. **Docker Desktop 설치** + 라이선스 확인 (Samsung 같은 큰 조직은 유상)
2. `Dockerfile` 신규 작성 (api, web 두 개)
3. `docker-compose.yml` 신규 작성 (postgres, meili, minio, mc, api, web)
4. `infra/scripts/*.sh` 를 `compose up/down`으로 교체
5. Windows Firewall 룰

### B-2. 예시 docker-compose.yml 골격

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    ports: ["5432:5432"]
    volumes: ["./infra/data/postgres:/var/lib/postgresql/data"]
  meilisearch:
    image: getmeili/meilisearch:v1.10
    environment:
      MEILI_MASTER_KEY: ${MEILI_MASTER_KEY}
    ports: ["7700:7700"]
    volumes: ["./infra/data/meili:/meili_data"]
  minio:
    image: minio/minio:latest
    command: server /data --console-address :9001
    environment:
      MINIO_ROOT_USER: ${MINIO_ACCESS_KEY}
      MINIO_ROOT_PASSWORD: ${MINIO_SECRET_KEY}
    ports: ["9000:9000", "9001:9001"]
    volumes: ["./infra/data/minio:/data"]
  api:
    build: ./apps/api
    depends_on: [postgres, meilisearch, minio]
    ports: ["8800:8800"]
    environment:
      DATABASE_URL: postgresql+asyncpg://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
      ...
  web:
    build: ./apps/web
    depends_on: [api]
    ports: ["5173:5173"]
```

DB 백업/복원/리셋 스크립트는 Docker용으로 1줄씩 바꾸면 됩니다 (`apptainer exec instance://...` → `docker exec mxwp-postgres ...`).

---

## C. Hyper-V 위 Linux VM

가장 격리된 옵션. WSL2가 못 쓰는 환경(예: 윈도우 서버 2016)에서 유효.

1. Hyper-V 매니저에서 Ubuntu 22.04 ISO로 VM 생성 (vCPU 4, RAM 8GB, 디스크 60GB)
2. SSH 활성화: `sudo apt install -y openssh-server`
3. Apptainer 설치 (위 A-2 참조)
4. **모든 점이 Linux 동일** — 코드 그대로 동작
5. 외부 노출: VM 네트워크를 "외부 가상 스위치"로 + 사내 IP 발급

WSL2와 비교한 트레이드오프:
- ✅ 완전 격리, 안정성 최고
- ✅ 외부 접근 단순 (VM이 네트워크 시민)
- ❌ RAM 8GB 통째로 점유 (WSL2는 dynamic)
- ❌ VM 관리 도구 별도 학습

---

## D. 네이티브 Windows 포팅 (비권장)

코드 자체는 거의 다 동작합니다 (Python/Node는 Windows에서 잘 동작). 다만 인프라 측면이 골치아픕니다:

- **Postgres**: 공식 Windows 인스톨러 사용 (서비스 등록)
- **MinIO**: Windows 바이너리 다운로드 (서비스 wrapper 추가 필요)
- **Meilisearch**: Windows 바이너리 다운로드
- **API**: `python -m uvicorn` 직접 실행 + NSSM으로 서비스화
- **Web**: `pnpm dev` 또는 prod 빌드 + IIS/Nginx로 정적 호스팅
- **bash 스크립트 → PowerShell 스크립트** 전부 재작성

작업량이 크고 유지보수 분기점이 늘어 **권장하지 않음**.

---

## 운영 체크리스트 (Windows Server 공통)

### 보안
- [ ] `.env`의 모든 비밀번호 변경 (POSTGRES, MEILI, MINIO, JWT)
- [ ] `APP_ENV=production` (CSP `'unsafe-eval'` 자동 제거됨)
- [ ] HTTPS 적용 — 외부 노출 시 IIS 또는 Nginx로 TLS 종단 (Let's Encrypt + win-acme)
- [ ] Windows Firewall: 5173, 8800만 외부 허용. 5432/7700/9000은 내부망만
- [ ] 정기 백업 (스케줄 작업으로 매일 03:00에 `backup-db.sh` 실행)
- [ ] Windows Update 자동화 정책 확인

### 성능
- [ ] WSL2 메모리 캡 (`%USERPROFILE%\.wslconfig` 의 `memory=8GB`)
- [ ] Postgres `shared_buffers`, `work_mem` 튜닝 (큰 문서 많을 때)
- [ ] MinIO 데이터 디스크 분리 (속도 + 백업 용이)
- [ ] Meilisearch 인덱스 크기 모니터링 (문서 1만 건 ≈ 1GB 정도 차지)

### 모니터링
- [ ] `infra/scripts/status.sh`로 인스턴스 상태 정기 점검
- [ ] `infra/logs/`의 에러 로그를 ELK/Loki로 전송 (선택)
- [ ] DB 디스크 사용량 알람 (90% 초과 시)

### 백업/복구
- [ ] 매일 자동 백업: `backup-db.sh` → 외부 NAS로 robocopy
- [ ] 월 1회 복구 리허설: `restore-db.sh`로 staging 복원
- [ ] MinIO `infra/data/minio/` 도 7일 단위 robocopy 백업

### 자동 시작
- [ ] Windows 부팅 시 WSL 자동 시작 (작업 스케줄러)
- [ ] WSL 시작 시 `start.sh` 자동 실행
- [ ] 헬스체크 실패 시 알람 (`curl /api/v1/healthz` 모니터링)

---

## 주요 명령어 치트시트 (Windows Server에서)

```powershell
# WSL 셸 진입
wsl -d Ubuntu-22.04

# 스택 시작/종료 (WSL 안)
./infra/scripts/start.sh
./infra/scripts/stop.sh
./infra/scripts/status.sh

# DB 백업/복원/리셋 (WSL 안)
./infra/scripts/backup-db.sh
./infra/scripts/restore-db.sh latest
./infra/scripts/reset-db.sh --with-seed

# 로그 보기
./infra/scripts/logs.sh api 100
```

```powershell
# Windows에서 WSL 상태 보기
wsl --list --running

# WSL 메모리 / 디스크 사용량
wsl -- free -h
wsl -- df -h

# WSL 종료 (긴급)
wsl --shutdown

# 포트 포워딩 확인
netsh interface portproxy show all
```

---

## 트러블슈팅

| 증상 | 원인 / 해결 |
|------|-----------|
| `apptainer: command not found` | WSL 안에서 PPA 추가 안 됨. A-2 절차 재확인 |
| Web 로딩 무한 (Network Error) | API 인스턴스가 안 떠있음. `./infra/scripts/status.sh` 확인 |
| `localhost:5173` 외부에서 안 보임 | 포트 프록시 또는 미러 모드 미적용. A-5 참조 |
| DB 비밀번호 틀림 에러 | `.env` 변경 후 `./infra/scripts/stop.sh && start.sh` 재시작 필요 |
| WSL 디스크 공간 부족 | `wsl --shutdown` 후 `Optimize-VHD -Path <vhdx 경로> -Mode Full` |
| 한글 LANG 워닝 | `sudo locale-gen ko_KR.UTF-8 && sudo update-locale LANG=ko_KR.UTF-8` |

---

## 마이그레이션 시나리오: Linux 운영 중 → Windows Server 이전

1. Linux 쪽에서 `./infra/scripts/backup-db.sh` 로 백업
2. 백업 .sql.gz + `infra/data/minio/` 디렉터리를 Windows Server로 robocopy
3. Windows Server에서 위 A-1~A-4 절차로 스택 구축
4. `infra/data/minio/` 복원 (이미지/파일 데이터)
5. `./infra/scripts/restore-db.sh path/to/backup.sql.gz`
6. `./infra/scripts/status.sh` 로 정상 동작 확인
7. DNS/방화벽 컷오버

다운타임 ≈ DB 복원 시간 (10MB 백업 기준 30초 미만)

---

## 참고

- [Apptainer on Windows (WSL2) 공식 가이드](https://apptainer.org/docs/admin/main/installation.html#install-from-source)
- [WSL2 메모리/네트워크 설정](https://learn.microsoft.com/windows/wsl/wsl-config)
- [Windows Server 2022 + WSL](https://learn.microsoft.com/windows-server/virtualization/wsl/install)
- 본 프로젝트 인프라 스크립트: [`infra/scripts/`](../infra/scripts/)
- DB ops 스크립트: [`backup-db.sh`](../infra/scripts/backup-db.sh) / [`restore-db.sh`](../infra/scripts/restore-db.sh) / [`reset-db.sh`](../infra/scripts/reset-db.sh)
