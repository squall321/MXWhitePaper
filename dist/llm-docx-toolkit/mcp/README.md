# MCP Server — `mxwp-mcp`

LLM (Claude Desktop, Claude Code 등) 이 MXWhitePaper 를 직접 다루게 해주는
stdio MCP 서버. 두 가지를 한다:

1. **RAG 검색** — block JSON 작성 룰을 로컬 인덱스에서 질의 (오프라인 동작)
2. **문서 읽기/쓰기** — 위키 REST API 를 대신 호출해 문서를 읽고, 블록을
   삽입/수정/삭제 (ETag 잠금 + 로컬 스키마 선검증 자동 처리)

읽기/쓰기 도구는 `MXWP_API_URL` 로 API 서버에 접근하고, **쓰기 도구는
`MXWP_API_TOKEN` (write scope) 이 반드시 필요**하다 — 발급법은 아래
[API 토큰 발급](#api-토큰-발급) 참고.

## 도구

### RAG (오프라인 — API 서버 불필요)

| 이름 | 설명 |
|---|---|
| `query_rules(query, k=5, backend="st")` | block 작성 룰 top-k chunks 검색 |
| `read_chunk(chunk_id)` | 단일 chunk 의 원문 + metadata |
| `mxwp_system_prompt()` | `llm-system-prompt.md` 전체 (prompt primitive) |

### 문서 읽기 (`MXWP_API_URL` 필요, 토큰은 선택)

| 이름 | 반환 |
|---|---|
| `list_documents(q="", limit=20)` | `[{slug, title, part, updated_at}]` |
| `get_document_outline(slug)` | `{title, etag, sections:[{id, number, title, blocks:[{id, type, hint}]}]}` — block 별 한 줄 hint 만 담은 구조 지도 (토큰 절약) |
| `get_section(slug, section_id)` | 섹션의 블록 전체 JSON |
| `get_block(slug, block_id)` | 블록 한 개의 전체 JSON |

### 문서 쓰기 (`MXWP_API_TOKEN` — write scope — 필수)

| 이름 | 반환 |
|---|---|
| `create_document(title, slug?, part_slug?, summary?)` | `{slug, url}` |
| `insert_block(slug, section_id, block, after_block_id?)` | `{block_id}` |
| `update_block(slug, block_id, block)` | `{ok, version}` |
| `delete_block(slug, block_id)` | `{ok}` |
| `move_block(slug, block_id, target_section_id, after_block_id?)` | `{ok}` |
| `validate_block(block)` | `{valid, errors:[{path, message}]}` — 로컬 jsonschema 만, API 호출 없음 |

block JSON 을 어떻게 짜야 하는지는 외우지 말고 `query_rules` 로 검색하거나
`mxwp_system_prompt` 를 읽는다 (예: `query_rules("callout 블록 형식")`).

### 쓰기 도구의 자동 처리 3가지

| 처리 | 내용 |
|---|---|
| 로컬 선검증 | `insert_block`/`update_block` 은 전송 전에 block 을 `packages/shared/schemas/document.json` 의 해당 Block 정의로 검증. 실패하면 **API 호출 없이** path 별 에러를 반환 — 블록을 고쳐 다시 호출하면 된다 |
| ETag 잠금 | 도구가 내부에서 문서의 ETag (`W/"<doc_id>-<version>"`) 를 받아 `If-Match` 헤더로 전송. 충돌 (409/412) 시 "문서가 그 사이 변경됨 — outline 다시 읽고 재시도" 에러 |
| 에러 변환 | API 의 에러 envelope (`{"error": {code, message}}`) 를 사람이 읽을 메시지로 변환 |

## 설정

환경변수 두 개 (쓰기 도구를 쓸 때만 토큰 필요):

| env | 기본 | 설명 |
|---|---|---|
| `MXWP_API_URL` | `http://127.0.0.1:8800` | 위키 API 서버 주소 (**origin 까지만 — `/api/v1` 은 붙이지 않는다**. 클라이언트가 경로를 추가함) |
| `MXWP_API_TOKEN` | (없음) | `Authorization: Bearer` 로 전송되는 개인 API 토큰. **write scope** 필요 |

`MXWP_API_URL` 은 배포 환경에 따라 다르다 — **`/api/v1` 없이** origin (+ 서브경로) 까지만:

| 환경 | `MXWP_API_URL` |
|---|---|
| 로컬 dev | `http://127.0.0.1:8800` |
| HWAX 포탈 (서브경로) | `https://hwax.sec.samsung.net/mx-white-paper` |
| 단독 배포 (루트) | `https://<host>` |

> **가장 쉬운 방법**: 위키 웹에서 **write scope 토큰을 발급하면**, 발급 직후 모달의
> "Claude Desktop / Code 에 바로 등록하기" 를 열어 **이 배포에 맞는 `MXWP_API_URL` 과
> 토큰이 채워진 config 블록을 통째로 복사**할 수 있다. `command` 경로만 내려받은
> 바이너리 위치로 바꾸면 끝. ([API 토큰 발급](#api-토큰-발급) 참고.)

### Claude Desktop

config 파일 위치:

| OS | 경로 |
|---|---|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |

```json
{
  "mcpServers": {
    "mxwp-rag": {
      "command": "/absolute/path/to/llm-docx-toolkit/bin/mxwp-mcp-linux",
      "args": [
        "--rag-dir", "/absolute/path/to/llm-docx-toolkit/rag",
        "--system-prompt", "/absolute/path/to/llm-docx-toolkit/llm-system-prompt.md"
      ],
      "env": {
        "MXWP_API_URL": "http://127.0.0.1:8800",
        "MXWP_API_TOKEN": "mxwp_PASTE_YOUR_TOKEN_HERE"
      }
    }
  }
}
```

- 경로는 전부 **절대경로**. Windows 는 `command` 가 `...\bin\mxwp-mcp-win32.exe`
  이고 경로 구분자가 백슬래시 (JSON 안에서는 `\\` 로 이스케이프).
- JSON 은 주석이 안 되므로 `MXWP_API_TOKEN` 값에 발급받은 토큰을 그대로
  붙여넣는다. 읽기/RAG 만 쓸 거면 `MXWP_API_TOKEN` 줄은 지워도 된다.
- 수정 후 Claude Desktop 재시작.

`example-claude-desktop.json` 참고.

### Claude Code

한 줄 등록:

```bash
claude mcp add mxwp-rag \
  --env MXWP_API_URL=http://127.0.0.1:8800 \
  --env MXWP_API_TOKEN=mxwp_PASTE_YOUR_TOKEN_HERE \
  -- /absolute/path/to/llm-docx-toolkit/bin/mxwp-mcp-linux \
     --rag-dir /absolute/path/to/llm-docx-toolkit/rag \
     --system-prompt /absolute/path/to/llm-docx-toolkit/llm-system-prompt.md
```

또는 프로젝트 루트의 `.mcp.json` (팀 공유용 — 단, **토큰은 커밋하지 말 것**.
`.mcp.json` 에는 URL 만 넣고 토큰은 `claude mcp add --env` 나 셸 env 로):

```json
{
  "mcpServers": {
    "mxwp-rag": {
      "type": "stdio",
      "command": "/absolute/path/to/llm-docx-toolkit/bin/mxwp-mcp-linux",
      "args": ["--rag-dir", "/absolute/path/to/llm-docx-toolkit/rag"]
    }
  }
}
```

`example-claude-code.json` 참고.

## API 토큰 발급

쓰기 도구를 쓰려면 위키 UI 에서 본인 토큰을 발급한다:

1. 위키에 로그인 → **우상단 프로필 아이콘** 클릭 → 메뉴에서 **🔑 개인 API
   토큰** 선택 (`/me/api-tokens`)
2. **+ 새 토큰** 버튼 → "새 API 토큰" 모달에서:
   - **이름**: 용도를 알 수 있게 (예: `claude-desktop`)
   - **권한 (scope)**: **쓰기** 선택 — "쓰기 (write) — read + POST/PUT/PATCH/DELETE
     on non-admin endpoints". 읽기 도구만 쓸 거면 **읽기** 로 충분
   - **만료**: 1개월 / 3개월 / 1년 / 무기한 중 선택
3. **발급** → "새 토큰을 안전하게 보관하세요" 모달에서 토큰 복사.
   **이 한 번만 표시되고 다시 볼 수 없다** — 바로 config 의
   `MXWP_API_TOKEN` 에 붙여넣을 것.

## 안전 수칙

- **토큰은 개인별 발급** — 비밀번호처럼 다루고, 팀원과 공유하거나 git 에
  커밋하지 않는다. 노출되었으면 토큰 목록에서 **회전** (기존 즉시 무효화 +
  새 토큰 발급) 또는 폐기.
- **토큰 없이 쓰기 시도** → 도구가 API 를 호출하지 않고 발급 안내 에러를
  반환한다 (위 발급 절차대로 만들어 env 에 넣으면 됨).
- **ETag 충돌** ("문서가 그 사이 변경됨") → 다른 사람/탭이 먼저 수정한 것.
  `get_document_outline` 으로 최신 구조를 다시 읽고 재시도하면 된다 —
  덮어쓰기 사고는 구조적으로 안 난다.
- **검증 실패 루프** — `insert_block`/`update_block` 이 스키마 에러를
  돌려주면 그 블록은 서버에 전혀 전송되지 않은 상태다. 에러의 `path` 를
  보고 블록을 고쳐 다시 호출한다. 미리 `validate_block` 으로 점검해도 좋다.
- 생성/수정 결과는 사람이 위키 화면에서 최종 검토한다.

## 사용 예시

**1) "X 문서 2장에 callout 추가해줘"**

```text
list_documents(q="X")                 → slug 확인
get_document_outline(slug)            → 2장 section_id + 끝 block_id 파악
query_rules("callout 블록 형식")       → block JSON 작성법 확인
insert_block(slug, section_id, {callout block}, after_block_id=...)
```

**2) "Y 문서의 분기 매출 차트 데이터 갱신해줘"**

```text
get_document_outline(slug)            → hint 로 chart 블록 id 찾기
get_block(slug, block_id)             → 현재 chart JSON 확보
update_block(slug, block_id, {갱신된 chart})   ← ETag 자동
```

**3) "신규 기능 백서 초안 만들어줘"**

```text
create_document(title="...", part_slug="...")   → {slug, url}
get_document_outline(slug)                       → 기본 섹션 id 확인
insert_block(slug, section_id, {heading}) → {paragraph} → {table} … 반복
완료 후 url 을 사용자에게 안내 → 사람이 위키에서 검토
```

## Backend 선택

기본은 `st` (sentence-transformer). 첫 호출 시 ~120MB 모델을 lazy 다운로드.

`bm25` 는 의존성 없이 즉시 사용 가능하지만 인덱스를 미리 만들어야 함:

```bash
./bin/mxwp-rules-linux index --backend bm25
```

`openai` 는 `OPENAI_API_KEY` 환경변수 필요.

## 트러블슈팅

| 증상 | 원인 | 대처 |
|---|---|---|
| `backend 'st' has no index` | embeddings.npz 없음 | `mxwp-rules index --backend st` 실행 |
| `chunks.jsonl missing` | rag-dir 잘못 지정 | `--rag-dir` 절대경로 재확인 |
| 한국어 질의가 엉뚱한 결과 | bm25 backend 의 단어 매칭 한계 | `--backend st` 로 전환 (multilingual model) |
| 쓰기 도구가 "토큰 필요" 에러 | `MXWP_API_TOKEN` 미설정 | [API 토큰 발급](#api-토큰-발급) 후 env 에 추가, 클라이언트 재시작 |
| 401 Unauthorized | 토큰 만료/폐기/회전됨 | UI 토큰 목록 확인 후 재발급 |
| 403 (scope) | read 전용 토큰으로 쓰기 시도 | **쓰기** scope 포함해 재발급 |
| "문서가 그 사이 변경됨" | ETag 충돌 — 다른 사용자가 먼저 수정 | `get_document_outline` 으로 다시 읽고 재시도 |
| 블록 스키마 에러 반복 | block JSON 형식이 룰과 다름 | `query_rules` 로 해당 블록 타입 룰 검색 후 수정 |
| API 연결 실패 | `MXWP_API_URL` 오류 / 서버 다운 | URL 확인 (`curl <url>/api/v1/healthz` 등) |
