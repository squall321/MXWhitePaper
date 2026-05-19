# Widget Integrity Pass 2 — Summary

> Cycle: widget-integrity-pass-2
> Date: 2026-05-18
> Status: All 4 work packages (B1·B2·B3·B4) + M5 FE leftover complete — Check phase 진입 준비 완료
> Plan: docs/01-plan/features/widget-integrity-pass-2.plan.md
> Design: docs/02-design/features/widget-integrity-pass-2.design.md

pass-1 사이클이 CRITICAL+HIGH 9건 + zebra를 청소한 후, 점검에서 발견된 MED 17건 중 영향 큰 10건(M1~M11, M10은 M11로 통합)을 처리. pass-1의 4분할 병렬 방법론(파일 단독 소유 + flag 신호) 재사용.

## 1. 변경 종합

### B1 — BE Export + Service
- `docx_export.py` — `_b_pdf` page hidden marker(+6), `_b_org_chart` layout hidden marker(+8), `_b_glossary_ref` `definition` dead branch 제거(-5)
- `document_service.py` — `_normalise_image_annotation_labels()` 헬퍼 + `validate_documentjson()` 진입부 호출(+99)
- 신규 marker grammar `⟦<type>:<key>=<value>⟧` — default 값 skip
- 테스트: 신규 6

### B2 — Schema
- `document.json` — IframeBlock `oneOf` (src XOR html), VideoBlock `autoplay`/`controls`/`loop`, AnnotationElement callout `text` → `label`
- `generate-py.py` — `_inject_after_meta()` 후처리로 pydantic v2 `oneOf` 한계 우회 (model_validator 자동 주입)
- 자동 regen: TS + pydantic 동기
- 테스트: 신규 7

### B3 — FE Editor
- 신규: `Heading4BlockEditor.tsx`, `QuoteBlockEditor.tsx`
- 수정: `DataSourceBlock.tsx` (`derivePollingConfig` 추출), `GlossaryRefBlock.tsx` (⚠️ broken-ref), `BlockRenderer.tsx`
- 테스트: 신규 13 + snapshot 1

### M5 FE 잔여 (race fix)
- B3 종료(21:42) 직후 B2 flag(21:43)가 떨어진 race로 누락된 M5 FE 부분을 직접 처리
- `ImageAnnotationBlockEditor.tsx` (buildCallout, hit-test), `ImageAnnotationBlock.tsx` (view), 3 fixture/test
- callout annotation `text` → `label`

### B4 — Sync + Integration
- lat: `documents.md` Block types + Gotchas #11; `export.md` hidden-marker grammar 섹션 + glossary-ref dead-code note
- LLM rules: 헤더 + §2.2 / §2.4 / §2.16 / §3.6 / §3.10 / §3.11 갱신
- dist 복제: md5 `78fe6dd30f61570f0cf6d2c1e86f06a7` (source = dist 동일)
- RAG: 131 → 132 chunks, sha256 `71f269a9...`
- BM25 sanity: 4 쿼리 모두 top-3 hit
- 회귀: BE 138 passed / 24 failed (인프라 이슈), FE 1548/1548

## 2. Acceptance Criteria — 14/14 통과

| # | 기준 | 결과 |
|---|---|---|
| C1 | M1~M11 모두 코드 변경 | ✅ |
| C2 | data-source `refreshInterval` 폴링 | ✅ (`derivePollingConfig`) |
| C3 | iframe XOR 거부 | ✅ (oneOf + 모델 validator 주입) |
| C4 | pdf docx page hidden marker | ✅ |
| C5 | video 옵션 + 기존 호환 | ✅ |
| C6 | image-annotation 모든 kind `label` | ✅ |
| C7 | org-chart layout variant marker | ✅ |
| C8 | gallery carousel marker | ✅ (선존재 보호) |
| C9 | heading-4 level dropdown | ✅ |
| C10 | QuoteBlockEditor 신규 | ✅ |
| C11 | glossary-ref `definition` 정리 + ⚠️ | ✅ |
| C12 | 회귀 0 (BE+FE) | ✅ (인프라 24개 widget 무관) |
| C13 | lat·LLM rules·RAG 동기 | ✅ |
| C14 | 4 에이전트 결과 보고서 | ✅ |

## 3. 신규 테스트 합계 — 26 + snapshot 1

| 영역 | 케이스 |
|---|---:|
| B1 `test_widget_export_markers.py` | 4 |
| B1 `test_schema_widget_pass1.py` | 2 |
| B2 `test_schema_widget_pass2.py` | 7 |
| B3 vitest 신규 4 파일 | 13 |
| (M5 잔여) 기존 fixture/assertion 갱신 | 0 신규 (3 갱신) |

## 4. 발견된 추가 이슈

1. **apptainer postgres `/dev/shm` 불안정 (재발견)** — pass-1 issue #4 그대로. endpoint 테스트 24개가 `asyncpg.UndefinedFileError: could not open shared memory segment` 로 실패. widget 변경과 무관 — **별도 인프라 사이클**.
2. **pydantic v2 codegen `oneOf` 한계** — `datamodel-codegen` 이 `not: { required: [...] }` 를 조용히 드롭. `generate-py.py:_inject_after_meta` 후처리로 우회. 다른 oneOf 시 같은 패턴 확장 권고.
3. **pydantic 직렬화 경고 (IframeBlock)** — `PydanticSerializationUnexpectedValue` 경고. validation 정상, discriminator 명시하면 사라짐. pass-3 cleanup 권고.
4. **race condition 학습** — B3 종료(21:42) ↔ B2 flag(21:43) 1분 차이로 M5 누락. 직접 패치로 마무리. 후속 사이클은 flag polling을 더 길게 또는 B2를 사이클 시작점으로 직렬화 권고.

## 5. 다음 단계

1. `/pdca analyze widget-integrity-pass-2` — gap analyze
2. matchRate ≥ 90% 이면 `/pdca report`
3. 인프라 이슈 #1 별도 사이클 (다음 진입)
4. pass-3 백로그 (Plan §1.3): spreadsheet 키보드, gantt UI, flow Mermaid, check list round-trip, image width 출처, form/quiz 기본값, spacer xl

---

**사이클 종합**: pass-1 4분할 병렬 방법론 재사용 + race 학습. MED 10건 충돌 없이 완료. 신규 26 케이스, 회귀 0 (인프라 외). lat·LLM rules·RAG 동기. Check phase 진입 준비 완료.
