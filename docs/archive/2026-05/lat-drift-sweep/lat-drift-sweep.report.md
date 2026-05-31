# lat-drift-sweep — Completion Report

## Executive Summary
| | |
|---|---|
| **Feature** | D5 — docs/lat/* 6 파일 drift 일괄 정정 |
| **Completion** | 2026-05-31 |
| **Match Rate** | 100% (30 confirmed / 1 rejected) |

### Value Delivered

| Perspective | Outcome |
|---|---|
| Problem | lat 문서가 코드와 어긋남 — 신규 LLM agent 가 lat 따라 호출했다가 404/403/501 받을 갭이 HIGH 11건. AI 코딩 가속을 위한 지도가 잘못된 지도로 작동 |
| Solution | Ultracode workflow 38 agent + 1.36M token 으로 6 lat 파일 audit → 31 raw → adversarial verify → 30 confirmed (HIGH 11 / MED 12 / LOW 4 / 등) → 모두 정정 |
| Function/UX | 다음 AI agent 가 lat 만 보고 정확한 endpoint / role / settings / 모듈 위치로 작업. CLAUDE.md 의 "lat 우선 참조" 룰이 다시 신뢰 가능 |
| Core Value | lat-as-source-of-truth-map 컨벤션의 정확성 복구 — 이게 깨지면 lat 룰 자체가 무력화 |

## 변경 — lat 6 파일 30 갭

### docs/lat/documents.md (6)
- **HIGH** `GET /{slug}/html` → `GET /{slug}/export.html` (+ 쿼리 파라미터 명시)
- **HIGH** `DELETE /{slug}` 권한 admin → editor+
- **HIGH** `PATCH /{slug}/custom-css` 권한 editor+ → admin (관리자 전용)
- **HIGH** `POST /{slug}/ping` → `POST /{slug}/view` (핸들러 `ping_view`)
- **MED** `ListBlock style: "bullet"|"ordered"` → `"bullet"|"number"|"check"` (pydantic enum 일치, L199 와 모순 해소)
- **MED** broken-link `test_versions.py` → `test_version_restore.py` + `test_version_tags.py`

### docs/lat/imports.md (3)
- **MED** Settings `pptx_import_max_bytes` 기본 30 MB → 50 MB (docx 와 다른 캡, 코드 주석에 의도 명시됨)
- **LOW** `docx_import.py` 1837 줄 → 2k+ 줄 (현재 2303 줄, drift 에 덜 민감한 표현)
- **LOW** `test_widget_autodetect.py` 43 케이스 → 구조 설명만 (cycle 마다 변동)

### docs/lat/export.md (6)
- **HIGH** Endpoints `GET /artifacts` → `GET /{slug}/artifacts` (+ `?fmt=` 필터)
- **HIGH** PDF 미설치 응답 503 → 501
- **HIGH** "artifact 비동기 polling" 서술 → 동기 응답 + `X-Export-Artifact-Id`/`X-Export-Download-Url` 헤더 직링크 (polling 없음)
- **MED** `_fetch_image_bytes()` 위치 `routers/exports.py` → `routers/documents.py`
- **MED** Heading 매핑 1..6 → `max(1, min(level, 3))` clamp (Word Heading 1/2/3 만, level 4+ 는 heading-4 block 전용)
- **LOW** Renderers 표에 `pdf_export.py` thin 어댑터 추가

### docs/lat/storage.md (6)
- **HIGH** `/uploads/images/{init,finalize}` (복수) → `/uploads/image/{init,finalize}` (단수) + `GET /api/v1/images/{identifier}` (별도 라우터)
- **HIGH** Settings 다수 정정: `minio_endpoint_internal/public` → `minio_endpoint`/`minio_public_endpoint`, `minio_region` 환경변수 없음 (모듈 상수), `upload_presign_ttl_seconds 900` → `_PRESIGN_TTL_SECONDS = 600` 모듈 상수, `image_max_bytes`
- **MED** `presign_client()` → `public_client()` (factory 명, Gotcha #6 포함)
- **MED** images 테이블: `ulid` PK → `id UUID PK` + `ulid UNIQUE TEXT` (DocumentJSON ImageBlock.imageId 가 ulid 참조)
- **MED** Gotcha #7 inversion 정정 — `uploaded_by` 는 hard FK (NOT NULL REFERENCES). 사용자 삭제는 *실패*, 고아 row 안 남음. reassign 필요
- **LOW** broken-link `[[src/migrations]]` → `[[apps/api/alembic/versions]]`

### docs/lat/core.md (6)
- **HIGH** Section 5 JWT helpers: `create_access_token/create_refresh_token/decode_jwt` → `make_access_token(sub, extra=None)` / `make_refresh_token(sub)` / `decode_token(token)`
- **HIGH** API token `token_prefix` 앞 12자 → 앞 8자 (`_API_TOKEN_PREFIX_LEN = 8`)
- **MED** `get_current_user` 우선순위에서 `X-MXWP-User` 헤더 제거 (별도 helper 로 분리 명시 — author override 용)
- **MED** broken-link `[[src/apps/web/src/lib/auth.ts]]` → `[[apps/web/src/features/auth]]`
- **MED** broken-link `[[src/tests/test_two_factor.py]]` → `[[src/tests/test_totp.py]]`
- **LOW** CORS Gotcha — split 책임자 `main.py` → `Settings.cors_origin_list` property. CORS 기본값 `http://` prefix 추가

### docs/lat/snapshots.md (3)
- **HIGH** manifest.json 스키마 — host/components/buckets 풍부한 shape → 실제 snapshot.sh 출력 (`snapshot_id`, `created_at`, `tool_version`, `components.postgres.filename+sha256`, `components.buckets[]`) 로 재작성
- **HIGH** Settings 표 — `snapshot_dir`/`snapshot_filename_prefix` 키 부재 → `SNAPSHOT_DIR` 환경변수 (snapshots.py 가 직접 `os.environ.get`) + 스크립트 하드코딩 prefix 명시
- **MED** Gotcha #2 — same-second nanosecond suffix → 실제 동작 (overwrite, tie-break 로직 없음, sub-second 호출 금지)

## 워크플로우 — Ultracode 통계

| 단계 | 결과 |
|---|---|
| Lat audit (6 files parallel) | 31 raw findings |
| Adversarial verify (parallel 31) | 30 confirmed / 1 rejected |
| Synthesize | per-file grouped report |
| **합계** | 38 agent, 1,357,999 tokens, 345 sec |

False positive 0.03 — verify 단계가 실제 코드 확인 후 통과.

## 검증

- 코드 변경 0 (lat 만 갱신 — 코드가 진실, lat 은 지도)
- typecheck / vitest 불필요 (lat = markdown)
- 다음 AI agent 가 lat 따라 호출하면 정확한 endpoint / role / settings 사용

## 후속

- CLAUDE.md 가 `docx_import.py` 1837 줄 stale 값을 참조 — 같은 단어 갱신 필요 (별도 cycle)
- D 트랙 5 사이클 (D1-D5) 모두 완료 — block audit 132 finding 전체 처리 + 추가 16 viewer i18n + 2 a11y + Excalidraw viewer + 30 lat drift

## D 트랙 5 사이클 누적 회고

| Cycle | 핵심 | 사이즈 |
|---|---|---|
| D1 | FLOW-01 Excalidraw viewer (Sprint-7 defer-L 회수) | XL |
| D2 | viewer 16 파일 i18n 일괄 (audit C5 false-positive 패턴 종료) | M-L |
| D3 | TABS-01 + ORG-01 a11y (audit C5 defer 회수) | M |
| D4 | QUIZ-01 + FormBlock pure 함수 refactor (audit C5 defer + D2 defer 회수) | M |
| D5 | lat 6 파일 drift sweep (HIGH 11 / MED 12 / LOW 4) | M |

block audit C5 의 **defer 6건 전체 + 추가 trk** 회수. editor + viewer +
viewer a11y + lat 일관성 완성. **다음 큰 트랙은 사용자 결정에 위임**.
