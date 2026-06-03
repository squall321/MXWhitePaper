# g4-defer-quad — Completion Report

## Executive Summary
| | |
|---|---|
| **Feature** | G4 — defer quad (chunker viewer-guide / TableBlock boundSlicers / TimelineBlock / EN viewer guide) |
| **Completion** | 2026-06-03 |
| **Match Rate** | 100% |

### Value Delivered

| Perspective | Outcome |
|---|---|
| Problem | G1~G3 cycle 종료 시 4 개 defer 항목 누적: (1) viewer-guide 가 RAG 검색에서 누락, (2) cross-widget slicer 가 Pivot 전용, (3) 날짜 range filter 부재, (4) 외부 영문 LLM 이 viewer 가이드 인용 불가 |
| Solution | 4 트랙 한 번에 처리. chunker source list 확장 / TableBlock.boundSlicers / TimelineBlock 신규 (38번째 block) + engine `between` op / `docs/llm-viewer-guide.en.md` 영문 번역 |
| Function/UX | Pivot · Table 둘 다 sidekick slicer/timeline 으로 라이브 필터링. 영문 LLM 도 viewer 가이드를 인용. RAG 답변이 사용자 가이드를 cite |
| Core Value | cross-widget filter coordination 완결 (slicer + timeline 통합 store) + 사용자 가이드 inbound/outbound 양방향 |

## Track 별 변경

### Track 1 — chunker source list 확장
- `dist/llm-docx-toolkit/rag/_lock.py` — TRACKED_SOURCES 에 `docs/llm-viewer-guide.md` 추가
- `dist/llm-docx-toolkit/rag/chunker.py` — `_chunks_from_viewer_guide()` 신규 (H2 walker, `_chunks_from_system_prompt` 패턴 미러), `build_chunks()` 에 wiring, by-source 출력 라인 추가
- `chunks.jsonl` / `index.lock` — 15 chunks 신규 (source="llm-viewer-guide.md", section="viewer"). 총 145→160 chunks
- 결과: RAG 검색이 "ULID 8자 인용", "PivotTable 읽기 6단계" 같은 viewer 질문을 답변 가능

### Track 2 — TableBlock.boundSlicers
- `packages/shared/schemas/document.json` — TableBlock 에 `boundSlicers?: Ulid[]` 추가. description 에 sparse 모드 skip 명시
- `apps/web/src/components/blocks/TableBlock.tsx` — `slicerFilters` / `timelineFilters` (Track 3 와 통합) 단계 추가, 헤더 이름 = field 1:1 매핑
- `apps/web/src/components/blocks/PivotTableBlock.tsx` — `collectSlicerFilters` 시그니처 generic 화 (Pivot block → `boundSlicers: ReadonlyArray<string>`)
- `apps/web/src/features/editor/blocks/PivotTableBlockEditor.tsx` — `BoundSlicersPicker` generic `<B extends {boundSlicers?}>` 로 변환 + export, testIdPrefix prop 추가
- `apps/web/src/features/editor/blocks/TableBlockEditor.tsx` — sparse / flat 두 모드 모두 BoundSlicersPicker 호출
- Chart / KpiCards 는 source ref 가 없어 deferred (scout 권고). KpiCardsBlock 은 `items[]` 전체가 데이터 모델이라 별도 schema 결정 필요

### Track 3 — TimelineBlock 신규 (38번째 block)
- `packages/shared/schemas/document.json` — TimelineBlock 정의 (label / field / source(inline|data-source) / min / max / default[2]), Block union 에 추가. FilterSpec 의 `op` enum 에 `"between"` 추가
- `apps/web/src/components/blocks/TimelineBlock.tsx` — 두 range slider (`from` / `to`), `useSlicerStore` 공유 (id → `[isoFrom, isoTo]`), 도메인 자동 추론 (rows[field] 의 min/max)
- `collectTimelineFilters()` — `{field, op:'between', value:[lo, hi]}` 로 변환. `collectSlicerFilters` 와 shape 호환되어 concat 가능
- `apps/web/src/components/blocks/pivotEngine.ts` — `applyFilters` 에 `between` 케이스 (numeric coercion 양쪽 가능 시 수치 비교, 아니면 문자열 비교 — ISO date 양쪽 지원)
- `apps/web/src/features/editor/blocks/TimelineBlockEditor.tsx` — Slicer Editor 패턴 미러 (label/field/min/max/source)
- `apps/web/src/components/blocks/BlockRenderer.tsx` — viewer + lazy editor 등록
- `apps/web/src/features/editor/components/BlockInsertPalette.tsx` — 📅 `/타임라인` 엔트리
- PivotTable + Table viewer 모두 slicer + timeline 동시 적용

### Track 4 — 영문 viewer 가이드
- `docs/llm-viewer-guide.en.md` 신규 — 9 챕터 1:1 영문 번역
- 보존: JSON skeleton, ULID 예시, citation 패턴 (§number / [<8자>] / pivot:[…] / quote@§…), verbatim 유지
- 톤 매치: imperative ("Cite…", "Don't…"), em-dash 보존, 친절-말투 제거

## 테스트
- vitest **2454/2454** pass (이전 2436 + Timeline 6 + between 3 + 기존 회귀 보존)
- pytest API 전수 pass (background, exit 0)
- typecheck clean (TimelineBlock active.length===2 narrowing + between 캐스트 처리)
- chunker `--check` exit 0 (lock vs live hash 일치)

## 핵심 설계 결정

### 1. boundSlicers 시그니처 generic 화
`collectSlicerFilters(block: PivotTableBlock, …)` → `collectSlicerFilters(boundSlicers: ReadonlyArray<string> | undefined, …)`. 두 widget 공유 (Table / Pivot) + 미래 widget (Chart 등) 대응. host-aware 호출만 변경.

### 2. Timeline 이 Slicer 와 같은 store 공유
별도 `useTimelineStore` 만들지 않고 `useSlicerStore` 의 `Record<id, string[]>` 에 `[isoFrom, isoTo]` 2-원소 배열로 저장. 이유: (a) `boundSlicers` picker 가 type-agnostic 으로 슬라이서/타임라인 둘 다 binding, (b) viewer 가 한 번의 store subscription 으로 두 filter 종류 모두 감지, (c) store 의 zustand shallow-compare 가 그대로 작동.

분리는 collector 레벨에서 — `collectSlicerFilters` 는 `type === 'slicer'` 만, `collectTimelineFilters` 는 `type === 'timeline'` 만 resolve. type-tag 가 분리하므로 store 가 통합되어도 안전.

### 3. engine `between` op
`gte` + `lte` 두 개 합성 대신 단일 op. value 가 `[lo, hi]` 2-tuple. numeric 양쪽 coerce 가능 시 수치 비교 (timeline 외 범용), 아니면 문자열 비교 (ISO date 의 lexical compare 가 시간순과 일치). out-of-shape 값은 no-op 처리.

### 4. Chart / KpiCards deferred
Scout report 결론: chart 는 `series.values[i]` 가 raw provenance 없는 opaque scalar 라 boundSlicers 만 추가해서는 무의미 — `source: { kind, dataSourceId, labelField }` 같은 schema 확장이 선행되어야. KpiCards 는 `items[]` 가 데이터 모델 그 자체 — `compute: { field, agg, when }` 같은 derivation 룰을 schema 에 도입해야. 둘 다 별도 cycle.

### 5. EN guide 의 톤 매치
원본은 "engineer-to-engineer instruction manual" 톤. 영문도 imperative 유지, hedging 제거. 한국어 "bold-with-spaces" (`**X** 는 **Y** 로`) 는 EN bold + 공백 제거 (`**X** must be read **as Y**`).

## Gotcha / 회피

1. **TypeScript strict mode**: `active.length === 2 ? active : […]` 가 destructure 후 `string | undefined` 로 narrowing 안됨. `active[0] ?? domain.min` 명시 fallback 으로 해결
2. **commitlint subject-case**: 한국어 영문 혼용 제목에서 영문 첫 글자 대문자가 자동으로 sentence-case 분류. 강제 소문자 시작
3. **pre-commit RAG drift hook**: schema staged 인데 chunks.jsonl 미반영 시 fail. 4 트랙 하나의 commit 으로 통합 (분리 불가)
4. **schema codegen drift hook**: `apps/web/src/types/document.ts` 와 `apps/api/app/schemas/document.py` 미 staging 상태로 다른 파일만 commit 시도 시 fail. workspace 전수 staging 필요

## Defer / 후속

- **Chart boundSlicers** — schema 확장 (source ref + labelField) + aggregation pipeline 분리 (`pivotEngine.applyAggregation` 의 widget 외 사용) 후 가능
- **KpiCards boundSlicers** — schema 에 `items[i].compute` 추가 + viewer hook 으로 store 구독 → 재계산. 더 큰 작업
- **Timeline default** schema 에 `[isoFrom, isoTo]` 적었지만 viewer 초기 hydration 에서 setActive 호출은 미구현 (현재 비어 있으면 = All). 다음 cycle 에서 hydration mount 시점 처리
- **Cross-locale palette i18n** — `palette.timeline` key 만 추가, ko/en/ja/zh resource bundle 매핑 미연결. fallback label 동작 OK
- **Sample doc** — `packages/shared/samples/` 에 Timeline + boundSlicers 예제 추가하면 docgen / 가이드에서 인용 가능

## 누적

| Cycle | commit | 핵심 |
|---|---|---|
| G1 (Pivot DataSource ref) | a8e7d68 | source: oneOf(inline\|csv\|data-source) |
| G2 (SlicerBlock + boundSlicers) | 9d1d673 | useSlicerStore + cross-widget filter |
| G3 (LLM viewer 가이드) | f45c5b8 | docs/llm-viewer-guide.md (한) |
| **G4 (defer quad)** | b069cfe | chunker + Table boundSlicers + Timeline + EN guide |
