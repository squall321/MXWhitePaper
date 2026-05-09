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
   * 최상위 섹션은 반드시 level=1
   */
  sections: SectionLevel1[]
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
 * 우상단 정보 박스. 키=라벨, 값=문자열 또는 문자열 배열
 */
export interface Infobox {
  [k: string]: (string | string[]) | undefined
}
export interface SectionLevel1 {
  id: Ulid
  number?: string
  level: 1
  title: string
  blocks: Block[]
  subsections: SectionLevel2[]
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
}
export interface Heading4Block {
  type: 'heading-4'
  id: Ulid
  title: string
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
export interface TableBlock {
  type: 'table'
  id: Ulid
  headers: string[]
  rows: string[][]
  options?: {
    sortable?: boolean
    searchable?: boolean
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
export interface ChartBlock {
  type: 'chart'
  id: Ulid
  chartType: 'line' | 'bar' | 'pie' | 'area' | 'radar' | 'scatter'
  title?: string
  data: {
    labels: string[]
    series: {
      name: string
      values: number[]
    }[]
  }
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
export interface IframeBlock {
  type: 'iframe'
  id: Ulid
  /**
   * 사내 화이트리스트 도메인만
   */
  src: string
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
   * Crockford base32 ULID
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
      imageId: Ulid
      caption?: string
      alt?: string
    },
    ...{
      imageId: Ulid
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
export interface DataSourceBlock {
  type: 'data-source'
  id: Ulid
  endpoint: string
  params?: {}
  render: 'table' | 'chart' | 'kpi-cards'
  refreshInterval?: number
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
export interface SectionLevel2 {
  id: Ulid
  number?: string
  level: 2
  title: string
  blocks: Block[]
  subsections: SectionLevel3[]
}
export interface SectionLevel3 {
  id: Ulid
  number?: string
  level: 3
  title: string
  blocks: Block[]
  /**
   * level 3은 더 깊은 섹션 불가 (heading-4 Block으로 표현)
   *
   * @maxItems 0
   */
  subsections?: []
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
