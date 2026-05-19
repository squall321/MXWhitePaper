# Namu_Archive 일괄 import 예제

319 개의 정제된 docx + 320 개의 메타 json — Namu_Archive 프로젝트가 정제한
한국어 위키 데이터를 MXWhitePaper 에 한꺼번에 적재하는 *작동하는 예제*.

## 준비 — 데이터 복사 (한 번만)

본 폴더는 *도구 (sh + yml + README) 만* commit 되어 있고 원본 데이터는
gitignore. 사용자가 본인 환경에서 한 줄로 복사:

```bash
cp /data/Namu_Archive/out/upload/* examples/namu-archive-bulk/
# 또는 다른 source 폴더라면:
cp /path/to/your/docx-folder/*.docx /path/to/your/docx-folder/*.json examples/namu-archive-bulk/
```

복사 안 하면 sh 가 "*.docx 없음" 에러로 멈춤 (안전).

## 데이터

| 항목 | 값 |
|---|---|
| 출처 | `/data/Namu_Archive/out/upload/` (정제 ETL 출력) |
| 본 폴더 위치 | `examples/namu-archive-bulk/` |
| 파일 | 319 docx + 320 json (1 개는 json 만, 자동 skip) |
| 총 용량 | 15 MB |
| 파일명 패턴 | `<주제-슬러그>.docx` + 동일 stem 의 `<주제-슬러그>.json` |
| json 필드 | `slug` `title` `domain` `entry_kind` `summary` `body_md` `structured_json.sections[]` |

## 사용 — 한 줄

```bash
export MXWP_TOKEN=<your-admin-or-editor-token>

# 1) dry-run (server 호출 0, 무엇이 어디로 갈지만)
bash examples/namu-archive-bulk/import-namu-archive.sh

# 2) 진짜 업로드 (DB 변경)
bash examples/namu-archive-bulk/import-namu-archive.sh --go

# 3) 실패한 건만 재시도
bash examples/namu-archive-bulk/import-namu-archive.sh --resume
```

## 환경변수

| 변수 | 기본 | 설명 |
|---|---|---|
| `MXWP_TOKEN` | — | **필수** — API 토큰 (admin/editor 권한) |
| `MXWP_SERVER` | `http://127.0.0.1:8800` | API 주소 |
| `MXWP_OWNER` | `archive-importer@mx.local` | 적재 owner 이메일 |

`.env` 파일에 `MXWP_TOKEN=...` 두면 sh 가 자동 load.

## 안전 가드

- `MXWP_TOKEN` 없으면 실행 거부
- server reachable 확인 (curl healthz)
- `--go` 직전 `GO` 입력 prompt
- 같은 slug 이미 있으면 **skip** (bulk.yml 의 `on_conflict: skip`)
- 분당 5건 rate limit 자동 준수 (319 건 × 12s ≈ 64분)

## 작동 흐름

1. **데이터 매칭**: `examples/namu-archive-bulk/*.docx` 각각에 대해 같은 stem 의
   `*.json` 이 있으면 매핑. json 의 `slug`/`title`/`summary` 가 메타데이터로
   사용됨. json 없는 docx 는 `bulk.yml` 의 `defaults` 적용.
2. **dry-run**: 어떤 slug 가 어떤 division/team 으로 갈지 console 에 출력.
   server 호출 없음. log 는 `_logs/dry-run-*.log`.
3. **`--go`**: `mxwp-import` CLI 가 한 건씩 `/api/v1/imports/docx` → `/api/v1/documents`
   2 단계 호출. 분당 5건 rate limit 준수.
4. **실패 처리**: 실패한 건 `_logs/failed.txt` 에 모이고, `--resume` 으로 *그 건만* 재시도.

## bulk.yml 의 핵심 필드

```yaml
server: ${MXWP_SERVER}
token: ${MXWP_TOKEN}
source:
  path: ${BULK_SOURCE_DIR}   # sh 가 자동 채움
  pattern: "*.docx"
defaults:
  division: mx
  team: research
  confidentiality: internal
  owners: [${MXWP_OWNER}]
  tags: [namu-archive, imported-bulk]
on_conflict: skip
parallel: 1
delay_seconds: 12
stop_on_error: false
metadata_mapping:
  json_field_to_tag: [domain, entry_kind]
```

## json 필드 매핑 정책

- `slug` → 문서 slug (json 없으면 파일명 stem)
- `title` → 문서 title (json 없으면 docx 의 H1 또는 파일명)
- `summary` → 문서 summary
- `domain` → tag 로 추가 (`mobile`, `semiconductor` 등)
- `entry_kind` → tag 로 추가 (`family`, `model` 등)
- `body_md` / `structured_json` → **무시** (docx 본문이 우선, server 가 docx → DocumentJSON 변환)

## 로그

```
_logs/
  dry-run-YYYYMMDD-HHMMSS.log   # 각 dry-run 결과
  go-YYYYMMDD-HHMMSS.log         # 각 실제 실행 결과
  failed.txt                      # 누적 실패 목록 (resume 사용)
```

`_logs/` 는 `.gitignore` 됨.

## 트러블슈팅

| 증상 | 원인 | 대응 |
|---|---|---|
| `✗ MXWP_TOKEN 미설정` | env 또는 .env 에 token 없음 | `export MXWP_TOKEN=...` 또는 `.env` 추가 |
| `healthz 실패` | server 안 떠있음 | `bash infra/scripts/recover.sh` 또는 `boot.sh` |
| `mxwp-import 못 찾음` | lite 번들 또는 source 부재 | Github Release v1.0.4 lite 다운로드 또는 `dist/llm-docx-toolkit/` 확인 |
| `429 Too Many Requests` | rate limit 초과 | `bulk.yml` 의 `delay_seconds` 올리기 (기본 12s) |
| 일부 docx만 실패 | docx schema 위반 | `--resume` 로 재시도, 안 되면 schema fix 필요 |

## 관련 문서

- bulk-import 기능 자체: `docs/01-plan/features/bulk-import.plan.md`, `docs/02-design/...`, `docs/04-report/...`
- LLM 입력 룰 (docx 만드는 사람): `docs/llm-input-rules.md`
- mxwp-import CLI 전체 옵션: `dist/llm-docx-toolkit/imp/cli.py --help`
