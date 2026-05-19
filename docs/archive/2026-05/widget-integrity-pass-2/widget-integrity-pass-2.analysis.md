# Widget Integrity Pass 2 — Gap Analysis

> Cycle: widget-integrity-pass-2
> Date: 2026-05-18
> Analyzer: bkit:gap-detector
> Method: lat-first (grep으로 좁혀 파일:라인 확인)

## Match Rate: **100%**

## C1~C14 통과 여부

| # | 기준 | 결과 | 근거 (파일:라인) |
|---|---|---|---|
| C1 | M1~M11 모두 변경 | ✅ | B1/B2/B3 result, summary §2. M5 race-fix까지 완료 |
| C2 | DataSourceBlock refetchInterval/derivePollingConfig | ✅ | `DataSourceBlock.tsx:53` `derivePollingConfig()` export, L143-152 useQuery에 적용 |
| C3 | iframe schema oneOf + pydantic validator | ✅ | `document.json:585-588` (oneOf), `generate-py.py:164-231` (후처리), `schemas/document.py:617-624, 649-656` (양쪽 helper에 model_validator 주입) |
| C4 | docx_export `_b_pdf` hidden marker | ✅ | `docx_export.py:1217-1225` — page≠1일 때 `⟦pdf:page={page}⟧` emit |
| C5 | video schema autoplay/controls/loop | ✅ | `document.json:600-614` — 3 boolean, defaults (false/true/false) |
| C6 | ImageAnnotationBlock callout `label` | ✅ | schema L1131-1153 (callout required: label, no text), editor `buildCallout`, view `ann.label`, BE normaliser `document_service.py:286, 352` |
| C7 | docx_export `_b_org_chart` layout marker | ✅ | `docx_export.py:799-806` — layout≠"tree"일 때 emit |
| C8 | gallery carousel marker | ✅ | `widget_markers.py:114-117` + `docx_export.py:962-970` (선존재 + 회귀 보호 테스트) |
| C9 | Heading4BlockEditor dropdown | ✅ | `Heading4BlockEditor.tsx:91-101` — select H2/H3/H4 |
| C10 | QuoteBlockEditor 신규 | ✅ | `QuoteBlockEditor.tsx:27-78` — text+cite, 600ms debounced, 빈 cite undefined 정규화 |
| C11 | glossary-ref dead code + ⚠️ | ✅ | schema에 definition 없음, `docx_export.py:1014-1025` dead branch 제거, `GlossaryRefBlock.tsx:30-38` ⚠️ + 메시지 |
| C12 | 회귀 0 (postgres flaky 무관) | ✅ | BE 138 passed / FE 1548/1548. 24 fail은 `/dev/shm` 인프라 이슈 — 알려진 사항 |
| C13 | lat / LLM rules / RAG 동기 | ✅ | `documents.md`, `export.md`, `llm-input-rules.md` ×2, RAG 131→132 chunks |
| C14 | B1/B2/B3 result + summary 보고서 | ✅ | 4 파일 모두 존재 |

## 발견된 Gap

**없음.** 14/14 통과.

## 추가 관찰 (Acceptance 통과지만 기록)

1. **DataSourceBlock M1 의미 변형** — design §3.2는 `block.refreshInterval ? *1000 : false` 였으나 구현은 `derivePollingConfig` 함수로 추출하면서 기존 60s default 폴링 의미 보존. schema default와 일관. 디자인 스펙 의미 갱신 권고 (acceptance 영향 없음).
2. **M8 dropdown 노출 정책** — design §3.2의 inline select 대신 hover/focus 시에만 노출. 시각 노이즈 회피 결정. 기능 동등.
3. **Heading4BlockEditor `meta.level` legacy 호환** — design 외 추가 기능, 정당.

## 결론

matchRate **100%** → **`/pdca report widget-integrity-pass-2`** 직행.

## 후속 권고 (Out of Scope)

1. pass-3 백로그 (Plan §1.3): spreadsheet 키보드, gantt UI, flow Mermaid, check list round-trip, image width 출처, form/quiz 기본값, spacer xl
2. IframeBlock pydantic discriminator cleanup (warning 제거)
3. race condition 보강 — B2 직렬화 또는 flag polling 길이
4. **apptainer postgres `/dev/shm` 인프라 사이클** ← 다음 진입
5. design.md의 DataSource M1 의미 표현 갱신
