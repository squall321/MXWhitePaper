# Infra mmap patch — 4 projects sweep summary

> Date: 2026-05-19
> Trigger: mxwp 어제 패치 후 백로그 H1 "다른 프로젝트 mmap 패치 권고" 진행
> Method: 3 서브 에이전트 병렬 + 메인 직접 fallback

## 결과

| 프로젝트 | 인스턴스 | 패치 | 검증 | 다운타임 | 발견 사항 |
|---|---|:---:|:---:|---:|---|
| MXWhitePaper | mxwp_postgres | ✅ 2026-05-18 | ✅ | ~10s | 첫 패치, playbook §6 하 |
| AIDataHub | aidh_postgres | ✅ | ✅ | ~5s | 에이전트가 raw apptainer 명령으로 처리 |
| KooDTX | koodtx-postgres | ✅ | ✅ | ~3s | 에이전트 차단 → 메인 fallback |
| SignalForge | sf_postgres | ✅ | ✅ | ~30s | 에이전트 차단 → 메인. 라이브 fail 중이었음. orphan mcp 발견·정리 |

4/4 모두 mmap 으로 전환. `/dev/shm/PostgreSQL.*` 의존 0. PGDATA 안 `pg_dynshmem/mmap.*` 정상 생성.

## 학습

### 1. 에이전트 샌드박스 제약

서브 에이전트 (general-purpose) 는 working directories 화이트리스트 *밖* 폴더에 쓰기 차단. KooDTX, SignalForge 둘 다 막힘. 진단까지만 하고 정지. 메인 스레드는 권한 있음 → fallback 패턴.

**다음에 같은 패턴 쓸 때**:
- 시작 전 *모든 대상 폴더가 화이트리스트에 있는지* 확인. 없으면 working directory 추가 후 출발
- 또는 메인 스레드가 직접 + 에이전트는 진단만 시키기

### 2. SignalForge orphan mcp

`mcp-server/server.py` 가 `init 1` 아래 살아남는 패턴. 정확한 원인:
- 부모 sf-mcp 프로세스 (pidfile 에 적힌 것) 가 죽으면 자식이 init 으로 reparent
- `kill <pid>` 가 단일 PID 만 시그널 — process group 까지 전파 안 함
- `down.sh` 가 `kill -- -PGID` 또는 child traverse 안 함

**별도 사이클 권고** (SignalForge 측 cleanup):
- `down.sh` 가 mcp 의 모든 자식까지 확실히 종료
- 또는 mcp 가 SIGTERM 받으면 자식까지 정리

### 3. up.sh 멱등성

SignalForge `up.sh` 는 postgres 만 떠있어도 backend/celery/mcp 까지 모두 재기동. MXWhitePaper `start.sh` 는 인스턴스 단위로 멱등 (`✓ already running` skip). 두 패턴 비교 후 SignalForge `up.sh` 도 같은 패턴 권고.

### 4. asyncpg lazy reconnect

postgres 만 stop/start 하고 host native client (uvicorn, celery) 는 안 죽여도 자동 재연결. 다운타임 최소화. mxwp 패치 때부터 검증된 패턴 — 4 프로젝트 모두 통과.

## 산출물

- `infra-mmap-aidh.md` (서브 에이전트 작성)
- `infra-mmap-koodtx.md` (메인 작성)
- `infra-mmap-sf.md` (메인 작성)
- `infra-mmap-summary.md` (본 문서)

## 후속

- 다음 호스트 OS reboot 후 4 프로젝트 모두 `/dev/shm/PostgreSQL.*` 신규 생성 안 되는지 확인 — 본 패치의 진짜 검증 시점
- SignalForge orphan mcp + up.sh 멱등성 별도 cleanup 사이클 (mxwp 외부 작업이지만 권고)
- mxwp `playbook §6 하` 가 4 프로젝트 적용 결과를 *증거*로 보강 (선택)
