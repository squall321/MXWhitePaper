---
template: design
version: 1.0
feature: bulk-import
date: 2026-05-18
project: MX White Paper
---

# Bulk Import CLI — Design Document

> **Planning Doc**: [bulk-import.plan.md](../../01-plan/features/bulk-import.plan.md)
> **Status**: Draft

---

## 1. 파일 구조

```
dist/llm-docx-toolkit/imp/
├── __init__.py
├── __main__.py            # `python -m imp` 엔트리
├── cli.py                 # argparse + main()
├── config.py              # YAML 옵션 파일 + env + CLI 머지
├── scanner.py             # 폴더 스캔 → 처리 대상 페어링
├── client.py              # /imports/docx + /documents API 클라이언트
├── uploader.py            # 한 건 처리 (validate + import + persist)
├── rate.py                # 분당 N 건 token-bucket 류 제한
├── log.py                 # 사람-읽는 stdout + jsonl 로그
└── tests/
    ├── conftest.py
    ├── test_config.py
    ├── test_scanner.py
    ├── test_uploader.py   # 모의 서버
    └── test_cli.py
```

## 2. Public API

### 2.1 entry point — `cli.main()`

```python
def main(argv: list[str] | None = None) -> int:
    """Exit code 0 = 모든 건 성공 or skip, 1 = 일부 실패, 2 = 사용법 오류."""
```

### 2.2 핵심 함수 시그니처

```python
# config.py
@dataclass(frozen=True)
class Defaults:
    division: str
    team: str
    part: str | None
    confidentiality: Literal['public', 'internal', 'confidential']
    owners: list[str]
    tags: list[str]

@dataclass(frozen=True)
class Config:
    server: str
    token: str  # NEVER log / repr  → __repr__ overrides to mask
    source_path: Path
    pattern: str
    exclude_patterns: list[str]
    defaults: Defaults
    domain_to_part: dict[str, str]
    mode: Literal['docx-primary', 'docx-only']
    on_conflict: Literal['skip', 'overwrite', 'version']
    stop_on_error: bool
    parallel: int
    delay_seconds: float
    dry_run: bool
    limit: int

def load_config(
    yaml_path: Path | None,
    cli_overrides: dict[str, Any],
    env: Mapping[str, str],
) -> Config: ...

# scanner.py
@dataclass(frozen=True)
class WorkItem:
    docx: Path
    json: Path | None
    slug: str
    title: str

def scan(cfg: Config) -> Iterator[WorkItem]: ...
def _slugify(name: str) -> str: ...  # imports.py 와 같은 규칙

# client.py
class MXWPClient:
    def __init__(self, server: str, token: str, session: httpx.Client | None = None): ...
    def import_docx(self, file: Path, slug: str, title: str) -> dict[str, Any]: ...
    def create_document(self, doc: dict[str, Any]) -> dict[str, Any]: ...
    def get_document(self, slug: str) -> dict[str, Any] | None: ...
    def update_document(self, slug: str, doc: dict[str, Any], etag: str) -> dict[str, Any]: ...

# uploader.py
@dataclass(frozen=True)
class Outcome:
    item: WorkItem
    status: Literal['success', 'skip', 'fail']
    reason: str  # 사용자 메시지
    server_id: str | None = None
    duration_ms: int = 0

def process_one(
    item: WorkItem,
    cfg: Config,
    client: MXWPClient,
) -> Outcome: ...

def process_all(cfg: Config) -> list[Outcome]: ...

# rate.py
class RateLimiter:
    """분당 N 건. parallel=1 이면 단순 sleep. 향후 parallel>1 위해 추상화."""
    def __init__(self, per_minute: int, parallel: int): ...
    def acquire(self) -> None: ...  # blocks until slot is free
```

## 3. YAML 옵션 파일 정밀 스키마

```yaml
# Required
server: <str>                # 예: https://mxwhitepaper.x
token: <str>                 # `${MXWP_TOKEN}` 형태 env 참조 지원

source:
  path: <str>                # 절대 경로 권장
  pattern: <str>             # default "*.docx"
  exclude_patterns: <list[str]>  # default []

# Required: 문서 메타 기본값
defaults:
  division: <slug>
  team: <slug>
  part: <slug|null>
  confidentiality: public|internal|confidential
  owners: <list[str]>        # min 1
  tags: <list[str]>          # default []

# Optional
domain_to_part: <dict[str, str]>  # json.domain → part slug

mode: docx-primary           # default
on_conflict: skip            # default
stop_on_error: false         # default
parallel: 1                  # default (v1 은 1만 검증, >1 은 미래)
delay_seconds: 12.0          # default — 분당 5건 기준 안전 마진
dry_run: false               # default
limit: 0                     # default 0 = 전체
```

검증 룰:
- `server` 가 `http://localhost` 아닌 한 https 권장 (경고)
- `token` 이 평문이면 시작 시 stderr 경고
- `defaults.owners` 비어 있으면 에러 (스키마 필수)
- `delay_seconds < 12` 면 경고 (서버 rate-limit 초과 위험)

## 4. 처리 흐름 상세

```
load_config()
  ├─ YAML 읽기
  ├─ env 머지 (${VAR} 치환)
  ├─ CLI 인자 머지 (CLI > env > config)
  └─ 검증

scan(cfg) → [WorkItem...]
  ├─ source.path 스캔 (glob `pattern`)
  ├─ exclude_patterns 필터
  ├─ 같은 stem 의 json 페어링
  ├─ json.slug 또는 _slugify(stem) → WorkItem.slug
  └─ limit 적용

for item in scan(cfg):           # 순차 (parallel=1)
    outcome = process_one(...)
    log + collect

    if outcome.status == 'fail':
        if cfg.stop_on_error: break

    rate_limiter.acquire()       # 다음 호출 전 대기

write log, failed.txt, summary
return exit_code
```

### 4.1 process_one() 상세

```python
def process_one(item, cfg, client) -> Outcome:
    t0 = time.monotonic()

    # 1. 사전 검증 (mxwp-validator 라이브러리)
    valid, errors = validate_docx_bytes(item.docx.read_bytes())
    if not valid:
        return Outcome('fail', f'schema invalid: {errors[0]}', ...)

    # 2. on_conflict pre-check
    if cfg.on_conflict == 'skip':
        if client.get_document(item.slug) is not None:
            return Outcome('skip', 'slug already exists', ...)

    # 3. dry-run 분기
    if cfg.dry_run:
        return Outcome('success', 'dry-run: would import', ...)

    # 4. /imports/docx 호출 → DocumentJSON 반환
    resp = client.import_docx(item.docx, slug=item.slug, title=item.title)
    doc = resp['document']

    # 5. defaults + json 메타로 metadata 보강
    enrich_metadata(doc, item, cfg)

    # 6. /documents 호출 (on_conflict 분기)
    if cfg.on_conflict == 'overwrite' and (existing := client.get_document(item.slug)):
        created = client.update_document(item.slug, doc, etag=existing['etag'])
    elif cfg.on_conflict == 'version':
        # 서버가 같은 slug 면 새 version 생성 (PUT /versions 와 비슷한 경로)
        # v1 은 overwrite 와 동일 처리, 서버 동작 확인 후 분기 추가
        created = client.create_document(doc)
    else:
        created = client.create_document(doc)  # skip 이지만 위 pre-check 통과한 경우

    return Outcome('success', '', server_id=created['id'], ...)
```

### 4.2 enrich_metadata()

```python
def enrich_metadata(doc: dict, item: WorkItem, cfg: Config) -> None:
    meta = doc.setdefault('metadata', {})

    # 기본값 (json/docx 가 안 채운 것만)
    meta.setdefault('division', cfg.defaults.division)
    meta.setdefault('team', cfg.defaults.team)
    meta.setdefault('confidentiality', cfg.defaults.confidentiality)
    meta.setdefault('owners', cfg.defaults.owners)

    # part: json.domain → mapping → fallback default
    if item.json:
        with item.json.open() as f:
            j = json.load(f)
        domain = j.get('domain')
        if domain:
            meta['part'] = cfg.domain_to_part.get(domain, cfg.defaults.part)
            # tags = defaults + [domain]
            tags = list(cfg.defaults.tags)
            if domain not in tags:
                tags.append(domain)
            meta['tags'] = tags
        else:
            meta.setdefault('part', cfg.defaults.part)
            meta['tags'] = cfg.defaults.tags
    else:
        meta.setdefault('part', cfg.defaults.part)
        meta['tags'] = cfg.defaults.tags

    # 추적 정보 — audit_log 의 payload 에 들어가도록
    # (서버가 이 필드를 그대로 audit 에 저장하지 않을 수 있음 — 별도 헤더로 보내는 게 안전)
    # 본 사이클은 metadata.tags 에 'source:namu-archive' 같은 마킹만
```

## 5. 로그 포맷

### 5.1 stdout (사람 친화)

```
[mxwp-import] config: bulk.yml
[mxwp-import] source: /data/Namu_Archive/out/upload (320 docx)
[mxwp-import] mode: docx-primary, on_conflict: skip, dry_run: false
[mxwp-import] starting...

[001/320] ✓ android-os-10           (1.2s) id=01K...
[002/320] ✓ samsung-exynos-10-series (1.1s) id=01K...
[003/320] - 10gigabit-ethernet      (skip — slug already exists)
[004/320] ✗ corrupted-file           (fail — schema invalid: missing 'variant')
...
[mxwp-import] done: 280 success / 35 skip / 5 fail
[mxwp-import] details: mxwp-import.log
[mxwp-import] failed list: mxwp-import.failed.txt
```

### 5.2 mxwp-import.log (JSONL)

```jsonl
{"ts": "2026-05-18T...", "level": "info", "event": "start", "config": {...}}
{"ts": "...", "level": "info", "event": "process", "idx": 1, "slug": "android-os-10", "status": "success", "duration_ms": 1234, "server_id": "01K..."}
{"ts": "...", "level": "warn",  "event": "process", "idx": 4, "slug": "corrupted-file", "status": "fail", "reason": "schema invalid: ..."}
{"ts": "...", "level": "info", "event": "done", "success": 280, "skip": 35, "fail": 5}
```

### 5.3 mxwp-import.failed.txt

```
/data/Namu_Archive/out/upload/corrupted-file.docx
/data/Namu_Archive/out/upload/another-bad.docx
```

`--resume` 시 이 파일을 새 source 로 처리.

## 6. 테스트 매트릭스

| 파일 | 케이스 |
|---|---|
| `test_config.py` | (a) YAML 읽기 (b) env 치환 `${VAR}` (c) CLI override (d) token mask in repr (e) 필수 필드 누락 → 에러 |
| `test_scanner.py` | (a) docx 만 (b) docx+json 페어 (c) json 만 (skip) (d) exclude_patterns (e) limit 적용 (f) `_slugify` 한글 |
| `test_uploader.py` | (a) success (mock client) (b) skip on conflict (c) fail on validator (d) dry-run (e) enrich metadata from json domain |
| `test_cli.py` | (a) --dry-run 출력 (b) --resume 동작 (c) exit code matrix (d) --limit (e) token 비노출 검증 |

총 ~20 케이스. mock client 는 httpx 의 `MockTransport` 사용.

## 7. 에러 매트릭스

| 단계 | 에러 | 처리 |
|---|---|---|
| config | YAML 파싱 실패 | exit 2 + 에러 메시지 |
| config | 필수 필드 누락 | exit 2 |
| config | env `${VAR}` 미정의 | exit 2 + var 이름 |
| scan | source.path 없음 | exit 2 |
| scan | 0건 매치 | exit 0 + 경고 |
| process | docx schema 위반 | Outcome.fail, 다음 진행 |
| process | network/timeout | Outcome.fail, retry 1회 |
| process | 401/403 | Outcome.fail (전부) — token 문제 |
| process | 409 conflict (on_conflict=skip 인데 race) | skip |
| process | 413 size | fail + 명확 메시지 |
| process | 429 rate-limited | rate_limiter delay 강화 + 재시도 |
| done | 일부 실패 | exit 1 |

## 8. 빌드 통합

`build.py` 에 새 함수 `_build_import()`. spec template 은 `_RULES_SPEC` 패턴 따라.

```python
def _build_import(work_dir, bin_dir, onefile, variant) -> Path:
    """import 는 RAG / torch 안 씀 — variant 무관 항상 lite (~30 MB)."""
    launcher = _stage_import_entry(work_dir)
    # spec: pathex=[stage], hiddenimports=['imp.cli', 'httpx', 'yaml']
    # excludes=['torch', 'sentence_transformers', 'openai']  # 무조건 제외
```

main()의 `--target` 에 `import` 추가, `--target all` 에 자동 포함.

CI workflow 변경: smoke test 1개 추가 (`mxwp-import --version`).

## 9. 동작 결정 — 모호 처리

### 9.1 server 가 `division.slug` / `team.slug` 검증을 어떻게?
- v1: 서버가 모름 → 그냥 metadata 에 텍스트로. 사이트 UI 에서 사후 매핑
- v2: `/divisions` GET 으로 사전 검증

→ **v1 채택**

### 9.2 etag 처리 (on_conflict=overwrite)
- 서버의 `/documents/{slug}` GET 응답에 `ETag` 헤더 또는 body 의 `version` 필드
- 둘 다 client 측에서 추출 시도, 없으면 force update (`If-Match: *` 또는 헤더 생략)

### 9.3 server URL 끝 슬래시
- `server.rstrip("/")` 통일

### 9.4 large file
- 30 MB 한계 (서버 측). 미리 체크하고 fail 표시 (POST 안 함)

## 10. 보안

| 항목 | 처리 |
|---|---|
| token | `Config.__repr__` 에서 마스킹 (`token=mxwp_****`). log 출력 시도 시 동일 |
| `${VAR}` 치환 | 환경에 없으면 *명시적 에러* (silent empty 금지) |
| https | 기본 권장, http 시 startup 경고 |
| 파일명 한글 | `pathlib.Path` 그대로 처리 (Python 3.12 UTF-8) |
| Windows 콘솔 | cp1252 회피 위해 stdout UTF-8 강제 (기존 validate.py 패턴) |

## 11. 산출물

| 파일 | 라인 (예상) |
|---|---|
| `imp/cli.py` | ~200 |
| `imp/config.py` | ~150 |
| `imp/scanner.py` | ~100 |
| `imp/client.py` | ~180 |
| `imp/uploader.py` | ~150 |
| `imp/rate.py` | ~50 |
| `imp/log.py` | ~80 |
| `tests/*.py` | ~400 |
| `build.py` 확장 | +30 |
| `docs/lat/imports.md` | +10 |
| `HANDOFF.md` §11 | +30 |
| deck 슬라이드 1 | +100 (HTML) |

총 ~1500 LOC 신규.

## 12. 의존성

신규 Python:
- `httpx` (또는 stdlib `urllib.request` — 더 가벼움. v1 은 `urllib` 채택 가능)
- `PyYAML` — config 파일 파싱

→ **`PyYAML` 만 추가** (`httpx` 대신 `urllib.request` 사용해 lite 유지)

## 13. Acceptance — design 단계 완료 조건

1. ✅ 본 design 문서 작성
2. ✅ Plan 의 12 결정사항 모두 코드 레벨로 풀어냄
3. ✅ 파일 구조 + 함수 시그니처 + 테스트 매트릭스 명시
4. ✅ 에러 매트릭스 (13 종)
5. ✅ 보안 항목 명시
