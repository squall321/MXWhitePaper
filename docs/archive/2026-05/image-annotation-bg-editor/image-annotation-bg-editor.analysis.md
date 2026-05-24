# Image Annotation BG Editor — Gap Analysis

**Recommendation: PROCEED TO REPORT.** Match Rate = **100%**.

## Verification

- ✅ `buildCallout(pos, text, color, bgColor?)` 시그니처 확장 (optional 4번째 인자)
- ✅ undefined 시 spread `...(bgColor ? { bgColor } : {})` — schema 키 미저장
- ✅ `calloutBgColor` useState (undefined default)
- ✅ buildCallout 호출처에 `calloutBgColor` 전달
- ✅ toolbar에 callout 도구 활성화 시만 보이는 swatch 그룹 + `<CalloutBgSwatch>` 헬퍼 컴포넌트
- ✅ 3 swatch — default(undefined → 흰색 dashed border) / `#111827` 다크 / `#fef3c7` 강조 노랑
- ✅ `data-callout-bg` attribute (테스트 anchor)
- ✅ 단위 테스트 2 신설 (호환 + bgColor 저장)
- ✅ 회귀 0 — web 1852/1852 + typecheck clean
- ✅ lat documents.md 갱신

## AC

| # | Status |
|---|:---:|
| C1 callout 시 swatch 노출 | ✅ |
| C2 그 외 도구 미노출 | ✅ (`tool === 'callout'` gate) |
| C3 swatch 클릭 state 갱신 | ✅ |
| C4 state 전달 | ✅ |
| C5 undefined 시 미저장 | ✅ |
| C6 명시 색 시 저장 | ✅ |
| C7 단위 테스트 2 | ✅ |
| C8 lat 갱신 | ✅ |
| C9 회귀 0 | ✅ |
| C10 보고서 | 🔄 |

## Conclusion

image-annotation-label-bg 사이클의 "editor UI 후속" 약속 완수. schema → render → UI 3단계 완성. **PROCEED TO REPORT**.
