# KooDTX postgres mmap 패치 — 결과

> Date: 2026-05-19
> Owner: 메인 스레드 (서브 에이전트는 KooDTX 폴더 샌드박스 차단으로 정지 후 보고만)

## 변경

- 백업: `/home/koopark/claude/KooDTX/KooDTX-main/server/data/pg/postgresql.conf.bak-pre-shmfix-2026-05-19` (29,822 bytes)
- 패치: L147 `#shared_memory_type = mmap` → `shared_memory_type = mmap`, L153 `dynamic_shared_memory_type = posix` → `mmap`. 각 줄에 "mxwp-infra-fix 2026-05-19" 마커

## 의존

- apptainer 인스턴스: `koodtx-postgres` 단독
- 호스트 native uvicorn (PID 1567268, port 8500) — kill 없이 postgres만 stop/start로 처리 (asyncpg lazy reconnect)

## 재시작

- stop: `bash run-postgres-apptainer.sh stop` — `[koodtx] postgres stopped`
- start: 같은 스크립트로 — `[koodtx] postgres up — postgresql://koodtx:****@127.0.0.1:5432/koodtx`
- 다운타임: ~3초 (uvicorn은 안 죽임)

## 검증 (모두 PASS)

```
SHOW shared_memory_type;        → mmap
SHOW dynamic_shared_memory_type;→ mmap
ls pg_dynshmem/                 → mmap.3485007634, mmap.4292886774
uvicorn PID 1567268             → LIVE (kill 안 함)
```

## 영향

- 다운타임: ~3초 (postgres만)
- 데이터 영향: 0
- 다른 프로젝트 영향: 0
- 의존(uvicorn) 영향: 0 (asyncpg가 자동 재연결)

## 후속 권고

- 다음 호스트 OS reboot 후 `/dev/shm/PostgreSQL.*` 신규 생성 안 되는지 확인 (재발 방지 검증)
- KooDTX `down.sh` / 다른 시작 스크립트도 본 conf 변경과 충돌 없음 (값만 다름)
