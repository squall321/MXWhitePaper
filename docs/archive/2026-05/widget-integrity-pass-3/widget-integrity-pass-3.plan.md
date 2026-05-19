# Widget Integrity Pass 3 — Planning Document

> **Summary**: pass-1·2 cleanup의 마무리 — MED 잔여 중 *작은* 5건 + 사이클 자체 cleanup 1건을
> 한 묶음으로 처리. 큰 작업(spreadsheet 키보드 에디터, gantt UI)은 별도 단독 사이클로 분리.
>
> **Project**: MX White Paper
> **Feature**: widget-integrity-pass-3
> **Version**: 0.1.0
> **Date**: 2026-05-18
> **Status**: Draft
> **Previous**: [pass-1](../../archive/2026-05/widget-integrity-pass-1/), [pass-2](../../archive/2026-05/widget-integrity-pass-2/)

---

## Executive Summary

| Perspective | Content |
|---|---|
| **Problem** | pass-1·2가 CRITICAL+HIGH+MED 10건씩 청소했으나 MED 잔여 7건 + pass-2 발견 cleanup 1건이 남음. 모두 *작은 변경*이지만 누적되면 디테일 부채. |
| **Solution** | 작은 5건 + cleanup 1건만 묶어 한 사이클로 (총 ~3시간). 큰 2건은 별도 사이클로 분리. 사이클 자체는 4분할 병렬 패턴 사용하지만 *변경 영역이 작아* 2분할로 간소화 가능. |
| **Function/UX Effect** | spacer xl=128px 선택 가능, list check style round-trip 안정화, image width 출처 일관, form/quiz 기본값 사용자 선호 저장, iframe pydantic 경고 제거. |
| **Core Value** | "디테일 부채 청산 완료" — 35블록 위젯의 일관성 회복을 한 호흡으로 마무리. pass-4부터는 *기능 추가* 중심으로 갈 수 있게. |

---

## 1. Overview

### 1.1 Purpose

pass-1·2의 cleanup 사이클들이 남긴 작은 잔여 항목을 한 데 묶어 처리. 위젯 신뢰성 사이클의 종착점.

### 1.2 본 사이클 처리 갭 (6건)

| # | 갭 | 출처 | 작업량 |
|---|---|---|---|
| N1 | **spacer** xl=128px schema enum 확장 + SpacerBlockEditor dropdown에 xl 추가 | pass-1 B3 결정 | 5분 + 5분 |
| N2 | **list check style** round-trip 안정화 — `☐ ` prefix 손실 위험 점검 + 회귀 테스트 | A2 | 1시간 |
| N3 | **image width 출처 통일** — schema는 `block.width` 만 있음. docx_export의 `meta.get("width")` fallback 시도 죽은 코드 정리 | A3 + pass-1 B1 | 30분 |
| N4 | **form/quiz 기본값 학습** — 사용자가 자주 쓰는 옵션 (예: required=true) 을 localStorage에 기억 → 다음 필드 추가 시 기본 적용 | A4 | 1~2시간 |
| N5 | **IframeBlock pydantic discriminator** — 직렬화 시 `PydanticSerializationUnexpectedValue` 경고. RootModel에 discriminator 추가 | pass-2 발견 | 30분 |
| N6 | **archive `_INDEX.md` markdownlint MD060** — 표 compact 스타일 통일 (전체 재포맷 1회) | pass-2 발견 | 10분 |

총 작업량 추정: ~4시간 (직렬 시), ~2시간 (병렬 시).

### 1.3 본 사이클 *제외* 항목 (단독 사이클)

| 갭 | 사유 |
|---|---|
| spreadsheet 전용 키보드 에디터 (반나절~하루) | 단독 사이클 — "Spreadsheet UX 강화" |
| gantt 에디터 UI (하루) | 단독 사이클 — "Gantt Editor" |
| flow Mermaid 시각 에디터 (반나절) | 단독 사이클 또는 LOW로 |

### 1.4 Decisions (확정)

| # | 결정 | 값 |
|---|---|---|
| 1 | 작업 분할 | **2분할**로 간소화 — C1: schema + BE (N1 schema, N2 분석, N3 fallback 제거, N5 pydantic) / C2: FE editor (N1 dropdown, N4 form/quiz, N6 INDEX 포맷). cleanup 사이클이라 4분할 과함 |
| 2 | N4 form/quiz 기본값 저장 위치 | **localStorage** — 사용자별 단순. 백엔드 상태 불필요. key: `mxwp-block-defaults-{type}` |
| 3 | N4 학습 범위 | 마지막에 사용된 필드 설정만 기억 (예: form field의 `required`, `kind`, quiz의 `type`) — 옵션 전체 학습은 과함 |
| 4 | N5 discriminator 방식 | IframeBlock1/IframeBlock2 가 RootModel 안에 있어 외부 discriminator 불가. **경고 무시 환경설정** (filterwarnings) 또는 *Field(discriminator=...)* 추가. design에서 확정 |
| 5 | N6 INDEX 포맷 | compact (`\| col \|`) → spaced (`\| col \|`). 모든 행 동일 패턴, 다른 archive INDEX 들과 일관성 유지하지 않아도 됨 (이 파일만) |
| 6 | N1 xl=128px | sm/md/lg/xl 4단으로 통일 (pass-1 B3가 design에 명시했지만 schema enum 부재로 미반영했던 그것) |
| 7 | N2 check round-trip | 코드 분석 → 손실 가능성 확정되면 fix, 아니면 *회귀 테스트만 추가하고 안전 확인* |
| 8 | N3 image width fallback | docx_export에서 `meta.get("width")` 시도 코드 *완전 제거*. schema가 `block.width`만 있다는 진실 단일화 |
| 9 | matchRate 기준 | 90% 이상 |
| 10 | 사이클 후 추가 사이클 | pass-3 끝나면 widget integrity 사이클 시리즈는 *종료*. 이후 단독 사이클 (Spreadsheet UX, Gantt Editor)로 |

### 1.5 Acceptance Criteria

1. **C1**: spacer schema enum에 `xl` 포함, SpacerBlockEditor dropdown에 4단
2. **C2**: list check style round-trip 안전 — `☐ ` import/export 왕복 시 손실 없음 (테스트로 확인)
3. **C3**: docx_export에서 `meta.get("width")` 시도 코드 제거됨
4. **C4**: form/quiz 필드 추가 시 마지막 설정이 기본값으로 적용 (localStorage)
5. **C5**: IframeBlock 직렬화 경고 사라짐 (pytest -W error::Warning 통과)
6. **C6**: archive `_INDEX.md` markdownlint 경고 0
7. **C7**: 회귀 0 (BE + FE 테스트 통과)
8. **C8**: lat / LLM rules / RAG 동기화
9. **C9**: 2 에이전트 결과 보고서 생성

---

## 2. 2분할 작업 (간소화)

### C1 — Schema + BE
**소유**: `packages/shared/schemas/document.json`, `apps/api/app/schemas/document.py` (필요 시), `apps/api/app/services/docx_export.py`

- N1 schema: SpacerBlock size enum에 `xl` 추가
- N2: docx_export `_b_list`의 check 분기 분석 + 회귀 테스트
- N3: docx_export `_b_image`의 `meta.get("width")` 시도 제거
- N5: pydantic IframeBlock discriminator 또는 경고 필터링

### C2 — FE + INDEX
**소유**: `SpacerBlockEditor.tsx`, FormBlockEditor + QuizBlockEditor (localStorage), `docs/archive/2026-05/_INDEX.md`

- N1: dropdown에 xl 옵션 추가 (B2 schema 완료 후)
- N4: form/quiz 기본값 localStorage 학습
- N6: INDEX.md 포맷 통일

### S (sync) — 코드 변경 후
- lat 갱신 (spacer xl, image width 단일 출처)
- LLM rules 갱신
- RAG re-chunk
- 통합 회귀
- summary 보고서

---

## 3. 다음 단계

`/pdca design widget-integrity-pass-3` — 2분할 작업 명세서 + design 단계에서 N5 discriminator 결정 확정.
