import { Fragment, type ReactNode } from 'react'
import { parseInline } from '@/lib/wiki-link'
import { WikiLink } from './WikiLink'
import { GlossaryTooltip } from '../GlossaryTooltip'

interface InlineProps {
  text: string
  /**
   * When true (default), match terms in the glossary and wrap them in a
   * hover tooltip. Pass `false` for input fields / contexts where extra
   * spans are undesirable.
   */
  glossary?: boolean
}

/**
 * Renders inline text — applies markdown-lite (bold, italic, code) AND
 * wraps `[[wiki]]` references with `<WikiLink>`. Wiki links are detected
 * FIRST so a literal `**[[foo]]**` becomes <strong><WikiLink/></strong>.
 *
 * Inline syntax:
 *   `**bold**`     → <strong>
 *   `*italic*`     → <em>
 *   `` `code` ``   → <code>
 *
 * Sprint 6: glossary terms in plain-text fragments are wrapped in a
 * `<GlossaryTooltip>` so hovering shows their definition.
 */
export function Inline({ text, glossary = true }: InlineProps) {
  const nodes = parseInline(text)
  return (
    <>
      {nodes.map((n, i) => {
        if (n.kind === 'wiki') {
          return (
            <WikiLink
              key={i}
              slug={n.slug}
              anchor={n.anchor}
              display={n.display}
            />
          )
        }
        const md = renderMarkdownLite(n.value, glossary)
        return <Fragment key={i}>{md}</Fragment>
      })}
    </>
  )
}

/**
 * Render Anti-fragile markdown-lite: bold > code > italic. Returns a flat list
 * of strings + React nodes. No HTML injection — every replacement is an
 * element, so the original text is never interpolated as HTML. Plain text
 * fragments may be wrapped in <GlossaryTooltip> for term annotation.
 */
function renderMarkdownLite(text: string, glossary: boolean): ReactNode[] {
  const out: ReactNode[] = []
  let buf = ''
  let i = 0
  let key = 0

  const flush = () => {
    if (buf.length > 0) {
      out.push(
        glossary ? <GlossaryTooltip key={`t${key++}`} text={buf} /> : buf,
      )
      buf = ''
    }
  }

  while (i < text.length) {
    if (text.startsWith('**', i)) {
      const close = text.indexOf('**', i + 2)
      if (close > i + 2) {
        flush()
        out.push(<strong key={`b${key++}`}>{text.slice(i + 2, close)}</strong>)
        i = close + 2
        continue
      }
    }
    if (text[i] === '`') {
      const close = text.indexOf('`', i + 1)
      if (close > i + 1) {
        flush()
        out.push(
          <code
            key={`c${key++}`}
            className="rounded bg-smsg-100 px-1 py-0.5 text-[0.95em] font-mono"
          >
            {text.slice(i + 1, close)}
          </code>,
        )
        i = close + 1
        continue
      }
    }
    if (text[i] === '*' && text[i + 1] !== '*') {
      let close = -1
      for (let j = i + 1; j < text.length; j++) {
        if (text[j] === '*' && text[j + 1] !== '*' && text[j - 1] !== '*') {
          close = j
          break
        }
      }
      if (close > i + 1) {
        flush()
        out.push(<em key={`i${key++}`}>{text.slice(i + 1, close)}</em>)
        i = close + 1
        continue
      }
    }
    buf += text[i]
    i++
  }
  flush()
  return out
}
