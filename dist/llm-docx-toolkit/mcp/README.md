# MCP Server — `mxwp-mcp`

LLM (Claude Desktop, Claude Code, 등) 이 RAG 인덱스를 stdio MCP 로 직접
질의할 수 있게 해주는 서버.

## Primitive

| 종류 | 이름 | 설명 |
|---|---|---|
| tool | `query_rules(query, k=5, backend="st")` | top-k chunks 반환 |
| resource | `rag://chunks/{id}` | 단일 chunk 의 원문 + metadata |
| prompt | `mxwp_system_prompt` | `llm-system-prompt.md` 전체 |

## 설정

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)
또는 `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```jsonc
{
  "mcpServers": {
    "mxwp-rag": {
      "command": "/absolute/path/to/llm-docx-toolkit/bin/mxwp-mcp-linux",
      "args": [
        "--rag-dir", "/absolute/path/to/llm-docx-toolkit/rag",
        "--system-prompt", "/absolute/path/to/llm-docx-toolkit/llm-system-prompt.md"
      ]
    }
  }
}
```

`example-claude-desktop.json` 참고.

### Claude Code

프로젝트 루트의 `.mcp.json`:

```jsonc
{
  "mcpServers": {
    "mxwp-rag": {
      "type": "stdio",
      "command": "/absolute/path/to/bin/mxwp-mcp-linux",
      "args": ["--rag-dir", "/absolute/path/to/rag"]
    }
  }
}
```

`example-claude-code.json` 참고.

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
