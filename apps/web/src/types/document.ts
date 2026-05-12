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
      text: string
      color: string
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
   * Optional sparse cell list for tables with merged or styled cells (DOCX gridSpan/vMerge round-trip + per-cell style overrides). When present, the renderer ignores headers/rows and lays out from this list. Each cell occupies (r..r+rowSpan-1) × (c..c+colSpan-1); covered slots have no entry. r/c are 0-indexed; the first row of a header-mode table is the header row.
   */
  cells?: {
    r: number
    c: number
    rowSpan?: number
    colSpan?: number
    text: string
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
  }
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
  }[]
  meta?: BlockMeta
}
/**
 * Chart block — `engine` selects the renderer. 'recharts' (default) uses our existing simple chart UI; 'echarts' unlocks rich interaction (zoom, brush, hover slope, markPoint annotations, markArea regions). With 'echarts' the data fields below still drive the dataset, but `options` accepts any ECharts EChartsOption fragment that gets merged on top.
 */
export interface ChartBlock {
  type: 'chart'
  id: Ulid
  chartType: 'line' | 'bar' | 'pie' | 'area' | 'radar' | 'scatter'
  /**
   * Chart renderer. Default 'recharts' for back-compat; choose 'echarts' for rich interactivity (markPoint / markArea / brush / dataZoom).
   */
  engine?: 'recharts' | 'echarts'
  title?: string
  data: {
    labels: string[]
    series: {
      name: string
      values: number[]
    }[]
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
/**
 * Embed an external page (`src`) OR an inline self-contained HTML document (`html`). Exactly one MUST be set. The renderer wraps the iframe in a sandbox boundary so the embed can't reach the parent DOM, cookies, or storage; only `allow-scripts` is granted so interactive embeds (charts, calculators) still work.
 */
export interface IframeBlock {
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
}
export interface VideoBlock {
  type: 'video'
  id: Ulid
  url: string
  title?: string
  provider?: 'intra' | 'youtube' | 'vimeo'
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
    chartType?: 'line' | 'bar' | 'pie' | 'area' | 'radar' | 'scatter'
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
   * FK to images table (mxwp-images)
   */
  image_id: string
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
  meta?: BlockMeta
}
/**
 * Explicit vertical spacer. Default inter-block spacing is tight (8px). Insert a spacer block to add deliberate breathing room. `size` chooses the gap: sm=16px, md=32px (default), lg=64px.
 */
export interface SpacerBlock {
  type: 'spacer'
  id: Ulid
  size?: 'sm' | 'md' | 'lg'
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
