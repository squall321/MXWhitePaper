/**
 * Reading-time estimation for DocumentJSON.
 *
 * Walks every text-bearing block (paragraph / heading / list / quote /
 * callout) across the entire section tree, then estimates minutes assuming:
 *
 *   - Korean reading speed: 500 chars/min
 *   - English reading speed: 200 words/min
 *
 * 결과를 양 언어 비율에 따라 가중평균한다 — 영어 위주면 word/200, 한국어
 * 위주면 char/500, 혼합문은 둘 사이 어딘가. 항상 최소 1분으로 반올림한다.
 *
 * Edge cases:
 *   - 본문이 비어 있으면 0 반환 → caller 가 pill 렌더를 생략
 *   - chart/table/code/math 같은 비 텍스트 블록은 의도적으로 제외
 *   - 매우 긴 문서는 캡 없이 그대로 분 단위로 보고
 */
import type {
  Block,
  DocumentJSONV10,
  SectionLevel1,
  SectionLevel2,
  SectionLevel3,
} from '@/types/document'

const KO_CPM = 500
const EN_WPM = 200

/** Korean reading speed (chars/minute) — exposed for tests/calibration. */
export const KOREAN_CHARS_PER_MIN = KO_CPM
export const ENGLISH_WORDS_PER_MIN = EN_WPM

type AnySection = SectionLevel1 | SectionLevel2 | SectionLevel3

function* walkSections(sections: readonly AnySection[]): Generator<AnySection> {
  for (const s of sections ?? []) {
    if (!s) continue
    yield s
    if ('subsections' in s && Array.isArray(s.subsections)) {
      yield* walkSections(s.subsections as AnySection[])
    }
  }
}

/**
 * Pull every user-facing text fragment out of a block. Returns `[]` for any
 * block type that has no readable prose (chart, table, math, code, …).
 */
function blockText(block: Block): string[] {
  switch (block.type) {
    case 'paragraph':
      return [block.text ?? '']
    case 'heading-4':
      return [block.title ?? '']
    case 'list':
      return Array.isArray(block.items) ? block.items.map((i) => String(i ?? '')) : []
    case 'quote':
      return [block.text ?? '', block.cite ?? '']
    case 'callout':
      return [block.title ?? '', block.text ?? '']
    default:
      return []
  }
}

/** Korean (Hangul syllables + Jamo + CJK incl. compat ideographs). */
const KOREAN_RE = /[ㄱ-ㆎ가-힣ᄀ-ᇿ㐀-䶿一-鿿]/gu

/**
 * Count Korean (CJK) characters and English words in `text`.
 * - Korean count = matches against the Hangul/CJK regex (whitespace excluded).
 * - English words = whitespace-separated tokens that include at least one
 *   ASCII letter; ensures pure-numeric or symbol-only tokens don't inflate.
 */
function countTokens(text: string): { koreanChars: number; englishWords: number } {
  if (!text) return { koreanChars: 0, englishWords: 0 }
  const koreanChars = (text.match(KOREAN_RE) ?? []).length
  // Strip Korean characters first so they don't pollute the English split.
  const stripped = text.replace(KOREAN_RE, ' ')
  let englishWords = 0
  for (const tok of stripped.split(/\s+/)) {
    if (!tok) continue
    if (/[A-Za-z]/.test(tok)) englishWords += 1
  }
  return { koreanChars, englishWords }
}

/**
 * Estimate reading time for a DocumentJSON. Returns whole minutes (≥ 0). Caller
 * decides whether to render a pill — return value of 0 means "no readable
 * text found".
 */
export function estimateReadingTimeMinutes(doc: DocumentJSONV10 | null | undefined): number {
  if (!doc) return 0
  let totalKo = 0
  let totalEn = 0

  // Title + summary count too — they're prose the reader has to scan.
  const titleSum = countTokens(`${doc.title ?? ''}\n${doc.summary ?? ''}`)
  totalKo += titleSum.koreanChars
  totalEn += titleSum.englishWords

  for (const section of walkSections((doc.sections ?? []) as AnySection[])) {
    if (section.title) {
      const t = countTokens(section.title)
      totalKo += t.koreanChars
      totalEn += t.englishWords
    }
    for (const block of section.blocks ?? []) {
      for (const text of blockText(block)) {
        const t = countTokens(text)
        totalKo += t.koreanChars
        totalEn += t.englishWords
      }
    }
  }

  if (totalKo === 0 && totalEn === 0) return 0

  // 분 단위 가산. 두 언어가 섞이면 각자 자기 속도로 시간을 잡아 합산하는 게
  // 가장 정확하다 — Korean 500cpm, English 200wpm, 둘 다 보수적인 일반 독자치.
  const minutes = totalKo / KO_CPM + totalEn / EN_WPM
  return Math.max(1, Math.round(minutes))
}
