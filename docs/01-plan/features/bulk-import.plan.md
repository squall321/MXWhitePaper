# Bulk Import CLI Planning Document

> **Summary**: 사내 / 외부 파이프라인이 *대량* 으로 만들어둔 `.docx` (와 부수
> 메타 json) 을 한 디렉토리만 가리키면 MXWhitePaper 사이트에 일괄 import 하는
> CLI. 현재 운영자가 한 건씩 UI 또는 단일 curl 로 처리해야 해 ~300+ 건 적재가
> 사실상 불가능.
>
> **Project**: MX White Paper
> **Feature**: bulk-import
> **Version**: 0.1.0
> **Date**: 2026-05-18
> **Status**: Draft

---

## Executive Summary

| Perspective | Content |
|-------------|---------|
| **Problem** | `/data/Namu_Archive/out/upload/` 같은 외부 파이프라인 출력 폴더에는 이미 320+ 쌍의 docx + json 이 있고 앞으로 더 늘어난다. 사이트 UI 한 건씩 import 하려면 운영자 손이 며칠 — 사실상 import 가 안 됨. |
| **Solution** | `mxwp-import` CLI: YAML 옵션 파일 한 장 + 폴더 경로만 주면 폴더 안 모든 docx (+ json 메타) 를 검증·변환·업로드. dry-run / on-conflict / parallel / resume / 부분 실패 리포트. server 의 `/imports/docx` + `/documents` 2-step API 를 그대로 활용해 import 로직 중복 없음. |
| **Function/UX Effect** | 옵션 파일 1장 작성 (10 줄) + `mxwp-import --config bulk.yml` 1줄 → 300+ 문서 자동 적재. 진행률 + 실패 목록 + 재시도 로그 자동. dry-run 으로 사전 검증, 충돌 시 skip/overwrite/version 옵션. |
| **Core Value** | "외부 파이프라인이 백서를 *대량* 으로 만들어두면 사이트가 그걸 *자동으로 흡수* 한다" — Namu Archive 같은 사내 ETL 결과를 사이트의 일급 자료로 변환하는 마지막 1마일 도구. 운영자 시간을 며칠 → 분 단위로. |

---

## 1. Overview

### 1.1 Purpose

외부 파이프라인 (Namu Archive 등) 이 만든 *수백~수천* 건의 docx 자료를 MXWhitePaper
서버에 일괄 import 하는 CLI 도구. 기존 toolkit 의 `mxwp-validator` + 서버의
`/imports/docx` + `/documents` API 를 조합해 *대량 자동화 어댑터* 로 동작.

### 1.2 Out of Scope

- 새 import 파이프라인 자체 (기존 `/api/v1/imports/docx` 그대로 사용)
- docx 콘텐츠 생성 / 변환 / 보강 (외부 파이프라인의 책임)
- 양방향 동기화 (이건 *단방향 적재*. update 동기화는 별도 사이클)
- Namu format → DocumentJSON *비-docx* 직접 변환 (이번 사이클은 docx 우선,
  json 은 메타데이터 보강만 — §1.3 결정 #1 참고)

### 1.3 Decisions (확정)

| # | 결정 | 값 |
|---|---|---|
| 1 | docx + json 처리 모드 | **docx-primary** — docx 본문 + json 메타 (domain/source/summary) 로 보강 |
| 2 | slug 출처 | json 의 `slug` 필드 우선. json 없으면 파일명 (stem) |
| 3 | 충돌 시 정책 | YAML 옵션 (`on_conflict: skip / overwrite / version`). 기본 `skip` |
| 4 | 에러 처리 | 전체 시도 후 실패 목록 리포트. 첫 실패에 멈추는 옵션도 (`stop_on_error: false`) |
| 5 | CLI 이름 / 위치 | `mxwp-import` 신규 binary. toolkit 의 4번째 PyInstaller 산출물 |
| 6 | 인증 | env (`MXWP_TOKEN` / `MXWP_SERVER`) 우선, CLI 인자 오버라이드 가능 |
| 7 | 옵션 파일 형식 | YAML (사람 친화) |
| 8 | 조직 매핑 | 옵션 파일에 default (`division/team/part/owners`). json 의 `domain` → `part` 매핑 테이블 옵션 |
| 9 | rate limit 준수 | 서버의 분당 5건 (`import_rate_limit_per_minute`) 자동 준수 — `parallel: 1` + `delay: 12s` 기본 |
| 10 | 재시도 / resume | 실패한 건 별도 `.failed.txt` 에 적고, `--resume` 시 그 목록만 재시도 |
| 11 | dry-run | `--dry-run` 모드 — 실제 호출 안 하고 무엇이 어디로 갈지 plan 만 출력 |
| 12 | docx 사전 검증 | `mxwp-validator` 라이브러리 임포트 (binary 호출 X). exit 1 (schema 위반) docx 는 자동 skip + 실패 리스트 |

---

## 2. Functional Requirements

### 2.1 입력

| 종류 | 출처 |
|---|---|
| **옵션 파일** | YAML, `--config path/to/bulk.yml` 또는 default `./mxwp-import.yml` |
| **CLI 인자** | `--source PATH` (옵션 파일의 source.path override), `--dry-run`, `--resume`, `--server URL`, `--token TOKEN`, `--limit N` |
| **환경변수** | `MXWP_TOKEN`, `MXWP_SERVER`, `MXWP_CONFIDENTIALITY` |

### 2.2 옵션 파일 스키마 (YAML)

```yaml
# Required
server: https://mxwhitepaper.회사도메인
token: ${MXWP_TOKEN}          # env 참조 (안전 보관 위해)

source:
  path: /data/Namu_Archive/out/upload
  pattern: "*.docx"            # glob. default *.docx (json 은 자동 매칭)
  exclude_patterns: []         # 선택, glob 배열

# Required: 문서 메타 기본값 (json/docx 에 없을 때 채워짐)
defaults:
  division: mx                 # division slug
  team: knowledge              # team slug
  part: namu-archive           # part slug (없으면 생략 가능)
  confidentiality: internal    # public | internal | confidential
  owners: ["archive-bot@samsung.com"]
  tags: []                     # 기본 태그 (json 의 domain 으로 자동 추가됨)

# Optional: json.domain → part 매핑
domain_to_part:
  software:      software-archive
  mobile:        mobile-archive
  semiconductor: semicon-archive
  electronics:   electronics-archive
  telecom:       telecom-archive
  architecture:  architecture-archive
  # 매핑에 없으면 defaults.part 사용

# 동작
mode: docx-primary             # docx-primary / docx-only / json-only (v1 미지원)
on_conflict: skip              # skip / overwrite / version
stop_on_error: false
parallel: 1                    # 서버 rate-limit 때문에 기본 1
delay_seconds: 12              # 분당 5 호출 한계 ÷ 안전계수
dry_run: false
limit: 0                       # 0 = 전체
```

### 2.3 출력

| 위치 | 내용 |
|---|---|
| stdout | 진행률 (`[123/320] ✓ android-os-10`), 결과 요약 |
| `mxwp-import.log` | 시도된 모든 건의 상세 (success/skip/fail + reason + http response) |
| `mxwp-import.failed.txt` | 실패한 파일 경로 (재시도용 — `--resume` 으로 입력) |
| `mxwp-import.plan.yml` | (dry-run 시) 무엇이 어디로 갈지 미리보기 |

### 2.4 동작 흐름

```
1. 옵션 파일 + env + CLI 인자 머지 (CLI > env > config)
2. source.path 스캔 → 처리 대상 목록 (docx + 동명 json 쌍)
3. 각 건마다:
   a. mxwp-validator 라이브러리로 docx 사전 검증 (schema OK 만 진행)
   b. json (있으면) 에서 메타 보강 (domain → tags, source → audit_log payload)
   c. server /imports/docx 호출 → DocumentJSON 받음
   d. defaults + json 메타로 metadata 채움
   e. /documents 호출 (on_conflict 정책에 따라)
   f. rate-limit 준수 (parallel + delay)
4. 결과 집계 → log + failed.txt + summary
```

### 2.5 명령 예시

```bash
# 가장 단순 — 옵션 파일만
$ mxwp-import --config bulk.yml

# 한 폴더만 빠르게 (옵션 파일 없이)
$ mxwp-import --source /data/Namu_Archive/out/upload \
              --server https://mxwhitepaper.x \
              --token mxwp_xxx \
              --limit 10

# dry-run
$ mxwp-import --config bulk.yml --dry-run

# 재시도
$ mxwp-import --config bulk.yml --resume
```

---

## 3. Non-Functional Requirements

| 항목 | 기준 |
|---|---|
| 처리량 | 분당 5건 (서버 rate-limit) — 300건 약 1시간 |
| 메모리 | 한 건 단위 처리, 폴더 전체 메모리 적재 X |
| 안전성 | 실패 시 그 docx 의 부분 데이터가 서버에 남지 않게 (트랜잭션 보장은 서버 측 책임, CLI 는 명시적 rollback 호출 X) |
| 재현성 | dry-run 결과가 실제 실행 결과와 일치 |
| 로그 | 모든 시도가 log 에 남음. 실패 시 reason + http body 포함 |
| 비밀 보관 | token 은 stdout/log 에 절대 노출 X. env 또는 옵션 파일 권장 |

---

## 4. Data Layer 영향

**없음** — 새 테이블 / 마이그레이션 / 스키마 변경 없음. 기존 `/imports/docx` +
`/documents` + `audit_log` 그대로 사용.

다만 *audit_log 의 `payload` 에 import source 정보가 들어가도록* 본 CLI 가 명시
주입 (예: `{source: "namu-archive", file: "android-10.docx", source_rev: "abc123"}`)
하여 후속 추적 가능.

---

## 5. 의존성 / 영향 범위

| 영역 | 영향 |
|---|---|
| `dist/llm-docx-toolkit/bin/` | 새 binary `mxwp-import` 추가 — 4번째 산출물 |
| `dist/llm-docx-toolkit/build.py` | 새 target `--target import` + `_pack_release` 가 자동 포함 |
| 서버 (`apps/api`) | 변경 없음 |
| RAG / MCP | 무관 |
| CI workflow | mxwp-import binary 도 빌드되도록 build.py 호출만 |
| HANDOFF.md / docx-authoring-guide.html | "대량 import" 절차 한 슬라이드 추가 |

---

## 6. 테스트 전략

| 종류 | 케이스 |
|---|---|
| Unit | docx + json 쌍 페어링, 옵션 파일 머지, on_conflict 분기 |
| Unit | rate-limit 시간 계산, log 포맷 |
| Integration | dry-run 모드: 실제 호출 없이 plan 출력 일치 |
| Integration | 모의 서버 (FastAPI test client) 로 3건 import 흐름 — success/skip/fail 각 1건 |
| E2E | `/data/Namu_Archive/out/upload` 의 10건 dry-run + 실제 1건 (개발 인스턴스) |

---

## 7. 단계별 산출물

| Phase | 파일 |
|---|---|
| design | `docs/02-design/features/bulk-import.design.md` (스키마, 로직, 함수 시그니처) |
| do | `dist/llm-docx-toolkit/imp/cli.py`, `imp/loader.py`, `imp/uploader.py`, `imp/types.py`, tests |
| 빌드 | `build.py --target import` 새 entry + spec |
| 문서 | HANDOFF §11 신규, deck 슬라이드 1개 추가 |
| report | `docs/04-report/features/bulk-import.report.md` |

---

## 8. 위험 / 미확정

| 위험 | 완화 |
|---|---|
| 서버 rate-limit (분당 5) — 300건 1시간 | 기본 보수적, 옵션 (`delay_seconds`) 로 조정 가능 |
| `slug` 중복 — 한 폴더에 같은 slug 두 docx | 첫 건 우선, 나머지는 skip + 경고 |
| docx schema 위반 비율 높음 | dry-run 으로 사전 파악 + skip 정책 |
| Namu json 의 `slug` 가 server 의 slug 규칙 (a-z 0-9 한글 -) 어길 때 | `_slugify()` 동일 룰로 정규화 |
| 동일 파일 *재실행* 시 audit_log 폭증 | on_conflict=skip 이면 INSERT 시도 자체를 안 함 |
| 옵션 파일 token 평문 보관 | env 참조 (`${MXWP_TOKEN}`) 권장, 평문이면 startup 경고 |
| Windows 경로 `\` vs Linux `/` | `pathlib.Path` 통일 |
| 파일명에 특수문자 (한글 OK, but emoji?) | 한글만 허용, 그 외 `_slugify` 강제 |

---

## 9. Acceptance Criteria

1. ✅ `mxwp-import --config bulk.yml --dry-run` 으로 `/data/Namu_Archive/out/upload` 전체 plan 출력
2. ✅ 실제 import 시 정상 docx 는 사이트에 새 문서로 들어감
3. ✅ schema 위반 docx 는 skip 되고 `mxwp-import.failed.txt` 에 기록
4. ✅ 동일 slug 가 있으면 `on_conflict: skip` 기본으로 건너뜀
5. ✅ rate-limit (분당 5) 자동 준수 — 60s window 안 6번째 호출 안 함
6. ✅ `--resume` 으로 실패 목록만 재시도
7. ✅ json 의 `domain` 이 `tags` 와 `part` 에 자동 반영
8. ✅ token 이 stdout / log 어디에도 노출되지 않음
9. ✅ Linux 와 Windows 양쪽 binary 빌드
10. ✅ 단위/통합 테스트 모두 통과 (5+ 케이스)
11. ✅ HANDOFF.md + deck 갱신
12. ✅ CI matrix 그린
