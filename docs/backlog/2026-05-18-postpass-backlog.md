# 2026-05-18 작업 정리 + 향후 패치 백로그

> 하루 안에 끝낸 큰 작업 4건 (v1.0.4 릴리스 / widget-integrity-pass-1 / widget-integrity-pass-2 / 인프라 패치) 의 결과 + *지금 손 안 댄 것* 정리.
> 다음 사이클 시작 시 본 문서 먼저 보고 우선순위 결정.

---

## 1. 오늘 한 일 (완료, 정리만)

### 1.1 v1.0.4 릴리스 — mxwp-import 첫 게시

- Linux/Windows lite 번들에 4번째 바이너리 (mxwp-import) 포함 게시
- Github Release: `https://github.com/squall321/MXWhitePaper/releases/tag/v1.0.4`
- 번들 검증: `mxwp-validator`, `mxwp-rules`, `mxwp-mcp`, **`mxwp-import`** 모두 포함

### 1.2 widget-integrity-pass-1 (matchRate 100%, archived)

- 4 Explore 에이전트가 35 블록 점검 → CRITICAL 1 + HIGH 8 + zebra 묶음
- 4분할 병렬 (B1 BE export / B2 schema+imageId / B3 FE editor / B4 sync) 충돌 0
- 신규 26 tests, 회귀 0
- Archive: `docs/archive/2026-05/widget-integrity-pass-1/`

### 1.3 widget-integrity-pass-2 (matchRate 100%, archived)

- pass-1 점검의 MED 17건 중 영향 큰 10건 (M1~M11) 처리
- pydantic v2 oneOf 한계 발견 + `generate-py.py` 후처리 패치 = 재사용 자산
- B3 vs B2 flag race condition 1회 (1분 차이) → 직접 5분 패치로 정리
- 신규 26 tests + snapshot 1, 회귀 0
- Archive: `docs/archive/2026-05/widget-integrity-pass-2/`

### 1.4 인프라 패치 — postgres `/dev/shm` mmap 전환

- 오늘 3번 마주친 `asyncpg.UndefinedFileError: could not open shared memory segment "/PostgreSQL.<rand>"` 해결
- `infra/data/postgres/pgdata/postgresql.conf` 2줄 수정:
  - `shared_memory_type = mmap`
  - `dynamic_shared_memory_type = mmap`
- 검증: endpoint 테스트 25+ pass (이전 fail). `pg_dynshmem/mmap.*` 생성 확인
- Playbook 업데이트: `docs/deployment-playbook.md` §6 하

---

## 2. 향후 패치 백로그 (우선순위)

### HIGH — 다음 사이클 후보

#### H1. pass-3: widget MED 잔여 7건

pass-2가 MED 10건 처리, 7건이 남아있음. pass-1 점검 보고서 (`docs/archive/2026-05/widget-integrity-pass-1/widget-audit/A1-A4-*.md`) 참조.

| 갭 | 출처 | 작업량 |
|---|---|---|
| spreadsheet 전용 키보드 에디터 (Enter/Tab/방향키 셀 이동, 엑셀 paste) | A1 | 반나절~하루 |
| gantt 에디터 UI (행 추가, 드래그 start/end, progress 슬라이더) | A1 | 하루 |
| flow Mermaid 시각 에디터 또는 도움말 강화 | A1 | 반나절 |
| list check style round-trip 보장 (☐ 문자 손실 위험) | A2 | 1시간 |
| image width 출처 통일 (`block.width` vs `meta.width`) | A3 | 30분 |
| form/quiz 기본값 학습 (사용자 선호 저장) | A4 | 1~2시간 |
| spacer xl=128px schema enum 확장 | A4 | 5분 |

**제안**: `/pdca plan widget-integrity-pass-3` 같은 패턴으로. 단 spreadsheet 키보드와 gantt UI는 *각각 큰 작업*이라 별도 사이클로 빼는 게 더 깔끔할 수도.

#### H2. 다른 프로젝트 postgres 동일 패치 권고

같은 호스트에서 돌고 있는 다른 apptainer postgres 인스턴스 3개 — 같은 `/dev/shm` flaky를 겪을 가능성:

- `aidh_postgres` (`/home/koopark/claude/AIDataHub/deploy/apptainer/`)
- `koodtx-postgres` (`/home/koopark/claude/KooDTX/...`)
- `sf_postgres` (`/home/koopark/claude/SignalForge/apptainer/`)

각 프로젝트의 `postgresql.conf`에 같은 2줄 패치 적용 권고. 우리 mxwp는 별개 PGDATA + conf라 격리됐지만, 다른 프로젝트도 같은 호스트 OS reboot 시 동일 증상 가능.

**작업량**: 프로젝트당 5분 (백업 → 2줄 수정 → 재시작 → 검증). 단, 각 프로젝트의 운영자/사용자 동의 필요 (다른 프로젝트의 conf를 마음대로 만지면 안 됨).

### MED — 이슈 누적, 시간 나면

#### M1. IframeBlock pydantic discriminator cleanup

pass-2가 발견한 경고:
```
PydanticSerializationUnexpectedValue: Defaulting to left to right union
serialization - failed to get discriminator value for tagged union serialization
[input_value=IframeBlock(root=IframeBl...height=None, meta=None))]
```

기능은 정상. discriminator 명시하면 사라짐. 작업량: 30분.

#### M2. race condition 보강 — pass-3 방법론 개선

pass-2의 B3가 B2 flag를 1분 차이로 못 보고 종료한 사례. 두 가지 해결책:

1. **flag polling 길이 연장** — B3 종료 전에 30분 polling (현재 어떻게 돼있는지 확인 필요)
2. **B2 직렬화** — B2를 사이클 시작점으로 단독 실행 후 B1/B3 출발 (의존성 깔끔하지만 시간 ↑)

다음 사이클이 같은 4분할 방식 쓰면 적용 필요.

#### M3. archive `_INDEX.md` markdownlint MD060

기존 markdown table compact 스타일이라 새 줄 추가할 때마다 경고. 파일 전체 재포맷 한 번 하면 끝. 작업량: 10분. 그러나 다른 문서들이 같은 스타일이라 *통일성*도 고려.

#### M4. design 문서의 의미 갱신 (DataSource M1 표현)

pass-2 gap-detector가 발견: design §3.2가 `block.refreshInterval ? *1000 : false` 였는데 구현은 `derivePollingConfig`로 기존 60s default 폴링 의미 보존. acceptance 영향 없지만 design의 표현이 코드와 약간 다름. 다음 사이클 design 작성 시 더 정확히.

### LOW — 시간 많이 남을 때

- A1 audit의 calculator unit 필드 추가
- A3 audit의 video thumbnail (YouTube)
- A3 audit의 file 미리보기 (MIME 별)
- A4 audit의 accordion 기본 펼침 정책
- markdown stripe round-trip import 측 보강 (pass-1의 결정 — markdown 자체 zebra 불가라 hidden comment만 emit)
- A2 audit의 callout marker "오보" 사실관계 정정 (실제 이미 구현돼 있음)
- pass-1·2 사이클의 archive index 표 압축형 → 정렬형 통일

---

## 3. 다음 시작할 때 권장 순서

1. **현재 우선순위 재확인** (사용자 의도가 시간 따라 바뀜)
2. H2 다른 프로젝트 postgres 패치 의사 결정 (다른 프로젝트 소유자와 협의)
3. H1 pass-3 진입 — `/pdca plan widget-integrity-pass-3` (MED 7건 중 작은 것만 골라 5건 정도가 적절)
4. M1·M2·M3 같은 작은 cleanup은 pass-3에 묶어서

---

## 4. 핵심 정리 — 오늘의 학습/자산

| 자산 | 출처 | 다음에 쓸 곳 |
|---|---|---|
| 4분할 병렬 방법론 (파일 단독 소유 + flag 신호) | pass-1, pass-2 | 비슷한 다영역 통합 작업 시 |
| pydantic v2 oneOf 한계 + `generate-py.py` 후처리 패치 | pass-2 B2 | 다른 oneOf 위젯 시 동일 패턴 |
| race condition 학습 | pass-2 | 다음 사이클 flag polling 또는 직렬화 |
| postgres mmap 전환 패치 | 인프라 사이클 | 다른 프로젝트, 호스트 재설치 시 |
| 35 블록 점검 (Explore ×4 분할) | pass-1 | 다음 *전수 점검* 시 같은 패턴 |

---

**작성 시각**: 2026-05-18 23:50 KST
**다음 사이클 시작 시 본 문서 먼저 읽기**
