# MXWhitePaper LLM Docx Toolkit — 인수인계 (HANDOFF)

> 이 문서를 **가장 먼저** 읽으세요. 받은 zip 안에 무엇이 들었고, 어떻게 쓰고,
> 룰이 바뀌면 어떻게 대처해야 하는지 한 페이지에 정리되어 있습니다.

---

## 0. 청자별 진입점 — 어디부터 읽나

| 당신은 누구입니까 | 먼저 읽을 곳 |
| --- | --- |
| 외부 LLM 을 이 룰에 맞춰 운영하는 사람 (메인) | [§3 시나리오 A/B/C](#3-3가지-사용-시나리오) → [§5 트러블슈팅](#5-자주-만나는-문제-트러블슈팅) |
| 본 toolkit 을 자기 회사 시스템에 *통합* 하려는 개발팀 | [§4 룰 갱신 흐름](#4-룰이-바뀌면-어떻게-되나-4계층-자동-동기화) → [§6 내부 구조](#6-내부-구조-개발자감사용) → 본 폴더의 `README.md` |
| 컴플라이언스/감사 — 이 도구가 "안전한가" 보는 사람 | [§4 룰 갱신 흐름](#4-룰이-바뀌면-어떻게-되나-4계층-자동-동기화) → [§6 내부 구조](#6-내부-구조-개발자감사용) → `rag/index.lock` 직접 확인 |
| LLM 자체 (Claude 등) — 이 문서가 컨텍스트로 주입될 때 | [§3-B](#b-llm-이-룰을-검색해가며-작성---mxwp-rules-cli) + `llm-system-prompt.md` 본문 |

---

## 1. 이게 뭐냐 — 한 단락 요약

MXWhitePaper 라는 백서 작성 시스템은 18 종류의 위젯(콜아웃·차트·갤러리·간트·등)을
가진 자체 `.docx` 입력 규격을 씁니다. 외부 LLM (ChatGPT·Claude·Gemini 등) 에게
"이 규격에 맞춰 .docx 를 작성해달라" 라고 시킬 때 본 toolkit 이 다음 세 가지를
한 번에 제공합니다.

1. **검증** — LLM 이 만든 `.docx` 가 규격에 맞는지 *서버 없이 로컬에서* 검사
2. **검색** — LLM 이 시스템 프롬프트에 7KB 룰 전체를 넣지 않고도
   필요한 룰만 골라 가져갈 수 있는 RAG (Retrieval-Augmented Generation) 인덱스
3. **자기-동기화** — 위젯 정의가 진화하면 위의 검증·검색 인덱스가 *자동으로*
   따라옴 (사람이 까먹어도 CI / git hook 가 강제로 잡아냄)

```
+----------------+    질의 ("차트 데이터 표 어떻게")   +-------------------+
|  외부 LLM      | -----------------------------------> |  mxwp-rules /     |
|  (Claude 등)   | <----------------------------------- |  mxwp-mcp         |
+----------------+    top-k 룰 chunks                  +-------------------+
       |
       | 룰을 따라 .docx 작성
       v
+----------------+   "이거 룰 맞아?"          +-------------------+
|  output.docx   | -------------------------> |  mxwp-validator   |
+----------------+   exit 0 / 1 / 2 / 3      +-------------------+
                                                    |
                                                    v
                                              MXWhitePaper 서버 import OK
```

---

## 2. 받은 자료 — zip 안에 뭐가 들었나

### 두 가지 변형 (variant)

| variant | 크기 | 배포 채널 | 백엔드 |
|---|---|---|---|
| **lite** (기본) | ~50-80 MB | GitHub Release | bm25 (즉시), st/openai (소스 빌드 시) |
| **full** | ~2.6 GB | 사내망 / 직접 빌드 | bm25 / st / openai 모두 바로 |

대부분은 **lite** 만 받으면 됩니다. 룰 검색 정확도 차이는 한국어 의미 검색
필요할 때 (`--backend st`) 만 의미 있고, lite 에서도 `pip install sentence-
transformers numpy` 후 소스 실행으로 같은 효과를 낼 수 있습니다.

**full** 은 외부 인터넷 차단된 환경에서 *바로* st backend 가 필요한 케이스용.
GitHub Release 의 2 GB per-asset 한계 때문에 직접 빌드해서 받아갑니다 (절차는
[§8 Full 빌드](#8-full-빌드-windows-자체-빌드)).

### 파일 트리 (lite 기준)

```
llm-docx-toolkit-lite-{linux,windows}/
├── HANDOFF.md                ← 이 문서 (가장 먼저 읽음)
├── README.md                 ← 개발자용 상세
├── llm-input-rules.md        ← LLM 에게 줄 18-위젯 명세서 (전통적 방식)
├── llm-system-prompt.md      ← LLM 시스템 프롬프트 (간단형, MCP 의 prompt primitive)
│
├── bin/                      ← 단일 실행 파일 (의존성 0)
│   ├── mxwp-validator-{linux,win32.exe}    ~17 MB   ← .docx 검증
│   ├── mxwp-rules-{linux,win32.exe}        ~50 MB   ← RAG CLI (bm25 backend)
│   └── mxwp-mcp-{linux,win32.exe}          ~50 MB   ← MCP stdio 서버 (bm25)
│
├── examples/                 ← 모범/반례 예시
│   ├── good-example.docx     ← 룰을 따른 예 (15 위젯)
│   ├── all-widgets.docx      ← 18 위젯 전부
│   └── bad-example.docx      ← 흔한 실수
│
├── rag/                      ← 룰 검색 인덱스 (코퍼스)
│   ├── chunks.jsonl          ← 120 chunks, 결정론적 (SHA c1f22a05...)
│   ├── index.lock            ← source hash manifest (drift 탐지의 진실원)
│   └── README.md             ← 내부 구조 설명
│
├── mcp/                      ← MCP 서버 설정 예시
│   ├── README.md
│   ├── example-claude-desktop.json
│   └── example-claude-code.json
│
├── apply/                    ← (선택) Windows 자동 적용 도구
│   ├── apply-rules.bat
│   └── apply-rules.ps1
│
├── src/                      ← validator 소스 (감사용)
├── build.py                  ← 직접 빌드 시
└── requirements.txt
```

**왜 rules/mcp 바이너리가 2.6GB 인가?**
sentence-transformer (한국어 의미 검색) 가 torch 를 의존성으로 갖기 때문입니다.
모델 자체 (~120MB) 는 첫 실행 시 `~/.cache/huggingface` 에 별도 다운로드.
키워드만 쓰는 환경에서는 `--backend bm25` 로 모델 다운로드를 회피할 수 있습니다.

---

## 3. 3가지 사용 시나리오

### A. `.docx` 검증만 (`mxwp-validator`)

**언제 쓰나**: LLM 이 만들어준 `.docx` 가 MXWhitePaper 규격에 맞는지 *서버 없이*
확인하고 싶을 때.

**사용법**:

```bash
# Linux
./bin/mxwp-validator-linux output.docx

# Windows
bin\mxwp-validator-win32.exe output.docx
```

**출력**:
- 인식된 위젯 인벤토리 (타입별 개수)
- 자동 인식된 위젯 목록
- placeholder 가 emit 된 위젯 (이미지 미해소 등)
- schema 위반 목록
- 변환된 DocumentJSON 을 `<input>.json` 으로 dump

**종료 코드**:

| 코드 | 의미 | 대처 |
| --- | --- | --- |
| `0` | 스키마 유효, import 준비 완료 | 서버로 보내도 OK |
| `1` | 스키마 위반 (서버가 REJECT) | 출력의 schema errors 보고 LLM 에게 재요청 |
| `2` | `.docx` 파싱 실패 | 파일이 손상됐거나 .docx 가 아님. 재생성 |
| `3` | 사용법/I/O 오류 | 인자/경로 확인 |

---

### B. LLM 이 룰을 *검색*해가며 작성 — `mxwp-rules` CLI

**언제 쓰나**: 7KB 짜리 룰 전체를 system prompt 에 매번 넣지 않고, LLM 이
필요한 룰만 골라 가져가게 하고 싶을 때. RAG 파이프라인을 직접 구축할 때.

**사용법**:

```bash
# 기본 = sentence-transformer 백엔드 (한국어 의미 검색)
./bin/mxwp-rules-linux query "callout 만드는 법"

# 키워드만 (의존성 0, 즉시 동작)
./bin/mxwp-rules-linux query --backend bm25 "차트 데이터 표 어떻게"

# OpenAI 임베딩 (API 키 필요)
export OPENAI_API_KEY=sk-...
./bin/mxwp-rules-linux query --backend openai "이미지 위에 주석 다는 법"

# JSON 출력 (프로그램 연계)
./bin/mxwp-rules-linux query --backend bm25 "callout" --json

# 인덱스 신선도 확인 (drift 검사)
./bin/mxwp-rules-linux check
```

**3개 백엔드 비교**:

| 백엔드 | 한국어 의미 검색 | 의존성 | 첫 실행 시간 | 정확도 |
| --- | :---: | --- | --- | :---: |
| `bm25` | × (단어 매칭) | 없음 | 즉시 | ★★ |
| `st` (기본) | O | 자동 모델 다운로드 (~120MB) | ~30초 첫회 | ★★★★ |
| `openai` | O | `OPENAI_API_KEY` | API 호출 | ★★★★★ |

**서브커맨드 요약**:

| 명령 | 용도 | 종료 코드 |
| --- | --- | --- |
| `query <text>` | 룰 top-k 검색 | 0=정상, 1=lock drift |
| `index --backend X` | 해당 백엔드 인덱스 빌드 | 0=성공 |
| `check` | source ↔ lock ↔ chunks 정합성 검사 | 0=일치, 1=drift |

---

### C. Claude Desktop / Claude Code 에 직접 통합 — `mxwp-mcp` MCP 서버

**언제 쓰나**: Anthropic Claude 데스크탑 또는 Claude Code CLI 안에서
"룰 검색" 을 LLM 의 *기본 도구* 로 제공하고 싶을 때. 사용자가 따로 명령을
치지 않아도 LLM 이 알아서 룰을 가져와 따른다.

**설정 (Claude Desktop, macOS)**:

`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mxwp-rag": {
      "command": "/absolute/path/to/llm-docx-toolkit/bin/mxwp-mcp-linux",
      "args": [
        "--rag-dir",
        "/absolute/path/to/llm-docx-toolkit/rag",
        "--system-prompt",
        "/absolute/path/to/llm-docx-toolkit/llm-system-prompt.md"
      ]
    }
  }
}
```

(Windows 는 같은 형식이되 `command` 가 `...mxwp-mcp-win32.exe` 이고 경로
구분자가 백슬래시. 자세한 예는 `mcp/example-claude-desktop.json` 참조.)

**설정 (Claude Code)**:

프로젝트 루트의 `.mcp.json`:

```json
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

**서버가 LLM 에게 노출하는 primitive**:

| 종류 | 이름 | LLM 입장에서 |
| --- | --- | --- |
| tool | `query_rules(query, k=5, backend="st")` | "이 자연어 질의에 대한 top-k 룰 chunk 줘" |
| resource | `rag://chunks/{id}` | "특정 룰 chunk 의 원문/메타데이터 줘" |
| prompt | `mxwp_system_prompt` | "MXWhitePaper 작성 시스템 프롬프트 줘" |

**확인**: 데스크탑/Code 재시작 후, LLM 대화에서 `mxwp-rag` 가 도구 목록에
보이면 성공. "MXWhitePaper 백서 만들어줘" 정도의 요청으로 LLM 이 알아서
`query_rules` 를 부르는지 확인.

---

## 4. 룰이 바뀌면 어떻게 되나 — 4계층 자동 동기화

본 toolkit 의 *진짜 차별점*. RAG 가 한 번 만든 뒤 위젯 룰이 진화하면 일반적으로
인덱스가 stale 되어 LLM 이 *잘못된 .docx* 를 생성합니다. 본 toolkit 은 그걸
4단계로 **시스템적으로** 막습니다.

### 4계층 가드

| Layer | 위치 | 차단 시점 | 사람이 까먹어도? |
| --- | --- | --- | --- |
| **1. CI rebuild + lock check** | GitHub Actions `rag-lock-verify` job | merge 전 | ✅ force-fail |
| **2. Path filter** | workflow `paths:` 필터 | 무관한 push 차단 | ✅ 자동 |
| **3. Pre-commit hook** | `.husky/pre-commit` | 커밋 전 | ✅ 차단 |
| **4. Runtime stale check** | binary 안의 `chunks_sha256` 검증 | 사용 시점 | ✅ warning + exit 1 |

### 운영자 입장의 의미

- **이 toolkit 을 그냥 받아서 쓰는 경우**: 신경 쓸 일 없음. 새 위젯이 추가되면
  새 v1.x.y 태그가 GitHub Release 에 올라온다. 그 번들을 받아 교체.
- **이 toolkit 을 자체 빌드하는 경우**: `widget_markers.py` / `docx_import.py` /
  `document.json` / `llm-input-rules.md` 중 어느 하나라도 바꾸면 commit 전
  pre-commit hook 이 `chunker.py --check` 를 돌려 막는다. 룰과 인덱스의
  lock-step 이 *사람의 디스플린이 아니라 시스템*으로 강제.

### Drift 가 의심될 때

```bash
./bin/mxwp-rules-linux check
```

출력:
- `✓ OK — index.lock matches live sources + chunks.jsonl` → 안전
- `✗ RAG index.lock is stale: ...` → 새 toolkit 번들을 받아야 함

---

## 5. 자주 만나는 문제 (트러블슈팅)

| 증상 | 원인 | 대처 |
| --- | --- | --- |
| 첫 `query` 가 30초 멈춤 | sentence-transformer 모델 lazy 다운로드 (~120MB) | 그냥 기다림. 다음부터는 즉시. 또는 `--backend bm25` 로 회피 |
| `backend 'st' has no index` | embeddings.npz 가 없음 | `mxwp-rules-linux index --backend st` 실행 |
| `backend 'openai' has no index` | `OPENAI_API_KEY` 미설정 | `export OPENAI_API_KEY=sk-...` 후 `index --backend openai` |
| Windows 콘솔에서 한글 깨짐 | cp1252 기본 인코딩 | toolkit 은 자체적으로 UTF-8 강제하므로 보통 OK. 그래도 깨지면 `chcp 65001` |
| MCP 서버가 Claude 에 안 보임 | config 경로 절대경로 아님 / 재시작 안 함 | 절대경로로 적고, Claude Desktop/Code 완전 재시작 |
| `check` 가 drift 보고 | 받은 번들이 stale 또는 누군가 수동 수정 | 최신 v1.x.y 번들 재다운로드 |
| Linux 바이너리가 `libm.so.6: GLIBC_2.38 not found` | 빌드 환경보다 오래된 glibc | Ubuntu 22.04 LTS 이상 사용 권장 (CI 빌드 환경) |
| MCP `query_rules` 가 늘 같은 결과 | LLM 이 캐시함 | k 값을 키우거나 질의 문구를 미세 조정 |

---

## 6. 내부 구조 (개발자/감사용)

### 결정론적 코퍼스 빌드

`rag/chunker.py` 가 다음 5개 *읽기 전용 진실원*을 AST/Markdown 파서로 읽어
120 chunks 를 생성:

| 진실원 | 추출 내용 | chunks |
| --- | --- | --- |
| `apps/api/app/services/widget_markers.py` | 18 widget marker 종류 + 직렬화 형식 | 18 |
| `packages/shared/schemas/document.json` | DocumentJSON v1.0 스키마 | 18 |
| `docs/llm-input-rules.md` | LLM 용 룰 명세서 (한국어) | 37 |
| `dist/llm-docx-toolkit/llm-system-prompt.md` | 시스템 프롬프트 | 10 |
| `dist/llm-docx-toolkit/examples/build_examples.py` | 18 위젯별 예시 코드 | 37 |

**결정론적 SHA**: 같은 입력 → 같은 `chunks.jsonl` byte-for-byte. drift 탐지의 기반.

### `rag/index.lock` 스키마

```json
{
  "schema_version": 1,
  "generated_at": "2026-05-16T...",
  "source_hashes": {
    "apps/api/app/services/widget_markers.py": "<sha256>",
    "apps/api/app/services/docx_import.py": "<sha256>",
    "packages/shared/schemas/document.json": "<sha256>",
    "docs/llm-input-rules.md": "<sha256>",
    "dist/llm-docx-toolkit/llm-system-prompt.md": "<sha256>"
  },
  "widget_types": ["accordion", "callout", "chart", ...],
  "chunk_count": 120,
  "embedding_backend_fingerprint": "bm25:v1",
  "chunks_sha256": "c1f22a054091b3fd185c51393f97f41e1e7d51aab7ffd3307252cfcd38a5bb66"
}
```

drift 검사는 `generated_at` 만 제외하고 byte-단위 비교 (CI 의 `jq del(.generated_at)`).

### 빌드 (자체 빌드 시)

```bash
cd dist/llm-docx-toolkit
pip install -r requirements.txt
python build.py                    # 3 바이너리 모두
python build.py --target validator # 개별 빌드
python build.py --target rules
python build.py --target mcp
```

PyInstaller 함정 두 가지 (build.py 안에서 해결됨):
1. `rag/__main__.py` 의 relative import (`from .cli import main`) → flat launcher 스테이징
2. 로컬 `mcp/` 패키지가 site-packages 의 `mcp` SDK 를 shadow → spec 안에서 `sys.path` 필터 + `collect_submodules('mcp')`

---

## 7. FAQ

**Q. 인터넷 없이 쓸 수 있나?**
A. `--backend bm25` 면 완전 오프라인. `st` 는 첫 실행 1회만 모델 다운로드.
`openai` 는 매 호출 인터넷 필요.

**Q. LLM 에게 어떻게 시키나? (전통 방식)**
A. `llm-input-rules.md` 를 통째로 system prompt 에 붙여넣기 → "이 룰 따라
`.docx` 만들어줘" → 결과를 `mxwp-validator` 로 검증. 토큰 낭비가 신경 쓰이면
시나리오 B/C 로 전환.

**Q. 시스템 프롬프트는 어디서 가져오나?**
A. 본 폴더의 `llm-system-prompt.md` (7KB) 가 사전 작성된 한국어 프롬프트.
MCP 의 `mxwp_system_prompt` prompt primitive 로도 노출됨.

**Q. 본 toolkit 의 라이선스/책임은?**
A. 본 zip 안의 `bin/` 은 MXWhitePaper 본체와 동일한 라이선스를 따른다. 외부
LLM (Claude / GPT 등) 사용에 대한 책임은 각 LLM 제공자 약관에 따른다. RAG
질의 내용·LLM 응답 등은 본 toolkit 외부에 저장되지 않는다 (stdio 만 사용).

**Q. 다음 릴리스는 어떻게 알 수 있나?**
A. GitHub Release 페이지를 watch. 위젯 룰이 바뀌면 자동으로 새 태그가 올라간다.

---

## 8. Full 빌드 (Windows / 자체 빌드)

GitHub Release 는 **lite** 만 publish 합니다. ST / OpenAI 백엔드가 통째로
번들된 **full** 변형 (~2.6 GB) 이 필요하면 직접 빌드합니다.

### 8.1 사전 준비

- Python 3.12 (Windows: 공식 installer + "Add to PATH" 체크)
- git
- 디스크 ~15 GB (torch 등 의존성 다운로드 + 빌드 산출물)

### 8.2 빌드 절차 (Windows / Linux 공통)

```powershell
# 1. 본 프로젝트 통째 clone (sparse-checkout 가능)
git clone https://github.com/squall321/MXWhitePaper.git
cd MXWhitePaper

# 2. 의존성 (lite 의 dep 위에 torch + sentence-transformers + openai 가 추가됨)
cd dist/llm-docx-toolkit
python -m pip install -r requirements.txt

# 3. RAG 인덱스 (분야별 어휘 등 최신 chunks.jsonl 보장)
python rag/chunker.py

# 4. full 빌드
python build.py --clean --variant full
```

빌드 시간 ~15-30 분 (PyInstaller가 torch 통째 번들).

### 8.3 산출물

`_release/full-{linux,windows}/` 안에:

```
llm-docx-toolkit-full-{linux,windows}.{zip|tar.gz}         ← 원본 (2.6 GB)
llm-docx-toolkit-full-{linux,windows}.{zip|tar.gz}.001     ← 분할 파트 1 (1.5 GB)
llm-docx-toolkit-full-{linux,windows}.{zip|tar.gz}.002     ← 분할 파트 2
REASSEMBLE.md                                              ← 합치는 방법
```

분할 파일은 GitHub Release / 사내 파일 서버 / 메일 첨부 등으로 전달.

### 8.4 받은 쪽에서 합치기

`REASSEMBLE.md` 안내 그대로:

**Linux / macOS**:
```bash
cat llm-docx-toolkit-full-linux.tar.gz.* > llm-docx-toolkit-full-linux.tar.gz
tar -xzf llm-docx-toolkit-full-linux.tar.gz
```

**Windows (cmd.exe)**:
```cmd
copy /b llm-docx-toolkit-full-windows.zip.* llm-docx-toolkit-full-windows.zip
```
이후 우클릭 → "압축 풀기" 또는 `Expand-Archive`.

**Windows (PowerShell)** — REASSEMBLE.md 에 자동 스크립트 포함.

---

## 9. Windows 에서 동료에게 zip 으로 전달

받은 toolkit 폴더를 동료에게 그대로 zip 으로 전달하고 싶을 때.

### 9.1 PowerShell 한 줄

```powershell
Compress-Archive -Path .\llm-docx-toolkit-lite-windows -DestinationPath .\llm-docx-toolkit-lite-windows-$(Get-Date -Format yyyyMMdd).zip
```

### 9.2 자동화 스크립트

`apply/repack-as-zip.ps1` (Windows 만, toolkit 안에 동봉):

```powershell
.\apply\repack-as-zip.ps1
# → llm-docx-toolkit-<variant>-windows-<timestamp>.zip 자동 생성
```

스크립트는 다음을 자동 처리:
- 현재 폴더 이름에서 variant 추출 (lite/full)
- 타임스탬프 포함 파일명
- `__pycache__`, `.pytest_cache` 자동 제외
- 압축 후 SHA-256 출력 (전달 시 무결성 검증용)

---

## 10. 한 줄 요약

> 받은 zip 안의 `bin/` 3개가 핵심. `mxwp-validator` 는 .docx 검사, `mxwp-rules`
> 는 LLM 이 룰을 검색, `mxwp-mcp` 는 Claude Desktop/Code 에 끼우는 MCP 서버.
> 위젯 룰이 바뀌면 새 zip 만 받아서 교체하면 된다. drift 는 4계층 가드가
> 시스템적으로 막는다. ST 백엔드는 lite 에 미포함 — `pip install` 또는 full 변형.
