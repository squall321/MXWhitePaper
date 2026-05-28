# Plan — Doc Round-trip API + TOC Verify-and-Strip + Batch CLI

## Executive Summary

| 관점 | 내용 |
| --- | --- |
| Problem | 외부에서 작성된 Word 문서가 사내 표준 양식(섹션 자동 번호, 자동 목차, 자동 figure caption, 표준 스타일)과 어긋남. 사용자가 그걸 일일이 손으로 정리하기엔 양이 너무 많고, 기존 import→export 흐름은 한 건씩 DB 업로드를 거쳐야 함. |
| Solution | (1) **DB 영속 없이** docx → DocumentJSON → docx 변환을 한 번에 해주는 round-trip API, (2) 원본의 수동 목차를 검출해 "각 챕터가 본문에 있는지 확인 후 삭제" 처리, (3) 폴더 단위 다수 파일을 round-trip API 로 일괄 변환하는 venv CLI. |
| Function UX Effect | 사용자는 작업 폴더의 워드 파일들을 CLI 한 번에 표준 양식으로 변환받고, 거기에 워드에서 추가 수정한 뒤 평소처럼 FE 업로드로 진행. 손으로 양식 맞추는 단계가 사라짐. |
| Core Value | "양식 표준화" 비용 0 에 수렴 — 다수 외부 문서를 사내 양식으로 일괄 변환해 입수하는 운영 시나리오를 처음으로 지원. |

---

## 1. Goals

1. **Stateless round-trip API** — Word 파일을 받아 DB 업로드 없이 *변환된 Word 파일*만 응답으로 돌려준다.
2. **수동 TOC 검증·제거** — 원본에 손으로 만든 목차가 있으면 ① 거기 적힌 챕터 제목이 본문 헤딩에 실제로 존재하는지 점검 ② 결과를 warning 으로 남김 ③ 목차 자체는 결과 문서에서 제거. (FE/Export 가 자동 TOC 를 다시 그리므로 중복 방지.)
3. **batch CLI** — 호스트의 venv 에서 실행, 입력 폴더의 모든 `.docx` 를 round-trip API 에 던지고 결과를 출력 폴더에 저장. DB 와 무관.

## 2. Non-goals

- 변환된 문서를 DB 에 저장하는 것 (그건 기존 `/imports/docx` + `POST /documents` 흐름이 담당).
- pptx round-trip (현 사이클은 docx 만; pptx 는 같은 패턴으로 후속 추가 가능).
- PDF 출력 round-trip (스코프 밖).
- TOC 자동 생성 변경 (이미 FE 가 자동 TOC 를 그리고 있고, 이번 작업은 *원본의 수동 TOC* 만 다룬다).

## 3. 전체 그림

```text
  external/foo.docx                                    cleaned/foo.docx
        │                                                     ▲
        │ 1) CLI 가 한 번에 여러 파일을 던짐                       │ 3) 표준 양식 출력
        ▼                                                     │
   ┌────────────────────────────────────────────────────────────┐
   │   POST /api/v1/imports/docx/roundtrip                      │
   │                                                            │
   │   docx bytes                                               │
   │      └→ docx_import.docx_to_document(...)                  │
   │             ├ TOC 검출 & 챕터 매칭                           │
   │             └ TOC 블록/섹션 제거                              │
   │      └→ docx_export.render_docx(documentJSON)               │
   │      └→ return docx bytes + 요약 헤더                        │
   └────────────────────────────────────────────────────────────┘
```

**DB 미접근**. 인증은 기존 import 와 동일하게 editor+ 권한 + 5/min 레이트리밋.

## 4. API 설계

### 4.1 새 엔드포인트

> **구현 현황 (2026-05-15)**: 아래 form 필드 중 `drop_warnings` 는
> 구현하지 않았고 (요청 헤더 크기는 `[:7000]` cap 으로 처리), `Summary-Url`
> 캐시 엔드포인트와 `?include_summary=1` multipart/mixed 변형도 deferred.
> 대신 `aggressive_toc` 필드와 `X-MXWP-Roundtrip-Summary` 인라인 JSON 헤더,
> `Toc-Method` / `Toc-Heuristic` / `Toc-Extra` 헤더가 추가됐다. 실제 endpoint
> 사양은 `docs/lat/imports.md` 의 "Roundtrip" 섹션이 권위 있다.

```http
POST /api/v1/imports/docx/roundtrip
Content-Type: multipart/form-data
  file:           <docx, ≤ docx_import_max_bytes>
  strip_toc:      bool       (default: true)
  verify_toc:     bool       (default: true)
  drop_warnings:  bool       (default: false)   # deferred — 미구현
  aggressive_toc: bool       (default: false)   # 휴리스틱 D 활성화 (lat 참조)

Response:
  200 OK
  Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document
  Content-Disposition: attachment; filename="<basename>.normalized.docx"
  Body: <converted docx bytes>
  Headers:
    X-MXWP-Roundtrip-Sections:           <int>     # 변환 후 섹션 수
    X-MXWP-Roundtrip-Images:             <int>
    X-MXWP-Roundtrip-Tables:             <int>
    X-MXWP-Roundtrip-Toc-Found:          <true-or-false>
    X-MXWP-Roundtrip-Toc-Entries:        <int>     # TOC 에 적혀 있던 항목 수
    X-MXWP-Roundtrip-Toc-Missing:        <int>     # TOC 에는 있는데 본문 헤딩에 없는 수
    X-MXWP-Roundtrip-Toc-Extra:          <int>     # 본문에는 있는데 TOC 에 없는 수
    X-MXWP-Roundtrip-Toc-Method:         <string>  # 검출에 사용된 휴리스틱 라벨
    X-MXWP-Roundtrip-Toc-Heuristic:      <weak-or-strong>
    X-MXWP-Roundtrip-Warnings:           <int>
    X-MXWP-Roundtrip-Summary:            <json, [:7000] truncated>  # 인라인 JSON

# deferred: X-MXWP-Roundtrip-Summary-Url (캐시된 last-summary), ?include_summary=1
```

내부 흐름:

```python
def roundtrip(buf: bytes, slug: str, *, strip_toc: bool, verify_toc: bool):
    # 이미지를 *실제로* MinIO 에 올리지는 않는다 (DB 미접근 모드).
    # 대신 docx_import 의 placeholder 이미지 ULID 경로 + 본문 image bytes
    # 를 export 단계로 전달해 그대로 다시 박는다.
    documentjson, summary = docx_import.docx_to_document(
        buf, slug=slug, title="", owner_user_id="roundtrip",
        image_uploader=None,   # placeholder 모드
        roundtrip_mode=True,   # ←신규 플래그: 원본 이미지 bytes 도 함께 캡쳐
    )
    if verify_toc:
        toc_check = verify_toc_against_sections(documentjson, summary.toc)
        summary.warnings += toc_check.warnings
    if strip_toc:
        documentjson = strip_toc_sections(documentjson)
    out_bytes = docx_export.render_docx(documentjson, options=DocxOptions(
        image_resolver=summary.captured_image_resolver,   # 캡쳐된 bytes 직접 사용
    ))
    return out_bytes, summary
```

> `docx_import` 에 `roundtrip_mode` 분기를 새로 추가해 **drawing 별 (sha → bytes) 맵** 을 `summary` 에 같이 실어 준다. 이걸 export 의 `image_resolver` 가 메모리에서 바로 읽어 다시 박는다. MinIO 왕복 없음.

### 4.2 기존 엔드포인트와의 관계

- `POST /imports/docx` (기존): 그대로. DocumentJSON 만 반환.
- `POST /exports/docx/{slug}` (기존): 그대로. DB 의 문서를 렌더링.
- `POST /imports/docx/roundtrip` (신규): DB 미접근, 변환된 바이너리만 응답.

## 5. TOC 검출·검증·제거

### 5.1 TOC 검출 휴리스틱 (우선순위 순)

| 방법 | 시그널 | 비고 |
| --- | --- | --- |
| A. Word 정식 TOC | `<w:sdt>` 안의 `<w:docPartObj>` `gallery="Table of Contents"` | "참조 > 목차" 로 자동 삽입된 것 |
| B. TOC 스타일 단락 | `<w:pStyle w:val="TOC1/TOC2/.../목차1/목차2/...">` | Word 한국어 버전 포함 |
| C. TOC 필드 | `<w:fldChar>` + `<w:instrText>` 에 `^\s*TOC\s` | 구버전 Word |
| D. 휴리스틱 헤딩 | 헤딩 텍스트가 `^(목차/차례/Contents/Table of Contents)$` 매칭 + 직후에 점 leader (`........`) + 페이지 번호 패턴이 있는 짧은 단락이 ≥ 2 개 | 손으로 만든 목차 |

각 방법별로 **TOC 항목** = `[(title, page_hint), ...]` 을 수집. A/B/C 는 `<w:hyperlink anchor="_Toc...">` 의 텍스트에서 title 추출. D 는 leader/페이지번호 앞부분을 title 로.

### 5.2 검증 로직

```python
def verify_toc_against_sections(doc_json, toc_entries):
    flat_headings = collect_all_section_titles(doc_json)  # 모든 depth
    norm = lambda s: re.sub(r'\s+', '', s).lower()
    body = {norm(h) for h in flat_headings}
    missing = [e for e in toc_entries if norm(e.title) not in body]
    extra   = [h for h in flat_headings if norm(h) not in {norm(e.title) for e in toc_entries}]
    return TocCheck(
        toc_entries=len(toc_entries),
        body_headings=len(flat_headings),
        missing=missing,   # TOC 에는 있는데 본문에 없음 → 본문 누락 의심
        extra=extra,       # TOC 에 없는데 본문엔 있음 → TOC 가 오래된 것
    )
```

`missing` 은 warning 으로, `extra` 는 info 로 분류. 응답 헤더에는 카운트만, 자세한 내역은 `X-MXWP-Roundtrip-Summary` 인라인 JSON 헤더에 (`[:7000]` cap). `?include_summary=1` multipart/mixed 변형은 deferred.

### 5.3 제거 로직

검출된 TOC 영역을 import 단계에서 **블록으로 만들지 않고 스킵**. 검증을 먼저 끝낸 뒤 스킵하면 ① 본문 누락 검증이 가능하고 ② 결과 DocumentJSON 에는 TOC 가 없어 export 가 자동 TOC 만 그리게 됨. 이를 위해 `_build_sections` 의 본문 워크에서 TOC 컨텍스트 진입/종료 플래그를 들고 다닌다.

엣지: TOC 다음 챕터로 넘어가는 경계가 모호한 케이스 → 다음 Heading 1 또는 페이지 브레이크에서 TOC 종료. 보수적 휴리스틱이라 본문이 잘려나갈 위험이 있으니 "휴리스틱 D" 만 발견됐을 때는 응답 헤더에 `X-MXWP-Roundtrip-Toc-Heuristic: weak` 도 같이 내보내 사용자가 결과를 한 번 보고 판단하게 한다.

## 6. CLI (venv 진입점)

### 6.1 파일 구조

```text
apps/api/
  app/cli/
    __init__.py
    roundtrip.py          # 새로 추가
  pyproject.toml          # [project.scripts] 추가
```

### 6.2 pyproject.toml 추가

```toml
[project.scripts]
mxwp-roundtrip = "app.cli.roundtrip:main"
```

설치는 `pip install -e apps/api` (또는 `uv pip install -e .`). venv 한 번 만들고 그 안에서 `mxwp-roundtrip ...` 실행.

### 6.3 CLI 사용법

```bash
mxwp-roundtrip \
  --input  ./external-docs \
  --output ./normalized-docs \
  --base-url http://localhost:8800 \
  --token   $MXWP_TOKEN \
  --concurrency 4 \
  --report  ./normalized-docs/_report.json
```

| Flag | 의미 |
| --- | --- |
| `--input <dir>` | 입력 폴더. 재귀하지 않음 (서브폴더는 별도 호출). |
| `--output <dir>` | 출력 폴더. 같은 파일명 + `.normalized.docx` 접미 또는 `--inplace` 시 같은 이름 덮어쓰기. |
| `--base-url <url>` | API base URL. 기본 `http://localhost:8800`. |
| `--token <jwt>` | Bearer 토큰 또는 `MXWP_TOKEN` env. dev 모드에서는 없어도 됨. |
| `--concurrency N` | 동시 호출 수. 기본 4. 각 파일은 독립 워커. |
| `--strip-toc / --keep-toc` | API 파라미터 전달. |
| `--verify-toc / --no-verify-toc` | TOC 검증 on/off. |
| `--aggressive-toc` | TOC 휴리스틱 D 활성화 (기본 off). |
| `--skip-existing` | sidecar 가 있는 파일은 건너뜀 (증분 처리). |
| `--report <path>` | 집계 JSON (`_report.json`) 출력 위치. |
| `--dry-run` | 변환 안 하고 입력 목록만 출력. |
| `--continue-on-error` | 실패한 파일은 스킵하고 계속. 기본은 실패 즉시 종료. |

### 6.4 동작

```python
files = list_docx(input_dir)
with ThreadPoolExecutor(max_workers=concurrency) as pool:
    for path, result in zip(files, pool.map(roundtrip_one, files)):
        write_sidecar(path, result)            # foo.normalized.report.json
        if result.ok:
            write_docx(path, result.body)      # foo.normalized.docx
write_aggregate_report(report_path)             # _report.json
```

진행률은 `tqdm` (이미 indirect dep 후보) 또는 단순 printf. 단순함을 위해 우선 printf, 후속에서 `rich.progress` 검토.

### 6.5 의존성

- `httpx` 는 이미 api deps 에 있음 → 추가 설치 불필요
- `argparse` (stdlib)
- 새 deps 없음

### 6.6 에러 처리 / 출력 파일 분리

- 422 (validation) → 그 파일만 스킵, report 에 사유 기록
- 413 / 429 → 재시도 1회 (백오프 5s)
- 5xx → `--continue-on-error` 따름
- 변환 결과가 0 바이트 / Content-Type 이 docx 가 아닐 때 → 에러로 분류

## 7. 작업 순서

| # | 단계 | 산출물 | 의존 |
| --- | --- | --- | --- |
| 1 | `docx_import` 에 TOC 검출 + 검증 + 스트립 로직 | `app/services/docx_import.py` 수정, `app/services/toc_extract.py` 신규 | — |
| 2 | `docx_import` 의 `roundtrip_mode` (원본 image bytes 캡처) | `docx_import.py` 보강 | 1 |
| 3 | `docx_export` 에 in-memory `image_resolver` 어댑터 | `docx_export.py` 또는 `roundtrip` 헬퍼 | 2 |
| 4 | `POST /imports/docx/roundtrip` 라우터 + 서비스 | `app/routers/imports.py`, `app/services/docx_roundtrip.py` 신규 | 1–3 |
| 5 | 신규 엔드포인트용 BE 테스트 | `apps/api/tests/test_docx_roundtrip_api.py` | 4 |
| 6 | CLI 엔트리포인트 + pyproject scripts | `app/cli/roundtrip.py`, `pyproject.toml` | 4 |
| 7 | CLI 테스트 (subprocess + 작은 fixture) | `apps/api/tests/test_cli_roundtrip.py` | 6 |
| 8 | (옵션) FE 에 "단일 파일 round-trip" UI — admin 페이지에 업로드/다운로드 버튼 | `apps/web/src/pages/RoundtripPage.tsx` | 4 |

## 8. 위험 요소

- **TOC 휴리스틱 D 의 오탐**. "목차" 가 본문 챕터 제목인 케이스나 leader-dot 단락이 사실 본문인 케이스. → 휴리스틱 D 만 트리거된 경우 `X-MXWP-Roundtrip-Toc-Heuristic: weak` 헤더 + warning 으로 안전망. 정 위험하면 D 는 기본 off, opt-in flag (`--aggressive-toc`).
- **이미지 round-trip 일관성**. 이미지 bytes 를 그대로 다시 박을 때 docx 안의 EMU 사이즈/cropping 메타가 export 단계에서 재계산되어 픽셀 수치가 달라질 수 있음. 일단 픽셀 사이즈는 import 단계의 EMU→px 환산값을 보존, export 단계에서 동일한 값으로 다시 작성하도록 `width/height meta` 전파. 100% 픽셀 매치는 보장 안 함.
- **API 컨테이너 ↔ CLI 호스트 분리**. CLI 는 venv 에서 호스트 측 Python 으로 돌릴 수 있어야 함. API 컨테이너 의존성과 무관하게 `httpx + argparse` 만 쓰면 호스트 venv 에 별도 사이드 설치 없이도 동작 (이미 호스트 어딘가에 Python 있음 가정). 단, "venv 로 별도 실행" 이라는 요구를 그대로 충족하려면 *호스트* 에 mini venv 를 권장 — README 한 줄 추가.
- **레이트리밋**. 기본 5/min/user 라 CLI 에서 50 개 파일 한 번에 던지면 막힘. CLI 가 1 초 간격으로 직렬 처리 → 안 막히지만 느림. `import_rate_limit_per_minute` 를 일시 풀거나 CLI 용 별도 admin 토큰 + 더 큰 limit 권장. 이건 운영 결정이므로 plan 에 plug 만 노출.

## 9. 검증

- BE: round-trip API 가 (a) 깨끗한 docx 입력 → 동일 섹션 수/이미지 수 (b) TOC 가 있는 docx → strip 후 헤딩 누락 없이 출력 + warning 카운트 정확 (c) 잘못된 zip → 422 — 세 케이스 골든.
- CLI: 입력 폴더 3 개 파일 + 1 개 깨진 파일 → report.json 에 success/failed 정확 기재.
- 수동 QA: 사내 실제 워드 1 개로 end-to-end. 워드에서 열어 시각적 차이 점검.

## 10. 결정 사항 (확정)

1. **TOC 휴리스틱 D 기본값 = `off`.** opt-in 플래그 `--aggressive-toc` (API 측 `aggressive_toc=true`) 가 있을 때만 D 작동. A/B/C 는 항상 작동.
2. **CLI 동시성 기본 = 4**, 각 파일은 독립 워커로 처리 (공유 mutable state 없음, 한 파일 실패가 다른 파일 진행을 막지 않음). `--concurrency N` 으로 조정. 서버 rate-limit 은 운영 .env 의 `import_rate_limit_per_minute` 로 올리거나 admin 토큰 사용.
3. **Report 포맷 = sidecar + 통합 (둘 다).**
   - 각 변환된 `foo.normalized.docx` 옆에 `foo.normalized.report.json` (한 건 결과, source of truth)
   - 실패 케이스는 docx 없이 `foo.report.json` 만
   - 배치 끝에 sidecar 들을 모아 `_report.json` 1 장 추가 (집계본; 성공/실패/총 warning)
   - 같은 폴더 재실행 시 `--skip-existing` 으로 증분 처리 가능 (sidecar 있는 파일 스킵)
4. **TOC 의심 별도 보고서 출력 = 둠.** 휴리스틱 D 가 트리거됐고 `missing/extra` 가 있을 때 `foo.toc-report.json` 을 sidecar 와 별개로 추가로 떨어뜨림. 본 sidecar 에는 카운트만, 자세한 내역은 toc-report 에.

