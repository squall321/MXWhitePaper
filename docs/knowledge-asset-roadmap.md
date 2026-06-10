# 지식 자산 활용 로드맵 (Knowledge Asset Roadmap)

> 2026-06-10 수립. 본 리포지토리의 지식 자산이 *쌓이기만 하고 활용되지 않는* 구조적
> 문제를 진단하고, 단계별로 "기계가 보증하는 지식 시스템" 으로 전환하는 계획.
> 갱신 책임: 각 Phase 완료 시 본 문서의 상태 컬럼을 갱신할 것.

## 1. 자산 인벤토리 × 소비자 맵

| 자산 | 위치 | 소비자 | 갱신 보증 |
| --- | --- | --- | --- |
| DocumentJSON schema (SSOT) | `packages/shared/schemas/document.json` | codegen, validator, 모든 문서 | pre-commit codegen drift |
| lat 코드 지도 (11 areas) | `docs/lat/` | AI 코딩 에이전트, 신규 dev | **사람 수동** ← 취약 |
| 작성 가이드 | `docs/llm-input-rules.md`, `llm-widgets-via-api.md`, `llm-document-formats.md` | 외부 LLM (문서 생성) | **사람 수동** ← 취약 |
| 읽기 가이드 | `docs/llm-viewer-guide.md` (+`.en`) | 외부 LLM (요약/Q&A) | **사람 수동** ← 취약 |
| system prompt | `dist/llm-docx-toolkit/llm-system-prompt.md` | mxwp-mcp, 외부 LLM | **사람 수동** ← 취약 |
| RAG index | `dist/llm-docx-toolkit/rag/` | mxwp-rules query, MCP | pre-commit `--check` (파일 hash 단위) |
| PDCA archive (80 reports) | `docs/archive/` | *(현재 소비자 없음)* | — |
| glossary (terms DB) | PostgreSQL `terms` | RAG (DB 연결 시만), 위키 본문 | DATABASE_URL 없으면 skip |
| 골든 샘플 17종 | `packages/shared/samples/` | ajv validate, 데모 | pre-commit validate |
| 바이너리 4종 | `dist/llm-docx-toolkit/bin/` | 외부 LLM 툴체인, cae00 | CI smoke (toolkit workflow) |

## 2. 진단 (2026-06-10 스캔)

1. **의미 드리프트 미검출**: RAG `--check` 는 *파일 hash* 만 본다. schema 에 block 이
   추가돼도 (G2 slicer → G4 timeline → 현재 38종) 작성/읽기 가이드에 해당 섹션이
   없는 것은 어떤 기계도 잡지 못한다. 실측: slicer/timeline/boundSlicers/compute/
   source-ref 가 input-rules·system-prompt·widgets-via-api 에서 **0건**.
2. **Archive 는 write-only**: 80개 cycle report 에 "왜 PUA 문자를 썼나", "recharts
   manualChunks 가 왜 금지인가" 같은 의사결정 근거가 있지만 검색 경로가 없다.
3. **lat 링크 무결성 미보증**: `[[src/path#sym]]` 274건 중 다수가 관례 매핑 의존,
   파일 이동 시 silent 하게 깨진다 (이미 widgetExport.ts 경로 오류 1건을 수동 발견).
4. **glossary chunk 는 사실상 죽은 코드 경로**: chunker 가 DATABASE_URL 없으면
   skip — CI/바이너리에는 glossary 지식이 한 번도 실리지 않았다.

## 3. Phased 로드맵

### Phase 0 — 문서 동기화 (즉시) — 상태: ✅ 2026-06-10
schema 38 block 기준으로 4종 가이드 일괄 갱신:
- `llm-input-rules.md`: §3.14 slicer, §3.15 timeline 신설 + kpi-cards(compute) /
  chart(source/labelField/aggregations) / table(source/filters) / pivot(boundSlicers) 갱신
- `llm-system-prompt.md`: 동일 델타의 압축판
- `llm-viewer-guide.md` + `.en.md`: §2 표에 timeline 행, §4 에 timeline 읽기 규칙,
  drill/CSV-TSV export 가능성 노트
- `llm-widgets-via-api.md`: slicer/timeline/cross-widget filter API 패턴 섹션

### Phase 1 — 커버리지 자동 보증 (즉시) — 상태: ✅ 2026-06-10
- `rag/coverage_check.py`: schema Block union → 각 block type 이 (a) input-rules,
  (b) viewer-guide 에 등장하는지 매트릭스 검사. 신규 block 추가 시 문서 누락이
  **CI fail** 이 되도록 chunker `--check` 흐름에 연결.
- `rag/lat_link_check.py`: lat 의 `[[ref]]` 를 관례 매핑 (src/→apps/api/app/,
  web 상대경로) 포함해 resolve, 깨진 링크 목록 출력. CI 옵션.

### Phase 2 — Archive 를 질의 가능한 지식으로 (즉시) — 상태: ✅ 2026-06-10
- chunker 에 `docs/archive/*/_INDEX.md` glob 소스 추가 (`source="archive"`).
  월별 INDEX 는 cycle 당 1행 요약이라 chunk 밀도가 적당하다. report 본문 전체는
  노이즈가 커서 INDEX 만 — 깊은 질문은 INDEX 가 가리키는 report 를 사람이 연다.
- 효과: `mxwp-rules query "왜 PUA 문자"` 가 답을 찾는다.

### Phase 3 — glossary 오프라인 chunk — 상태: ⬜ 예정
- `make glossary-dump` → `dist/llm-docx-toolkit/rag/glossary.json` (tracked).
- chunker 가 DB 대신 dump 파일을 읽도록 fallback 추가. CI/바이너리에 glossary 포함.
- 주의: dump 갱신 시점 규약 필요 (terms 변경이 잦으면 주기적, 아니면 릴리즈 시).

### Phase 4 — 바이너리 + 릴리즈 갱신 (즉시, Phase 0-2 후) — 상태: ✅ 2026-06-10
- `build.py --clean --variant lite` 로 4종 바이너리 재빌드 (갱신된 가이드 + chunks 베이크).
- `_release/lite-linux` tarball 재생성. Drive ship 은 별도 운영 판단.

### Phase 5 — in-app 지식 검색 — 상태: ⬜ 후순위
- Meilisearch 에 lat/가이드/archive INDEX 를 별도 인덱스로 적재, 위키 검색창에서
  "시스템 지식" 탭 제공. 효과 대비 surface 가 커서 수요 확인 후 진행.

### Phase 6 — lat 자동 갱신 보조 — 상태: ⬜ 후순위
- commit diff 에서 lat 영향 파일을 감지해 "lat 갱신 필요 후보" 를 PR 코멘트로 제안.
  (CLAUDE.md 룰의 기계 보조. 완전 자동화는 오탐 위험으로 비권장.)

## 4. 성공 지표

| 지표 | 현재 | 목표 |
| --- | --- | --- |
| 신규 block 추가 시 가이드 누락 검출 | 사람 기억 | CI fail (coverage_check) |
| "왜" 질문의 RAG 응답 가능성 | 0 (archive 미인덱스) | archive INDEX 질의 가능 |
| lat 깨진 링크 | 미측정 | 검사기 보고 0건 유지 |
| 가이드 ↔ schema 시차 | 9일+ (6/1 vs 6/10) | commit 단위 동기 (--check 강제) |
