# Gantt Darkmode — Design-Implementation Gap Analysis

**Recommendation: PROCEED TO REPORT.** Match Rate = **100%** (≥ 90% threshold).

---

## Analysis Overview

| Field | Value |
|---|---|
| Feature | `gantt-darkmode` |
| Plan | `docs/01-plan/features/gantt-darkmode.plan.md` |
| Design | `docs/02-design/features/gantt-darkmode.design.md` |
| Implementation | commit `46a2b4b` on `main` |
| Date | 2026-05-24 |

## Overall Scores

| Category | Score | Status |
|---|:---:|:---:|
| Design Match (sections 1–7) | 100% | ✅ |
| Acceptance Criteria (C1–C9) | 100% (9/9) | ✅ |
| Convention | 100% | ✅ |
| **Overall** | **100%** | ✅ |

## Section Verification

### §2 GanttBlock.tsx

- 5 SVG hex → `var(--smsg-...)` 모두 완료 (GanttBlock.tsx 의 fill/stroke 5곳):
  - `#F9FAFB` → `var(--smsg-gray-050)` ✅
  - `#E5E7EB` → `var(--smsg-gray-200)` ✅
  - `#1A1A1A` → `var(--smsg-gray-900)` ✅
  - `#2E5BFF` → `var(--smsg-blue-500)` ✅
  - `#1428A0` → `var(--smsg-blue-700)` ✅
- figure className: `dark:border-gray-700 dark:bg-gray-900` 추가 ✅

### §3 zebra.ts 주석

`STRIPE_CLASSES['gantt']` 주석이 `var(--smsg-gray-050)` 토큰 참조로 갱신됨. ✅

### §4 테스트

| 파일 | Design | 실제 | 상태 |
|---|---|---|---|
| `GanttBlock.darkmode.test.tsx` | NEW 1 케이스 | NEW 2 케이스 (5 토큰 검증 + dark className 검증) | ✅ over-spec'd |
| `GanttBlock.zebra.test.tsx` | EDIT fixture | EDIT 2곳 (toContain + notContain 양쪽 hex→var) | ✅ |
| AllBlocksRender snapshot | 1 update | 1 updated | ✅ |

Test results: web vitest **229/229 파일 1828/1828 테스트** 통과, typecheck clean.

### §6 lat

`docs/lat/documents.md` GanttBlock entry에 darkmode 한 줄 + figure 다크 변형 명시. ✅

## Acceptance Criteria

| # | Criterion | Status |
|---|---|:---:|
| C1 | SVG 5 hex 모두 토큰 교체 | ✅ |
| C2 | figure 배경/테두리 토큰 | ✅ |
| C3 | 라이트 시각 변화 0 | ✅ (light 토큰 = 기존 hex) |
| C4 | 다크 자동 렌더 | ✅ (CSS var 자동 해석) |
| C5 | 회귀 0 | ✅ |
| C6 | 시각 회귀 테스트 1 | ✅ (실제 2 케이스) |
| C7 | snapshot 1 update | ✅ |
| C8 | lat 갱신 | ✅ |
| C9 | analysis + report + archive | 🔄 (analysis = 본 문서) |

## Differences

### 🔴 Missing
None.

### 🟡 Added
- darkmode 테스트 1 → 2 케이스 (over-spec'd: 토큰 + className 분리)

### 🔵 Changed
None of substance.

## Conclusion

Plan + Design 그대로 구현. 토큰 매핑 사전 검증으로 시각 회귀 0. Match Rate **100%**, recommendation **PROCEED TO REPORT**.
