import { Fragment, useEffect, useRef, type ReactNode } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { parseInline } from '@/lib/wiki-link'
import { WikiLink } from './WikiLink'
import { GlossaryTooltip } from '../GlossaryTooltip'
import { useEditorStore } from '@/features/editor/state'

/**
 * Render a slice of LaTeX as KaTeX inline math. Used by `$…$` markers in
 * paragraph text. Errors are swallowed (the raw expression is shown
 * instead) so a single bad formula doesn't blank the surrounding line.
 */
function InlineMath({ expr }: { expr: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    try {
      katex.render(expr, el, {
        displayMode: false,
        throwOnError: false,
        strict: 'ignore',
      })
    } catch {
      el.textContent = expr
    }
  }, [expr])
  return <span ref={ref} aria-label={`수식 ${expr}`} className="mx-0.5" />
}

interface InlineProps {
  text: string
  /**
   * When true (default), match terms in the glossary and wrap them in a
   * hover tooltip. Pass `false` for input fields / contexts where extra
   * spans are undesirable.
   */
  glossary?: boolean
  /**
   * Optional override for variable resolution. Falls back to the active
   * editor draft's `variables` map. Tests pass an explicit map so they don't
   * have to bind the editor store.
   */
  variables?: Record<string, string>
}

/** Variable token grammar: `{{name}}` or `{{name|fallback}}`. Name is
 * alphanumeric + underscore + hyphen. Fallback is a literal string up to the
 * closing `}}`. Returns `null` when text doesn't start with a token here. */
const VAR_NAME_RE = /^[A-Za-z0-9_-]+$/

/**
 * Renders inline text — applies markdown-lite (bold, italic, code) AND
 * wraps `[[wiki]]` references with `<WikiLink>`. Wiki links are detected
 * FIRST so a literal `**[[foo]]**` becomes <strong><WikiLink/></strong>.
 *
 * Inline syntax:
 *   `**bold**`     → <strong>
 *   `~~strike~~`   → <s>
 *   `*italic*`     → <em>
 *   `` `code` ``   → <code>
 *   `[^N]`         → <sup><a href="#fn-N" id="fnref-N">[N]</a></sup>
 *                    (pandoc-style footnote reference; tag is alphanumeric/hyphen)
 *
 * Sprint 6: glossary terms in plain-text fragments are wrapped in a
 * `<GlossaryTooltip>` so hovering shows their definition.
 */
export function Inline({ text, glossary = true, variables }: InlineProps) {
  // When the caller doesn't pass an explicit map, pull it from the active
  // editor draft. Selecting via zustand keeps re-renders scoped to actual
  // changes in `variables`. JSON-schema regen types `additionalProperties`
  // as `string | undefined`, so we coerce to a defined-only record before
  // passing it down — the substituter doesn't need to handle undefined.
  const draftVars = useEditorStore((s) => s.draft?.variables)
  const vars: Record<string, string> | undefined = variables ?? (
    draftVars
      ? Object.fromEntries(Object.entries(draftVars).filter(([, v]) => v !== undefined) as [string, string][])
      : undefined
  )
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
        if (n.kind === 'cite') {
          // Citation references jump to a `BibliographyBlock` entry whose
          // anchor lives at `id="cite-KEY"`. The display label defaults to
          // the key so `[[cite:Smith2020]]` reads naturally inline.
          return (
            <a
              key={i}
              href={`#cite-${n.key}`}
              className="text-link no-underline hover:underline"
              aria-label={`인용 ${n.key}`}
              data-cite-ref={n.key}
            >
              [{n.display ?? n.key}]
            </a>
          )
        }
        const md = renderMarkdownLite(n.value, glossary, vars)
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
function renderMarkdownLite(
  text: string,
  glossary: boolean,
  variables?: Record<string, string>,
): ReactNode[] {
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
    // Variable token `{{name}}` or `{{name|fallback}}`. Resolution order:
    // (1) variables[name] when defined; (2) literal fallback when present;
    // (3) unfilled marker. Sits before `~~` so `{{}}` doesn't collide with
    // anything inside a strikethrough span.
    if (text.startsWith('{{', i)) {
      const close = text.indexOf('}}', i + 2)
      if (close > i + 2) {
        const body = text.slice(i + 2, close)
        const pipe = body.indexOf('|')
        const name = pipe >= 0 ? body.slice(0, pipe) : body
        const fallback = pipe >= 0 ? body.slice(pipe + 1) : null
        if (VAR_NAME_RE.test(name)) {
          flush()
          const resolved = variables?.[name]
          if (resolved !== undefined) {
            out.push(<Fragment key={`v${key++}`}>{resolved}</Fragment>)
          } else if (fallback !== null) {
            out.push(<Fragment key={`v${key++}`}>{fallback}</Fragment>)
          } else {
            out.push(
              <span
                key={`v${key++}`}
                className="var-unfilled"
                title={`정의되지 않은 변수: ${name}`}
              >{`{{${name}}}`}</span>,
            )
          }
          i = close + 2
          continue
        }
      }
    }
    // Strikethrough — same precedence as bold (2-char delimiter); must come
    // before single-char `*italic*` so `~~foo~~` doesn't interleave.
    if (text.startsWith('~~', i)) {
      const close = text.indexOf('~~', i + 2)
      if (close > i + 2) {
        flush()
        out.push(<s key={`s${key++}`}>{text.slice(i + 2, close)}</s>)
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
    // Inline LaTeX math `$…$`. KaTeX in inline mode (no display centering).
    // We require non-whitespace right after the opening `$` so prose like
    // "₩50" or "$5 USD and $10 CAD" doesn't accidentally get parsed as
    // math. The DOCX importer emits this exact form for `<m:oMath>`.
    // `$$…$$` is reserved for display-mode math (handled below).
    if (text[i] === '$' && text[i + 1] === '$') {
      const close = text.indexOf('$$', i + 2)
      if (close > i + 2) {
        flush()
        out.push(<InlineMath key={`m${key++}`} expr={text.slice(i + 2, close)} />)
        i = close + 2
        continue
      }
    }
    if (text[i] === '$' && text[i + 1] !== '$' && text[i + 1] !== ' ') {
      // Find the next single `$` that isn't escaped.
      let close = -1
      for (let j = i + 1; j < text.length; j++) {
        if (text[j] === '$' && text[j - 1] !== '\\') {
          close = j
          break
        }
      }
      if (close > i + 1) {
        const expr = text.slice(i + 1, close)
        // Sanity: don't render currency-looking spans like "$5".
        // Math expressions almost always include a letter/operator.
        if (/[\\^_{}\\\\=()A-Za-z]/.test(expr)) {
          flush()
          out.push(<InlineMath key={`m${key++}`} expr={expr} />)
          i = close + 1
          continue
        }
      }
    }
    // Footnote / endnote reference `[^X]` — alphanumeric / hyphen tag.
    // Footnote: `[^1]`        → href=#fn-1,    display "[1]"
    // Endnote:  `[^en-1]`     → href=#fn-en-1, display "[1]" (en- stripped)
    // We always emit href under the `fn-` prefix so a single CSS rule
    // covers both anchor targets. The reference carries `id="fnref-X"`
    // so the definition's `↩` back-link can return the reader inline.
    // Note: code spans short-circuit before this branch (they consume the
    // whole `…` blob), so `[^N]` inside `\`code\`` stays literal.
    if (text[i] === '[' && text[i + 1] === '^') {
      const close = text.indexOf(']', i + 2)
      if (close > i + 2) {
        const tag = text.slice(i + 2, close)
        if (/^[A-Za-z0-9-]+$/.test(tag)) {
          flush()
          const isEndnote = tag.startsWith('en-')
          const display = isEndnote ? tag.slice(3) : tag
          out.push(
            <sup
              key={`fn${key++}`}
              id={`fnref-${tag}`}
              className="text-[0.75em]"
            >
              <a
                href={`#fn-${tag}`}
                className="text-link no-underline hover:underline"
                aria-label={isEndnote ? `미주 ${display}` : `각주 ${display}`}
              >
                [{display}]
              </a>
            </sup>,
          )
          i = close + 1
          continue
        }
      }
    }
    buf += text[i]
    i++
  }
  flush()
  return out
}
