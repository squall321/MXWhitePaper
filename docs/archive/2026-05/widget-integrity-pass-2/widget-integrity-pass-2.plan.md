# Widget Integrity Pass 2 — Planning Document

> **Summary**: pass-1에서 CRITICAL+HIGH 9건 + zebra를 처리했고, 점검에서 나온 **MED 우선순위 17건** 중 10건을 본 사이클에 묶는다. 나머지 7건과 LOW는 백로그. 같은 4분할 병렬 방법론을 그대로 재사용 (pass-1에서 검증됨).
>
> **Project**: MX White Paper
> **Feature**: widget-integrity-pass-2
> **Version**: 0.1.0
> **Date**: 2026-05-18
> **Status**: Draft
> **Previous**: [widget-integrity-pass-1](../../archive/2026-05/widget-integrity-pass-1/) (matchRate 100%)

---

## Executive Summary

| Perspective | Content |
|-------------|---------|
| **Problem** | pass-1이 CRITICAL+HIGH를 청소했지만 점검(Explore ×4)이 발견한 **MED 우선순위 17건**이 남아있음. *옵션은 있는데 작동 안 함*, *편집 UI 부재*, *export round-trip 일부 옵션 손실*, *schema의 죽은 필드* 등 사용자 편의성 손실이 누적. |
| **Solution** | pass-1의 4분할 병렬 방법론(파일 단독 소유 + flag 신호) 재사용. MED 17건 중 *작업량 작고 영향 큰* 10건 골라 한 사이클로. 나머지 7건은 pass-3 백로그. |
| **Function/UX Effect** | data-source가 사용자가 설정한 refreshInterval대로 폴링. heading-4 level 드롭다운, quote 전용 editor 등장. iframe XOR 검증이 schema에서 됨. pdf page 정보 docx에서 보존. video autoplay/controls 옵션. annotation 라벨 일관. gallery carousel, org-chart layout, image width 출처 명확화. glossary-ref schema 죽은 필드 정리. |
| **Core Value** | "위젯이 한 약속을 지킨다" pass-2 — pass-1이 임계점 픽스였다면 본 사이클은 *디테일을 깎아내는* 사이클. 사용자가 "이게 왜 안 되지" 라고 의문 가지는 횟수를 한 단계 더 줄임. |

---

## 1. Overview

### 1.1 Purpose

pass-1 점검(`docs/archive/2026-05/widget-integrity-pass-1/widget-audit/A1-A4-*.md`)에서 MED로 분류된 17건 중 작업량 작고 영향 큰 10건 처리. 점검은 *이미 했고 사실 확인됨* 이라 점검 단계 스킵 — 바로 Plan→Design→Do.

### 1.2 본 사이클 처리 갭 (MED 17건 중 선택된 10건)

| # | 갭 | 출처 | 작업량 |
|---|---|---|---|
| M1 | data-source `refreshInterval` 동작화 — `staleTime` 하드코딩 제거 | A1 | 30분 |
| M2 | iframe src/html XOR 검증 schema 차원으로 (oneOf) | A3 | 30분 |
| M3 | pdf docx export에서 page 정보 보존 (hidden marker) | A3 | 30분 |
| M4 | video schema에 `autoplay`/`controls`/`loop` 추가 | A3 | 30분 |
| M5 | annotation 라벨 필드 일관성 (arrow/rect=label, callout=text → 통일) | A3 | 30분 |
| M6 | org-chart docx export에서 `layout` 옵션 보존 | A3 | 30분 |
| M7 | gallery carousel hidden marker variant 인코딩 | A3 | 30분 |
| M8 | heading-4 UI level 드롭다운 (schema는 [2,3,4] 지원하는데 UI 고정) | A2 | 30분 |
| M9 | quote 전용 BlockEditor 추가 (cite 필드 + 검증) | A2 | 30분 |
| M10 | glossary-ref schema의 죽은 `definition` 처리 + broken-ref 시각화 | A2 | 1시간 |

총 작업량 추정: 5~6시간 (병렬 ~2시간).

### 1.3 본 사이클 *제외* 항목 (pass-3 백로그)

| # | 갭 | 이유 |
|---|---|---|
| - | spreadsheet 전용 키보드/엑셀-paste 에디터 (반나절) | 단독 사이클 (Spreadsheet UX 강화) 필요 |
| - | gantt 에디터 UI (하루) | 큰 작업 |
| - | flow Mermaid 시각 에디터 (반나절) | 별도 |
| - | check list round-trip 보장 (1시간) | list 깊이 인코딩 재설계와 연결, 별도 |
| - | image width meta vs block 출처 통일 | M4 schema 작업과 충돌 가능, 신중히 |
| - | form/quiz 기본값 학습 | UX 개선 — 사용자 가치 명확화 후 |
| - | spacer xl=128 schema 확장 | 매우 작아서 pass-3에 묶음 |

### 1.4 Decisions (확정)

| # | 결정 | 값 |
|---|---|---|
| 1 | 점검 재수행 여부 | **불필요**. pass-1 점검 결과(`A1-A4-*.md`)를 그대로 출처로 사용 |
| 2 | 작업 분할 방식 | pass-1과 동일 — 4분할 + 파일 단독 소유 + flag 신호 |
| 3 | 4분할 매핑 (변경) | B1: BE export 4파일 + BE schema service / B2: schema + 정규화 / B3: FE editor / B4: lat+LLM+RAG+테스트 |
| 4 | annotation 라벨 필드 통일 방향 (M5) | **`label`로 통일** — schema 변경 + BE/FE 동시. callout의 `text` deprecate, 호환성 위해 양쪽 읽되 `label`로 정규화 |
| 5 | iframe XOR (M2) | JSON Schema `oneOf` 사용. pydantic v2에서 `oneOf` 지원되는지 확인 후 결정 (안 되면 validator 함수) |
| 6 | video 옵션 기본값 (M4) | `autoplay: false`, `controls: true`, `loop: false` (HTML5 표준 안전 기본값) |
| 7 | heading-4 UI 옵션 (M8) | dropdown — 2/3/4. 기본 4 (현재 schema default와 일치) |
| 8 | quote editor (M9) | text(textarea) + cite(input). 최소 구현 — pass-1 spacer editor 패턴 그대로 |
| 9 | glossary-ref definition (M10) | schema에서 `definition` 필드 *제거* (죽은 코드). docx_export L996의 `block.get("definition")` 정리. broken-ref 시각화는 별도 — UI에 ⚠️ 아이콘만 추가 |
| 10 | 마이그레이션 | 없음. M5(annotation label 통일)는 read-side 정규화로 처리 |
| 11 | matchRate 기준 | 90% 이상 |
| 12 | A2 audit의 callout 오보 (pass-1에서 발견) | pass-1 archive 안에 있고 정정 권고만 남기고 *수정하지 않음* (역사 보존) |

### 1.5 Acceptance Criteria

1. **C1**: M1~M10 모두 코드 변경 들어감
2. **C2**: data-source의 `refreshInterval` 슬라이더 값대로 polling 동작 (E2E 또는 단위테스트)
3. **C3**: iframe schema가 src·html 둘 다 없거나 둘 다 있는 입력을 *schema 단계에서* 거부 (oneOf)
4. **C4**: pdf docx export에 page 정보 hidden marker로 보존
5. **C5**: video schema에 autoplay/controls/loop 추가, 기존 문서 호환
6. **C6**: image-annotation의 모든 kind(arrow/rect/callout)가 `label` 필드 사용
7. **C7**: org-chart docx export marker에 layout variant 인코딩
8. **C8**: gallery docx export marker에 layout=carousel variant 인코딩
9. **C9**: heading-4 편집 UI에 level 드롭다운 (2/3/4)
10. **C10**: QuoteBlockEditor 신규 — text+cite 입력
11. **C11**: glossary-ref schema에서 `definition` 제거 (정리), docx export의 죽은 코드 제거. broken-ref 시각화 (⚠️ 아이콘)
12. **C12**: 회귀 0 (BE + FE 테스트 통과)
13. **C13**: lat·LLM rules·RAG 동기
14. **C14**: 4 에이전트 결과 보고서 생성

---

## 2. 4분할 — pass-1 패턴 그대로

| 에이전트 | 담당 갭 | 소유 파일 |
|---|---|---|
| **B1** (BE export + service) | M1 refreshInterval (BE 측 polling 헬퍼가 있으면), M3 pdf docx page marker, M4 video schema FE 측은 제외, M5 annotation 라벨 BE 정규화, M6 org-chart docx layout marker, M7 gallery docx layout marker, M11 glossary-ref docx_export 죽은 코드 제거 | docx_export.py, html_renderer.py, pptx_export.py, markdown_export.py |
| **B2** (schema + FE FE editor 일부) | M2 iframe oneOf, M4 video 옵션 schema, M5 annotation label schema, M11 glossary-ref schema 정리 | document.json, 자동 regen된 TS + pydantic |
| **B3** (FE editor) | M1 DataSourceBlock useQuery 수정, M8 heading-4 dropdown, M9 QuoteBlockEditor 신규, M11 glossary-ref broken-ref ⚠️ 아이콘, M5 ImageAnnotationBlockEditor 라벨 통일 | features/editor/blocks/{DataSourceBlock*, Heading4BlockEditor*, QuoteBlockEditor 신규, GlossaryRefBlock*, ImageAnnotationBlockEditor.tsx} |
| **B4** (sync + 통합) | B1~B3 완료 후 lat·LLM rules·RAG 동기 + 통합 회귀 + summary | docs/lat/*, llm-input-rules.md (×2), RAG |

의존성: pass-1과 동일 — B2 schema가 우선 (flag로 신호), B1·B3는 다른 작업 먼저 시작.

---

## 3. 다음 단계

`/pdca design widget-integrity-pass-2` — 각 갭의 정확한 파일·라인·diff 단위 명세 작성 + 4 에이전트 prompt 뼈대.
