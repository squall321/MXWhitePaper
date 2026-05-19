# SignalForge postgres mmap 패치 — 결과

> Date: 2026-05-19
> Owner: 메인 스레드 (서브 에이전트는 SignalForge 폴더 샌드박스 차단으로 정지 후 보고만)

## 긴급도

패치 *전*부터 이미 라이브 fail 중이었음 — 에이전트가 진단 단계에서 `apptainer exec instance://sf_postgres psql` 호출이 `FATAL: could not open shared memory segment "/PostgreSQL.1481756288": No such file or directory` 로 실패하는 것을 확인. 즉시 패치 진행한 게 잘한 선택.

## 변경

- 백업: `/home/koopark/claude/SignalForge/data/postgres/pgdata/postgresql.conf.bak-pre-shmfix-2026-05-19` (29,792 bytes)
- 패치: L147 `#shared_memory_type = mmap` → `shared_memory_type = mmap`, L153 `dynamic_shared_memory_type = posix` → `mmap`. 각 줄에 "mxwp-infra-fix 2026-05-19" 마커

## 의존

apptainer 인스턴스 1 + 호스트 native 4:
- `sf_postgres` (apptainer)
- backend (PID 3094105, uvicorn port 8000)
- celery-worker (PID 6539)
- celery-beat (PID 2169096)
- mcp (PID 2010119, port 8002)

## 재시작 + 부수 처리

1. `apptainer instance stop sf_postgres` (성공)
2. `bash scripts/up.sh` — 의도와 달리 *멱등이 아니라* backend/celery/mcp까지 모두 재기동.
   - postgres ready (1초)
   - backend 새로 시작 OK
   - celery worker/beat 새로 시작 OK
   - **MCP 포트 8002 충돌** — pidfile 의 mcp PID 2010119 는 죽었지만 *자식 python (PID 2010189)* 가 init 1 아래 orphan 상태로 살아남아 8002 잡고있음
3. orphan kill: `lsof -i :8002` → PID 2010189 = `mcp-server/.venv/bin/python mcp-server/server.py` (CWD: SignalForge) 확정. `kill 2010189` 성공.
4. `bash scripts/up.sh` 재실행 — 모든 서비스 ✅ "SignalForge 서비스 기동 완료"

## 검증 (모두 PASS)

```
SHOW shared_memory_type;        → mmap
SHOW dynamic_shared_memory_type;→ mmap
ls pg_dynshmem/                 → mmap.1649541896, mmap.647073626
backend / celery-worker / celery-beat / mcp → LIVE
API http://localhost:8000, MCP http://localhost:8002
```

## 영향

- 다운타임: ~10초 (postgres) + ~20초 (backend/celery/mcp 재기동, up.sh 자동)
- 데이터 영향: 0
- 다른 프로젝트 영향: 0
- *발견된 별개 버그*: SignalForge 의 mcp 자식 프로세스가 부모 stop 후에도 orphan 으로 살아남는 패턴. up.sh 의 멱등성도 일부 깨짐 (postgres 만 떠있어도 backend/celery/mcp 까지 재기동). 단독 정리 필요 — 본 패치 범위 밖

## 후속 권고

- **HIGH**: SignalForge `down.sh` 가 mcp 자식까지 확실히 정리하는지 점검. orphan 패턴은 `kill <pid>` 가 자식까지 signal 전파 안 함 → process group 으로 kill 필요 (`kill -- -PGID`)
- **MED**: `up.sh` 멱등성 — postgres 만 새로 떠있으면 다른 서비스는 재기동하지 않게 분기 추가 (또는 옵션 `--postgres-only`)
- 다음 호스트 OS reboot 후 `/dev/shm/PostgreSQL.*` 신규 생성 안 되는지 확인
