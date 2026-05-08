import { useEffect, useRef, useState } from 'react'

/**
 * InlineFormattingToolbar — small floating bubble that hovers above any
 * non-collapsed selection inside `[data-inline-text-editor]` surfaces.
 *
 * Implementation choice: relies on `document.execCommand`. It's deprecated,
 * but every Chromium build still ships it and it's the *only* path that
 * doesn't require shipping a custom selection model + rich-text renderer
 * (which the user has explicitly rejected). Persistence happens via the
 * existing `onInput`/`onBlur` debounce in InlineTextBlockEditor — execCommand
 * mutates the contentEditable DOM, which fires `input`, which schedules a
 * patchBlock save. Nothing extra to wire up.
 *
 * Shortcuts (also bound globally inside InlineTextBlockEditor):
 *   - Ctrl/Cmd+B     bold
 *   - Ctrl/Cmd+I     italic
 *   - Ctrl/Cmd+U     underline
 *   - Ctrl/Cmd+E     inline code (wraps selection in <code>)
 *   - Ctrl/Cmd+K     link prompt (wiki-internal: write `[[slug]]`)
 *
 * The toolbar is positioned via `getBoundingClientRect` of the current
 * selection range; it auto-hides on collapse / focus loss / Esc.
 */

type Cmd = 'bold' | 'italic' | 'underline' | 'strikeThrough' | 'code' | 'link' | 'clear'

interface Props {
  /**
   * Selector that the toolbar binds to. Defaults to inline text editors —
   * any element with `data-inline-text-editor`. The toolbar lives at the
   * page level so a single instance handles every block.
   */
  rootSelector?: string
}

interface ToolbarPos {
  left: number
  top: number
}

export function InlineFormattingToolbar({
  rootSelector = '[data-inline-text-editor]',
}: Props) {
  const [pos, setPos] = useState<ToolbarPos | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const reposition = () => {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        setPos(null)
        return
      }
      const range = sel.getRangeAt(0)
      const startEl =
        range.startContainer.nodeType === Node.ELEMENT_NODE
          ? (range.startContainer as Element)
          : (range.startContainer.parentElement as Element | null)
      if (!startEl || !startEl.closest(rootSelector)) {
        setPos(null)
        return
      }
      const rect = range.getBoundingClientRect()
      // If the rect has no width (e.g. inside a fresh empty contentEditable),
      // fall back to the container so the toolbar doesn't land at (0,0).
      const target =
        rect.width === 0 && rect.height === 0
          ? startEl.closest(rootSelector)?.getBoundingClientRect()
          : rect
      if (!target) {
        setPos(null)
        return
      }
      // Place the toolbar 36px above the selection, clamped to the viewport.
      const left = Math.max(8, Math.min(window.innerWidth - 280, target.left))
      const top = Math.max(8, target.top - 38)
      setPos({ left, top })
    }
    const onSelChange = () => reposition()
    const onScroll = () => reposition()
    const onMouseUp = () => reposition()
    document.addEventListener('selectionchange', onSelChange)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      document.removeEventListener('selectionchange', onSelChange)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [rootSelector])

  // Hide on Escape so the toolbar doesn't get stuck.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && pos) setPos(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pos])

  const exec = (cmd: Cmd) => {
    // Re-grab selection right before execCommand — the button's mousedown
    // shouldn't have stolen focus (we preventDefault below) but the safety
    // belt is cheap.
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return
    const range = sel.getRangeAt(0)
    const editor = (
      range.startContainer.nodeType === Node.ELEMENT_NODE
        ? (range.startContainer as Element)
        : range.startContainer.parentElement
    )?.closest('[data-inline-text-editor]') as HTMLElement | null
    if (!editor) return

    if (cmd === 'bold' || cmd === 'italic' || cmd === 'underline' || cmd === 'strikeThrough') {
      document.execCommand(cmd)
    } else if (cmd === 'code') {
      // execCommand has no native "code" — wrap selection manually.
      wrapSelection(range, 'code', { class: 'inline-code' })
    } else if (cmd === 'link') {
      const initial =
        sel.toString().startsWith('http') || sel.toString().startsWith('[[')
          ? sel.toString()
          : ''
      const url = window.prompt(
        '링크 URL — 외부는 https://… , 위키 내부는 [[slug]] 형식',
        initial,
      )
      if (!url) return
      // Wiki shorthand: replace selection with `[[slug]]` plain text so the
      // existing Inline parser handles it on read. For external URLs use the
      // browser's createLink so the saved HTML carries an <a href>.
      if (url.startsWith('[[') && url.endsWith(']]')) {
        document.execCommand('insertText', false, url)
      } else {
        document.execCommand('createLink', false, url)
      }
    } else if (cmd === 'clear') {
      document.execCommand('removeFormat')
      // removeFormat doesn't strip <a>; do it manually.
      document.execCommand('unlink')
    }

    // Trigger a synthetic input event so InlineTextBlockEditor's debounce
    // picks up the mutation. execCommand on contentEditable does fire input
    // in modern Chromium, but better safe than sorry.
    editor.dispatchEvent(new InputEvent('input', { bubbles: true }))
  }

  if (!pos) return null

  const Btn = ({
    label,
    title,
    cmd,
    children,
  }: {
    label: string
    title: string
    cmd: Cmd
    children: React.ReactNode
  }) => (
    <button
      type="button"
      aria-label={label}
      title={title}
      // Keep selection alive: prevent the click from stealing focus.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => exec(cmd)}
      className="inline-grid h-7 w-7 place-items-center rounded text-sm text-gray-700 hover:bg-smsg-50 hover:text-smsg-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-smsg-300"
    >
      {children}
    </button>
  )

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label="텍스트 서식"
      data-inline-formatting-toolbar
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        zIndex: 9100,
      }}
      className="flex items-center gap-0.5 rounded-md border border-gray-200 bg-white px-1 py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
    >
      <Btn label="굵게" title="굵게 (Ctrl+B)" cmd="bold">
        <span className="font-bold">B</span>
      </Btn>
      <Btn label="기울임" title="기울임 (Ctrl+I)" cmd="italic">
        <span className="italic">I</span>
      </Btn>
      <Btn label="밑줄" title="밑줄 (Ctrl+U)" cmd="underline">
        <span className="underline">U</span>
      </Btn>
      <Btn label="취소선" title="취소선" cmd="strikeThrough">
        <span className="line-through">S</span>
      </Btn>
      <span className="mx-0.5 h-4 w-px bg-gray-200" aria-hidden="true" />
      <Btn label="인라인 코드" title="인라인 코드 (Ctrl+E)" cmd="code">
        <span className="font-mono text-xs">{'<>'}</span>
      </Btn>
      <Btn label="링크" title="링크 (Ctrl+K)" cmd="link">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path
            d="M5 9l4-4M4 7L2.5 8.5a2.12 2.12 0 003 3L7 10M10 7l1.5-1.5a2.12 2.12 0 00-3-3L7 4"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      </Btn>
      <span className="mx-0.5 h-4 w-px bg-gray-200" aria-hidden="true" />
      <Btn label="서식 지우기" title="서식 지우기" cmd="clear">
        <span className="text-xs">⌫</span>
      </Btn>
    </div>
  )
}

/**
 * Wrap the current selection in a tag (used for inline-code since execCommand
 * has no native equivalent). Falls back gracefully if the selection has been
 * lost.
 */
function wrapSelection(range: Range, tag: string, attrs: Record<string, string> = {}) {
  if (range.collapsed) return
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  try {
    el.appendChild(range.extractContents())
    range.insertNode(el)
    // Move caret to after the wrap so subsequent typing isn't inside <code>.
    const sel = window.getSelection()
    if (sel) {
      const after = document.createRange()
      after.setStartAfter(el)
      after.collapse(true)
      sel.removeAllRanges()
      sel.addRange(after)
    }
  } catch {
    // surroundContents can throw on partial-element selections; swallow.
  }
}
