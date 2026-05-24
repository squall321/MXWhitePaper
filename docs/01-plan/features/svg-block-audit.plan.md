# SVG Block Audit — Planning + Findings (combined cycle)

> **Summary**: chart/gantt/orgchart darkmode 사이클 종료 후 *모든* SVG 블록을 점검.
> 위반 잔존 확인 + 의도적 예외 문서화. **결과: mini-fix 0건 — audit 자체가 산출물**.
>
> **Project**: MX White Paper
> **Feature**: svg-block-audit
> **Date**: 2026-05-24
> **Previous**: orgchart-darkmode (`docs/archive/2026-05/orgchart-darkmode/`)

---

## Executive Summary

| Perspective | Content |
|---|---|
| **Problem** | gantt/orgchart darkmode 사이클 후 *다른 SVG 블록*에 잔존하는 하드코딩 색이 있는지 불확실. SVG 블록 darkmode 일관성 100% 확인 필요. |
| **Solution** | `grep <svg` → SVG 사용 블록 6개 식별 → 각 블록의 `fill=`/`stroke=` 전수 점검 → 위반/의도 분류. 코드 변경 없이 *감사 결과 문서화* 가 산출물. |
| **Function/UX Effect** | SVG 블록 darkmode 잔존 위반 0건 확인. `fill="white"` 의도 예외 1건 문서화 (ImageAnnotationBlock callout 라벨 배경 — 사용자 ann.color 텍스트 대비 위해 의도적). |
| **Core Value** | "SVG 블록 darkmode 100% 검증 + 의도 예외 lat 문서화" — 향후 코드 변경 시 무지(無知)로 인한 회귀 방지. |

---

## 1. Audit 결과

### 1.1 SVG 사용 블록 (6개)

| # | 파일 | 상태 |
|---|---|---|
| 1 | `GanttBlock.tsx` | ✅ 다크 토큰화 완료 (gantt-darkmode 사이클) |
| 2 | `OrgChartBlock.tsx` | ✅ 다크 토큰화 완료 (orgchart-darkmode 사이클) |
| 3 | `CalloutBlock.tsx` | ✅ `currentColor` 사용 — text color 자동 inversion |
| 4 | `CodeBlock.tsx` | ✅ `currentColor` 사용 — 동일 |
| 5 | `WhiteboardBlock.tsx` | ✅ `el.color`/`el.stroke` — *사용자 입력 색*, 토큰 무관 (UX 의도) |
| 6 | `ImageAnnotationBlock.tsx` | ⚠️ `fill="white"` 1건 (line 200) — **의도적 예외** |

### 1.2 의도적 예외 — ImageAnnotationBlock callout 라벨 배경

**위치**: `apps/web/src/components/blocks/ImageAnnotationBlock.tsx:200`

```tsx
<rect ...
  stroke={ann.color}      // 사용자 설정 색
  fill="white"            // ← 흰색 하드코딩
  fillOpacity={0.9}
/>
<text ... fill={ann.color}>{calloutLabel}</text>
```

**유지 사유**:
- callout 라벨은 사용자 이미지 위에 그려짐 (배경 = 사용자 이미지의 모든 색)
- 라벨 텍스트 색 = `ann.color` (사용자 설정 — 보통 진한 색)
- 흰 배경 + 진한 텍스트 = 어떤 이미지 위에서도 가독성 보장
- 만약 다크 토큰 (`var(--smsg-surface)` = dark에서 `#111827`) 으로 바꾸면, 다크 모드에서 사용자가 어두운 ann.color (예: 진한 네이비) 를 골랐을 때 *어두운 배경 + 어두운 텍스트* 가 되어 라벨 가독성 0
- `fillOpacity=0.9` 가 다크 surface 위에서도 자연스러운 반투명 효과 제공

**대안 후보 (out-of-scope, 별도 사이클)**:
- 다크에서 ann.color 의 brightness 자동 inversion (HSL parsing 필요)
- 라벨 배경을 `ann.color`의 *보색* 으로 계산
- 사용자가 라벨 배경 색 별도 지정

본 사이클은 *현재 동작이 의도적*이라는 사실 문서화로 마무리.

### 1.3 SVG 블록 외 점검 (out-of-scope)

| 위반 가능성 | 사유 |
|---|---|
| div/figure 의 `bg-white` 등 Tailwind light-only | SVG 블록 audit 범위 외 — 전체 블록 darkmode 사이클 (별도) |
| recharts/echarts 내부 raster 색 | chart-darkmode 사이클 처리 완료 |
| mermaid (FlowBlock) 색 | mermaid theme API — 별도 사이클 |

---

## 2. 산출물

### 2.1 코드 변경
**0건** — audit 결과 잔존 위반 없음. ImageAnnotationBlock의 1건은 의도적 예외로 유지.

### 2.2 문서 갱신

- `docs/lat/documents.md` — ImageAnnotationBlock 항목에 의도적 `fill="white"` 명시 (1줄 추가)
- 본 plan + analysis + report (audit 자체 기록)

---

## 3. Acceptance Criteria

1. **C1**: 6 SVG 블록 모두 다크 토큰 사용 확인 (또는 의도적 예외 문서화)
2. **C2**: ImageAnnotationBlock의 `fill="white"` 의도 lat에 1줄 명시
3. **C3**: 회귀 0 (코드 변경 0)
4. **C4**: 사이클 보고서 + archive

---

## 4. Estimate

| 작업 | LOC | 시간 |
|---|---|---|
| grep + 각 파일 점검 | — | 10분 (완료) |
| lat 1줄 갱신 | ~3 | 3분 |
| plan/analysis/report 작성 | 본 문서 | 15분 |
| commit + archive | — | 5분 |
| **합계** | **~3** | **~30분** |

---

## 5. Open Questions

| # | 질문 | 결정 |
|---|---|---|
| Q1 | `fill="white"` 를 토큰화 해야 하나? | **No** — 사용자 ann.color 가독성 보장 위해 의도적 흰색. 1.2 사유 |
| Q2 | 다른 블록 darkmode pass도 같이? | **No** — SVG 한정 사이클. 전체 블록 darkmode는 별도 큰 사이클 (block-darkmode-batch) |
| Q3 | WhiteboardBlock 의 사용자 입력 색이 다크 배경에서 안 보이면? | **별도** — 화이트보드는 painter 도구 특성상 사용자가 색 책임. 자동 대비는 별도 |
