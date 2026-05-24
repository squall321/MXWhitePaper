# Charts lat — ChartBlock / EChartsView / fits / paste

> chart 블록의 데이터 모델·렌더링·편집·분석·출력 전부를 한 곳에 정리.
> 연관: [[documents]] (스키마 union) · [[export]] (pptx/docx 매핑)

## 데이터 모델 (chart-xy-line 사이클 후)

`packages/shared/schemas/document.json` → `ChartBlock`:

```ts
{
  type: 'chart',
  chartType: 'line'|'bar'|'pie'|'area'|'radar'|'scatter'|'xy-line',
  engine?: 'recharts'|'echarts',  // xy-line 은 항상 echarts
  title?: string,
  data: {
    labels: string[],              // 카테고리 공통 x (xy-line 미사용)
    series: {
      name: string,
      values?: number[],           // labels 와 같은 길이의 y (xy-line 미사용)
      points?: { x, y, err?, errLow?, errHigh? }[],  // xy-line 전용
      caption?: string,            // tooltip 부가 설명
      color?: string,              // 시리즈 색 override
      yAxisIndex?: 0|1,            // dual y-axis (P3)
    }[],
    xAxisLabel?: string,
    yAxisLabel?: string,
    yAxisLabel2?: string,          // 오른쪽 y 축 (dual)
    xAxisType?: 'value'|'time',    // timestamp x (P3)
  },
  display?: {                       // 사용자 시각화 토글 — 저장됨
    gridOn?: bool, xLog?: bool, yLog?: bool,
    xMin?, xMax?, yMin?, yMax?,    // 축 범위 수동
    showFit?: bool,
    fitType?: 'linear'|'poly2'|'poly3'|'exp'|'power',
    fitRange?: { xMin, xMax },     // 회귀 구간 한정
    showStats?: bool,
    sampling?: 'none'|'lttb',      // P4 큰 데이터
  },
  annotations?: (                   // P3 차트 위 도형
    | { kind:'marker', x, y, label, color? }
    | { kind:'arrow', fromX, fromY, toX, toY, label?, color? }
    | { kind:'box', xMin, xMax, yMin, yMax, label?, color? }
  )[],
  interactions?: { keyPoints, regions, showZoom, showCrosshair },
  options?: object,                 // raw ECharts EChartsOption 통과
}
```

모든 P1+P3 신규 필드는 **add-only optional** — 옛 chart 블록 무영향.

## 핵심 진입점

### 렌더
| 파일 | 책임 |
|---|---|
| [[src/components/blocks/ChartBlock.tsx]] | recharts 엔진 (line/bar/pie/area/radar/scatter, xy-line 제외). 다크 모드: `useResolvedTheme()` → CartesianGrid/XAxis/YAxis stroke 분기 + figure `dark:` 변형 + Tooltip contentStyle/itemStyle theme 분기 (chart-libs-darkmode 사이클) |
| [[src/components/blocks/EChartsView.tsx]] | echarts 엔진 — xy-line 의 모든 P1+P3 기능. `forwardRef<EChartsViewHandle>` 로 `getPng()` 노출. 다크 모드: `useResolvedTheme()` + `mergeThemeColors(buildOption(block, colors), colors)` + theme 변화 시 `dispose+init` 으로 재초기화 (ECharts init 시 결정되는 default를 다시 픽업). PNG export 배경도 theme 따라 분기 |

### 편집
| 파일 | 책임 |
|---|---|
| [[src/features/editor/blocks/ChartBlockEditor.tsx]] | xy-line 전용 toolbar (Grid/Log/Zoom/Fit-type/축범위/Fit범위/Stats/Annotation/Derived) + (x,y) 시리즈 테이블 + onPaste (TSV → 시리즈 누적). `applyChartPasteToBlock` / `buildCsvExport` / `computeSeriesStats` export. |
| [[src/features/editor/blocks/_chartPaste.ts]] | TSV/CSV → `{title?, xAxisLabel?, yAxisLabel?, xAxisType?, series:[{name, points, caption?}], outliers?}`. 헤더 단위 추출 (`[MPa]` → 분리), timestamp 추론 (ISO/슬래시/unix-ms+time-header), outlier 5σ 검출 (1%+ → 시리즈명 list) |

### 분석 (순수 모듈)
| 파일 | 책임 |
|---|---|
| [[src/features/editor/blocks/_fits.ts]] | `linearFit / polyFit(2\|3) / exponentialFit / powerFit / evaluateFit / formatFitGeneric / fitLine`. exp/power 는 log 변환 후 회귀 + R² 는 원본 y 공간에서 재계산. |
| [[src/features/editor/blocks/_derived.ts]] | `sortedByX / differentiate (중앙/전후 차분) / integrate (사다리꼴 누적) / findPeaks (인접 + plateau + minProminence) / diffSeries (공통 x 만)` |

## 출력 (export.md 와 짝)

| chartType | recharts/echarts | pptx | docx | html | md |
|---|---|---|---|---|---|
| `line` `bar` `column` `pie` | recharts (기본) | native chart shape | hidden marker + 데이터 표 | `<canvas>` chart.js | mermaid fenced |
| `area` `radar` `scatter` | recharts | text fallback | 동일 | 동일 | 동일 |
| **`xy-line`** | **echarts (강제)** | **XY_SCATTER_LINES_NO_MARKERS** (P4) | hidden marker + 데이터 표 (round-trip) | echarts canvas | mermaid fenced (값만) |

## paste UX 흐름 (xy-line 핵심)

1. 사용자 엑셀에서 N×2 (헤더 + 데이터) 복사
2. ChartBlockEditor 의 onWrapperPaste → `parseChartPaste(text)`
3. 헤더 detection: 첫 행 모두 숫자 아님 → 헤더, 그 위에 단일 셀 → 차트 제목
4. timestamp detection: 첫 컬럼이 ISO/슬래시/unix-ms 패턴 매칭 → `xAxisType='time'`, x 를 unix ms 로
5. 단위 추출: `Stress [MPa]` → name="Stress" + label 에 단위 부착
6. outlier 검출: 시리즈마다 |y-mean| > 5σ 점이 1% 초과면 outliers list 에
7. `applyChartPasteToBlock(block, parsed)` — chartType='xy-line' 으로 전환,
   기존 xy-line 이면 시리즈 append, 그 외엔 교체
8. outlier 있으면 toast.warn (최대 3건)

## Gotchas

- **xy-line 은 engine='echarts' 강제** — recharts 는 dataZoom/markLine 지원 부족.
  ChartBlockEditor 의 engine select 가 xy-line 일 땐 recharts 선택해도 EChartsView 로.
- **xy-line 의 labels 는 무시** — points 가 단일 진실. 스키마 호환 위해 labels: []
  로 유지.
- **timestamp x 는 unix ms (number)** — ISO 문자열 그대로 두지 않음. paste 가 변환.
- **paste UX 는 input/textarea/contentEditable 안에서도 가로채기** — 표 모양 텍스트면
  무조건 적용. 시리즈명 input 에 일반 텍스트 paste 는 `parseChartPaste` 가 null 반환
  → native paste 동작.
- **dual y-axis 켜진 채로 yAxisIndex 미지정 시리즈** = 왼쪽 (0) 으로. 우측에 시리즈가
  하나도 없으면 yAxisLabel2 표시는 됨 (빈 우측 축).
- **비선형 fit 곡선은 markLine 이 아니라 별도 line series** — fitRange 안에서 50점 균등
  샘플링. linearFit 만 markLine. evaluateFit 헬퍼가 곡선 점 생성.
- **LTTB downsample 자동 ON 임계** = points.length ≥ 100_000 (또는 display.sampling='lttb').
  display.sampling='none' 으로 끌 수 있음. ECharts large=true 도 같이.
- **fit R² 가 NaN/Infinity** — formatFitGeneric / formatStatNum 이 '—' 로 표시.
  계산 함수는 null 반환 (점 부족 / 행렬 singular / log 인자 비양수).
- **annotation 좌표는 데이터 좌표계** — image 의 정규화 [0..1] 와 다름. paste 시
  시리즈 bbox 중심을 기본값으로 (A5 의 derived peaks 분기).
- **다크 모드 = `useResolvedTheme()` hook** ([[src/features/theme/useResolvedTheme.ts]])
  → MutationObserver 로 `html.classList`/`data-theme` 감지 → theme 변화 시
  recharts는 props 분기로 즉시 / EChartsView 는 `dispose+init` 으로 재초기화.
  시리즈 팔레트는 `getPalette(theme)` ([[src/components/blocks/EChartsView.tsx#getPalette]])
  로 light/dark brighter variant 자동 전환 — 인덱스 일관성 유지 (chart-dark-palette
  사이클). series.color override 는 theme 무관 우선.

## 테스트 지도

| 파일 | 케이스 수 | 무엇 |
|---|---|---|
| [[src/features/editor/blocks/__tests__/_fits.test.ts]] | 35 | linear/poly/exp/power, evaluateFit, formatFitGeneric |
| [[src/features/editor/blocks/__tests__/_chartPaste.test.ts]] | 23 | 헤더/단위/N×K/timestamp/outlier |
| [[src/features/editor/blocks/__tests__/_derived.test.ts]] | 21 | differentiate/integrate/findPeaks/diffSeries |
| [[src/features/editor/blocks/__tests__/ChartBlockEditor.paste.test.tsx]] | 13 | onPaste, applyChartPasteToBlock |
| [[src/features/editor/blocks/__tests__/ChartBlockEditor.p2.test.tsx]] | 26 | toolbar P2 (axis range/fit range/PNG/CSV/stats/시리즈 정리) |
| [[src/features/editor/blocks/__tests__/ChartBlockEditor.p3.test.tsx]] | 20 | fit-type select/dual-y/annotation/derived |
| [[src/components/blocks/__tests__/EChartsView.option.test.ts]] | 4 | LTTB 자동, axis range, fitRange, dual-y |
| [[src/tests/test_pptx_export.py#xy-line]] | 2 | native chart 매핑 + 빈 fallback |

## 사이클 / Plan

- `docs/01-plan/features/chart-xy-line.plan.md` — 4 phase 단일 plan
- P1 `30d059b` — xy-line 기초 + paste + EChartsView + toolbar
- P2 `a65dd9d` — fit-range/축범위/stats/PNG/CSV/시리즈정리
- P3 `2cb25c0` — annotation/dual-y/비선형 fit/error-bar/timestamp/derived
- P4 `751bc10` — pptx export + LTTB + outlier toast
