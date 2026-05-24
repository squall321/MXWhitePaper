# Image Annotation Label BG — Gap Analysis

**Recommendation: PROCEED TO REPORT.** Match Rate = **100%**.

## Verification

- ✅ callout schema에 `bgColor?: string` optional 추가 (`document.json`)
- ✅ TS + Pydantic regen
- ✅ ImageAnnotationBlock.tsx callout render: `fill={ann.bgColor ?? 'white'}`
- ✅ 테스트 2 신설 (default white + override)
- ✅ 회귀 0 — web 1848/1848 + api 1014/1014 + typecheck clean
- ✅ lat documents.md ImageAnnotation entry 갱신 (의도 예외 + escape hatch)

## AC

| # | Status |
|---|:---:|
| C1 schema | ✅ |
| C2 render | ✅ |
| C3 호환 | ✅ |
| C4 테스트 2 | ✅ |
| C5 회귀 0 | ✅ |
| C6 lat | ✅ |
| C7 보고서 | 🔄 |

## Conclusion

Schema + render 만. editor UI는 후속 — raw JSON 편집 가능. **PROCEED TO REPORT**.
