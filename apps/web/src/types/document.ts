/**
 * AUTO-GENERATED — do not edit by hand.
 * Source: packages/shared/schemas/document.json
 * Run: pnpm schema:gen
 */

/**
 * Crockford base32 ULID
 */
export type Ulid = string
/**
 * url-safe identifier (lowercase ASCII, digits, hyphen, Hangul)
 */
export type Slug = string
export type Block =
  | ParagraphBlock
  | Heading4Block
  | ListBlock
  | QuoteBlock
  | CalloutBlock
  | CodeBlock
  | MathBlock
  | TableBlock
  | KpiCardsBlock
  | ChartBlock
  | GanttBlock
  | FlowBlock
  | OrgChartBlock
  | IframeBlock
  | VideoBlock
  | ImageBlock
  | GalleryBlock
  | FileBlock
  | DocLinkCardBlock
  | GlossaryRefBlock
  | ColumnsBlock
  | TabsBlock
  | AccordionBlock
  | DataSourceBlock
  | DashboardEmbedBlock
  | CalculatorBlock
  | WhiteboardBlock
  | FormBlock
  | PdfBlock
  | QuizBlock
  | ImageAnnotationBlock
  | SpreadsheetBlock
  | BibliographyBlock
  | SpacerBlock
  | FigureIndexBlock
  | PivotTableBlock
/**
 * Block subset allowed inside a TableBlock cell's `blocks` array. Intentionally narrow to keep table cell rendering tractable — only paragraph/image/list.
 */
export type CellBlock = ParagraphBlock | ImageBlock | ListBlock
/**
 * Embed an external page (`src`) OR an inline self-contained HTML document (`html`). Exactly one MUST be set. The renderer wraps the iframe in a sandbox boundary so the embed can't reach the parent DOM, cookies, or storage; only `allow-scripts` is granted so interactive embeds (charts, calculators) still work.
 */
export type IframeBlock = {
  type: 'iframe'
  id: Ulid
  /**
   * 사내 화이트리스트 도메인만. `html` 와 동시 사용 금지.
   */
  src?: string
  /**
   * Self-contained HTML document. Rendered via iframe srcdoc + sandbox. Use this for ad-hoc interactive embeds (e.g. canvas-based charts) that don't need a hosting URL. `src` 와 동시 사용 금지.
   */
  html?: string
  title?: string
  height?: number
  meta?: BlockMeta
} & IframeBlock1
export type IframeBlock1 = {
  [k: string]: any | undefined
}
/**
 * FK to images.id — accepts ULID (legacy seed data) or UUID (uploaded images)
 */
export type ImageRef = string
export type WhiteboardElement =
  | {
      kind: 'stroke'
      id: string
      points: [number, number][]
      stroke: string
      strokeWidth: number
    }
  | {
      kind: 'shape'
      id: string
      shape: 'rect' | 'ellipse' | 'line' | 'arrow'
      x: number
      y: number
      w: number
      h: number
      stroke: string
      strokeWidth: number
      fill?: string
    }
  | {
      kind: 'text'
      id: string
      x: number
      y: number
      text: string
      fontSize: number
      color: string
    }
export type AnnotationElement =
  | {
      kind: 'arrow'
      id: string
      from: {
        x: number
        y: number
      }
      to: {
        x: number
        y: number
      }
      color: string
      label?: string
    }
  | {
      kind: 'rect'
      id: string
      x: number
      y: number
      w: number
      h: number
      color: string
      label?: string
    }
  | {
      kind: 'callout'
      id: string
      x: number
      y: number
      anchor?: {
        x: number
        y: number
      }
      /**
       * Annotation label (was `text` pre-pass-2). BE normaliser rewrites legacy `text` → `label` on read.
       */
      label: string
      color: string
      /**
       * Optional callout label background colour. Default is white (hardcoded for readability on top of user images — see svg-block-audit cycle). Set to override (e.g. when the underlying image is uniformly bright and white blends in).
       */
      bgColor?: string
    }
  | {
      kind: 'textbox'
      id: string
      x: number
      y: number
      w: number
      h: number
      /**
       * Multi-line plain text. \n 으로 줄 구분.
       */
      text: string
      /**
       * 텍스트 색.
       */
      color: string
      /**
       * 정규화 좌표계 기준 글자 크기 (기본 0.025). 좌표가 0-1 이라 일반적으로 0.015~0.06.
       */
      fontSize?: number
      /**
       * 박스 배경색 (선택). 미지정 시 반투명 흰색 폴백.
       */
      bg?: string
    }

/**
 * MX White Paper 단일 진실 공급원(SSOT). Section 트리(level 1~3) + Block 배열 본문. PROJECT_PLAN.md / Plan / Design / Do 문서의 모든 데이터 모델 참조처.
 */
export interface DocumentJSONV10 {
  schema_version: '1.0'
  id: Ulid
  slug: Slug
  title: string
  summary?: string
  metadata: DocumentMeta
  infobox?: Infobox
  /**
   * 최상위 섹션은 반드시 level=1 (BE 가 검증). 자식 섹션은 부모 level+1.
   */
  sections: Section[]
  related_documents?: RelatedDoc[]
  glossary?: GlossaryItem[]
  references?: Reference[]
  see_also?: Slug[]
  /**
   * Map of variable names → fill-in strings used to substitute {{var}} tokens at render time.
   */
  variables?: {
    [k: string]: string | undefined
  }
  /**
   * Optional CSS injected into the doc's render. Sandboxed: no <script>, no expression(), no url(javascript:), no @import, no behavior:.
   */
  custom_css?: string
}
export interface DocumentMeta {
  division: string
  team?: string
  group?: string
  part?: string
  /**
   * @minItems 1
   */
  owners: [string, ...string[]]
  reviewers?: string[]
  tags: string[]
  category?: string
  confidentiality: 'public' | 'internal' | 'restricted'
}
/**
 * 우상단 정보 박스. 키=라벨, 값=문자열, 문자열 배열, 또는 풍부한 표현(링크/뱃지/아이콘)을 위한 InfoboxRich 객체. 기존 문자열 형태는 그대로 호환.
 */
export interface Infobox {
  [k: string]: (string | string[] | InfoboxRich | InfoboxRich[]) | undefined
}
/**
 * Richer Infobox value — wraps a label with optional link / badge / icon / color hints. Used wherever a plain string isn't enough (예: 상태 뱃지, 담당자 메일 링크).
 */
export interface InfoboxRich {
  /**
   * 표시 텍스트.
   */
  text: string
  /**
   * 링크 URL — 있으면 텍스트가 클릭 가능한 a 태그로 렌더링.
   */
  href?: string
  /**
   * 선두 이모지 아이콘 (예: 📞 ✉️ 👤).
   */
  icon?: string
  /**
   * 배경/텍스트 컬러로 강조하는 뱃지 종류. neutral=회색.
   */
  badge?: 'success' | 'info' | 'warn' | 'danger' | 'neutral'
  /**
   * 텍스트 색 직접 지정 (badge와 함께 쓰면 badge가 우선).
   */
  color?: string
}
/**
 * Document outline node. Recursive — `subsections` is another Section[]. Top-level entries MUST have level=1; child level = parent.level + 1 (enforced by the BE renumber/validate pass). The visual rendering caps at HTML <h6> (level 5+ all render as h6) but schema-wise depth is unbounded.
 */
export interface Section {
  id: Ulid
  /**
   * 1.2.3.4… dotted ordinal recomputed by the BE on every save.
   */
  number?: string
  /**
   * 1-based depth. BE rejects values that don't match the tree position.
   */
  level: number
  title: string
  /**
   * Visual layout for this section's blocks. Drives both the wiki view (block arrangement inside the section) and presentation view (slide template). Defaults to 'stack' (existing behaviour: blocks render top-to-bottom). 'two-col' splits blocks alternately into two columns. 'image-left'/'image-right' put the first ImageBlock on one side and remaining blocks on the other. 'title-only' renders just the section heading (PPT cover style). 'full-bleed' uses the first ImageBlock as a full-width background with subsequent blocks overlaid.
   */
  layout?: 'stack' | 'two-col' | 'image-left' | 'image-right' | 'title-only' | 'full-bleed'
  /**
   * Per-pane percentage widths for two-pane layouts (two-col / image-left / image-right). Length MUST equal 2 when present, each value 10..90, sum SHOULD equal 100 (FE normalises). Ignored for stack / title-only / full-bleed. Omit for equal 50/50 split.
   *
   * @minItems 2
   * @maxItems 2
   */
  layoutWidths?: [number, number]
  blocks: Block[]
  subsections?: Section[]
}
export interface ParagraphBlock {
  type: 'paragraph'
  id: Ulid
  text: string
  meta?: BlockMeta
}
export interface BlockMeta {
  align?: 'left' | 'center' | 'right' | 'full'
  collapsed?: boolean
  locked?: boolean
  permission?: 'all' | 'editor' | 'admin'
  note?: string
  /**
   * Heading 블록(heading-4 type)에서 실제 보여줄 단계. 2=큰 제목, 3=중간 제목, 4=작은 제목(기본). 다른 블록 타입에서는 무시됨.
   */
  level?: 2 | 3 | 4
  /**
   * 사용자 지정 블록 너비(px). 미지정 또는 0이면 부모 컨테이너에 맞춤(기존 동작).
   */
  width?: number
  /**
   * 사용자 지정 블록 높이(px). 미지정이면 콘텐츠 자동 높이(기존 동작).
   */
  height?: number
  /**
   * 이 블록이 노출되는 뷰. 'both'(기본): 위키 + 슬라이드 둘 다. 'wiki-only': 위키에만 (프레젠테이션에서 숨김). 'slide-only': 프레젠테이션에서만 (위키 본문에서는 숨김). 발표용 큰 이미지/스피커 멘트, 또는 위키엔 자세히 적고 슬라이드엔 빼고 싶은 표 등을 분리할 때 사용.
   */
  audience?: 'both' | 'wiki-only' | 'slide-only'
  /**
   * 프레젠테이션 모드에서 사용자가 명시적으로 슬라이드 분할 지점을 지정. 'before': 이 블록부터 새 슬라이드 시작. 'after': 이 블록 다음부터 새 슬라이드 시작. buildSlides 의 자동 BUDGET 분할보다 우선. 같은 섹션 안에서 발표자 흐름을 직접 제어할 때 사용.
   */
  slideBreak?: 'before' | 'after'
}
export interface Heading4Block {
  type: 'heading-4'
  id: Ulid
  title: string
  /**
   * Visual heading level. Optional — defaults to 4 (smallest). Sub-section heading; the document outline still uses Section nodes for the canonical hierarchy.
   */
  level?: 2 | 3 | 4
  meta?: BlockMeta
}
export interface ListBlock {
  type: 'list'
  id: Ulid
  style: 'bullet' | 'number' | 'check'
  items: string[]
  /**
   * 표시 옵션. 모두 optional, default 동작은 ON.
   */
  options?: {
    /**
     * 행 단위 zebra-striping. false 일 때만 OFF — 옛 문서 (옵션 미지정) 는 ON 유지. 중첩 항목 (depth>=1) 은 stripe 미적용.
     */
    stripe?: boolean
  }
  meta?: BlockMeta
}
export interface QuoteBlock {
  type: 'quote'
  id: Ulid
  text: string
  cite?: string
  meta?: BlockMeta
}
export interface CalloutBlock {
  type: 'callout'
  id: Ulid
  variant: 'info' | 'warn' | 'danger' | 'tip'
  title?: string
  text: string
  meta?: BlockMeta
}
export interface CodeBlock {
  type: 'code'
  id: Ulid
  language: string
  code: string
  filename?: string
  meta?: BlockMeta
}
export interface MathBlock {
  type: 'math'
  id: Ulid
  /**
   * LaTeX (KaTeX 호환)
   */
  expression: string
  display?: 'block' | 'inline'
  meta?: BlockMeta
}
/**
 * Table block. Two layout modes: flat (`headers` + `rows`, the common case) and sparse (`cells`, used whenever cells are merged or styled per-cell). The renderer prefers `cells` when present. Optional `columns` carries per-column metadata (width / align / dtype / format) that applies to BOTH modes — column index is well-defined in either layout.
 */
export interface TableBlock {
  type: 'table'
  id: Ulid
  /**
   * Optional caption rendered below the table; participates in auto-numbering ('표 N: ...').
   */
  caption?: string
  headers: string[]
  rows: string[][]
  /**
   * Optional sparse cell list for tables with merged or styled cells (DOCX gridSpan/vMerge round-trip + per-cell style overrides). When present, the renderer ignores headers/rows and lays out from this list. Each cell occupies (r..r+rowSpan-1) × (c..c+colSpan-1); covered slots have no entry. r/c are 0-indexed; the first row of a header-mode table is the header row. A cell carries content via either `text` (plain string, the common case) or `blocks` (mixed content — paragraph/image/list). Exactly one of the two MUST be set; empty cell ⇒ text=''.
   */
  cells?: {
    r: number
    c: number
    rowSpan?: number
    colSpan?: number
    text?: string
    /**
     * Mixed-content cell payload. When present, renderers ignore `text` and lay out these blocks inside the cell. Restricted to paragraph/image/list to keep cell layout tractable — tables-in-tables and callouts-in-cells are intentionally out of scope.
     *
     * @minItems 1
     */
    blocks?: [CellBlock, ...CellBlock[]]
    /**
     * True for header-row cells (rendered as <th>).
     */
    header?: boolean
    /**
     * Per-cell horizontal alignment override (wins over column default).
     */
    align?: 'left' | 'center' | 'right'
    /**
     * Cell background color (CSS hex).
     */
    bg?: string
    /**
     * Bold text in this cell.
     */
    bold?: boolean
    /**
     * Cell text color (CSS hex).
     */
    color?: string
  }[]
  /**
   * Optional per-column metadata. Index matches column index in both flat and sparse layouts. Missing entries fall back to defaults (left-align, text dtype, auto width).
   */
  columns?: {
    /**
     * CSS width — '120px' or '15%' or 'auto'.
     */
    width?: string
    /**
     * Default cell alignment for this column. dtype=number|percent|currency auto-defaults to right when align is unset.
     */
    align?: 'left' | 'center' | 'right'
    /**
     * Column data type. Drives auto-formatting and default alignment.
     */
    dtype?: 'text' | 'number' | 'percent' | 'currency' | 'date'
    /**
     * Format hint. number/percent: decimal places like '2'. currency: ISO code or symbol like 'KRW' / '$'. date: pattern like 'YYYY-MM-DD'.
     */
    format?: string
  }[]
  /**
   * Optional footer row showing per-column aggregates. Computed at render time from `rows` (flat mode) — sparse mode is skipped because merged-cell semantics make column-wise sums ambiguous.
   */
  footer?: {
    show?: boolean
    /**
     * Label shown in the first column when no aggregate is set there.
     */
    label?: string
    /**
     * Per-column aggregate. '' (empty) skips that column.
     */
    aggregates?: ('' | 'sum' | 'avg' | 'count' | 'min' | 'max')[]
  }
  options?: {
    /**
     * Header click sorts asc/desc by that column (flat mode only).
     */
    sortable?: boolean
    /**
     * Show a search box above the table that filters rows (flat mode only).
     */
    searchable?: boolean
    /**
     * Row padding density. Default 'normal'.
     */
    density?: 'compact' | 'normal' | 'comfortable'
    /**
     * Pin the first column when the table scrolls horizontally.
     */
    stickyFirstCol?: boolean
    /**
     * Show 1-based row numbers in a leading column.
     */
    rowNumbers?: boolean
    /**
     * Zebra-striped rows. Default true; set false to disable.
     */
    stripe?: boolean
    /**
     * Cell border style. Default 'horizontal'.
     */
    borderStyle?: 'none' | 'horizontal' | 'all'
    /**
     * FE-only conditional formatting rules (WIDGET-02 Phase 1). Each rule scopes to a column (by header name or 0-based index; omit for all columns), tests cellValue with an operator, and applies a style. Sparse `cells[].bg/color/bold` always override. Not yet round-tripped through docx export.
     */
    conditionalFormatting?: {
      /**
       * Column scope: header text (string) or 0-based index (integer); omit to match every column.
       */
      column?: string | number
      operator:
        | 'gt'
        | 'gte'
        | 'lt'
        | 'lte'
        | 'eq'
        | 'neq'
        | 'between'
        | 'top_n'
        | 'bottom_n'
        | 'contains'
        | 'not_contains'
      /**
       * Numeric/string for comparison ops; [min, max] for between; N for top_n/bottom_n.
       */
      value: number | string | [number, number]
      style: {
        bg?: string
        fg?: string
        bold?: boolean
      }
    }[]
  }
  meta?: BlockMeta
}
export interface ImageBlock {
  type: 'image'
  id: Ulid
  /**
   * FK to images.id (ULID or UUID)
   */
  imageId: string
  caption?: string
  alt?: string
  width?: 'sm' | 'md' | 'lg' | 'full'
  /**
   * 외부 URL 또는 위키 slug
   */
  link?: string
  meta?: BlockMeta
}
export interface KpiCardsBlock {
  type: 'kpi-cards'
  id: Ulid
  items: {
    label: string
    value: string | number
    delta?: string | number
    trend?: 'up' | 'down' | 'flat'
    /**
     * Excel Insert→Sparkline 동등. 카드 하단의 작은 인-카드 차트.
     */
    sparkline?: {
      /**
       * 시계열 값. 빈 배열이면 sparkline 미렌더.
       */
      values: number[]
      /**
       * line=경향선, bar=막대, win-loss=양/음 1px 막대.
       */
      kind?: 'line' | 'bar' | 'win-loss'
      /**
       * Sparkline 색 override. 미지정이면 trend 색 (▲↗ emerald / ▼↘ red / → gray) 또는 currentColor 사용. line=stroke, bar=fill, win-loss=양수 fill (음수는 같은 색 + opacity 0.55).
       */
      color?: string
      /**
       * bar kind 전용 — 막대별 색 cycle. i 번째 막대는 palette[i % palette.length] 사용. line/win-loss 에서는 무시 (color 사용). 둘 다 지정되면 palette 우선.
       */
      palette?: string[]
    }
  }[]
  /**
   * 표시 옵션. 모두 optional, default 동작은 ON.
   */
  options?: {
    /**
     * 카드 단위 zebra-striping (`:nth-of-type(2n)`). grid 컬럼 수와 무관 — 카드 한 칸 건너 한 칸 음영.
     */
    stripe?: boolean
  }
  meta?: BlockMeta
}
/**
 * Chart block — `engine` selects the renderer. 'recharts' (default) uses our existing simple chart UI; 'echarts' unlocks rich interaction (zoom, brush, hover slope, markPoint annotations, markArea regions). With 'echarts' the data fields below still drive the dataset, but `options` accepts any ECharts EChartsOption fragment that gets merged on top.
 */
export interface ChartBlock {
  type: 'chart'
  id: Ulid
  /**
   * 차트 타입. 'xy-line' 은 시리즈마다 자유로운 (x, y) 쌍 — labels 공유 안 함. 두 stress-strain 곡선처럼 시료별 측정점이 다른 데이터를 한 그림에 겹쳐 비교할 때 사용. data.labels 는 무시되고 각 series 의 points: [{x, y}] 가 그려진다. 'boxplot' 은 분포 비교용 — 시리즈마다 한 박스. raw mode (기본) 는 values:number[] 에서 min/Q1/median/Q3/max 자동 계산. precomputed mode (block.options.boxplotMode='precomputed') 는 values:[min, Q1, median, Q3, max] (length=5) 로 직접 지정.
   */
  chartType: 'line' | 'bar' | 'pie' | 'area' | 'radar' | 'scatter' | 'xy-line' | 'boxplot'
  /**
   * Chart renderer. Default 'recharts' for back-compat; choose 'echarts' for rich interactivity (markPoint / markArea / brush / dataZoom).
   */
  engine?: 'recharts' | 'echarts'
  title?: string
  data: {
    labels: string[]
    series: {
      name: string
      /**
       * labels 와 동일 길이의 y 값. chartType=='xy-line' 이면 무시되고 points 사용.
       */
      values?: number[]
      /**
       * 자유 (x, y) 쌍. chartType=='xy-line' 에서 사용. 시리즈마다 x 가 다를 수 있어 stress-strain 곡선처럼 측정점이 다른 데이터 비교 가능. 각 점에 optional err (대칭 error bar y±err) 또는 errLow/errHigh (비대칭) 가능 — 측정 오차 시각화.
       */
      points?: {
        x: number
        y: number
        /**
         * 대칭 오차 (y±err). P3 추가.
         */
        err?: number
        /**
         * 비대칭 오차 — 하한 (y - errLow ~ y).
         */
        errLow?: number
        /**
         * 비대칭 오차 — 상한 (y ~ y + errHigh).
         */
        errHigh?: number
      }[]
      /**
       * 시리즈 추가 설명 — hover/legend 에 표시. 캡션은 사용자가 paste 시 헤더에서 추출하거나 직접 입력.
       */
      caption?: string
      /**
       * 이 시리즈가 그려질 y 축. 0 (기본) = 왼쪽 축, 1 = 오른쪽 축. dual-axis 일 때 단위가 다른 두 시리즈를 같은 차트에 표시.
       */
      yAxisIndex?: 0 | 1
      /**
       * 시리즈 색상 override. 미지정 시 PALETTE 자동. CSS 색 (#RGB, rgb(), name).
       */
      color?: string
    }[]
    /**
     * x 축 라벨. xy-line 처럼 카테고리가 아닌 연속값일 때 의미. paste 의 'x' 헤더 컬럼명에서 자동 추출 가능.
     */
    xAxisLabel?: string
    /**
     * y 축 라벨. paste 의 'y' 헤더 컬럼명에서 자동 추출 가능.
     */
    yAxisLabel?: string
    /**
     * 오른쪽 y 축 라벨 — dual-axis 일 때 (series 중 yAxisIndex=1 있을 때) 사용.
     */
    yAxisLabel2?: string
    /**
     * x 축 데이터 유형. 'time' 이면 unix ms 또는 ISO date 로 해석 (P3 — timestamp x). 미지정 = 'value' (숫자).
     */
    xAxisType?: 'value' | 'time'
  }
  /**
   * Friendly knobs for ECharts interactivity that map onto markPoint / markArea / dataZoom without requiring users to write raw EChartsOption.
   */
  interactions?: {
    /**
     * Highlighted points on the curve (label, x-index, optional color).
     */
    keyPoints?: {
      label: string
      xIndex: number
      color?: string
    }[]
    /**
     * Coloured x-range bands (e.g. Elastic / Plastic). xFromIndex / xToIndex are inclusive label indexes.
     */
    regions?: {
      label: string
      xFromIndex: number
      xToIndex: number
      color?: string
    }[]
    /**
     * Inline dataZoom slider under the chart.
     */
    showZoom?: boolean
    /**
     * Crosshair guides + axis pointers.
     */
    showCrosshair?: boolean
  }
  /**
   * Raw ECharts EChartsOption fragment, merged after `interactions` so power users can override anything.
   */
  options?: {}
  /**
   * 사용자 시각화 토글 상태. 차트 블록과 함께 저장되어 재방문 시 동일 상태 복원. P1 에서 gridOn/xLog/yLog/showFit + 자동 zoom 지원, P2 에서 fitRange/축범위/stats, P3 에서 fitType/도메인 옵션 확장.
   */
  display?: {
    /**
     * 격자 표시 (기본 true).
     */
    gridOn?: boolean
    /**
     * x 축 log 스케일.
     */
    xLog?: boolean
    /**
     * y 축 log 스케일.
     */
    yLog?: boolean
    /**
     * linear fit + R² markLine 표시.
     */
    showFit?: boolean
    xMin?: number
    xMax?: number
    yMin?: number
    yMax?: number
    /**
     * 피팅 모델. P1 은 linear 만, P3 에서 나머지.
     */
    fitType?: 'linear' | 'poly2' | 'poly3' | 'exp' | 'power'
    fitRange?: {
      xMin: number
      xMax: number
    }
    showStats?: boolean
    sampling?: 'none' | 'lttb'
  }
  /**
   * 차트 위 도형 (P3) — 사용자가 데이터 좌표계에 직접 얹는 화살표/박스/마커/노트. ImageAnnotation 의 카운터파트이지만 좌표가 (x, y) 데이터 단위.
   */
  annotations?: (
    | {
        kind: 'marker'
        id: string
        x: number
        y: number
        label: string
        color?: string
      }
    | {
        kind: 'arrow'
        id: string
        fromX: number
        fromY: number
        toX: number
        toY: number
        label?: string
        color?: string
      }
    | {
        kind: 'box'
        id: string
        xMin: number
        xMax: number
        yMin: number
        yMax: number
        label?: string
        color?: string
      }
  )[]
  meta?: BlockMeta
}
export interface GanttBlock {
  type: 'gantt'
  id: Ulid
  tasks: {
    name: string
    start: string
    end: string
    progress?: number
  }[]
  /**
   * 표시 옵션. 모두 optional, default 동작은 ON.
   */
  options?: {
    /**
     * task row 단위 zebra-striping (label 영역 포함 전체 행). SVG `<rect fill='#F9FAFB'>` 로 paint.
     */
    stripe?: boolean
    /**
     * x-axis tick 단위. 미지정 시 'month'. tick 위치는 view 가 [minStart, maxEnd] 구간에서 해당 단위 경계마다 SVG `<line>` 으로 paint.
     */
    axisUnit?: 'day' | 'week' | 'month' | 'quarter'
  }
  meta?: BlockMeta
}
export interface FlowBlock {
  type: 'flow'
  id: Ulid
  engine: 'mermaid' | 'excalidraw'
  /**
   * Mermaid DSL 또는 excalidraw JSON
   */
  source: string
  meta?: BlockMeta
}
export interface OrgChartBlock {
  type: 'org-chart'
  id: Ulid
  root: OrgChartNode
  layout?: 'tree' | 'horizontal'
  meta?: BlockMeta
}
export interface OrgChartNode {
  id: string
  label: string
  role?: string
  children?: OrgChartNode[]
}
export interface VideoBlock {
  type: 'video'
  id: Ulid
  url: string
  title?: string
  provider?: 'intra' | 'youtube' | 'vimeo'
  /**
   * Auto-play on load. Browser autoplay policies may block this when muted=false; treat as a hint.
   */
  autoplay?: boolean
  /**
   * Show native video controls (play/pause/volume/seek).
   */
  controls?: boolean
  /**
   * Restart automatically when the video ends.
   */
  loop?: boolean
  meta?: BlockMeta
}
export interface GalleryBlock {
  type: 'gallery'
  id: Ulid
  layout: 'grid' | 'carousel'
  /**
   * @minItems 1
   */
  items: [
    {
      imageId: ImageRef
      caption?: string
      alt?: string
    },
    ...{
      imageId: ImageRef
      caption?: string
      alt?: string
    }[]
  ]
  meta?: BlockMeta
}
export interface FileBlock {
  type: 'file'
  id: Ulid
  fileId: Ulid
  name: string
  size?: number
  mime?: string
  meta?: BlockMeta
}
export interface DocLinkCardBlock {
  type: 'doc-link-card'
  id: Ulid
  slug: Slug
  showSummary?: boolean
  meta?: BlockMeta
}
export interface GlossaryRefBlock {
  type: 'glossary-ref'
  id: Ulid
  term: string
  meta?: BlockMeta
}
export interface ColumnsBlock {
  type: 'columns'
  id: Ulid
  /**
   * @minItems 2
   * @maxItems 4
   */
  columns: [Block[], Block[]] | [Block[], Block[], Block[]] | [Block[], Block[], Block[], Block[]]
  /**
   * Optional per-column widths as percentages of the row. Length MUST equal columns.length when present, each value 5..95, and the sum SHOULD equal 100 (server normalises). Omit for equal split.
   *
   * @minItems 2
   * @maxItems 4
   */
  widths?: [number, number] | [number, number, number] | [number, number, number, number]
  meta?: BlockMeta
}
export interface TabsBlock {
  type: 'tabs'
  id: Ulid
  /**
   * @minItems 1
   */
  tabs: [
    {
      label: string
      blocks: Block[]
    },
    ...{
      label: string
      blocks: Block[]
    }[]
  ]
  meta?: BlockMeta
}
export interface AccordionBlock {
  type: 'accordion'
  id: Ulid
  /**
   * @minItems 1
   */
  items: [
    {
      label: string
      blocks: Block[]
    },
    ...{
      label: string
      blocks: Block[]
    }[]
  ]
  meta?: BlockMeta
}
/**
 * Live data block. Widget response shapes the data; render type fixes the renderer. For render=chart, the widget may include chartType / engine / interactions / options inline; chartOptions on the block deep-merges on top so document authors can override per-doc styling without touching the widget.
 */
export interface DataSourceBlock {
  type: 'data-source'
  id: Ulid
  endpoint: string
  params?: {}
  render: 'table' | 'chart' | 'kpi-cards'
  refreshInterval?: number
  /**
   * Per-document chart styling overrides (only for render=chart). Deep-merged ON TOP of widget-provided defaults — set just the fields you want to change.
   */
  chartOptions?: {
    chartType?: 'line' | 'bar' | 'pie' | 'area' | 'radar' | 'scatter' | 'xy-line' | 'boxplot'
    engine?: 'recharts' | 'echarts'
    title?: string
    interactions?: {
      keyPoints?: {
        label: string
        xIndex: number
        color?: string
      }[]
      regions?: {
        label: string
        xFromIndex: number
        xToIndex: number
        color?: string
      }[]
    }
    /**
     * Raw ECharts EChartsOption fragment, deep-merged after widget defaults + interactions.
     */
    options?: {}
  }
  meta?: BlockMeta
}
export interface DashboardEmbedBlock {
  type: 'dashboard-embed'
  id: Ulid
  provider: 'grafana' | 'tableau' | 'superset'
  panelId: string
  params?: {}
  meta?: BlockMeta
}
export interface CalculatorBlock {
  type: 'calculator'
  id: Ulid
  inputs: {
    name: string
    label: string
    default?: string | number | boolean
    kind?: 'number' | 'text' | 'select'
  }[]
  /**
   * 안전한 표현식 (mathjs 등)
   */
  formula: string
  label?: string
  meta?: BlockMeta
}
export interface WhiteboardBlock {
  type: 'whiteboard'
  id: Ulid
  title?: string
  viewbox: {
    w: number
    h: number
  }
  elements: WhiteboardElement[]
  meta?: BlockMeta
}
export interface FormBlock {
  type: 'form'
  id: Ulid
  title?: string
  description?: string
  /**
   * @minItems 1
   */
  questions: [FormQuestion, ...FormQuestion[]]
  submit_label?: string
  thanks_message?: string
  allow_multiple_responses?: boolean
  meta?: BlockMeta
}
export interface FormQuestion {
  id: string
  kind:
    | 'text'
    | 'long-text'
    | 'email'
    | 'number'
    | 'select'
    | 'multi-select'
    | 'checkbox'
    | 'rating-5'
    | 'date'
  label: string
  required?: boolean
  placeholder?: string
  options?: string[]
  /**
   * Numeric kinds (number): minimum allowed value (inclusive).
   */
  min?: number
  /**
   * Numeric kinds (number): maximum allowed value (inclusive).
   */
  max?: number
  /**
   * Text kinds (text/long-text/email): minimum string length.
   */
  minLength?: number
  /**
   * Text kinds (text/long-text/email): maximum string length.
   */
  maxLength?: number
  /**
   * Text kinds: ECMA-262 RegExp source. BE compiles defensively (silent skip on invalid).
   */
  pattern?: string
}
export interface PdfBlock {
  type: 'pdf'
  id: Ulid
  /**
   * FK to files table (mxwp-files); served via /api/v1/files/:file_id/download
   */
  file_id: string
  title?: string
  page?: number
  height_px?: number
  meta?: BlockMeta
}
export interface QuizBlock {
  type: 'quiz'
  id: Ulid
  title?: string
  description?: string
  /**
   * @minItems 1
   */
  questions: [QuizQuestion, ...QuizQuestion[]]
  passing_score?: number
  shuffle?: boolean
  max_attempts?: number
  show_answers_after?: boolean
  meta?: BlockMeta
}
export interface QuizQuestion {
  id: string
  kind: 'single-choice' | 'multi-choice' | 'true-false' | 'short-text'
  label: string
  options?: string[]
  correct: string | string[] | boolean
  explanation?: string
  points?: number
}
export interface ImageAnnotationBlock {
  type: 'image-annotation'
  id: Ulid
  /**
   * FK to images table (mxwp-images). Camel-case to match ImageBlock; BE normalizes legacy 'image_id' on read.
   */
  imageId: string
  caption?: string
  annotations: AnnotationElement[]
  meta?: BlockMeta
}
export interface SpreadsheetBlock {
  type: 'spreadsheet'
  id: Ulid
  title?: string
  cols: number
  rows: number
  headers?: string[]
  /**
   * Sparse map of cell-ref → raw cell input (e.g. {'A1':'42', 'B2':'=SUM(A1:A10)'})
   */
  cells: {
    [k: string]: string | undefined
  }
  /**
   * Visual rendering options. All fields optional with sensible defaults.
   */
  options?: {
    /**
     * Zebra-striped data rows for readability. Default true; set false to disable. Header row is unaffected.
     */
    stripe?: boolean
  }
  meta?: BlockMeta
}
/**
 * Reference list (참고문헌). Citations elsewhere in the document use the [[cite:KEY]] inline syntax to anchor-link into entries here. Most often produced by the DOCX importer when it sees a 'References' / '참고문헌' / 'Bibliography' heading.
 */
export interface BibliographyBlock {
  type: 'bibliography'
  id: Ulid
  /**
   * Optional override for the block heading. Defaults to '참고문헌' in the FE renderer.
   */
  title?: string
  /**
   * Citation style label (numeric / alphabetic / author-year). Currently informational — the FE renders ordered list either way.
   */
  style?: 'numeric' | 'alphabetic' | 'author-year'
  /**
   * @minItems 1
   */
  entries: [
    {
      /**
       * Optional citation key used by [[cite:KEY]] inline references. Alphanumeric / hyphen / underscore.
       */
      key?: string
      /**
       * Formatted reference body — e.g. 'Smith, J. (2020). Foo bar. Journal of X, 3(2), 14-22.'
       */
      text: string
      /**
       * Optional canonical URL (DOI, journal page).
       */
      url?: string
    },
    ...{
      /**
       * Optional citation key used by [[cite:KEY]] inline references. Alphanumeric / hyphen / underscore.
       */
      key?: string
      /**
       * Formatted reference body — e.g. 'Smith, J. (2020). Foo bar. Journal of X, 3(2), 14-22.'
       */
      text: string
      /**
       * Optional canonical URL (DOI, journal page).
       */
      url?: string
    }[]
  ]
  /**
   * 표시 옵션. 모두 optional, default 동작은 ON.
   */
  options?: {
    /**
     * 참고문헌 항목 단위 zebra-striping (각 entry 행).
     */
    stripe?: boolean
  }
  meta?: BlockMeta
}
/**
 * Explicit vertical spacer. Default inter-block spacing is tight (8px). Insert a spacer block to add deliberate breathing room. `size` chooses the gap: sm=16px, md=32px (default), lg=64px, xl=128px.
 */
export interface SpacerBlock {
  type: 'spacer'
  id: Ulid
  size?: 'sm' | 'md' | 'lg' | 'xl'
  meta?: BlockMeta
}
/**
 * Auto-generated table of figures (그림/표/차트 목차). The renderer walks the document and lists every captioned image, table (with caption), and chart (with title), each linked to its anchor. `kinds` controls which lists to render.
 */
export interface FigureIndexBlock {
  type: 'figure-index'
  id: Ulid
  title?: string
  /**
   * Which figure types to include — 'image' (그림), 'table' (표), 'chart' (차트). Order in this array determines section order. Omit for all three.
   *
   * @minItems 1
   * @maxItems 3
   */
  kinds?:
    | ['image' | 'table' | 'chart']
    | ['image' | 'table' | 'chart', 'image' | 'table' | 'chart']
    | ['image' | 'table' | 'chart', 'image' | 'table' | 'chart', 'image' | 'table' | 'chart']
  /**
   * 표시 옵션. 모두 optional, default 동작은 ON.
   */
  options?: {
    /**
     * 그룹별 <ol> 안에서 항목 단위 zebra-striping (각 그룹 내 카운터 리셋).
     */
    stripe?: boolean
  }
  meta?: BlockMeta
}
/**
 * Pivot table widget — Excel pivot table 동등. raw rows 를 rows × cols × values 축으로 cross-tab 집계. Sprint 1 = inline source + 기본 집계 (sum/count/avg/min/max). Subtotal/grand total/sort/filter 는 Sprint 2, % of total / 누적 / numberFormat 은 Sprint 3 (measure.showAs + measure.numberFormat). Sprint 4 = calculated field (measure.expr — 'revenue - cost' 같은 식, formulaEngine 산술 subset 평가 후 agg).
 */
export interface PivotTableBlock {
  type: 'pivot-table'
  id: Ulid
  source: {
    kind: 'inline' | 'csv'
    /**
     * Raw rows — each is a flat object of field→value. csv kind 이면 CSV text 도 inline 으로 paste 시점에 parse 후 저장.
     */
    rows: {
      [k: string]: (string | number | null) | undefined
    }[]
    /**
     * Optional — fields 자동 추론 가능하면 생략. 명시 시 우선.
     */
    schema?: {
      fields?: {
        name: string
        dtype: 'number' | 'string' | 'date'
      }[]
    }
  }
  /**
   * Row 축 dimension field 이름 list (e.g., ['department', 'year']). Sprint 5 — 각 항목은 단순 field 이름 (문자열) 이거나 시간 자동 그룹을 위해 {field, group} object. group 은 'year'|'quarter'|'month'|'week'|'day' 중 하나로 raw row 의 date 를 bucket. 미명시 field 는 raw value 사용.
   */
  rows: (
    | string
    | {
        field: string
        /**
         * raw row 의 date 를 bucket 할 단위. year=YYYY, quarter=YYYY-Q1..4, month=YYYY-MM, week=YYYY-Www(ISO), day=YYYY-MM-DD. row[field] 가 ISO date string / epoch ms / Date 로 파싱 가능한 값이어야 함.
         */
        group?: 'year' | 'quarter' | 'month' | 'week' | 'day'
      }
  )[]
  /**
   * Col 축 dimension field 이름 list. 빈 배열 = col 축 없음 (flat aggregation). rows 와 동일하게 시간 그룹 object 형식 허용.
   */
  cols: (
    | string
    | {
        field: string
        group?: 'year' | 'quarter' | 'month' | 'week' | 'day'
      }
  )[]
  /**
   * Measure(s) — Sprint 1 은 1개 이상.
   *
   * @minItems 1
   */
  values: [
    {
      field?: string
      /**
       * Sprint 4 — calculated field 식. 각 row 의 fields 를 식별자로 참조하는 산술식 (예: 'revenue - cost', 'profit / revenue * 100'). 지원 연산: + - * / 와 괄호. 평가 결과를 numeric 으로 모은 뒤 agg 적용 (sum/avg/...). 잘못된 식이거나 row 에 필드 없을 시 그 row 는 무시.
       */
      expr?: string
      agg: 'sum' | 'count' | 'avg' | 'min' | 'max' | 'median' | 'stdev' | 'var'
      /**
       * 표시 이름; default = '{agg}({field})' 또는 '{agg}({expr})'
       */
      label?: string
      /**
       * Sprint 3 — 값 표시 방식. value=raw, pct_row=row total 대비 %, pct_col=col total 대비 %, pct_total=grand total 대비 %, running=row 안 col 순서 누적 합.
       */
      showAs?: 'value' | 'pct_row' | 'pct_col' | 'pct_total' | 'running'
      /**
       * Sprint 3 — viewer 포맷 패턴. 예: '#,##0.00' (thousands+2dp), '0.0%' (percent 1dp), '#,##0' (integer thousands). 미설정 시 default toLocaleString (≤4dp, trailing 0 strip).
       */
      numberFormat?: string
    },
    ...{
      field?: string
      /**
       * Sprint 4 — calculated field 식. 각 row 의 fields 를 식별자로 참조하는 산술식 (예: 'revenue - cost', 'profit / revenue * 100'). 지원 연산: + - * / 와 괄호. 평가 결과를 numeric 으로 모은 뒤 agg 적용 (sum/avg/...). 잘못된 식이거나 row 에 필드 없을 시 그 row 는 무시.
       */
      expr?: string
      agg: 'sum' | 'count' | 'avg' | 'min' | 'max' | 'median' | 'stdev' | 'var'
      /**
       * 표시 이름; default = '{agg}({field})' 또는 '{agg}({expr})'
       */
      label?: string
      /**
       * Sprint 3 — 값 표시 방식. value=raw, pct_row=row total 대비 %, pct_col=col total 대비 %, pct_total=grand total 대비 %, running=row 안 col 순서 누적 합.
       */
      showAs?: 'value' | 'pct_row' | 'pct_col' | 'pct_total' | 'running'
      /**
       * Sprint 3 — viewer 포맷 패턴. 예: '#,##0.00' (thousands+2dp), '0.0%' (percent 1dp), '#,##0' (integer thousands). 미설정 시 default toLocaleString (≤4dp, trailing 0 strip).
       */
      numberFormat?: string
    }[]
  ]
  options?: {
    /**
     * default '-'
     */
    emptyCell?: string
  }
  /**
   * Sprint 2 — subtotal/grand total 토글
   */
  totals?: {
    /**
     * row+col 교차 grand total cell
     */
    grand?: boolean
    /**
     * 각 row 마지막 col 에 row total
     */
    row?: boolean
    /**
     * 각 col 마지막 row 에 col total
     */
    col?: boolean
  }
  /**
   * Sprint 5 — 행/열 축 안 가상 항목 (e.g. 'Q1 = Jan + Feb + Mar'). 각 item 은 base aggregation 이 끝난 후 합성. formula 는 다른 같은-축 항목 라벨을 식별자로 참조하는 산술식 (+ - * / 와 괄호). 평가는 각 measure × (반대 축의 각 위치) 마다 한 번. base 항목과 라벨 충돌 시 calculated item 가 추가 (덮어쓰기 X).
   */
  calculatedItems?: {
    /**
     * 어느 축에 추가할지
     */
    axis: 'row' | 'col'
    /**
     * 축 위 표시 라벨
     */
    name: string
    /**
     * 산술식. 같은 축 항목 라벨을 식별자로. 공백/한글 라벨은 백틱으로 감싸기: '`Jan` + `Feb` + `Mar`'.
     */
    formula: string
  }[]
  sort?: {
    axis: 'row' | 'col'
    /**
     * dimension 이름 또는 measure label
     */
    by: string
    order?: 'asc' | 'desc'
  }
  filters?: {
    field: string
    op: 'in' | 'not_in' | 'gt' | 'lt' | 'top_n' | 'bottom_n'
    value: any
  }[]
  meta?: BlockMeta
}
export interface RelatedDoc {
  slug: Slug
  relation: string
}
export interface GlossaryItem {
  term: string
  definition: string
}
export interface Reference {
  type: 'internal' | 'external'
  label: string
  url?: string
}

// ── Backwards-compatibility aliases ──────────────────────────────────
// The schema collapsed the explicit level-1/2/3 Section interfaces into a
// single recursive `Section`. These aliases keep older imports compiling.
export type SectionLevel1 = Section
export type SectionLevel2 = Section
export type SectionLevel3 = Section
