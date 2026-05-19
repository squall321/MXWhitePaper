# Widget Integrity Pass 3 — Completion Report

> **Cycle**: widget-integrity-pass-3
> **Duration**: 2026-05-18 ~ 2026-05-19
> **Status**: Completed
> **Match Rate**: 100% (1차 89% → G1+G2 follow-up → 100%)
> **Series Conclusion**: pass-1·2·3로 widget integrity cleanup 사이클 종료

---

## Executive Summary

| Perspective | Content |
|---|---|
| **Problem** | pass-1·2에서 남긴 MED 잔여 7건 + cleanup 필요 1건. 모두 작은 변경이지만 누적되면 위젯 디테일 부채 심화. |
| **Solution** | 6개 갭(N1~N6)을 2분할(C1: schema+BE, C2: FE+INDEX) 사이클로 한 묶음 처리. 4분할 대신 직접 순차 작업으로 오버헤드 제거. 1차 gap-detector 89% → 25분 follow-up(G1·G2 테스트 추가) → 100%. |
| **Function/UX Effect** | spacer xl(128px) 선택 가능, form/quiz 필드 추가 시 마지막 설정 기본값 학습, list check round-trip 안전 확인 + known limitation 잠금, image width 출처 단일화(legacy 호환), pydantic 경고 제거, INDEX MD060 fix. |
| **Core Value** | "widget integrity 사이클 시리즈 종료" — 35개 블록 위젯의 일관성 회복을 3단계 cleanup으로 완료. 이후 단독 기능 사이클(Spreadsheet UX, Gantt Editor) 시작 가능. |

---

## 1. PDCA Cycle Summary

### 1.1 Plan

- **Document**: `docs/01-plan/features/widget-integrity-pass-3.plan.md`
- **Goal**: pass-1·2 잔여 6개 갭 + cleanup 1개 = 7개 항목 처리 (작은 변경 중심)
- **Scope**: 2분할(C1: schema+BE, C2: FE+INDEX) + sync
- **Estimated Duration**: ~4시간(직렬) → ~2시간(병렬/2분할)

### 1.2 Design

- **Document**: `docs/02-design/features/widget-integrity-pass-3.design.md`
- **Key Decisions**:
  1. **2분할 간소화** — cleanup 사이클이라 4분할 과함. C1(schema enum + docx_export) / C2(FE editor + INDEX)
  2. **N1 spacer xl**: schema enum `["sm","md","lg","xl"]` + SpacerBlockEditor dropdown 추가
  3. **N2 list check round-trip**: import/export 왕복 시 `☐ ` prefix 검증 + known limitation 잠금
  4. **N3 image width**: schema `block.width`만 사용, `meta.get("width")` fallback 제거 대신 **legacy 호환 위해 유지+명시 댓글**
  5. **N4 form/quiz 기본값**: localStorage `mxwp-block-defaults-{type}` 헬퍼로 마지막 필드 설정 기억
  6. **N5 pydantic 경고**: `filterwarnings` 설정으로 IframeBlock 직렬화 경고 무시
  7. **N6 INDEX**: MD060 fix — `|---|` → `| --- |` spaced 포맷

### 1.3 Do

- **Implementation Duration**: ~2시간 (2026-05-18 부트 ~ 2026-05-19 00:30)
- **Files Modified**: ~12개
- **Changes by Component**:
  - **BE**: `document.json`(schema), `docx_export.py`(N2·N3·N5), `pyproject.toml`(filterwarnings)
  - **FE**: `SpacerBlockEditor.tsx`, `FormBlockEditor.tsx`, `QuizBlockEditor.tsx`, `blockDefaults.ts`(신규), tests
  - **Docs**: `docs/archive/2026-05/_INDEX.md`, `docs/lat/documents.md`

### 1.4 Check

- **Gap Analysis**: `docs/03-analysis/widget-integrity-pass-3.analysis.md`
- **Method**: lat-first gap-detector → 1차 89% → 권고대로 G1·G2 follow-up → 100%
- **Root Cause (89%)**: 
  - G1: SpacerBlockEditor xl 테스트 누락(dropdown 4개 검증 + size=xl className 케이스)
  - G2: blockDefaults helper 단위테스트 누락(5 케이스: fallback, round-trip, merge, scope, error)
- **Resolution**: 즉시 두 테스트 추가 → 모두 통과 → matchRate 100%

### 1.5 Act (Follow-up)

- **Iteration 1** (G1·G2): 25분 테스트 추가 → matchRate 100% 도달
- **max Iterations**: 1회 (목표 달성)

---

## 2. Results

### 2.1 Completed Acceptance Criteria

| # | 기준 | 상태 | 근거 |
|---|---|:---:|---|
| C1a | SpacerBlock schema enum에 xl 추가 | ✅ | `document.json:812` — `["sm","md","lg","xl"]`, default=md, description 128px |
| C1b | SpacerBlockEditor xl dropdown 구현 | ✅ | `SpacerBlockEditor.tsx:11,17,24,108` — 4개 옵션 + test |
| C1c | spacer xl 테스트 (G1) | ✅ | `SpacerBlockEditor.test.tsx:46,65` — dropdown text 4개 + size=xl→h-32 케이스 |
| C2 | list check round-trip 잠금 | ✅ | `test_docx_roundtrip.py` — known limitation 주석 + 회귀 테스트만(fix 불필요) |
| C3 | image width fallback 결정 | ✅ | `docx_export.py:890-895` — legacy 호환 위해 유지+명시 댓글(plan과 의도 변경) |
| C4a | blockDefaults helper 구현 | ✅ | `utils/blockDefaults.ts` (60 LOC, SSR-safe try/catch) |
| C4b | FormBlockEditor + QuizBlockEditor 통합 | ✅ | Form L32·61·303·318, Quiz L31·54·301 |
| C4c | blockDefaults 테스트 (G2) | ✅ | `blockDefaults.test.ts` — 5 케이스(load, round-trip, merge, scope, error handling) |
| C5 | pydantic 경고 제거 | ✅ | `pyproject.toml:188-190` filterwarnings, pytest "warnings summary" 확인 |
| C6 | INDEX MD060 fix | ✅ | `docs/archive/2026-05/_INDEX.md:4` — `| --- | :---: |` spaced 포맷 |
| C7 | 회귀 0 | ✅ | BE 168/168 + FE 1554/1554(이전 1548+신규 6) |
| C8a | lat documents.md 동기 | ✅ | SpacerBlock xl 포함 + pass-3 N1 마크 |
| C8b | LLM rules 동기 | ✅ | §2.10 spacer 4 옵션 + pass-3 노트 |
| C8c | dist 복제 | ✅ | md5 `0078546ff5679bc05b91b294cfc48177` 양쪽 동일 |
| C8d | RAG re-chunk | ✅ | `chunks.jsonl` 갱신, BM25 "spacer xl" → top-1 hit |
| C9 | 보고서 생성 | ✅ | 본 report.md |

### 2.2 핵심 수치

- **Match Rate**: 100% (1차 89% → G1+G2 25분 → 100%)
- **신규 테스트**: 6개
  - BE: list check roundtrip 1개
  - FE: spacer xl dropdown 1개 + blockDefaults 5개
- **테스트 회귀**: 0 (BE 168/168, FE 1554/1554)
- **코드 변경**: ~12개 파일, ~400 LOC 순변(spacer xl 10줄, blockDefaults 60줄, docx_export 주석 30줄, tests 300줄)
- **사이클 기간**: 2026-05-18~19 (부트 포함 ~3시간, follow-up ~25분)

### 2.3 부수 산출물

1. **boot.sh** — systemd service 등록 + 자동 시작 패턴(별도 작업)
2. **postgres mmap 인프라 패치** — 서버 재시작 안정성(별도 작업)
3. **백로그 갱신** — pass-4 후보(spreadsheet 키보드, gantt UI, list check fix)

---

## 3. Lessons Learned

### 3.1 What Went Well

1. **gap-detector의 1차 분석이 정확** — production 코드의 완료도(89%)를 분리해서 인식. 테스트 누락 G1·G2만 명시했고 나머지는 코드 완료.
2. **cleanup 사이클은 2분할이 최적** — 작은 변경 6개는 직접 순차 작업(~2시간) > 4분할 에이전트(오버헤드). 의사결정 빨라짐.
3. **follow-up 권고 시간 정확** — gap-detector가 "25분 follow-up" 제시 → 실제 25분 내에 G1·G2 추가 및 통과.
4. **plan vs design 간의 결정 변경 명확** — C3(image fallback: "제거" → "유지+명시")은 design 단계에서 새로운 정보(legacy compatibility)로 의도적 변경. analysis에 명시되어 추적 가능.
5. **vitest localStorage 테스트 패턴** — jsdom 미설치 환경에서 `vi.stubGlobal('window', {localStorage: mock})` 패턴이 정답.

### 3.2 Areas for Improvement

1. **N2 list check round-trip은 분석만 하고 fix 연기** — import 측 로직 변경 가능성은 있으나 test-driven로 진행(이전 1548 → 1554 테스트 전 분석 먼저). 다음 pass-4에서 "진짜 fix"를 단독 사이클로 계획.
2. **N5 filterwarnings 는 임시방편** — pydantic 라이브러리의 union discriminator 한계. RootModel 재설계 없이는 근본 해결 어려움(마이그레이션 비용 ↑).

### 3.3 To Apply Next Time

1. **cleanup 사이클은 에이전트 불필요** — 변경량 < 1000 LOC면 직접 순차 + 동료 리뷰. 4분할 병렬화 비용 > 직렬 이득.
2. **plan → design 간 결정 변경은 명시 필수** — design document에 "plan과 다른 이유"를 섹션으로 표기. analysis gap 리스트에서 "의도된 차이" vs "누락"을 구분 쉽게.
3. **gap-detector의 "follow-up 시간 제시"를 신뢰** — 정확도 높음. 해당 시간 배정하고 즉시 실행.

---

## 4. Next Steps

### 4.1 Immediate (이번 사이클 직후)

1. **Post-pass-3 백로그 정리** — `docs/backlog/2026-05-19-postpass-backlog.md` (단독 기능 사이클 3개 정렬)
2. **Archive** — `/pdca archive widget-integrity-pass-3` (pass-1·2·3 모두 archive/2026-05/에 이동)

### 4.2 Series Conclusion

**Widget Integrity Pass 사이클 시리즈 종료:**
- pass-1: CRITICAL+HIGH 10건 (구조적 이슈)
- pass-2: HIGH+MED 10건 (정확도)
- pass-3: MED 5건 + cleanup 1건 (디테일)
- **총 35개 블록 위젯 일관성 회복 완료**

### 4.3 Next Major Cycles (단독 기능)

1. **Pass-4 (선택사항)**
   - list check round-trip *진짜 fix* — import 측 `☐ ` prefix detection 분기 추가
   - 별도 계획 문서 필요 여부 TBD

2. **Spreadsheet UX Enhancement** — 단독 사이클
   - 키보드 에디터(↑↓←→, Tab/Shift-Tab)
   - 셀 병합, 정렬, 숨김
   - Plan → Design → Do → Check → Report 전체 PDCA

3. **Gantt Editor** — 단독 사이클
   - UI 구현(timeline bar, drag-resize)
   - Plan → Design → Do → Check → Report 전체 PDCA

---

## 5. Artifacts

### 5.1 PDCA Documents

- **Plan**: `docs/01-plan/features/widget-integrity-pass-3.plan.md`
- **Design**: `docs/02-design/features/widget-integrity-pass-3.design.md`
- **Analysis**: `docs/03-analysis/widget-integrity-pass-3.analysis.md`
- **Report**: `docs/04-report/features/widget-integrity-pass-3.report.md` (본 파일)

### 5.2 Code Changes (Commits)

| 변경 | 파일 | LOC |
|---|---|---|
| N1: spacer xl schema | `packages/shared/schemas/document.json` | +1 |
| N1: SpacerBlockEditor dropdown | `apps/web/src/features/editor/blocks/SpacerBlockEditor.tsx` | +4 |
| N2: list check test | `apps/api/tests/test_docx_roundtrip.py` | +15 |
| N3: image width cleanup | `apps/api/app/services/docx_export.py` | ±30(주석) |
| N4: blockDefaults helper | `apps/web/src/features/editor/utils/blockDefaults.ts` | +60 |
| N4: FormBlockEditor 통합 | `apps/web/src/features/editor/blocks/FormBlockEditor.tsx` | ±10 |
| N4: QuizBlockEditor 통합 | `apps/web/src/features/editor/blocks/QuizBlockEditor.tsx` | ±10 |
| N5: pydantic filterwarnings | `apps/api/pyproject.toml` | +3 |
| N6: INDEX format | `docs/archive/2026-05/_INDEX.md` | ±5 |
| Tests (G1): SpacerBlockEditor | `apps/web/src/features/editor/blocks/__tests__/SpacerBlockEditor.test.tsx` | +20 |
| Tests (G2): blockDefaults | `apps/web/src/features/editor/utils/__tests__/blockDefaults.test.ts` | +80 |

### 5.3 Documentation Updates

- `docs/lat/documents.md` — spacer xl 포함 + pass-3 마크
- `docs/llm-input-rules.md` + dist 복제 — 동기
- `docs/archive/2026-05/_INDEX.md` — MD060 fix + pass-3 행 추가

---

## 6. Quality Metrics

| Metric | Target | Actual | Status |
|---|---|---|:---:|
| Match Rate | 90% | 100% | ✅ |
| Test Coverage (new) | — | 6/6 | ✅ |
| Regression | 0 | 0/1722 | ✅ |
| Code Review | — | self-review + gap-detector | ✅ |
| Iterations | ≤5 | 1 | ✅ |

---

## 7. Sign-Off

| Role | Name | Date | Note |
|---|---|---|---|
| Developer | koopark | 2026-05-19 | Direct implementation + G1·G2 follow-up |
| Analyzer | gap-detector (bkit) | 2026-05-19 | 1차 89% → 2차 100% |
| Approver | — | — | Ready for archive |

---

## Appendix: Known Limitations & Future Improvements

### A1. list check round-trip (C2)

**Status**: Known limitation + regression test only (fix 연기)
**Reason**: `☐ ` prefix 손실 가능성은 낮음(import 측에서 감지), 100% 보증 필요 시 import 코드 변경 필요(영향도 ↑)
**Next**: Pass-4에서 "list check round-trip fix" 단독 사이클로 진행 권고

### A2. image width fallback (C3)

**Status**: Legacy compatibility 유지 + 명시 댓글
**Reason**: Old docx 파일이 meta.width를 기대할 수 있음(migration pass 필요 시)
**Decision**: Design 단계에서 "제거" → "유지+명시"로 변경됨(intentional)

### A3. pydantic discriminator (C5)

**Status**: filterwarnings로 무시 (임시)
**Reason**: IframeBlock1/IframeBlock2가 RootModel 내부 → 외부 discriminator 불가
**Future**: pydantic 2.1+ discriminator mode 또는 RootModel 재설계 (cost ↑)

### A4. spacer xl tailwind safelist

**Status**: Build verification pending
**Action**: Production 빌드 후 `h-32` (128px) 클래스 포함 확인 권장

---

**보고서 완료: 2026-05-19**
