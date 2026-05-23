import type {
  Block,
  DocumentJSONV10,
  SectionLevel1,
  SectionLevel2,
} from '@/types/document'
import { isSpeakerNoteParagraph } from '@/components/blocks/ParagraphBlock'

/**
 * Slide is one screen in presentation mode.
 *
 *  - kind="title"    → cover slide (doc title + summary + meta strip)
 *  - kind="section"  → a Section becomes a slide; renders heading + blocks
 */
export interface TitleSlide {
  kind: 'title'
  key: string
  title: string
  summary?: string
  meta: { path: string; tags: readonly string[]; confidentiality?: string }
}
export interface SectionSlide {
  kind: 'section'
  key: string
  number: string
  title: string
  level: 1 | 2
  section: SectionLevel1 | SectionLevel2
  /**
   * 한 섹션이 여러 슬라이드로 분할됐을 때 *이 슬라이드에만* 렌더할 body
   * 블록 부분집합. 미정이면 호출 측이 section.blocks 전체를 본다 (legacy).
   * speaker-note 는 제외된 상태 — splitSpeakerNotes 후의 body 만 담는다.
   */
  bodyBlocks?: Block[]
  /**
   * 0 = 섹션의 첫 슬라이드 (제목 그대로 표시), 1+ = "(계속)" 슬라이드.
   * 미정이면 0 으로 간주.
   */
  continuation?: number
  /**
   * 같은 section.id 에서 갈라진 슬라이드의 총 개수. UI 에서 "2/3" 같이 표시
   * 가능. 미정이면 분할 없음.
   */
  totalContinuations?: number
}
export type Slide = TitleSlide | SectionSlide

export interface BuildSlidesOptions {
  /**
   * When true, expose level-2 subsections as their own slides immediately
   * after their parent (Reveal.js "vertical" feel). Default false.
   */
  nested?: boolean
  /**
   * Auto-split a section into multiple slides when its blocks won't fit one
   * screen comfortably. Default true. Pure heuristic — see SLIDE_WEIGHT_*.
   */
  autoSplit?: boolean
}

// ── Block-weight 휴리스틱 ───────────────────────────────────────────────────
//
// 한 슬라이드에 들어가는 컨텐츠가 화면을 넘치지 않게 — 정확한 측정이 아니라
// 합리적 추정 (DOM 없이 순수 함수). 각 block 의 "시각 무게" 를 점수로 환산해
// 누적이 SLIDE_BUDGET 을 넘으면 새 슬라이드를 연다.
//
// 단위 감각:
//   - 빈 paragraph 1 = ~50 점 정도 가정
//   - 1 줄 문단 (~50자) ≈ 50, 4 줄 문단 (~200자) ≈ 200
//   - heading-4 = 100 (제목 + 줄바꿈)
//   - table 작은 거 (~5x3) = 250, 큰 거 (>10 행) = 500+
//   - chart/kpi/gantt/flow/org/whiteboard 같은 시각 위주 = 400~500 (단독에 가까움)
//   - image = 300 (대형 시각 자료)
const SLIDE_BUDGET = 700

/** block 별 weight 점수. 시각 위주 (chart 등) 는 단독 슬라이드에 가깝게. */
function _blockWeight(b: Block | undefined): number {
  if (!b) return 0
  const t = b.type as string

  // 텍스트 위주 — 글자 수 기반 추정. 너무 길면 cap.
  if (t === 'paragraph') {
    const text = ((b as { text?: string }).text ?? '').length
    // 50자 ≈ 50점, 200자 ≈ 200점, 그 이상은 cap.
    return Math.min(300, Math.max(40, text * 1.0))
  }
  if (t === 'heading-4') {
    return 100
  }
  if (t === 'quote' || t === 'callout' || t === 'code' || t === 'math') {
    const text = ((b as { text?: string }).text ?? '').length
    return Math.min(400, Math.max(120, text * 1.0 + 80))
  }
  if (t === 'list') {
    const items = ((b as { items?: unknown[] }).items ?? []) as string[]
    // 각 항목 50점 + 평균 글자 가중.
    const charSum = items.reduce(
      (a, it) => a + (typeof it === 'string' ? it.length : 0),
      0,
    )
    return Math.min(600, items.length * 50 + charSum * 0.5)
  }
  if (t === 'table') {
    const rows = ((b as { rows?: unknown[] }).rows ?? []).length
    const headers = ((b as { headers?: unknown[] }).headers ?? []).length
    // 표는 행수 + 컬럼 폭에 따라 무게 결정.
    return Math.min(900, 150 + rows * 50 + headers * 20)
  }
  if (t === 'image' || t === 'gallery' || t === 'pdf' || t === 'image-annotation') {
    return 450  // 큰 시각 자료 — 거의 단독.
  }
  if (
    t === 'chart' || t === 'kpi-cards' || t === 'gantt' || t === 'flow' ||
    t === 'org-chart' || t === 'whiteboard' || t === 'spreadsheet'
  ) {
    return 500  // 단독에 가까움.
  }
  if (t === 'iframe' || t === 'video') {
    return 500
  }
  if (t === 'columns' || t === 'tabs' || t === 'accordion') {
    // 자식 합을 적당히 가중 — children walk 는 비용 커서 conservative cap.
    return 500
  }
  // 그 외 unknown — 보수적으로.
  return 200
}

/**
 * 자기만의 슬라이드를 갖는 게 자연스러운 시각-중심 블록인지. 이 종류가 한 번
 * 등장하면 그 직전 paragraph 1개 (있으면) 와 함께 단독 슬라이드로 분리.
 */
function _isSoloVisual(b: Block | undefined): boolean {
  if (!b) return false
  const t = b.type as string
  return (
    t === 'chart' || t === 'kpi-cards' || t === 'gantt' || t === 'flow' ||
    t === 'org-chart' || t === 'whiteboard' || t === 'spreadsheet' ||
    t === 'image-annotation' || t === 'gallery' || t === 'iframe' ||
    t === 'video' || t === 'pdf'
  )
}

/**
 * 한 섹션의 body blocks 를 슬라이드용 청크 배열로 분할. 순수 함수.
 *
 * 규칙 (우선순위 순):
 *   1. solo-visual 블록은 자기만의 슬라이드. 직전 블록이 paragraph 면 같이 (캡션 역할).
 *   2. 그 외 블록은 누적 weight ≤ SLIDE_BUDGET 까지 한 청크에 모음.
 *   3. 단일 블록 weight 가 BUDGET 초과여도 단독 슬라이드로 (분할 안 함 — block 내부 자를 수 없으니).
 *
 * 빈 입력 → 빈 배열. 한 슬라이드에 들어가는 경우 → 길이 1.
 */
export function chunkBlocksForSlides(blocks: readonly Block[]): Block[][] {
  if (blocks.length === 0) return []
  const chunks: Block[][] = []
  let cur: Block[] = []
  let curW = 0
  const flush = () => {
    if (cur.length > 0) {
      chunks.push(cur)
      cur = []
      curW = 0
    }
  }
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!
    if (_isSoloVisual(b)) {
      // solo-visual: 직전 paragraph 가 현재 청크의 마지막이면 그것까지 같이.
      let caption: Block | null = null
      if (cur.length > 0) {
        const last = cur[cur.length - 1]!
        if (last.type === 'paragraph') {
          caption = last
          cur = cur.slice(0, -1)
        }
      }
      flush()
      chunks.push(caption ? [caption, b] : [b])
      continue
    }
    const w = _blockWeight(b)
    // 현재 청크가 비어있지 않은데 합치면 BUDGET 초과 → flush 후 새 청크.
    if (cur.length > 0 && curW + w > SLIDE_BUDGET) {
      flush()
    }
    cur.push(b)
    curW += w
  }
  flush()
  return chunks
}

/**
 * Pure: derive a flat slide list from a DocumentJSON. Always produces at
 * least the title slide.
 */
export function buildSlides(
  doc: DocumentJSONV10,
  opts: BuildSlidesOptions = {},
): Slide[] {
  if (!doc) return []
  const md = doc.metadata ?? ({} as DocumentJSONV10['metadata'])
  const path = [md.division, md.team, md.group, md.part]
    .filter((x): x is string => Boolean(x))
    .join(' / ')
  const slides: Slide[] = [
    {
      kind: 'title',
      key: `title:${doc.slug ?? 'unknown'}`,
      title: doc.title ?? '',
      summary: doc.summary,
      meta: {
        path,
        tags: Array.isArray(md.tags) ? md.tags : [],
        confidentiality: md.confidentiality,
      },
    },
  ]
  const autoSplit = opts.autoSplit ?? true
  const sections = Array.isArray(doc.sections) ? doc.sections : []

  // 섹션 → 1 개 이상의 SectionSlide. autoSplit 가 켜졌고 본문 weight 가
  // SLIDE_BUDGET 초과면 chunkBlocksForSlides 로 나눠 continuation 슬라이드 생성.
  const pushSection = (
    sec: SectionLevel1 | SectionLevel2,
    level: 1 | 2,
  ) => {
    const baseKey = `sec:${sec.id ?? Math.random().toString(36)}`
    if (!autoSplit) {
      slides.push({
        kind: 'section',
        key: baseKey,
        number: sec.number ?? '',
        title: sec.title ?? '',
        level,
        section: sec,
      })
      return
    }
    const allBlocks = Array.isArray(sec.blocks) ? sec.blocks : []
    const { body } = splitSpeakerNotes(allBlocks)
    const chunks = chunkBlocksForSlides(body)
    if (chunks.length <= 1) {
      // 분할 불필요 — 기존과 동일 (bodyBlocks 미정 = legacy 렌더).
      slides.push({
        kind: 'section',
        key: baseKey,
        number: sec.number ?? '',
        title: sec.title ?? '',
        level,
        section: sec,
      })
      return
    }
    // 분할 — 각 chunk 가 자기만의 SectionSlide. 첫 슬라이드만 원제목, 이후는
    // "(계속)". key 끝에 인덱스 붙여 React 키 충돌 방지.
    for (let i = 0; i < chunks.length; i++) {
      slides.push({
        kind: 'section',
        key: `${baseKey}#${i}`,
        number: sec.number ?? '',
        title: sec.title ?? '',
        level,
        section: sec,
        bodyBlocks: chunks[i]!,
        continuation: i,
        totalContinuations: chunks.length,
      })
    }
  }

  for (const section of sections) {
    if (!section) continue
    pushSection(section, 1)
    if (opts.nested) {
      const subs = Array.isArray(section.subsections) ? section.subsections : []
      for (const sub of subs) {
        if (!sub) continue
        pushSection(sub, 2)
      }
    }
  }
  return slides
}

/**
 * Pure navigation reducer. Index always clamped to [0, total - 1].
 *
 * "next"/"prev" do nothing at the boundaries instead of wrapping — wrapping
 * surprises presenters mid-talk.
 */
export type NavCommand =
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'first' }
  | { type: 'last' }
  | { type: 'goto'; index: number }

export function navigate(current: number, total: number, cmd: NavCommand): number {
  const last = Math.max(0, total - 1)
  switch (cmd.type) {
    case 'next':
      return Math.min(current + 1, last)
    case 'prev':
      return Math.max(current - 1, 0)
    case 'first':
      return 0
    case 'last':
      return last
    case 'goto':
      return Math.min(Math.max(cmd.index, 0), last)
  }
}

/**
 * Map a keyboard event to a NavCommand (or null if it shouldn't navigate).
 * Pure — no DOM access; tests pass plain objects.
 */
export interface KeyEventLike {
  key: string
  shiftKey?: boolean
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
}

export function keyToNav(ev: KeyEventLike): NavCommand | null {
  // Ignore modified shortcuts so Cmd-R / Ctrl-K still work.
  // (Shift-only is fine — the Presentation page handles Shift+P explicitly.)
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return null
  switch (ev.key) {
    case 'ArrowRight':
    case ' ':
    case 'PageDown':
      return { type: 'next' }
    case 'ArrowLeft':
    case 'PageUp':
      return { type: 'prev' }
    case 'Home':
      return { type: 'first' }
    case 'End':
      return { type: 'last' }
    default:
      // Digit keys 1..9 jump to slide N (1-based).
      if (/^[1-9]$/.test(ev.key)) {
        return { type: 'goto', index: Number(ev.key) - 1 }
      }
      return null
  }
}

/**
 * Split a section's blocks into the visible slide body (everything except
 * speaker-note paragraphs) and the presenter notes (speaker-note paragraphs,
 * in source order). Pure: takes a Block[], returns two Block[] slices.
 */
export interface SlideBlockSplit {
  body: Block[]
  notes: Block[]
}
export function splitSpeakerNotes(blocks: readonly (Block | undefined)[]): SlideBlockSplit {
  const body: Block[] = []
  const notes: Block[] = []
  for (const b of blocks) {
    if (!b) continue
    if (b.type === 'paragraph' && isSpeakerNoteParagraph(b.meta)) {
      notes.push(b)
    } else {
      body.push(b)
    }
  }
  return { body, notes }
}

/**
 * Extract the human-readable speaker-note text for a slide. Concatenates the
 * `text` fields of every speaker-note paragraph in `slide.section.blocks`,
 * separated by blank lines. Returns the empty string for title slides or
 * sections with no notes.
 */
export function speakerNotesFor(slide: Slide): string {
  if (slide.kind !== 'section') return ''
  const blocks = Array.isArray(slide.section?.blocks) ? slide.section.blocks : []
  const { notes } = splitSpeakerNotes(blocks)
  return notes
    .map((b) => (b.type === 'paragraph' ? b.text : ''))
    .filter(Boolean)
    .join('\n\n')
}
