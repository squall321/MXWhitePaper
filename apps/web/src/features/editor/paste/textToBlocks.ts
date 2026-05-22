/**
 * textToBlocks — pure plain-text → DocumentJSON Block[] parser.
 *
 * `htmlToBlocks` 의 짝. Word/메모장/터미널/코드에서 복사한 `text/plain` 을
 * 붙여넣을 때, 줄 구조 (번호목록·불릿·들여쓰기·markdown 헤딩·문단) 를 인식해
 * list / heading-4 / paragraph 블록으로 분해한다.
 *
 * 의도적으로 **markdown 전체 파서가 아니다** — 헤딩(ATX `#`)·목록·문단만.
 * 인라인 강조 (`**bold**` 등) 는 무시 (rich 강조는 HTML paste 경로 담당).
 *
 * Pure module. No DOM, no fetch. ULID 만 부수효과 (블록 id).
 */
import { ulid } from '../ulid'
import type { Block, Heading4Block, ListBlock, ParagraphBlock } from '@/types/document'

export interface TextToBlocksResult {
  blocks: Block[]
}

type ListStyle = 'bullet' | 'number' | 'check'

interface ParsedLine {
  /** 들여쓰기 depth — 탭 1개 또는 공백 2칸 = depth 1. */
  depth: number
  /** list item 이면 style, 아니면 null. */
  listStyle: ListStyle | null
  /** markdown ATX 헤딩이면 level (2~4), 아니면 null. */
  headingLevel: 2 | 3 | 4 | null
  /** prefix 를 제거한 본문 텍스트. */
  text: string
  /** 공백만 있는 빈 줄. */
  blank: boolean
}

// 번호 목록: "1. " "1) " "12. " — 숫자 + . 또는 ) + 공백.
const NUMBER_RE = /^(\d+)[.)]\s+(.*)$/
// 불릿: "- " "* " "• " "· " "‣ " "▪ " — 흔한 불릿 문자 + 공백.
const BULLET_RE = /^[-*•·‣▪◦]\s+(.*)$/
// 체크박스: "[ ] " "[x] " "[X] " — 불릿보다 먼저 검사.
const CHECK_RE = /^\[([ xX])\]\s+(.*)$/
// markdown ATX 헤딩: "# " ~ "###### " — # 1~6 개 + 공백.
const HEADING_RE = /^(#{1,6})\s+(.*)$/

/** 줄 앞 들여쓰기 길이 → depth. 탭 1개 = 1, 공백 2칸 = 1 (htmlPaste 컨벤션). */
function indentDepth(raw: string): number {
  let i = 0
  let spaces = 0
  let depth = 0
  while (i < raw.length) {
    const c = raw[i]
    if (c === '\t') {
      depth += 1
      i++
    } else if (c === ' ') {
      spaces++
      i++
    } else {
      break
    }
  }
  depth += Math.floor(spaces / 2)
  return depth
}

function parseLine(raw: string): ParsedLine {
  if (raw.trim().length === 0) {
    return { depth: 0, listStyle: null, headingLevel: null, text: '', blank: true }
  }
  const depth = indentDepth(raw)
  const body = raw.slice(raw.length - raw.trimStart().length)
  const content = raw.trimStart()

  // 헤딩 — 들여쓰기 무시 (헤딩에 depth 개념 없음).
  const hm = HEADING_RE.exec(content)
  if (hm) {
    const hashes = hm[1]!.length
    // htmlToBlocks 와 동일: h1/h2 → 2, h3 → 3, h4+ → 4.
    const level: 2 | 3 | 4 = hashes <= 2 ? 2 : hashes === 3 ? 3 : 4
    return { depth: 0, listStyle: null, headingLevel: level, text: hm[2]!.trim(), blank: false }
  }

  // 체크박스 (불릿보다 먼저 — "[ ]" 가 불릿 아님).
  const cm = CHECK_RE.exec(content)
  if (cm) {
    return { depth, listStyle: 'check', headingLevel: null, text: cm[2]!.trim(), blank: false }
  }

  // 번호 목록.
  const nm = NUMBER_RE.exec(content)
  if (nm) {
    return { depth, listStyle: 'number', headingLevel: null, text: nm[2]!.trim(), blank: false }
  }

  // 불릿.
  const bm = BULLET_RE.exec(content)
  if (bm) {
    return { depth, listStyle: 'bullet', headingLevel: null, text: bm[1]!.trim(), blank: false }
  }

  // 일반 텍스트 — body 변수는 위에서 안 쓰지만 trimStart 결과를 그대로 본문으로.
  void body
  return { depth, listStyle: null, headingLevel: null, text: content.trim(), blank: false }
}

function makeParagraph(text: string): ParagraphBlock {
  return { type: 'paragraph', id: ulid(), text }
}

function makeHeading(text: string, level: 2 | 3 | 4): Heading4Block {
  return { type: 'heading-4', id: ulid(), title: text, level }
}

function makeList(style: ListStyle, items: string[]): ListBlock {
  return { type: 'list', id: ulid(), style, items }
}

/**
 * plain text 가 "구조적" 인지 — 즉 textToBlocks 로 분해할 가치가 있는지 판정.
 *
 * 보수적: 다음 중 하나라도 만족할 때만 true.
 *   - list prefix (번호/불릿/체크) 가 한 줄 이상
 *   - markdown ATX 헤딩이 한 줄 이상
 *   - 빈 줄로 구분된 문단이 2개 이상
 *
 * false 면 호출 측은 기존 단일 paragraph 동작을 유지하면 된다.
 */
export function looksLikeStructuredText(text: string): boolean {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  let hasList = false
  let hasHeading = false
  let paragraphRuns = 0
  let inParagraph = false

  for (const raw of lines) {
    const p = parseLine(raw)
    if (p.blank) {
      inParagraph = false
      continue
    }
    if (p.listStyle) hasList = true
    if (p.headingLevel) hasHeading = true
    if (!inParagraph) {
      paragraphRuns++
      inParagraph = true
    }
  }

  return hasList || hasHeading || paragraphRuns >= 2
}

/**
 * plain text → Block[]. 줄 단위 1-pass 스캔.
 *
 *  - 연속된 같은 style 의 list item → 하나의 list 블록 (style 바뀌면 새 블록).
 *  - 들여쓰기 depth → item 텍스트 앞 `"  "` × depth (htmlPaste 컨벤션).
 *  - markdown 헤딩 → heading-4 블록 (level 2~4).
 *  - 그 외 줄 → paragraph. 연속 텍스트 줄은 빈 줄 만날 때까지 한 문단으로 합침.
 *  - 패턴이 전혀 없는 단일 텍스트 → paragraph 1개.
 */
export function textToBlocks(text: string): TextToBlocksResult {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const blocks: Block[] = []

  // 진행 중인 list / paragraph 누적 버퍼.
  let listStyle: ListStyle | null = null
  let listItems: string[] = []
  let paraLines: string[] = []

  const flushList = () => {
    if (listStyle && listItems.length > 0) {
      blocks.push(makeList(listStyle, listItems))
    }
    listStyle = null
    listItems = []
  }
  const flushPara = () => {
    if (paraLines.length > 0) {
      blocks.push(makeParagraph(paraLines.join('\n')))
    }
    paraLines = []
  }

  for (const raw of lines) {
    const p = parseLine(raw)

    if (p.blank) {
      // 빈 줄 = 블록 경계.
      flushList()
      flushPara()
      continue
    }

    if (p.headingLevel) {
      flushList()
      flushPara()
      blocks.push(makeHeading(p.text, p.headingLevel))
      continue
    }

    if (p.listStyle) {
      flushPara()
      // style 이 바뀌면 새 list 블록.
      if (listStyle !== null && listStyle !== p.listStyle) {
        flushList()
      }
      listStyle = p.listStyle
      const prefix = '  '.repeat(p.depth)
      listItems.push(prefix + p.text)
      continue
    }

    // 일반 텍스트 줄.
    flushList()
    paraLines.push(p.text)
  }

  flushList()
  flushPara()

  // 아무것도 못 만들었으면 (전부 빈 줄 등) — 원문 그대로 paragraph 1개.
  if (blocks.length === 0) {
    blocks.push(makeParagraph(text.trim()))
  }

  return { blocks }
}
