---
template: report
version: 1.0
feature: svg-block-audit
date: 2026-05-24
---

# SVG Block Audit — Completion Report

> Cycle: Plan → Audit (Do) → Check → Report → Archive
> Match Rate: 100%
> Output: 0 code change, 1 lat documentation

---

## 1. Executive Summary

### 1.1 Overview

| 항목 | 값 |
|---|---|
| Duration | ~20분 |
| Files | 1 lat doc updated, 3 PDCA docs created |
| Code change | **0건** |
| Match Rate | **100%** |

### 1.2 Value Delivered

| Perspective | Content |
|---|---|
| **Problem** | chart/gantt/orgchart darkmode 사이클 후 *다른 SVG 블록*의 잔존 위반 불확실. 일관성 100% 보증 필요. |
| **Solution** | 6 SVG 블록 (Gantt/OrgChart/Callout/Code/Whiteboard/ImageAnnotation) 전수 grep + 점검. 잔존 위반 0. ImageAnnotationBlock 의 `fill="white"` 1건은 *의도적* 예외로 사유 lat 명시. |
| **Function/UX Effect** | 사용자 체감 변화 0 (코드 무변경). 향후 PDCA 사이클에서 ImageAnnotation `fill="white"` 를 토큰화하려는 시도가 생기면 lat 의 명시 사유로 회피 가능. |
| **Core Value** | "SVG 블록 darkmode 100% audit 완료 + 의도 예외 명시화" — 향후 회귀 방지의 사후 안전망. |

---

## 2. What was Audited

| # | 블록 | hex 잔존 | 처리 |
|---|---|---|---|
| 1 | Gantt | 0 | gantt-darkmode 처리 |
| 2 | OrgChart | 0 | orgchart-darkmode 처리 |
| 3 | Callout | 0 | `currentColor` (자동 inversion) |
| 4 | Code | 0 | `currentColor` (자동 inversion) |
| 5 | Whiteboard | 0 | 사용자 입력 색 (UX 의도) |
| 6 | ImageAnnotation | 1 | **의도적 — 유지** (callout 라벨 가독성) |

---

## 3. What was *Not* Done (out-of-scope)

| 항목 | 사유 |
|---|---|
| 비-SVG 블록 (div/figure light-only) darkmode | 전체 블록 darkmode 사이클 (별도 큰 audit) |
| FlowBlock mermaid 다크 | mermaid theme API 사이클 (별도) |
| ImageAnnotation 라벨 배경 토큰화 | 의도적 — sec §1.2 사유 |
| Whiteboard 사용자 색 자동 다크 inversion | UX 결정 필요 (별도) |

---

## 4. Patterns Confirmed (재사용 자산)

### 4.1 SVG 블록 darkmode 패턴 4가지
1. **Tokenization** (Gantt/OrgChart) — `fill="var(--smsg-...)"` → tokens.css 자동
2. **currentColor** (Callout/Code) — text color 상속 → 부모 className의 `dark:text-*` 자동
3. **User-driven** (Whiteboard) — `el.color` props, 토큰 무관
4. **Intentional hardcode** (ImageAnnotation `fill="white"`) — UX 의도 + lat 명시

### 4.2 향후 SVG 블록 추가 시 의사결정
```
새 SVG 블록 추가
 ├─ 사용자 데이터로 색 결정? → User-driven (User color, no token)
 ├─ text 색에 종속? → currentColor
 ├─ 시각 컨테이너? → Tokenization (var(--smsg-*))
 └─ 가독성 보장이 핵심? → Intentional hardcode + lat 문서화
```

---

## 5. Open Items (next-cycle)

| # | 항목 | 우선순위 |
|---|---|---|
| 1 | 전체 블록 darkmode pass (div/figure light-only) — block-darkmode-batch | MED |
| 2 | FlowBlock mermaid theme | MED |
| 3 | Whiteboard 사용자 색 자동 다크 inversion | LOW (UX 결정) |
| 4 | ImageAnnotation 라벨 배경 사용자 지정 옵션 | LOW |

---

## 6. Lessons

- **Audit = 가치 있는 산출물** — 코드 0건 변경도 사이클로 인정 (회귀 방지 + 의도 명시화)
- **의도 예외 lat 명시 의무화** — 토큰화 안 한 hex가 있으면 *반드시* 사유 문서화 (다음 사람이 무지로 깨뜨리지 않게)
- **6/6 SVG 블록 4가지 패턴** — 모든 향후 SVG 블록은 이 4 패턴 중 하나에 fit
- **사이클 시간 효율**: ~20분 (grep + 점검 + 3 문서 작성). 직접 분석 패턴 4사이클째 검증

---

## 7. Status / Final

- ✅ All phases done
- ⏳ Archive
- 🎯 darkmode 시리즈 종료 (chart/gantt/orgchart/audit 4 사이클 일관성 완성)
