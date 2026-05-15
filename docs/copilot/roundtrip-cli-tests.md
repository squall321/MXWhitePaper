# Task: Write tests for `mxwp-roundtrip` CLI

## 누구를 위한 문서

GitHub Copilot (또는 다른 보조 에이전트) 가 단독으로 실행할 수 있도록
작성한 작업 명세. 본 저장소의 다른 컨텍스트를 모르고 들어와도 이 문서만으로
Step-by-step 진행 가능해야 한다.

## 작업 한 줄

`apps/api/app/cli/roundtrip.py` 에 정의된 `mxwp-roundtrip` CLI 의
pytest 단위 테스트를 `apps/api/tests/test_cli_roundtrip.py` 로 추가한다.

---

## 배경 (10초 요약)

`mxwp-roundtrip` 는 폴더에 있는 여러 .docx 파일을 HTTP API
`POST /api/v1/imports/docx/roundtrip` 로 보내서, 사내 표준으로 정규화된
.docx 를 받아 출력 폴더에 떨궈주는 일괄 처리 CLI 다. DB 영구화는 안 한다.
이미 API 엔드포인트 테스트는 `apps/api/tests/test_imports_roundtrip.py`
로 있다. CLI 레이어 (argparse, ThreadPoolExecutor, 파일 입출력, 리포트
생성) 만 따로 단위 테스트하는 게 본 작업의 목표.

---

## 컨텍스트 파일 (반드시 먼저 읽기)

1. `apps/api/app/cli/roundtrip.py` — 테스트 대상 모듈. main(), run(),
   _process_file(), build_arg_parser(), AggregateReport, FileResult 등.
2. `apps/api/app/routers/imports.py` — `/imports/docx/roundtrip` 엔드포인트.
   응답 헤더 이름과 형식 참고.
3. `apps/api/tests/test_imports_roundtrip.py` — HTTP 레벨 테스트 패턴
   참고. `build_minimal_docx` 사용법, `ASGITransport` 활용법.
4. `apps/api/tests/conftest.py` — env 로드/엔진 리셋 방식.
5. `apps/api/app/services/docx_import.py` 의 `build_minimal_docx(...)` 함수
   — 픽스처 .docx 를 in-memory 로 만들 때 쓴다.

---

## 테스트 파일 위치 / 규약

- 경로: `apps/api/tests/test_cli_roundtrip.py`
- 스타일: 기존 테스트 (`test_imports.py`, `test_imports_roundtrip.py`) 와
  동일. `from __future__ import annotations`, docstring 한국어 OK,
  type hint 적용.
- pytest-asyncio mode 는 conftest 에서 `auto` 로 설정되어 있음.
- 동기 함수 위주의 CLI 이므로 일반 `def test_*()` 가 기본.

---

## 테스트 케이스 (필수)

각 케이스마다 docstring 한 줄로 의도를 명확히 적을 것.

### 1. `test_arg_parser_defaults`
- `build_arg_parser().parse_args([...minimal...])` 호출.
- 디폴트값 확인: `strip_toc=True`, `verify_toc=True`,
  `aggressive_toc=False`, `concurrency=4`, `timeout=120.0`,
  `dry_run=False`, `continue_on_error=False`.

### 2. `test_arg_parser_no_strip_toc_flag`
- `--no-strip-toc` 로 호출 → `strip_toc is False`.

### 3. `test_enumerate_inputs_recursive`
- tmp_path 안에 `a.docx`, `sub/b.docx`, `c.txt` 만든다 (가짜로 빈 파일이면 됨).
- `_enumerate_inputs(tmp_path)` 가 `[a.docx, sub/b.docx]` 만 리턴, 순서는
  정렬되어 있어야 함.
- `.normalized.docx` 가 포함된 파일은 제외돼야 함 (예: `x.normalized.docx`
  를 만들고 이게 결과에서 빠지는지 확인).

### 4. `test_dry_run_writes_no_output` (capsys)
- tmp_input 폴더에 `build_minimal_docx()` 로 만든 .docx 한 개 저장.
- `main(["--input", str(in), "--output", str(out), "--dry-run"])` 호출.
- exit code 0, `out/` 디렉토리에 `.docx` 출력 파일 없음, `_report.json`
  도 없음, stdout 에 `[dry-run]` 문자열 포함.

### 5. `test_process_file_success_writes_docx_and_sidecar` (monkeypatch)
- httpx 호출을 monkeypatch — `httpx.Client.post` 를 가짜 응답으로 교체.
- 가짜 응답: status=200, body=valid .docx 바이트 (간단히 `b"PKfake"`로 해도
  되지만 가능하면 `build_minimal_docx()` 결과를 그대로 사용),
  headers={X-MXWP-Roundtrip-Sections: "2", -Tables: "1", -Images: "0",
  -Toc-Found: "false", -Toc-Method: "", -Toc-Heuristic: "strong",
  -Toc-Entries: "0", -Toc-Missing: "0", -Toc-Extra: "0",
  -Warnings: "0", -Summary: '{"warnings":[]}'}.
- `main(...)` 실행 후:
  - `out/<name>.normalized.docx` 파일 존재 & body 와 동일
  - `out/<name>.normalized.report.json` 사이드카 존재 & 파싱되면
    `ok=true, sections=2, tables=1`.
  - `out/_report.json` 집계 리포트 존재 & `succeeded=1, failed=0`.
- exit code 0.

### 6. `test_process_file_http_error_writes_error_sidecar` (monkeypatch)
- 가짜 응답: status=422, body=`b'{"error":{"message":"validation failed"}}'`.
- `main(["--continue-on-error", ...])` 호출.
- 결과:
  - `.normalized.docx` 출력 **없음**
  - `.report.json` 사이드카 존재 & `ok=false, error="validation failed"`
  - exit code 2 (`failed > 0`).

### 7. `test_skip_existing_skips_when_output_exists`
- 출력 폴더에 미리 `<name>.normalized.docx` 빈 파일을 둠.
- `main([..., "--skip-existing"])` 호출. httpx 는 절대 호출되어선 안 됨
  (`monkeypatch` 한 mock 의 call_count == 0 으로 검증).
- exit code 0, `skipped=1` 이 `_report.json` 에 반영.

### 8. `test_aggregate_report_structure`
- 위 success 케이스를 활용하거나 별도 단순 케이스로:
  `_report.json` 의 키들 확인 — `started_at`, `ended_at`, `total`,
  `succeeded`, `failed`, `skipped`, `concurrency`, `base_url`,
  `options`, `files`. 그리고 `files[0]` 안에 `source`, `output`,
  `ok`, `sections`, `images`, `tables`, `elapsed_seconds` 가 있어야 함.

### 9. `test_aborts_on_first_failure_without_continue_flag` (monkeypatch)
- 파일 2 개를 만들고 첫 호출은 200, 두 번째 호출은 500 으로 응답하도록
  monkeypatch — 또는 단순화: 항상 500 응답으로 가설하고 2 개 파일을 넣어도
  `--continue-on-error` 가 없으면 `failed >= 1, succeeded == 0` 으로 빠르게
  종료한다는 점만 검증.
- exit code 2.

### 10. `test_toc_suspicious_writes_toc_sidecar` (monkeypatch)
- 가짜 응답 헤더에 `X-MXWP-Roundtrip-Toc-Found: true`,
  `X-MXWP-Roundtrip-Toc-Heuristic: weak`,
  `X-MXWP-Roundtrip-Summary: '{"toc_missing":["Chapter X"]}'`.
- 정상 200 응답이지만 TOC 가 의심스러우므로
  `<name>.toc-report.json` 사이드카가 **추가로** 생성돼야 함.

---

## 모킹 전략

httpx 를 그대로 외부 호출하지 말고, monkeypatch 로 `httpx.Client.post`
를 교체한다. 예시 형태:

```python
def _make_fake_post(status: int, body: bytes, headers: dict[str, str]):
    class _Resp:
        def __init__(self) -> None:
            self.status_code = status
            self.content = body
            self.headers = headers
    def _post(self, url, *, files=None, data=None, timeout=None):
        return _Resp()
    return _post

def test_xxx(monkeypatch, tmp_path):
    import httpx
    monkeypatch.setattr(
        httpx.Client, "post",
        _make_fake_post(200, my_body, my_headers),
    )
    ...
```

여러 호출에 다른 응답을 주려면 `_post` 안에서 카운터를 들고 분기.

---

## 실행 방법 (검증용)

테스트는 `mxwp_api` apptainer 인스턴스 안에서 돈다:

```bash
apptainer exec instance://mxwp_api bash -lc \
  'cd /workspace/apps/api && python -m pytest tests/test_cli_roundtrip.py -x -q'
```

전체 통과 + 기존 테스트도 통과해야 한다:

```bash
apptainer exec instance://mxwp_api bash -lc \
  'cd /workspace/apps/api && python -m pytest tests/ -q 2>&1 | tail -20'
```

---

## 작성 시 주의사항

1. **새 의존성 금지** — pytest, monkeypatch, tmp_path 만 사용. respx /
   pytest-httpx 같은 외부 패키지 추가 금지.
2. **실제 네트워크 호출 금지** — 모든 httpx 호출은 모킹.
3. **CLI 의 print 출력은 capsys 로만 검증** — stdout 의존성 최소화.
4. **time.sleep / 실제 동시성 검증은 빼라** — `concurrency=1` 또는
   `concurrency=2` 로 충분. ThreadPoolExecutor 내부 동작 검증 X.
5. **임시 디렉토리는 pytest 의 `tmp_path` fixture 만 사용** — `/tmp` 직접
   접근 금지.
6. **에러 케이스에서도 `_report.json` 은 생성된다** — exit code 가 2 더라도
   파일은 있어야 함. (`run()` 내부 흐름 확인하면 보임.)

---

## Done 기준

- `apps/api/tests/test_cli_roundtrip.py` 가 새로 추가됨.
- 위 10 케이스 모두 작성/통과.
- 기존 테스트 어느 것도 깨지지 않음.
- `ruff check apps/api/tests/test_cli_roundtrip.py` 클린.

---

## 변경 영향 범위

- 추가: `apps/api/tests/test_cli_roundtrip.py` (신규)
- 수정: 없음. 단, CLI 코드 자체에 테스트 작성하다 보면 발견되는
  버그가 있을 수 있다 — 그 경우 `app/cli/roundtrip.py` 만 손볼 것.
  (라우터 / 서비스 / docx_import 등은 손대지 말 것.)
