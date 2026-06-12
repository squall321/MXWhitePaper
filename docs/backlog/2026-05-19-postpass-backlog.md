# 2026-05-19 작업 정리 + 향후 패치 백로그 (pass-3 완료 시점)

> 어제(2026-05-18) 백로그 (`2026-05-18-postpass-backlog.md`) 를 갱신.
> widget integrity 사이클 시리즈 (pass-1·2·3) 종료. 부팅 자동 시작 + 인프라 패치 완료.
> 다음 사이클 시작 시 본 문서 먼저 보고 우선순위 결정.

> **[2026-06-12 종결]** HIGH/MED 전 항목 처리 완료 — `docs/archive/2026-06/backlog-gap-closure/` 참조.
>
> - H2 Spreadsheet: Enter/Tab/방향키 (6월 초 선행 구현) + 중간 삽입 UI·엑셀 멀티셀 paste·formula 자동완성 (본 사이클)
> - H3 Gantt: 행 추가/삭제 (선행) + bar 포인터 드래그·progress 슬라이더·날짜순 정렬 버튼 (본 사이클)
> - M1 list check round-trip: H7 fix 로 이미 구현돼 있었음 (테스트 5종 통과) — 주석 drift 만 정정
> - M2 flow Mermaid: 백로그 전제가 stale (템플릿 8종+치트시트+미리보기 5/8-9 기 구현, excalidraw 시각 에디터 5/31) — 공식 문서 링크만 추가
> - M3 spacer xl safelist: non-issue 실증 (`h-32` 가 소스 리터럴 + dist CSS 에 존재) — 작업 불요
> - M4 race condition 방법론: 4분할 flag 방식 자체를 Workflow 오케스트레이션으로 대체해 obsolete
> - LOW 항목은 잔존 (기능 추가성 손질 — 필요 시 별도 사이클)

---

## 1. 완료 (어제~오늘 누적)

### 1.1 widget integrity 사이클 시리즈 — 종료 ✅

| 사이클 | matchRate | 신규 테스트 | 회귀 | 핵심 |
|---|---:|---:|---:|---|
| pass-1 | 100% (14/14) | 26 | 0 | CRITICAL+HIGH 9 + zebra 통합 |
| pass-2 | 100% (14/14) | 26 + snap 1 | 0 | MED 10 + pydantic oneOf 패치 |
| pass-3 | 100% (9/9) | 6 | 0 | MED 잔여 5 + cleanup 1, 직접 수행 |
| **합계** | — | **58 + snap** | **0** | 35블록 위젯 일관성 회복 완료 |

Archive: `docs/archive/2026-05/widget-integrity-pass-{1,2,3}/`

### 1.2 v1.0.4 릴리스 — mxwp-import 첫 게시

GitHub Release `v1.0.4`. 4 바이너리 모두 lite 번들에 포함.

### 1.3 인프라 패치 — postgres /dev/shm mmap 전환

- `infra/data/postgres/pgdata/postgresql.conf`: shared_memory_type=mmap, dynamic_shared_memory_type=mmap
- 결과: endpoint 25+ 살림. `/dev/shm` 의존 0.
- Playbook 갱신: `docs/deployment-playbook.md` §6 하

### 1.4 부팅 자동 시작 (신규)

- `infra/scripts/boot.sh` — start.sh wrapper + 로깅 + healthz 검증
- `infra/systemd/mxwp-stack.service` — systemd --user unit (ExecStop loop fix)
- `infra/systemd/README.md` — 옵션 A(systemd) / B(cron @reboot) / C(수동) 가이드

설치 (사용자 1회):
```bash
sudo loginctl enable-linger koopark
cp infra/systemd/mxwp-stack.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now mxwp-stack
```

---

## 2. 향후 패치 백로그 (우선순위)

### HIGH — 다음 사이클 후보

#### H1. 다른 프로젝트 postgres 동일 mmap 패치 — ✅ **완료 2026-05-19**

- aidh_postgres ✅ (서브 에이전트 raw apptainer 명령 우회)
- koodtx-postgres ✅ (메인 직접 — 에이전트 샌드박스 차단)
- sf_postgres ✅ (메인 직접 — *이미 라이브 fail 중*이었고 orphan mcp 정리 부수효과)

종합 보고서: `docs/03-analysis/infra-mmap-summary.md` (+ 프로젝트별 3 보고서)

부수 발견 → **별도 백로그 항목 (HIGH)**: SignalForge orphan mcp + up.sh 멱등성 (mxwp 외부지만 권고)

#### H2. Spreadsheet 키보드 에디터 (단독 사이클)

pass-1·2·3에서 *미루기로 결정*한 큰 작업. 사용자 가치 명확.

- Enter/Tab 셀 이동, 방향키 네비게이션
- 셀 참조 자동 보정 (행/열 삽입 시 `A1:A5` → `A1:A6`)
- 엑셀에서 paste (TSV/CSV)
- formula 자동완성

작업량: 반나절~하루. 단독 사이클 권장.

#### H3. Gantt 에디터 UI (단독 사이클)

- 행 추가/삭제
- 드래그로 start/end 조정
- progress 슬라이더
- 자동 일자 정렬

작업량: 하루. 단독 사이클.

### MED — 시간 나면

#### M1. list check style round-trip *진짜 fix*

pass-3 N2가 *known limitation으로 잠금만* 함. 실제 fix는:
- `docx_import.py` 의 list 분기에 ☐ prefix detection 추가
- 발견 시 `style:"check"` 로 복원 + ☐ 제거

작업량: 1~2시간.

#### M2. flow Mermaid 시각 에디터

A1 audit MED. 현재 DSL 직접 편집만. 시각 에디터 또는 도움말 강화.

작업량: 반나절.

#### M3. spacer xl tailwind safelist 확인

pass-3 N1에서 `h-32` 클래스 추가. production 빌드 시 purge 되면 안 보임. tailwind config 확인 또는 safelist 명시.

작업량: 15분.

#### M4. race condition 방법론 보강 (다음 4분할 사이클 전)

pass-2 race (B3 vs B2 flag 1분 차이). 옵션:
- B2 직렬화 (사이클 시작점)
- B3·B1 의 flag polling 시간 늘리기 (현재 30분이지만 종료 조건 검토)
- flag 가 떨어진 *후에* 종료하는 패턴 명시

작업량: 30분 (방법론 문서 갱신).

### LOW — 백로그

- A1 audit calculator unit 필드
- A3 audit video thumbnail (YouTube)
- A3 audit file 미리보기 (MIME 별)
- A4 audit accordion 기본 펼침 정책
- markdown stripe round-trip import 측 보강
- A2 audit callout marker "오보" 정정 (실제 이미 구현 → archive 댓글만)
- pass-1/2/3 archive 표 정리 (compact vs spaced 통일)

---

## 3. 권장 다음 시작 순서

1. **사용자 우선순위 재확인** (시간 따라 의도 변동)
2. H1 다른 프로젝트 postgres — 협의 결과 따라 빠르게 정리
3. H2 또는 H3 단독 사이클 — 사용자가 spreadsheet UX vs gantt UI 중 골라서
4. M3 spacer xl safelist 는 H 작업 중간에 끼워 5분
5. M4 race condition 방법론은 다음 4분할 사이클 *전*에 미리

---

## 4. 자산 (방법론 / 코드 / 인프라)

| 자산 | 출처 | 다음 활용 |
|---|---|---|
| 4분할 병렬 (파일 단독 + flag) | pass-1, pass-2 | 다음 다영역 통합 시 |
| 2분할 직접 작업 | pass-3 | cleanup 사이클 시 |
| pydantic v2 oneOf 후처리 패치 | pass-2 B2 | 다른 oneOf 위젯 시 |
| `_normalise_*` BE 정규화 헬퍼 | pass-1 imageId, pass-2 label | 다른 필드 마이그레이션 |
| `blockDefaults.ts` localStorage 학습 | pass-3 N4 | 다른 editor (table preset 등) |
| `vi.stubGlobal('window', ...)` 패턴 | pass-3 G2 | jsdom 없는 환경에서 storage 테스트 |
| boot.sh + systemd unit | 2026-05-19 | 호스트 재설치/이전 시 |
| postgres mmap 패치 | 인프라 사이클 | 다른 프로젝트 + 호스트 재설치 시 |
| Explore ×4 35블록 점검 분할 | pass-1 audit | 다음 전수 점검 시 |

---

## 5. widget integrity 사이클 시리즈 — 종료 선언

pass-1·2·3로 35 블록 위젯의 schema/UI/render/export 일관성 갭을 *체계적으로* 청소. CRITICAL+HIGH+MED 카테고리 거의 모두 해소.

남은 LOW 항목은 *기능 추가가 아닌 손질*이고, *기능 추가* 단독 사이클 (Spreadsheet UX, Gantt Editor 등) 이 더 큰 가치. 따라서 pass-4 (widget integrity 연장) 보다 *단독 사이클*로 전환 권장.

---

**작성**: 2026-05-19 03:10 KST
**다음 시작 시 본 문서 먼저 읽기. 이전 백로그 (`2026-05-18-postpass-backlog.md`) 는 archive 참조용으로 둠.**
