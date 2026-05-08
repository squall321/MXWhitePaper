/**
 * AI 액션 popover.
 *
 * EditorToolbar 에 들어가는 단일 "✨ AI" 버튼이 popover 를 토글하고, popover
 * 항목은 현재 문서의 첫 섹션 (또는 활성 섹션) 의 본문 텍스트를 BE 로 보낸 뒤
 * 결과를 미리보기 모달에 띄운다.
 *
 * 본 모듈은 placeholder LLM 응답을 가정한 UX 와이어링이다. 실제 LLM 연결 후에도
 * 호출 자체는 동일한 헬퍼 (`aiSummarize` 등) 를 그대로 쓴다.
 */
import { useEffect, useRef, useState } from 'react'
import type { Block, DocumentJSONV10, SectionLevel1 } from '@/types/document'
import { useEditorStore } from '@/features/editor/state'
import {
  aiContinue,
  aiPolish,
  aiSummarize,
  aiTitle,
  aiTranslate,
} from './api'

type ActionKey = 'summarize' | 'translate' | 'polish' | 'continue' | 'title'

interface PreviewState {
  action: ActionKey
  label: string
  result: string
}

/** 첫 섹션 본문에서 paragraph/quote/callout/list 텍스트를 모아 한 덩어리로. */
export function extractSectionText(doc: DocumentJSONV10 | null): string {
  if (!doc) return ''
  const first: SectionLevel1 | undefined = doc.sections[0]
  if (!first) return ''
  const parts: string[] = []
  for (const b of first.blocks as Block[]) {
    if (b.type === 'paragraph' && b.text) parts.push(b.text)
    else if (b.type === 'quote' && b.text) parts.push(b.text)
    else if (b.type === 'callout' && b.text) parts.push(b.text)
    else if (b.type === 'heading-4' && b.title) parts.push(b.title)
    else if (b.type === 'list' && Array.isArray(b.items))
      parts.push(b.items.join('\n'))
  }
  return parts.join('\n\n').trim()
}

interface AiButtonProps {
  /**
   * 결과 "삽입" 버튼이 눌렸을 때 호출되는 콜백. 기본 구현은
   * `document.execCommand('insertText')` 로 caret 위치에 삽입을 시도한다.
   * 호출자가 더 정교한 동작을 원할 때 override.
   */
  onInsert?: (text: string, action: ActionKey) => void
}

export function AiButton({ onInsert }: AiButtonProps) {
  const draft = useEditorStore((s) => s.draft)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<ActionKey | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  // click-outside / Escape — ExportMenu 패턴 미러.
  useEffect(() => {
    if (!open) return
    function onDoc(ev: MouseEvent) {
      if (!wrapRef.current) return
      if (!wrapRef.current.contains(ev.target as Node)) setOpen(false)
    }
    function onKey(ev: KeyboardEvent) {
      if (ev.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // 자동 에러 메시지 제거.
  useEffect(() => {
    if (!error) return
    const t = setTimeout(() => setError(null), 4000)
    return () => clearTimeout(t)
  }, [error])

  async function run(action: ActionKey) {
    setError(null)
    if (!draft) {
      setError('편집 중인 문서가 없습니다.')
      return
    }
    const text = extractSectionText(draft)
    if (!text) {
      setError('현재 섹션에 텍스트가 없습니다.')
      return
    }
    setBusy(action)
    try {
      let result = ''
      let label = ''
      if (action === 'summarize') {
        result = await aiSummarize(text, { targetLength: 'medium' })
        label = '요약 생성'
      } else if (action === 'translate') {
        result = await aiTranslate(text, 'en')
        label = '영문 번역'
      } else if (action === 'polish') {
        result = await aiPolish(text)
        label = '문장 다듬기'
      } else if (action === 'continue') {
        result = await aiContinue(text)
        label = '이어 쓰기'
      } else {
        result = await aiTitle(text)
        label = '제목 자동 생성'
      }
      setPreview({ action, label, result })
      setOpen(false)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'AI 호출 실패'
      setError(msg)
    } finally {
      setBusy(null)
    }
  }

  function handleInsert() {
    if (!preview) return
    if (onInsert) {
      onInsert(preview.result, preview.action)
    } else {
      try {
        document.execCommand('insertText', false, preview.result)
      } catch {
        /* noop — focus may be off the contenteditable */
      }
    }
    setPreview(null)
  }

  const itemClass =
    'flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-gray-700 hover:bg-smsg-50 hover:text-smsg-900 disabled:cursor-not-allowed disabled:opacity-50'

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-8 items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 text-xs font-medium text-gray-700 transition-all hover:-translate-y-px hover:border-smsg-500 hover:text-smsg-900 hover:shadow-sm focus-visible:outline-none focus-visible:shadow-focus"
        aria-haspopup="menu"
        aria-expanded={open}
        title="AI 보조 (요약/번역/다듬기/이어쓰기/제목)"
        data-testid="ai-button"
      >
        <span aria-hidden>✨</span> AI
        <span aria-hidden className="ml-0.5 text-[10px]">▾</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-popover mt-1 w-56 overflow-hidden rounded-md border border-gray-200 bg-white shadow-lg"
          data-testid="ai-menu"
        >
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => run('summarize')}
            className={itemClass}
            data-testid="ai-summarize"
          >
            <span aria-hidden>📝</span>
            <span>요약 생성</span>
            {busy === 'summarize' && (
              <span className="ml-auto text-[10px]">…</span>
            )}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => run('translate')}
            className={itemClass}
            data-testid="ai-translate"
          >
            <span aria-hidden>🌐</span>
            <span>영문 번역</span>
            {busy === 'translate' && (
              <span className="ml-auto text-[10px]">…</span>
            )}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => run('polish')}
            className={itemClass}
            data-testid="ai-polish"
          >
            <span aria-hidden>✏️</span>
            <span>문장 다듬기</span>
            {busy === 'polish' && (
              <span className="ml-auto text-[10px]">…</span>
            )}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => run('continue')}
            className={itemClass}
            data-testid="ai-continue"
          >
            <span aria-hidden>➡️</span>
            <span>이어 쓰기</span>
            {busy === 'continue' && (
              <span className="ml-auto text-[10px]">…</span>
            )}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => run('title')}
            className={itemClass}
            data-testid="ai-title"
          >
            <span aria-hidden>🏷️</span>
            <span>제목 자동 생성</span>
            {busy === 'title' && (
              <span className="ml-auto text-[10px]">…</span>
            )}
          </button>
        </div>
      )}

      {error && (
        <div
          role="status"
          className="absolute right-0 top-full mt-1 max-w-xs rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] text-amber-900 shadow-md"
          data-testid="ai-error"
        >
          {error}
        </div>
      )}

      {preview && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-modal flex items-center justify-center bg-black/30 p-4"
          data-testid="ai-preview"
          onClick={(ev) => {
            if (ev.target === ev.currentTarget) setPreview(null)
          }}
        >
          <div className="w-full max-w-lg rounded-lg bg-white p-4 shadow-xl">
            <div className="mb-2 text-sm font-semibold text-gray-900">
              {preview.label} 결과
            </div>
            <textarea
              readOnly
              value={preview.result}
              className="h-56 w-full resize-none rounded-md border border-gray-300 bg-gray-50 p-2 font-mono text-xs text-gray-800 focus:outline-none"
              data-testid="ai-preview-result"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="inline-flex h-8 items-center rounded-md border border-gray-300 bg-white px-3 text-xs font-medium text-gray-700 hover:border-smsg-500 hover:text-smsg-900"
                data-testid="ai-preview-cancel"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleInsert}
                className="inline-flex h-8 items-center rounded-md bg-smsg-700 px-3 text-xs font-semibold text-white hover:bg-smsg-900"
                data-testid="ai-preview-insert"
              >
                삽입
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
