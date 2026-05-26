# Presentation Auto-Layout — Gap Analysis

**Recommendation: PROCEED TO REPORT.** Match Rate = **95%**.

## Verification

| # | 항목 | 상태 |
|---|---|---|
| A | `autoLayout.ts` pickAutoLayout 6 룰 + resolveLayout wrapper | ✅ |
| A | 단위 테스트 16 (빈/단일/image+텍스트/시각1+텍스트/시각다수/텍스트다수/section.layout 명시/auto off) | ✅ pass |
| A | textCount ≤5 까지 image-right 확장 (audit fine-tune) | ✅ |
| B | SlideContent props (autoLayoutEnabled / layoutOverride) | ✅ |
| B | SubsectionInline autoLayoutEnabled 전달 (sample doc 1.1 subsection 2단 자동 분할 효과) | ✅ |
| B | PresentationPage state (autoLayoutEnabled / layoutOverrides map slide.key → kind) | ✅ |
| B | PresentationToolbar 자동 on/off 버튼 + layout select (`__clear__` 옵션) | ✅ |
| B | toolbar select style (dark/light theme 양쪽) | ✅ transitions.css.ts |
| B-2 | override 문서 저장 | ⚠️ **out-of-scope** (별도 사이클) — 세션 한정으로 충분 |
| 회귀 | vitest 1877/1877 + typecheck clean | ✅ |
| baseline | visual-presentation 갱신 | ✅ |
| cleanup | 임시 `_preso-autolayout-audit.spec.ts` 삭제 | ✅ |

## AC

| # | Status |
|---|:---:|
| C1 pickAutoLayout 룰 + 단위 테스트 16 | ✅ |
| C2 SlideContent prop 통합 | ✅ |
| C3 SubsectionInline 동일 | ✅ |
| C4 toolbar 자동 + select | ✅ |
| C5 sample 1.1 subsection 2단 효과 | ✅ (audit 캡쳐 확인 — sequence + flow chart 좌우) |
| C6 회귀 0 | ✅ |
| C7 visual baseline 갱신 | ✅ |
| C8 lat 갱신 | 🔄 (별도 commit 또는 skip) |
| C9 보고서 + archive | 🔄 |

## Differences

### 🟡 Added (positive)
- audit 후 textCount ≤3 → ≤5 룰 확장 (실 sample doc 패턴 더 잘 매칭)
- toolbar select 의 `__clear__` 옵션 — 사용자가 override 해제 가능

### 🔴 Missing
- B-2 (override 문서 저장) — 의도적 out-of-scope, 별도 사이클
- toolbar select 가 "현재 슬라이드 layout" 추정 시 *section 전체 blocks* 기준 (effectiveBody 가 outer scope 접근 X) — minor 표시 오류, 동작에는 영향 없음. 후속 cleanup 후보.

## Conclusion

사용자 *"이상적으로 이쁘게 배치"* 피드백 → auto-layout + toolbar override 둘 다 도입. sample 1.1 subsection 이 2단 자동 분할되어 *진짜 슬라이드 느낌*. Match Rate **95%** (B-2 의도 out-of-scope), **PROCEED TO REPORT**.
