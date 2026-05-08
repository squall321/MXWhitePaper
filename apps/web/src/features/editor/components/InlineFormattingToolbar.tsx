import { useEffect, useRef, useState } from 'react'
import type { DocumentJSONV10 } from '@/types/document'
import { useEditorStore } from '../state'
import { SectionLinkPicker } from './SectionLinkPicker'

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
 *
 * Link prompt UX — 두 단계:
 *   1) URL 입력 + "📑 현재 문서의 섹션" 버튼이 있는 inline 미니-모달
 *   2) 섹션 버튼 클릭 시 `SectionLinkPicker` 로 교체 (현재 문서의 섹션 검색)
 *
 *  열기 전에 `savedRangeRef` 에 Range 를 보관하고, 입력 직전 `restoreSelection`
 *  으로 복구해 `document.execCommand('insertText', …)` 가 사용자의 원래 캐럿
 *  위치에 텍스트를 떨어뜨리도록 한다. (모달이 열리면 contentEditable 의
 *  selection 이 사라지므로 saved Range 재주입이 필수.)
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
  // Two-step link prompt state.
  const [linkPromptOpen, setLinkPromptOpen] = useState(false)
  const [linkUrlDraft, setLinkUrlDraft] = useState('')
  const [sectionPickerOpen, setSectionPickerOpen] = useState(false)
  // Range stashed BEFORE the modal opens so we can restore the caret after
  // the modal steals focus and dispatch execCommand at the right spot.
  const savedRangeRef = useRef<Range | null>(null)
  // Snapshot of the contentEditable surface that owned the selection, so a
  // late-binding `insertText` can also re-focus it (some browsers won't run
  // execCommand until the editable host has focus).
  const savedEditorRef = useRef<HTMLElement | null>(null)
  // Read the document tree from the store imperatively — the toolbar only
  // needs it the moment the section picker is shown, no need to subscribe
  // on every keystroke. We snapshot via getState() inside the click handler
  // and stash on local state so the picker can render against a stable doc.
  const [pickerDoc, setPickerDoc] = useState<DocumentJSONV10 | null>(null)

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
      // Save selection + editor so the modal can restore them. Selection is
      // lost as soon as the prompt input takes focus.
      savedRangeRef.current = range.cloneRange()
      savedEditorRef.current = editor
      const selText = sel.toString()
      const initial =
        selText.startsWith('http') || selText.startsWith('[[') ? selText : ''
      setLinkUrlDraft(initial)
      setLinkPromptOpen(true)
      return
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

  /** Restore the saved Range so subsequent execCommand(...) lands at the
   *  user's original caret. Returns true if the restore + focus succeeded. */
  const restoreSavedSelection = (): boolean => {
    const saved = savedRangeRef.current
    const editor = savedEditorRef.current
    if (!saved || !editor) return false
    editor.focus()
    const selWin = window.getSelection()
    if (!selWin) return false
    selWin.removeAllRanges()
    selWin.addRange(saved)
    return true
  }

  const closeLinkPrompt = () => {
    setLinkPromptOpen(false)
    setSectionPickerOpen(false)
    setLinkUrlDraft('')
    setPickerDoc(null)
    savedRangeRef.current = null
    savedEditorRef.current = null
  }

  /** Apply the URL the user typed (free-form path). Mirrors the previous
   *  `window.prompt` branch in `exec('link')`. */
  const applyTypedUrl = () => {
    const url = linkUrlDraft.trim()
    if (!url) {
      closeLinkPrompt()
      return
    }
    const editor = savedEditorRef.current
    if (!restoreSavedSelection() || !editor) {
      closeLinkPrompt()
      return
    }
    if (url.startsWith('[[') && url.endsWith(']]')) {
      document.execCommand('insertText', false, url)
    } else {
      document.execCommand('createLink', false, url)
    }
    editor.dispatchEvent(new InputEvent('input', { bubbles: true }))
    closeLinkPrompt()
  }

  /** When the user picks a section from the picker, drop a wiki-shorthand
   *  `[[#section-X.Y|타이틀]]` at the saved Range. */
  const applySectionPick = (anchor: string, display: string) => {
    const editor = savedEditorRef.current
    const wiki = `[[#${anchor}|${display}]]`
    if (!restoreSavedSelection() || !editor) {
      closeLinkPrompt()
      return
    }
    document.execCommand('insertText', false, wiki)
    editor.dispatchEvent(new InputEvent('input', { bubbles: true }))
    closeLinkPrompt()
  }

  if (!pos && !linkPromptOpen && !sectionPickerOpen) return null

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
    <>
      {pos && (
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
      )}

      {linkPromptOpen && !sectionPickerOpen && (
        <div
          className="fixed inset-0 z-modal flex items-start justify-center bg-black/30 pt-24"
          role="dialog"
          aria-modal="true"
          aria-label="링크 입력"
          data-testid="inline-link-prompt"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeLinkPrompt()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              closeLinkPrompt()
            }
          }}
        >
          <div className="w-full max-w-md rounded-md border border-gray-200 bg-white p-3 shadow-lg">
            <label
              htmlFor="inline-link-prompt-url"
              className="mb-1.5 block text-xs font-medium text-gray-600"
            >
              링크 URL — 외부는 https://… , 위키 내부는 [[slug]] 형식
            </label>
            <input
              id="inline-link-prompt-url"
              type="text"
              autoFocus
              value={linkUrlDraft}
              onChange={(e) => setLinkUrlDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  applyTypedUrl()
                }
              }}
              placeholder="https://… 또는 [[slug]]"
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-smsg-500 focus:outline-none"
              data-testid="inline-link-prompt-input"
            />
            <div className="mt-3 flex items-center justify-between gap-2">
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  const snapshot = useEditorStore.getState().draft
                  if (!snapshot) return
                  setPickerDoc(snapshot)
                  setSectionPickerOpen(true)
                }}
                className="inline-flex items-center gap-1 rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                data-testid="inline-link-prompt-section-btn"
              >
                <span aria-hidden="true">📑</span>
                <span>현재 문서의 섹션</span>
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={closeLinkPrompt}
                  className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={applyTypedUrl}
                  className="rounded bg-smsg-600 px-3 py-1 text-xs font-medium text-white hover:bg-smsg-700"
                >
                  적용
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {sectionPickerOpen && pickerDoc && (
        <SectionLinkPicker
          document={pickerDoc}
          onSelect={(pick) => applySectionPick(pick.anchor, pick.display)}
          onCancel={() => setSectionPickerOpen(false)}
        />
      )}
    </>
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
