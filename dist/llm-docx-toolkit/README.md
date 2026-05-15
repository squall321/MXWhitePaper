# MXWhitePaper LLM Docx Toolkit

> 사람이 LLM 에게 *"이 룰을 따라 백서를 .docx 로 만들어줘"* 라고 시킬 때
> 그 결과물을 **서버 없이 로컬에서 검증** 할 수 있는 도구 모음.

## 무엇이 들어있나

```
llm-docx-toolkit/
├── README.md                   ← 이 문서
├── llm-input-rules.md          ← LLM 에게 줄 명세서 (18 위젯 형태/실수/체크리스트)
├── bin/
│   ├── mxwp-validator-linux*           ← Linux 단일 실행 파일 (PyInstaller)
│   └── mxwp-validator-win32.exe        ← Windows 단일 실행 파일
├── examples/
│   ├── good-example.docx       ← 룰을 따른 모범 예시 (15 위젯)
│   ├── all-widgets.docx        ← 18 위젯 전부
│   ├── bad-example.docx        ← 흔한 실수 모음
│   └── build_examples.py       ← 예제 재생성 스크립트
├── src/
│   ├── validate.py             ← CLI 소스 (PyInstaller 엔트리)
│   └── _settings_stub.py       ← 서버 설정 stub
├── build.py                    ← 로컬 빌드 스크립트
└── requirements.txt
```

## 빠른 사용 (이미 빌드된 binary)

### Linux / macOS
```bash
./bin/mxwp-validator-linux examples/good-example.docx
```

### Windows
```cmd
bin\mxwp-validator-win32.exe examples\good-example.docx
```

출력:
- 인식된 위젯 인벤토리 (타입별 개수)
- 자동 인식된 위젯 목록
- placeholder 가 emit 된 위젯 (이미지 미해소 등)
- schema 위반 목록
- 변환된 DocumentJSON 을 `<input>.json` 으로 dump

### 종료 코드

- `0` — 스키마 유효, import 준비 완료
- `1` — 스키마 위반 (서버가 REJECT)
- `2` — docx 파싱 실패 (파일이 손상됐거나 .docx 가 아님)
- `3` — 사용법 / I/O 오류

## LLM 에게 어떻게 시키나

1. `llm-input-rules.md` 를 ChatGPT / Claude / Gemini 의 system prompt 또는
   첫 메시지에 통째로 붙여넣기.
2. "이 룰을 따라 [백서 주제] 에 대한 .docx 를 만들어줘" 라고 요청.
3. LLM 이 산출한 .docx 를 본 toolkit 의 validator 로 검증:
   ```bash
   ./bin/mxwp-validator-linux output.docx
   ```
4. 위반/누락 있으면 그 메시지를 LLM 에게 다시 보내 수정 요청.
5. 검증 통과한 .docx 를 MXWhitePaper 의 `/api/v1/imports/docx` 엔드포인트에
   업로드.

## 로컬에서 빌드

본 toolkit 은 MXWhitePaper repo 안에 있다 — 그래서 빌드 스크립트가 *원본*
`docx_import.py` / `widget_markers.py` / `document.json` 을 *그 위치에서*
직접 읽어서 PyInstaller 에 묶는다. 코드 복사본이 없으니 drift 0.

```bash
cd dist/llm-docx-toolkit
pip install -r requirements.txt
python build.py            # bin/mxwp-validator-<platform> 생성
python build.py --onedir   # 단일 파일 대신 펼친 폴더 (디버깅)
```

## 자동 빌드 (GitHub Actions)

`main` 브랜치에 push 가 일어나면 `.github/workflows/llm-docx-toolkit.yml`
가 Linux + Windows 양쪽에서 자동 빌드해 artifact 로 첨부. 새 위젯이
추가되거나 import 로직이 바뀌어도 다음 push 의 빌드가 *그 변경을 자동
반영* — 본 toolkit 은 항상 production 코드의 최신 스냅샷.

태그 push (`v*`) 가 일어나면 같은 artifact 가 GitHub Release 로도 발행됨.

## 검증이 *정확히* 무엇을 보는가

`mxwp-validator` 가 실행하는 것은 *서버가 import 시 실행하는 코드와 동일*:

1. **`docx_import.docx_to_document(...)`** — XML → DocumentJSON
2. **`apply_widget_markers(...)`** — `Widget: <type>` 마커 인식
3. **`apply_widget_autodetect(...)`** — 마커 없는 위젯 패턴 자동 인식
   (callout / kpi-cards / gantt / gallery)
4. **`apply_section_column_autodetect(...)`** — Word "단" 레이아웃 인식
5. **`document.schema.json` validation** (Draft 2020-12)

차이는 단 두 가지:
- DB / MinIO / Meilisearch 가 없으므로 이미지 업로드 / 저장 / 검색 인덱싱
  은 발생하지 않음.
- 결과를 응답 JSON 으로 emit 하지 않고 `<input>.json` 으로 dump.

## 빌드된 binary 의 크기

- Linux x64: ~25 MB (Python + stdlib + ulid + jsonschema)
- Windows x64: ~30 MB

PyInstaller `--onefile` 모드: 단일 실행 파일. Python 설치 불필요.

## 트러블슈팅

| 증상 | 원인 | 해결 |
|---|---|---|
| `file is not a valid .docx` | ZIP magic byte 또는 `word/document.xml` 누락 | LLM 이 진짜 docx 가 아닌 plain text 출력했을 가능성 — `.docx` 로 다시 만들도록 요청 |
| `schema validation FAILED` | 필수 필드 누락 또는 enum 위반 | 출력된 `(path): error` 메시지를 LLM 에게 보내 수정 요청 |
| `Placeholders emitted` 다수 | docx 가 이미지 자체 (bytes) 를 안 가지고 있음 | LLM 이 "이미지 삽입" 한 게 아니라 placeholder paragraph 만 만들었을 수 있음. 룰의 "이미지는 inline 삽입" 항목 참고 |
| `placeholder fileId emitted` | file/pdf 위젯의 실제 파일이 안 첨부됨 | 정상 — file/pdf 는 import 후 에디터에서 진짜 파일 다시 연결 |

## 라이센스 / 소스

MXWhitePaper 의 일부. 본 toolkit 의 binary 는 LGPL-호환 (jsonschema, ulid) +
사내 BSL (production 코드 부분).
